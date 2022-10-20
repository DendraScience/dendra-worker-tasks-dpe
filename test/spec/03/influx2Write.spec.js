/**
 * Tests for influxWrite tasks
 */

const { BucketsAPI } = require('@influxdata/influxdb-client-apis')

describe('influx2Write tasks', function () {
  this.timeout(60000)

  const now = new Date()
  const model = {
    props: {},
    state: {
      _id: 'taskMachine-influx2Write-current',
      source_defaults: {
        some_default: 'default'
      },
      sources: [
        {
          description: 'Write prepared points to Influx2',
          error_subject: 'influx2Write.err',
          sub_options: {
            ack_wait: 60000,
            durable_name: 'influx2Write',
            max_in_flight: 100
          },
          sub_to_subject: 'influx2Write.in.' + main.ts,
          writer_options: {
            batch_interval: 2000,
            batch_size: 1000
          }
        }
      ],
      created_at: now,
      updated_at: now
    }
  }

  const dataFileName = {
    csiOut: 'csi_prep_out',
    decodePseudoBinaryOut: 'decodePseudoBinary_prep_out'
  }

  Object.defineProperty(model, '$app', {
    enumerable: false,
    configurable: false,
    writable: false,
    value: main.app
  })
  Object.defineProperty(model, 'key', {
    enumerable: false,
    configurable: false,
    writable: false,
    value: 'patch'
  })
  Object.defineProperty(model, 'private', {
    enumerable: false,
    configurable: false,
    writable: false,
    value: {}
  })

  let tasks
  let machine

  after(function () {
    return Promise.all([
      model.private.stan
        ? new Promise((resolve, reject) => {
            model.private.stan.removeAllListeners()
            model.private.stan.once('close', resolve)
            model.private.stan.once('error', reject)
            model.private.stan.close()
          })
        : Promise.resolve()
    ])
  })

  it('should import', function () {
    tasks = require('../../../dist').influx2Write

    expect(tasks).to.have.property('sources')
  })

  it('should create machine', function () {
    machine = new tm.TaskMachine(model, tasks, {
      helpers: {
        logger: console
      },
      interval: 500
    })

    expect(machine).to.have.property('model')
  })

  it('should run', function () {
    model.scratch = {}

    return machine
      .clear()
      .start()
      .then(success => {
        /* eslint-disable-next-line no-unused-expressions */
        expect(success).to.be.true

        // Verify task state
        expect(model).to.have.property('sourcesReady', true)
        expect(model).to.have.property('stanCheckReady', false)
        expect(model).to.have.property('stanCloseReady', false)
        expect(model).to.have.property('stanReady', true)
        expect(model).to.have.property('subscriptionsReady', true)
        expect(model).to.have.property('versionTsReady', false)

        // Check for defaults
        expect(model).to.have.nested.property(
          'sources.influx2Write_in_' + main.ts + '.some_default',
          'default'
        )
      })
  })

  it('should drop csi database', function () {
    const bucketsAPI = new BucketsAPI(model.private.influx2.influxDB)

    return bucketsAPI
      .deleteBucketsID({ bucketID: 'ucnrs__ucac_angelo' })
      .catch(_ => {})
  })

  it('should process csi data', function () {
    return helper.loadData(dataFileName.csiOut).then(data => {
      const msgStr = JSON.stringify(data)

      return new Promise((resolve, reject) => {
        model.private.stan.publish(
          'influx2Write.in.' + main.ts,
          msgStr,
          (err, guid) => (err ? reject(err) : resolve(guid))
        )
      })
    })
  })

  it('should drop decoded database', function () {
    const bucketsAPI = new BucketsAPI(model.private.influx2.influxDB)

    return bucketsAPI
      .deleteBucketsID({ bucketID: 'ucnrs__ucbu_burns' })
      .catch(_ => {})
  })

  it('should process decoded data', function () {
    return helper.loadData(dataFileName.decodePseudoBinaryOut).then(data => {
      const msgStr = JSON.stringify(data)

      return new Promise((resolve, reject) => {
        model.private.stan.publish(
          'influx2Write.in.' + main.ts,
          msgStr,
          (err, guid) => (err ? reject(err) : resolve(guid))
        )
      })
    })
  })

  it('should wait for 5 seconds to load points', function () {
    return new Promise(resolve => setTimeout(resolve, 5000))
  })

  it('should have loaded csi points', async function () {
    const queryApi = model.private.influx2.influxDB.getQueryApi(
      model.private.influx2.org
    )
    const results = await queryApi.collectRows(
      'from(bucket: "ucnrs__ucac_angelo")' +
        ' |> range(start: 1545660000)' +
        ' |> filter(fn: (r) => r._measurement == "source_tenmin" and (r._field == "Extra" or r._field == "Day_of_Year"))' +
        ' |> limit(n: 10)' +
        ' |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")' +
        ' |> drop(columns: ["_measurement", "_start", "_stop"])'
    )

    expect(results).to.have.lengthOf(2)

    expect(results).to.have.nested.property('0._time')
    expect(new Date(results[0]._time).getTime()).to.equal(1545660000000)
    expect(results).to.have.nested.property('0.Extra', 1545660000000)
    expect(results).to.have.nested.property('0.Day_of_Year', 358)

    expect(results).to.have.nested.property('1._time')
    expect(new Date(results[1]._time).getTime()).to.equal(1545663600000)
    expect(results).to.have.nested.property('1.Extra', 1545663600000)
    expect(results).to.have.nested.property('1.Day_of_Year', 358)
  })

  it('should have loaded decoded points', async function () {
    const queryApi = model.private.influx2.influxDB.getQueryApi(
      model.private.influx2.org
    )
    const results = await queryApi.collectRows(
      'from(bucket: "ucnrs__ucbu_burns")' +
        ' |> range(start: 1545660000)' +
        ' |> filter(fn: (r) => r._measurement == "source_goes_tenmin" and (r._field == "Extra" or r._field == "col01"))' +
        ' |> limit(n: 10)' +
        ' |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")' +
        ' |> drop(columns: ["_measurement", "_start", "_stop"])'
    )

    expect(results).to.have.lengthOf(1)

    expect(results).to.have.nested.property('0._time')
    expect(new Date(results[0]._time).getTime()).to.equal(1545660000000)
    expect(results).to.have.nested.property('0.Extra', 1545660000000)
    expect(results).to.have.nested.property('0.col01', 358)
  })
})
