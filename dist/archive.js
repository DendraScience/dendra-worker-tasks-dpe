'use strict';

module.exports = {
  preprocessingExprs: require('./tasks/preprocessingExprs'),
  sources: require('./tasks/sources'),
  stan: require('./tasks/stan'),
  stanCheck: require('./tasks/stanCheck'),
  subscriptions: require('./tasks/archive/subscriptions'),
  subscriptionsClose: require('./tasks/subscriptionsClose'),
  versionTs: require('./tasks/versionTs')
};