/**
 * Subscribe to subjects after preprocessing expressions are ready. Add an event listener for messages.
 */

const get = require('lodash.get')
const { handleMessage, setSubOpts } = require('../../lib/sub')
const { PointsWriter } = require('../../lib/points-writer')

/**
 * Function for batch writing points to webhook.
 */
async function write() {
  const { callbacks, options, points, webhooks } = this
  this.points = []
  this.callbacks = []

  try {
    this.logger.info(`Writing (${points.length}) point(s)`, this.options)

    const webhook =
      (options.webhook && webhooks[options.webhook]) || webhooks.default

    await webhook({ data: points, url: options.path || '/' })
    callbacks.forEach(cb => cb())
  } catch (err) {
    callbacks.forEach(cb => cb(err))
  }
}

async function processItem(
  { data, dataObj, msgRc, msgSeq },
  {
    errorSubject,
    ignoreErrorsAtRedelivery,
    logger,
    m,
    metricsGroups,
    pubSubject,
    stan,
    subSubject,
    webhooks,
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
    if (!Array.isArray(points)) throw new Error('Invalid payload.data')

    /*
      Get cached writer, or create/cache a writer.
     */

    const writer = PointsWriter.cached(
      `${options.webhook}$${options.path}`,
      m.props && m.props.lruLimit,
      {
        logger,
        options,
        webhooks,
        write
      },
      writerOptions
    )

    /*
      Map time values to timestamp. Enqueue points for writing.
     */

    const beforeLength = writer.points.length

    for (let i = 0; i < points.length; i++) {
      writer.points.push(points[i])
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
      m.private.webhooks &&
      m.sourcesTs === m.versionTs &&
      m.subscriptionsTs !== m.versionTs &&
      !m.private.subscriptions
    )
  },

  execute(m, { logger }) {
    const { stan, webhooks } = m.private
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
            logger,
            m,
            metricsGroups,
            processItem,
            pubSubject,
            stan,
            subSubject,
            webhooks,
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
