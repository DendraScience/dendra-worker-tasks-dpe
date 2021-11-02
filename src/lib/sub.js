/**
 * Subscription helpers.
 */

function handleMessage(msg) {
  const { logger, m, processItem, subSubject } = this

  if (!msg) {
    logger.error('Message undefined')
    return
  }

  const msgRc = msg.getRedeliveryCount()
  const msgSeq = msg.getSequence()
  const msgTs = msg.getTimestamp()

  logger.info('Message received', { msgRc, msgSeq, msgTs, subSubject })

  if (m.subscriptionsTs !== m.versionTs) {
    logger.info('Message deferred', { msgSeq, subSubject })
    return
  }

  const { ignoreBeforeDate } = this
  if (ignoreBeforeDate && msgTs < ignoreBeforeDate) {
    logger.info('Message ignored', {
      msgSeq,
      subSubject,
      ignoreBeforeDate
    })
    msg.ack()
    return
  }

  try {
    const data = msg.getData()
    const dataObj = JSON.parse(data)

    processItem({ data, dataObj, msgRc, msgSeq }, this)
      .then(() => msg.ack())
      .catch(err => {
        logger.error('Message processing error', {
          msgSeq,
          subSubject,
          err,
          dataObj
        })
      })
  } catch (err) {
    logger.error('Message error', { msgSeq, subSubject, err })
  }
}

function setSubOpts(opts, subOptions) {
  opts.setManualAckMode(true)

  if (subOptions && typeof subOptions.start_at_time_delta === 'number')
    opts.setStartAtTimeDelta(subOptions.start_at_time_delta)
  else opts.setDeliverAllAvailable()

  if (subOptions) {
    if (typeof subOptions.ack_wait === 'number')
      opts.setAckWait(subOptions.ack_wait)
    if (typeof subOptions.durable_name === 'string')
      opts.setDurableName(subOptions.durable_name)
    if (typeof subOptions.max_in_flight === 'number')
      opts.setMaxInFlight(subOptions.max_in_flight)
  }

  return opts
}

module.exports = {
  handleMessage,
  setSubOpts
}
