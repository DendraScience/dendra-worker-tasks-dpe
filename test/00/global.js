const chai = require('chai')
const feathers = require('feathers')
const restClient = require('feathers-rest/client')
const request = require('request')
const app = feathers()

const tm = require('@dendra-science/task-machine')
tm.configure({
  // logger: console
})

app.logger = console

const JSON_ARCHIVE_API_URL = 'http://localhost:3033'
// const JSON_ARCHIVE_API_URL = 'http://localhost:8080/_services/archive/json/api/v1'

app.set('connections', {
  jsonArchive: {
    app: feathers().configure(restClient(JSON_ARCHIVE_API_URL).request(request))
  }
})

app.set('clients', {
  stan: {
    client: 'test-dpe-{key}',
    cluster: 'test-cluster',
    opts: {
      maxPubAcksInflight: 3,
      uri: 'http://localhost:4222'
    }
  }
})

global.assert = chai.assert
global.expect = chai.expect
global.main = {
  app
}
global.tm = tm
