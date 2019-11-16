"use strict";

/**
 * Subscribe to subjects after preprocessing expressions are ready. Add an event listener for messages.
 */
const jsonata = require('jsonata');

const LRU = require('modern-lru');

const moment = require('../../lib/moment-fn');

const {
  registerHelpers
} = require('../../lib/jsonata-utils');

async function processItem({
  data,
  dataObj,
  msgSeq
}, {
  errorSubject,
  exprCache,
  logger,
  preprocessingExpr,
  pubSubject,
  stan,
  staticRules,
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
          pubSubject,
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

    if (!Array.isArray(params.tags)) throw new Error('Invalid params.tags');
    const {
      tags: paramTags
    } = params;
    if (typeof params.time === 'undefined') throw new Error('Invalid params.time');
    const paramTime = moment(params.time).utc();
    if (!(paramTime && paramTime.isValid())) throw new Error('Invalid params.time format');
    /*
      Lookup static rules for transformation.
     */

    const matchedRules = staticRules.filter(rule => {
      return rule.definition && rule.tags && rule.tags.every(tag => paramTags.includes(tag)) && paramTime.isBetween(rule.begins_at, rule.ends_before, null, '[)');
    });
    logger.info(`Processing (${matchedRules.length}) static rule(s)`);
    /*
      Evaluate all transform expressions.
     */

    for (const staticRule of matchedRules) {
      const {
        definition
      } = staticRule;

      if (Array.isArray(definition.transform_expr)) {
        /*
          Get cached expression, or create/cache an expression (optional).
         */
        let expr = exprCache.get(staticRule);

        if (!expr) {
          expr = jsonata(definition.transform_expr.join(' '));
          registerHelpers(expr);
          exprCache.set(staticRule, expr);
        }
        /*
          Evaluate transform expression.
         */


        preRes.payload = await new Promise((resolve, reject) => {
          expr.evaluate(preRes.payload, {
            time: () => paramTime.clone()
          }, (err, res) => err ? reject(err) : resolve(res));
        });
      }
    }

    await new Promise(resolve => setImmediate(resolve));
    logger.info('Transformed', {
      msgSeq,
      subSubject
    });
    /*
      Prepare outbound messages and publish.
     */

    const msgStr = JSON.stringify({
      context: preRes.context,
      payload: preRes.payload
    });
    const guid = await new Promise((resolve, reject) => {
      stan.publish(pubSubject, msgStr, (err, guid) => err ? reject(err) : resolve(guid));
    });
    logger.info('Published', {
      msgSeq,
      subSubject,
      pubSubject,
      guid
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
    return !m.subscriptionsError && m.private.stan && m.stanConnected && m.preprocessingExprsTs === m.versionTs && m.staticRulesTs === m.versionTs && m.subscriptionsTs !== m.versionTs && !m.private.subscriptions;
  },

  execute(m, {
    logger
  }) {
    const {
      preprocessingExprs,
      staticRules,
      stan
    } = m.private;
    const subs = [];
    m.sourceKeys.forEach(sourceKey => {
      const source = m.sources[sourceKey];
      const {
        error_subject: errorSubject,
        pub_to_subject: pubSubject,
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
          errorSubject,
          exprCache: new LRU(20),
          // TODO: Make configurable
          logger,
          m,
          preprocessingExpr,
          pubSubject,
          stan,
          staticRules,
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