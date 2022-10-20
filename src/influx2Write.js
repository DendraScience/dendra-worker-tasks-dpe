module.exports = {
  influx2: require('./tasks/influx2'),
  metrics: require('./tasks/metrics'),
  sources: require('./tasks/sources'),
  stan: require('./tasks/stan'),
  stanCheck: require('./tasks/stanCheck'),
  stanClose: require('./tasks/stanClose'),
  subscriptions: require('./tasks/influx2Write/subscriptions'),
  versionTs: require('./tasks/versionTs')
}
