"use strict";

/**
 * Subscribe to subjects after preprocessing expressions are ready. Add an event listener for messages.
 */
const moment = require('../../lib/moment-fn');

const {
  parseRules
} = require('../../lib/static-rules');

const {
  handleMessage,
  setSubOpts
} = require('../../lib/sub');

async function processItem({
  data,
  dataObj,
  msgRc,
  msgSeq
}, {
  errorSubject,
  ignoreErrorsAtRedelivery,
  logger,
  preprocessingExpr,
  pubSubject,
  stan,
  staticRules,
  subSubject
}) {
  try {
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
      return rule.definition && rule.transformExpr && rule.tags && rule.tags.every(tag => paramTags.includes(tag)) && paramTime.isBetween(rule.begins_at, rule.ends_before, null, '[)');
    });
    logger.info(`Processing (${matchedRules.length}) static rule(s)`);
    /*
      Evaluate all transform expressions.
     */

    for (const staticRule of matchedRules) {
      preRes.payload = await new Promise((resolve, reject) => {
        staticRule.transformExpr.evaluate(preRes.payload, {
          time: () => paramTime.clone()
        }, (err, res) => err ? reject(err) : resolve(res));
      });
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
    } else if (msgRc >= ignoreErrorsAtRedelivery) {
      logger.warn('Processing error (ignored)', {
        msgRc,
        msgSeq,
        subSubject,
        ignoreErrorsAtRedelivery,
        err,
        dataObj
      });
    } else {
      throw err;
    }
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
    const subs = [];
    m.sourceKeys.forEach(sourceKey => {
      const source = m.sources[sourceKey];
      const {
        error_subject: errorSubject,
        ignore_before_date: ignoreBeforeDate,
        ignore_errors: ignoreErrors,
        ignore_errors_at_redelivery: ignoreErrorsAtRedelivery,
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
        const opts = setSubOpts(stan.subscriptionOptions(), subOptions);
        opts.setMaxInFlight(1);
        const sub = typeof queueGroup === 'string' ? stan.subscribe(subSubject, queueGroup, opts) : stan.subscribe(subSubject, opts);
        sub.on('message', handleMessage.bind({
          errorSubject,
          ignoreBeforeDate: ignoreBeforeDate && new Date(ignoreBeforeDate),
          ignoreErrorsAtRedelivery: typeof ignoreErrorsAtRedelivery === 'number' ? ignoreErrorsAtRedelivery : ignoreErrors === true ? 0 : undefined,
          logger,
          m,
          preprocessingExpr,
          processItem,
          pubSubject,
          stan,
          staticRules: parseRules(m.state.static_rules || []),
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