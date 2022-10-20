"use strict";

/**
 * Worker tasks for archiving, transforming and loading data.
 *
 * @author J. Scott Smith
 * @license BSD-2-Clause-FreeBSD
 * @module dendra-worker-tasks-goes
 */
// Named exports for convenience
module.exports = {
  archive: require('./archive'),
  decodePseudoBinary: require('./decodePseudoBinary'),
  influx2Write: require('./influx2Write'),
  influxWrite: require('./influxWrite'),
  transform: require('./transform'),
  webhookSend: require('./webhookSend')
};