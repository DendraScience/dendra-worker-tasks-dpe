module.exports = {
  influx: require('./tasks/influx'),
  sources: require('./tasks/sources'),
  stan: require('./tasks/stan'),
  stanCheck: require('./tasks/stanCheck'),
  subscriptions: require('./tasks/influxWrite/subscriptions'),
  subscriptionsClose: require('./tasks/subscriptionsClose'),
  versionTs: require('./tasks/versionTs')
}
