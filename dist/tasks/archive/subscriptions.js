'use strict';

/**
 * Subscribe to subjects after preprocessing expressions are ready. Add an event listener for messages.
 */

async function archive({ data, documentService, preprocessingExpr }) {
  const res = await new Promise((resolve, reject) => {
    preprocessingExpr.evaluate(data, {}, (err, res) => err ? reject(err) : resolve(res));
  });

  if (!res) throw new Error('Result undefined');
  if (!res.payload) throw new Error('Missing payload object');
  if (!res.archive) throw new Error('Missing archive object');
  if (typeof res.archive.document_id !== 'string') throw new Error('Invalid archive.document_id');

  return documentService.create({
    _id: res.archive.document_id,
    content: res.payload
  });
}

function handleMessage(msg) {
  const { documentService, logger, m, preprocessingExpr } = this;

  if (!msg) {
    logger.error('Message undefined');
    return;
  }

  const msgSeq = msg.getSequence();
  const subject = msg.getSubject();

  try {
    logger.info('Message received', { msgSeq, subject });

    if (m.subscriptionsTs !== m.versionTs) {
      logger.info('Message deferred', { msgSeq, subject });
      return;
    }

    const data = JSON.parse(msg.getData());

    logger.info('Archiving', { msgSeq, subject });

    archive({ data, documentService, preprocessingExpr }).then(doc => {
      logger.info('Archived', { msgSeq, subject, _id: doc._id });

      return msg.ack();
    }).catch(err => {
      logger.error('Archive error', { msgSeq, subject, data, err });
    });
  } catch (err) {
    logger.error('Message error', { msgSeq, subject, err });
  }
}

module.exports = {
  guard(m) {
    return !m.subscriptionsError && m.private.stan && m.stanConnected && m.preprocessingExprsTs === m.versionTs && m.subscriptionsTs !== m.versionTs && !m.private.subscriptions;
  },

  execute(m, { logger }) {
    const { preprocessingExprs, stan } = m.private;
    const documentService = m.$app.get('connections').jsonArchive.app.service('/documents');
    const subs = [];

    m.sourceKeys.forEach(sourceKey => {
      const source = m.sources[sourceKey];
      const { sub_options: options, sub_to_subject: subject } = source;
      const preprocessingExpr = preprocessingExprs[sourceKey];

      if (!preprocessingExpr) {
        logger.warn('Subscription skipped, no preprocessing expression found', { sourceKey, subject });
        return;
      }

      try {
        const opts = stan.subscriptionOptions();

        opts.setManualAckMode(true);
        opts.setDeliverAllAvailable();

        if (typeof options.ack_wait === 'number') opts.setAckWait(options.ack_wait);
        if (typeof options.durable_name === 'string') opts.setDurableName(options.durable_name);
        if (typeof options.max_in_flight === 'number') opts.setMaxInFlight(options.max_in_flight);

        const sub = stan.subscribe(subject, opts);

        sub.on('message', handleMessage.bind({
          documentService,
          logger,
          m,
          preprocessingExpr
        }));

        subs.push(sub);
      } catch (err) {
        logger.error('Subscription error', { err, sourceKey, subject });
      }
    });

    return subs;
  },

  assign(m, res, { logger }) {
    m.private.subscriptions = res;
    m.subscriptionsTs = m.versionTs;

    logger.info('Subscriptions ready');
  }
};