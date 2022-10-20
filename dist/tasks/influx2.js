"use strict";

/**
 * Create an InfluxDB client if not defined.
 */
const Agent = require('agentkeepalive');

const {
  HttpsAgent
} = require('agentkeepalive');

const {
  InfluxDB
} = require('@influxdata/influxdb-client');

function agentOptions() {
  return {
    timeout: 60000,
    freeSocketTimeout: 30000
  };
}

const httpAgent = new Agent(agentOptions());
const httpsAgent = new HttpsAgent(agentOptions());
module.exports = {
  guard(m) {
    return !m.influx2Error && !m.private.influx2;
  },

  execute(m, {
    logger
  }) {
    const cfg = m.$app.get('clients').influx2;
    const influxDB = new InfluxDB({
      token: cfg.token,
      transportOptions: {
        agent: cfg.url.startsWith('https:') ? httpsAgent : httpAgent
      },
      url: cfg.url
    });
    return {
      influxDB,
      org: cfg.org
    };
  },

  assign(m, res, {
    logger
  }) {
    m.private.influx2 = res;
    logger.info('Influx2 ready');
  }

};