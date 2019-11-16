"use strict";

module.exports = {
  preprocessingExprs: require('./tasks/preprocessingExprs'),
  sources: require('./tasks/sources'),
  stan: require('./tasks/stan'),
  stanCheck: require('./tasks/stanCheck'),
  stanClose: require('./tasks/stanClose'),
  staticRules: require('./tasks/staticRules'),
  subscriptions: require('./tasks/decodePseudoBinary/subscriptions'),
  versionTs: require('./tasks/versionTs')
};