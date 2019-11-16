"use strict";

/**
 * Moment initialized with helper functions.
 */
const moment = require('moment');

moment.fn.toMillis = function () {
  return this.valueOf();
};

module.exports = moment;