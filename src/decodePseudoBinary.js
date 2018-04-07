module.exports = {
  preprocessingExprs: require('./tasks/preprocessingExprs'),
  sources: require('./tasks/sources'),
  stan: require('./tasks/stan'),
  stanCheck: require('./tasks/stanCheck'),
  staticRules: require('./tasks/staticRules'),
  subscriptions: require('./tasks/decodePseudoBinary/subscriptions'),
  subscriptionsClose: require('./tasks/subscriptionsClose'),
  versionTs: require('./tasks/versionTs')
}