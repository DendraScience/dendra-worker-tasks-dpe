'use strict';

/**
 * Subscribe to subjects after preprocessing expressions are ready. Add an event listener for messages.
 */

// TODO: Make more async-y? (e.g. setImmediates)

const LRU = require('modern-lru');
const moment = require('../../lib/moment-fn');
const debounce = require('lodash/debounce');

/**
 * Class for batch writing points to Influx.
 */
class PointsWriter {
  constructor(...opts) {
    Object.assign(this, ...opts, {
      callbacks: [],
      points: []
    });

    this.debouncedWrite = debounce(this.write.bind(this), this.batch_interval || 1000, {
      leading: false,
      trailing: true
    });
  }

  static cached(key, ...opts) {
    let { cache } = this;
    if (!cache) cache = this.cache = new LRU(60); // TODO: Make configurable

    let writer = cache.get(key);
    if (!writer) {
      writer = new PointsWriter(...opts);

      cache.set(key, writer);
    }

    return writer;
  }

  push(pts, cb) {
    const { callbacks, options, points, debouncedWrite } = this;

    points.push(...pts);
    callbacks.push(cb);

    this.logger.info(`Pushed (${pts.length}) point(s), (${points.length}) queued`, options);

    if (points.length >= this.batch_size) {
      this.logger.info('Flushing queue', this.options);

      debouncedWrite.flush();
    } else {
      debouncedWrite();
    }
  }

  async write() {
    const { callbacks, influx, options, points } = this;
    this.points = [];
    this.callbacks = [];

    let createDb;
    let stop;

    while (!stop) {
      if (createDb) {
        this.logger.info('Creating database', this.options);

        try {
          await influx.createDatabase(options.database);
        } catch (err) {
          callbacks.forEach(cb => cb(err));
          stop = true;
        }
      }

      try {
        this.logger.info(`Writing (${points.length}) point(s)`, this.options);

        await influx.writePoints(points, options);
        callbacks.forEach(cb => cb());
        stop = true;
      } catch (err) {
        if (!createDb && err.res && err.res.statusCode === 404) {
          this.logger.warn('Writing failed, database not found', this.options);

          createDb = true;
        } else {
          callbacks.forEach(cb => cb(err));
          stop = true;
        }
      }
    }
  }
}

async function processItem({ data, dataObj, msgSeq }, { errorSubject, influx, logger, pubSubject, stan, subSubject, writerOptions }) {
  try {
    /*
      Throttle re-processing of messages from error subject.
     */

    // if (subSubject === errorSubject) {
    //   await new Promise(resolve => setTimeout(resolve, 1000))
    // }

    /*
      Validate inbound message data.
     */

    if (!dataObj.payload) throw new Error('Missing payload object');

    const { options, points } = dataObj.payload;

    if (typeof options !== 'object') throw new Error('Invalid payload.options');
    if (!Array.isArray(points)) throw new Error('Invalid payload.points');

    /*
      Map time values to timestamp.
     */

    points.forEach((point, i) => {
      if (typeof point.time === 'undefined') return;

      const time = moment(point.time).utc();
      if (!(time && time.isValid())) throw new Error(`Invalid points[${i}].time format`);

      point.timestamp = time.toDate();
      delete point.time;
    });

    /*
      Get cached writer, or create/cache a writer.
     */

    // TODO: Construct a better object hash
    const writer = PointsWriter.cached(`${options.database}$${options.precision}$${options.retentionPolicy}`, {
      influx,
      logger,
      options
    }, writerOptions);

    /*
      Enqueue points for writing.
     */

    await new Promise((resolve, reject) => {
      writer.push(points, err => err ? reject(err) : resolve());
    });

    logger.info('Point(s) written', { msgSeq, subSubject });
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
    return !m.subscriptionsError && m.private.stan && m.stanConnected && m.private.influx && m.sourcesTs === m.versionTs && m.subscriptionsTs !== m.versionTs && !m.private.subscriptions;
  },

  execute(m, { logger }) {
    const { influx, stan } = m.private;
    const subs = [];

    m.sourceKeys.forEach(sourceKey => {
      const source = m.sources[sourceKey];
      const {
        error_subject: errorSubject,
        pub_to_subject: pubSubject,
        sub_options: subOptions,
        sub_to_subject: subSubject,
        writer_options: writerOptions
      } = source;

      try {
        const opts = stan.subscriptionOptions();

        opts.setManualAckMode(true);
        opts.setDeliverAllAvailable();

        if (subOptions) {
          if (typeof subOptions.ack_wait === 'number') opts.setAckWait(subOptions.ack_wait);
          if (typeof subOptions.durable_name === 'string') opts.setDurableName(subOptions.durable_name);
          if (typeof subOptions.max_in_flight === 'number') opts.setMaxInFlight(subOptions.max_in_flight);
        }

        const sub = stan.subscribe(subSubject, opts);

        sub.on('message', handleMessage.bind({
          errorSubject,
          influx,
          logger,
          m,
          pubSubject,
          stan,
          subSubject,
          writerOptions
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