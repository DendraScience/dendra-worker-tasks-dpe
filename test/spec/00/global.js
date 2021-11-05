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
    database: 'dendra_dpe_test',
    // Bonsai test server at home
    host: '192.168.1.60',
    port: 31186
    // host: 'localhost',
    // port: 8086
  },
  stan: {
    client: 'test-dpe-{key}',
    cluster: 'stan-cluster',
    opts: {
      // Bonsai test server at home
      uri: 'http://192.168.1.60:31242'
      // uri: 'http://localhost:4222'
    }
  },
  // Requires webhook running:
  // node ./dist/generic-webhook-sftp-upload.js --sftp_host=192.168.1.60 --sftp_port=30122 --sftp_username=foo --sftp_password=123 --secret=abc
  webhooks: {
    cdec: {
      baseURL: 'http://127.0.0.1:3000',
      headers: {
        Authorization: 'abc'
      },
      method: 'POST'
    }
    // default: {}
  }
})

global.assert = chai.assert
global.expect = chai.expect
global.helper = {
  loadData,
  loadJSON
}
global.main = {
  app,
  ts: Date.now()
}
global.tm = tm
