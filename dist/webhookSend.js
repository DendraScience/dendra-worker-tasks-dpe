"use strict";

module.exports = {
  metrics: require('./tasks/metrics'),
  sources: require('./tasks/sources'),
  stan: require('./tasks/stan'),
  stanCheck: require('./tasks/stanCheck'),
  stanClose: require('./tasks/stanClose'),
  subscriptions: require('./tasks/webhookSend/subscriptions'),
  versionTs: require('./tasks/versionTs'),
  webhooks: require('./tasks/webhooks')
};