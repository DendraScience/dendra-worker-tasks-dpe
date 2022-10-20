/**
 * Subscribe to subjects after preprocessing expressions are ready. Add an event listener for messages.
 */

const moment = require('../../lib/moment-fn')
const get = require('lodash.get')
/* eslint-disable-next-line camelcase */
const { DEFAULT_WriteOptions, Point } = require('@influxdata/influxdb-client')
const { BucketsAPI, OrgsAPI } = require('@influxdata/influxdb-client-apis')
const { handleMessage, setSubOpts } = require('../../lib/sub')
const { PointsWriter } = require('../../lib/points-writer')

/**
 * Function for batch writing points to Influx.
 */
async function write() {
  const { callbacks, influx2, options } = this

  try {
    if (!this.bucketsAPI) this.bucketsAPI = new BucketsAPI(influx2.influxDB)
    if (!this.orgsAPI) this.orgsAPI = new OrgsAPI(influx2.influxDB)

    if (!this.writeApi)
      this.writeApi = influx2.influxDB.getWriteApi(
        influx2.org,
        options.database,
        options.precision || 'ms',
        {
          // SEE: https://influxdata.github.io/influxdb-client-js/influxdb-client.writeoptions.html
          // SEE: https://influxdata.github.io/influxdb-client-js/influxdb-client.writeretryoptions.html
          /* eslint-disable-next-line camelcase */
          batchSize: DEFAULT_WriteOptions.batchSize + 1,
          flushInterval: 0,
          maxBufferLines: 30000,
          maxRetries: 0
        }
      )
  } catch (err) {
    callbacks.forEach(cb => cb(err))
  }

  const { bucketsAPI, orgsAPI, points, writeApi } = this

  this.points = []
  this.callbacks = []

  let createDb
  let stop

  while (!stop) {
    if (createDb) {
      this.logger.info('Creating database', this.options)

      try {
        const organizations = await orgsAPI.getOrgs({ org: influx2.org })
        if (!organizations.orgs.length)
          throw new Error('Organization not found')

        // Create database with shard duration specified (HARDCODED to 20 years)
        await bucketsAPI.postBuckets({
          body: {
            name: options.database,
            orgID: organizations.orgs[0].id,
            retentionRules: [
              {
                everySeconds: 0,
                shardGroupDurationsSeconds: 24 * 60 * 60 * 7300,
                type: 'expire'
              }
            ],
            rp: 'autogen'
          }
        })
      } catch (err) {
        callbacks.forEach(cb => cb(err))
        stop = true
      }
    }

    try {
      this.logger.info(`Writing (${points.length}) point(s)`, this.options)

      writeApi.writePoints(points)
      await writeApi.flush()

      callbacks.forEach(cb => cb())
      stop = true
    } catch (err) {
      if (!createDb && err.statusCode === 404) {
        this.logger.warn('Writing failed, database not found', this.options)

        createDb = true
      } else {
        callbacks.forEach(cb => cb(err))
        stop = true
      }
    }
  }
}

