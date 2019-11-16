const chai = require('chai')
const feathers = require('@feathersjs/feathers')
const restClient = require('@feathersjs/rest-client')
const axios = require('axios')
const app = feathers()

const fs = require('fs')
const path = require('path')

function loadJSON(filePath) {
  return new Promise((resolve, reject) => {
    fs.readFile(filePath, (err, data) => (err ? reject(err) : resolve(data)))
  }).then(data => JSON.parse(data))
}

function loadData(fileName) {
  return loadJSON(path.join(__dirname, '../../data', `${fileName}.json`))
}

const tm = require('@dendra-science/task-machine')
tm.configure({
  // logger: console
})

app.logger = console

const ARCHIVE_JSON_API_URL = 'http://localhost:3036'

app.set('connections', {
  archiveStore: {
    app: feathers().configure(restClient(ARCHIVE_JSON_API_URL).axios(axios))
  }
})

app.set('clients', {
  influx: {
    database: 'dendra_dpe_test'
    // host: 'localhost',
    // port: 8086
  },
  stan: {
    client: 'test-dpe-{key}',
    cluster: 'test-cluster',
    opts: {
      uri: 'http://localhost:4222'
    }
  }
})

global.assert = chai.assert
global.expect = chai.expect
global.helper = {
  loadData,
  loadJSON
}
global.main = {
  app
}
global.tm = tm
