module.exports = {
  preprocessingExprs: require('./tasks/preprocessingExprs'),
  sources: require('./tasks/sources'),
  stan: require('./tasks/stan'),
  stanCheck: require('./tasks/stanCheck'),
  stanClose: require('./tasks/stanClose'),
  subscriptions: require('./tasks/decodePseudoBinary/subscriptions'),
  versionTs: require('./tasks/versionTs')
}
