"use strict";

/**
 * Subscribe to subjects after preprocessing expressions are ready. Add an event listener for messages.
 */
async function processItem({
  data,
  dataObj,
  msgSeq
}, {
  documentService,
  errorSubject,
  logger,
  preprocessingExpr,
  stan,
  subSubject
}) {
  try {
    /*
      Throttle re-processing of messages from error subject.
     */
    // if (subSubject === errorSubject) {
    //   await new Promise(resolve => setTimeout(resolve, 1000))
    // }

    /*
      Preprocess inbound message data.
     */
    const preRes = await new Promise((resolve, reject) => {
      preprocessingExpr.evaluate(dataObj, {
        env: () => ({
          errorSubject,
          msgSeq,
          subSubject
        })
      }, (err, res) => err ? reject(err) : resolve(res));
    });
    if (!preRes) throw new Error('Preprocessing result undefined');
    const {
      params,
      payload
    } = preRes;
    if (!payload) throw new Error('Missing payload object');
    if (!params) throw new Error('Missing params object');
    logger.info('Preprocessing params', {
      msgSeq,
      subSubject,
      params
    });

    if (params.skip === true) {
      logger.warn('Processing SKIPPED', {
        msgSeq,
        subSubject
      });
      return;
    }

    const {
      document_id: paramDocId
    } = params;
    if (typeof paramDocId !== 'string') throw new Error('Invalid params.document_id');
    /*
      Create document in archive.
     */

    const doc = await documentService.create({
      _id: paramDocId,
      content: {
        context: preRes.context,
        payload: preRes.payload
      }
    });
    logger.info('Archived', {
      msgSeq,
      subSubject,
      _id: doc._id
    });
  } catch (err) {
    if (errorSubject && subSubject !== errorSubject) {
      logger.error('Processing error', {
        msgSeq,
        subSubject,
        err,
        dataObj
      });
      const guid = await new Promise((resolve, reject) => {
        stan.publish(errorSubject, data, (err, guid) => err ? reject(err) : resolve(guid));
      });
      logger.info('Published to error subject', {
        msgSeq,
        subSubject,
        errorSubject,
        guid
      });
    } else {
      throw err;
    }
  }
}

function handleMessage(msg) {
  const {
    logger,
    m,
    subSubject
  } = this;

  if (!msg) {
    logger.error('Message undefined');
    return;
  }

  const msgSeq = msg.getSequence();
  logger.info('Message received', {
    msgSeq,
    subSubject
  });

  if (m.subscriptionsTs !== m.versionTs) {
    logger.info('Message deferred', {
      msgSeq,
      subSubject
    });
    return;
  }

  try {
    const data = msg.getData();
    const dataObj = JSON.parse(data);
    processItem({
      data,
      dataObj,
      msgSeq
    }, this).then(() => msg.ack()).catch(err => {
      logger.error('Message processing error', {
        msgSeq,
        subSubject,
        err,
        dataObj
      });
    });
  } catch (err) {
    logger.error('Message error', {
      msgSeq,
      subSubject,
      err
    });
  }
}

module.exports = {
  guard(m) {
    return !m.subscriptionsError && m.private.stan && m.stanConnected && m.preprocessingExprsTs === m.versionTs && m.subscriptionsTs !== m.versionTs && !m.private.subscriptions;
  },

  execute(m, {
    logger
  }) {
    const {
      preprocessingExprs,
      stan
    } = m.private;
    const documentService = m.$app.get('connections').archiveStore.app.service('/documents');
    const subs = [];
    m.sourceKeys.forEach(sourceKey => {
      const source = m.sources[sourceKey];
      const {
        error_subject: errorSubject,
        queue_group: queueGroup,
        sub_options: subOptions,
        sub_to_subject: subSubject
      } = source;
      const preprocessingExpr = preprocessingExprs[sourceKey];

      if (!preprocessingExpr) {
        logger.warn('Subscription skipped, no preprocessing expression found', {
          sourceKey,
          subSubject
        });
        return;
      }

      try {
        const opts = stan.subscriptionOptions();
        opts.setManualAckMode(true);
        opts.setDeliverAllAvailable();
        opts.setMaxInFlight(1);

        if (subOptions) {
          if (typeof subOptions.ack_wait === 'number') opts.setAckWait(subOptions.ack_wait);
          if (typeof subOptions.durable_name === 'string') opts.setDurableName(subOptions.durable_name);
        }

        const sub = typeof queueGroup === 'string' ? stan.subscribe(subSubject, queueGroup, opts) : stan.subscribe(subSubject, opts);
        sub.on('message', handleMessage.bind({
          documentService,
          errorSubject,
          logger,
          m,
          preprocessingExpr,
          stan,
          subSubject
        }));
        subs.push(sub);
      } catch (err) {
        logger.error('Subscription error', {
          err,
          sourceKey,
          subSubject
        });
      }
    });
    return subs;
  },

  assign(m, res, {
    logger
  }) {
    m.private.subscriptions = res;
    m.subscriptionsTs = m.versionTs;
    logger.info('Subscriptions ready');
  }

};