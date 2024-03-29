/**
 * Subscribe to subjects after preprocessing expressions are ready. Add an event listener for messages.
 */

const moment = require('../../lib/moment-fn')
const get = require('lodash.get')
const { assertNoErrors } = require('influx/lib/src/results')
const { escape } = require('influx/lib/src/grammar/escape')
const { handleMessage, setSubOpts } = require('../../lib/sub')
const { PointsWriter } = require('../../lib/points-writer')

/**
 * Function for batch writing points to Influx.
 */
async function write() {
  const { callbacks, influx, options, points } = this
  this.points = []
  this.callbacks = []

  let createDb
  let stop

  while (!stop) {
    if (createDb) {
      this.logger.info('Creating database', this.options)

      try {
        // NOTE: Does NOT support shard options, need to use newer official client!
        // await influx.createDatabase(options.database)

        // HACK: Create database with shard duration specified (HARDCODED to 20 years)
        await influx._pool
          .json(
            influx._getQueryOpts(
              {
                q: `create database ${escape.quoted(
                  options.database
                )} with duration inf shard duration 7300d name "autogen"`
              },
              'POST'
            )
          )
          .then(assertNoErrors)
          .then(() => undefined)
      } catch (err) {
        callbacks.forEach(cb => cb(err))
        stop = true
      }
    }

    try {
      this.logger.info(`Writing (${points.length}) point(s)`, this.options)

      await influx.writePoints(points, options)
      callbacks.forEach(cb => cb())
      stop = true
    } catch (err) {
      if (!createDb && err.res && err.res.statusCode === 404) {
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
    influx,
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
        influx,
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

      point.timestamp = time.toDate()
      delete point.time

      writer.points.push(point)
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
      m.private.influx &&
      m.sourcesTs === m.versionTs &&
      m.subscriptionsTs !== m.versionTs &&
      !m.private.subscriptions
    )
  },

  execute(m, { logger }) {
    const { influx, stan } = m.private
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
            influx,
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
