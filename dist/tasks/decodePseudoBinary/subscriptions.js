'use strict';

/**
 * Subscribe to subjects after preprocessing expressions are ready. Add an event listener for messages.
 */

const LRU = require('modern-lru');
const moment = require('../../lib/moment-fn');
const { Decoder } = require('@dendra-science/goes-pseudo-binary');
const { MomentEditor } = require('@dendra-science/utils-moment');

async function processItem({ data, dataObj, msgSeq }, { decoderCache, editorCache, errorSubject, logger, preprocessingExpr, pubSubject, stan, staticRules, subSubject }) {
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
        env: () => ({ errorSubject, msgSeq, pubSubject, subSubject })
      }, (err, res) => err ? reject(err) : resolve(res));
    });

    if (!preRes) throw new Error('Preprocessing result undefined');

    const { params, payload } = preRes;

    if (!payload) throw new Error('Missing payload object');
    if (!params) throw new Error('Missing params object');

    logger.info('Preprocessing params', { msgSeq, subSubject, params });

    if (params.skip === true) {
      logger.warn('Processing SKIPPED', { msgSeq, subSubject });
      return;
    }

    if (!Array.isArray(params.tags)) throw new Error('Invalid params.tags');
    const { tags: paramTags } = params;

    if (typeof params.time === 'undefined') throw new Error('Invalid params.time');
    const paramTime = moment(params.time).utc();
    if (!(paramTime && paramTime.isValid())) throw new Error('Invalid params.time format');

    /*
      Lookup static rule for decoding.
     */

    const staticRule = staticRules.find(rule => {
      return rule.definition && rule.definition.decode_format && rule.tags && rule.tags.every(tag => paramTags.includes(tag)) && paramTime.isBetween(rule.begins_at, rule.ends_before, null, '[)');
    });

    if (!staticRule) throw new Error('No static rule found');

    /*
      Get cached decoder, or create/cache a new decoder.
     */

    const { definition } = staticRule;
    const {
      decode_columns: decodeCols,
      decode_slice: decodeSlice,
      time_edit: timeEdit,
      time_interval: timeInterval
    } = definition;

    let decoder = decoderCache.get(staticRule);
    if (!decoder) {
      decoder = new Decoder(definition.decode_format);

      decoderCache.set(staticRule, decoder);
    }

    /*
      Slice and decode buffer.
     */

    const decodeSliceArgs = Array.isArray(decodeSlice) ? decodeSlice.map(arg => arg | 0) : [0];
    const decodeRes = await decoder.decode(Buffer.from(payload).slice(...decodeSliceArgs));

    if (!decodeRes) throw new Error('Decode result undefined');
    if (decodeRes.error) throw new Error(`Decode error: ${decodeRes.error}`);
    if (!decodeRes.rows) throw new Error('Decode rows undefined');

    /*
      Get cached Moment editor, or create/cache a new editor (optional).
     */

    let editor = editorCache.get(staticRule);
    if (!editor && timeEdit) {
      editor = new MomentEditor(timeEdit);
      editorCache.set(staticRule, editor);
    }

    /*
      Map/reduce rows to assign column names and time.
     */

    if (!Array.isArray(decodeCols)) throw new Error('Decode columns undefined');

    let time = editor ? editor.edit(paramTime).valueOf() : 0;

    decodeRes.rows = decodeRes.rows.map(row => {
      const newRow = row.reduce((obj, cur, i) => {
        const col = decodeCols[i];

        if (!col) throw new Error(`Decode column [${i}] undefined`);

        obj[col] = cur;
        return obj;
      }, { time });

      // Assume rows are always in descending order
      time -= (timeInterval | 0) * 1000;

      return newRow;
    });

    await new Promise(resolve => setImmediate(resolve));

    logger.info('Decoded', { msgSeq, subSubject });

    /*
      Prepare outbound messages and publish.
     */

    for (let row of decodeRes.rows) {
      const msgStr = JSON.stringify({
        context: preRes.context,
        payload: row
      });

      const guid = await new Promise((resolve, reject) => {
        stan.publish(pubSubject, msgStr, (err, guid) => err ? reject(err) : resolve(guid));
      });

      logger.info('Published', { msgSeq, subSubject, pubSubject, guid });
    }
  } catch (err) {
    if (errorSubject && subSubject !== errorSubject) {
      logger.error('Processing error', { msgSeq, subSubject, err, dataObj });

      const guid = await new Promise((resolve, reject) => {
        stan.publish(errorSubject, data, (err, guid) => err ? reject(err) : resolve(guid));
      });

      logger.info('Published to error subject', { msgSeq, subSubject, errorSubject, guid });
    } else {
      throw err;
    }
  }
}

function handleMessage(msg) {
  const { logger, m, subSubject } = this;

  if (!msg) {
    logger.error('Message undefined');
    return;
  }

  const msgSeq = msg.getSequence();

  logger.info('Message received', { msgSeq, subSubject });

  if (m.subscriptionsTs !== m.versionTs) {
    logger.info('Message deferred', { msgSeq, subSubject });
    return;
  }

  try {
    const data = msg.getData();
    const dataObj = JSON.parse(data);

    processItem({ data, dataObj, msgSeq }, this).then(() => msg.ack()).catch(err => {
      logger.error('Message processing error', { msgSeq, subSubject, err, dataObj });
    });
  } catch (err) {
    logger.error('Message error', { msgSeq, subSubject, err });
  }
}

module.exports = {
  guard(m) {
    return !m.subscriptionsError && m.private.stan && m.stanConnected && m.preprocessingExprsTs === m.versionTs && m.staticRulesTs === m.versionTs && m.subscriptionsTs !== m.versionTs && !m.private.subscriptions;
  },

  execute(m, { logger }) {
    const { preprocessingExprs, staticRules, stan } = m.private;
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
        logger.warn('Subscription skipped, no preprocessing expression found', { sourceKey, subSubject });
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
          decoderCache: new LRU(20), // TODO: Make configurable
          editorCache: new LRU(20), // TODO: Make configurable
          errorSubject,
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
        logger.error('Subscription error', { err, sourceKey, subSubject });
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