async function processItem(
  { data, dataObj, msgRc, msgSeq },
  {
    errorSubject,
    ignoreErrorsAtRedelivery,
    influx2,
    logger,
    m,
    metricsGroups,
    pubSubject,
    stan,
    subSubject,
    writerOptions
  }
) {
  try {
    /*
      Validate inbound message data.
     */

    if (!dataObj.payload) throw new Error('Missing payload object')

    const { options, points } = dataObj.payload

    if (typeof options !== 'object') throw new Error('Invalid payload.options')
    if (!Array.isArray(points)) throw new Error('Invalid payload.points')

    /*
      Get cached writer, or create/cache a writer.
     */

    const writer = PointsWriter.cached(
      `${options.database}$${options.precision}$${options.retentionPolicy}`,
      m.props && m.props.lruLimit,
      {
        influx2,
        logger,
        options,
        write
      },
      writerOptions
    )

    /*
      Map time values to timestamp. Enqueue points for writing.
     */

    const beforeLength = writer.points.length

    for (let i = 0; i < points.length; i++) {
      const point = points[i]
      const { measurement } = point

      if (!measurement || point.time === undefined) continue

      const time = moment(point.time).utc()
      if (!(time && time.isValid()))
        throw new Error(`Invalid points[${i}].time format`)

      const pt = new Point(measurement)

      pt.timestamp(time.toDate())

      if (typeof point.tags === 'object')
        for (const [k, v] of Object.entries(point.tags)) {
          if (k && v) pt.tag(k, v + '')
        }

      if (typeof point.fields === 'object')
        for (const [k, v] of Object.entries(point.fields)) {
          if (k)
            switch (typeof v) {
              case 'boolean':
                pt.booleanField(k, v)
                break
              case 'number':
                pt.floatField(k, v)
                break
              case 'string':
                pt.stringField(k, v)
                break
            }
        }

      writer.points.push(pt)
    }

    logger.info(`Pushed (${writer.points.length - beforeLength}) point(s)`)

    await new Promise((resolve, reject) => {
      writer.check(err => (err ? reject(err) : resolve()))
    })

    logger.info('Point(s) written', { msgSeq, subSubject })

    /*
      Update metrics (e.g. count).
     */

    if (m.metrics && metricsGroups) {
      Object.keys(metricsGroups).forEach(group => {
        const value = get(dataObj, metricsGroups[group])
        if (value !== undefined) {
          const key = `${group}_${value}`
          let metric = m.metrics[key]
          if (!metric) metric = m.metrics[key] = { count: 0, group, value }
          metric.ts = new Date().getTime()
          metric.count++
        }
      })
    }
  } catch (err) {
    if (errorSubject && subSubject !== errorSubject) {
      logger.error('Processing error', { msgSeq, subSubject, err, dataObj })

      const guid = await new Promise((resolve, reject) => {
        stan.publish(errorSubject, data, (err, guid) =>
          err ? reject(err) : resolve(guid)
        )
      })

      logger.info('Published to error subject', {
        msgSeq,
        subSubject,
        errorSubject,
        guid
      })
    } else if (msgRc >= ignoreErrorsAtRedelivery) {
      logger.warn('Processing error (ignored)', {
        msgRc,
        msgSeq,
        subSubject,
        ignoreErrorsAtRedelivery,
        err,
        dataObj
      })
    } else {
      throw err
    }
  }
}

module.exports = {
  guard(m) {
    return (
      !m.subscriptionsError &&
      m.private.stan &&
      m.stanConnected &&
      m.private.influx2 &&
      m.sourcesTs === m.versionTs &&
      m.subscriptionsTs !== m.versionTs &&
      !m.private.subscriptions
    )
  },

  execute(m, { logger }) {
    const { influx2, stan } = m.private
    const subs = []

    m.sourceKeys.forEach(sourceKey => {
      const source = m.sources[sourceKey]
      const {
        error_subject: errorSubject,
        error_writer_options: errorWriterOptions,
        ignore_before_date: ignoreBeforeDate,
        ignore_errors: ignoreErrors,
        ignore_errors_at_redelivery: ignoreErrorsAtRedelivery,
        metrics_groups: metricsGroups,
        pub_to_subject: pubSubject,
        sub_options: subOptions,
        sub_to_subject: subSubject,
        writer_options: writerOptions
      } = source

      try {
        const opts = setSubOpts(stan.subscriptionOptions(), subOptions)

        const sub = stan.subscribe(subSubject, opts)

        sub.on(
          'message',
          handleMessage.bind({
            errorSubject,
            ignoreBeforeDate: ignoreBeforeDate && new Date(ignoreBeforeDate),
            ignoreErrorsAtRedelivery:
              typeof ignoreErrorsAtRedelivery === 'number'
                ? ignoreErrorsAtRedelivery
                : ignoreErrors === true
                ? 0
                : undefined,
            influx2,
            logger,
            m,
            metricsGroups,
            processItem,
            pubSubject,
            stan,
            subSubject,
            writerOptions:
              subSubject === errorSubject
                ? Object.assign({}, writerOptions, errorWriterOptions)
                : writerOptions
          })
        )

        subs.push(sub)
      } catch (err) {
        logger.error('Subscription error', { err, sourceKey, subSubject })
      }
    })

    return subs
  },

  assign(m, res, { logger }) {
    m.private.subscriptions = res
    m.subscriptionsTs = m.versionTs

    logger.info('Subscriptions ready')
  }
}
