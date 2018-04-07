'use strict';

/**
 * Worker tasks for archiving, mutating and loading data.
 *
 * @author J. Scott Smith
 * @license BSD-2-Clause-FreeBSD
 * @module dendra-worker-tasks-goes
 */

// Named exports for convenience
module.exports = {
  archive: require('./archive'),
  decodePseudoBinary: require('./decodePseudoBinary'),
  influxWrite: require('./influxWrite'),
  transform: require('./transform')
};