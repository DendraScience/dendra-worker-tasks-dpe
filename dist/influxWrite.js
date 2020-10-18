"use strict";

module.exports = {
  influx: require('./tasks/influx'),
  metrics: require('./tasks/metrics'),
  sources: require('./tasks/sources'),
  stan: require('./tasks/stan'),
  stanCheck: require('./tasks/stanCheck'),
  stanClose: require('./tasks/stanClose'),
  subscriptions: require('./tasks/influxWrite/subscriptions'),
  versionTs: require('./tasks/versionTs')
};