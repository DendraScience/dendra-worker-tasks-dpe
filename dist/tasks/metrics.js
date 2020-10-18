"use strict";

/**
 * Init and log in-memory metrics, such as message counters.
 */
module.exports = {
  guard(m) {
    return !m.metricsError && !m.metricsReady && m.state.metrics;
  },

  execute(m, {
    logger
  }) {
    const metrics = m.metrics || {};
    const ttl = (m.state.metrics.expiry_seconds | 0 || 3600) * 1000;
    const ts = new Date().getTime();
    Object.keys(metrics).forEach(key => {
      const metric = metrics[key];

      if (ts - metric.ts > ttl) {
        logger.info('Deleting metric', {
          key,
          metric,
          ttl
        });
        delete metrics[key];
      }
    });
    return metrics;
  },

  assign(m, res, {
    logger
  }) {
    m.metrics = res;
    if (Object.keys(res).length) logger.info('Metrics', res);
  }

};