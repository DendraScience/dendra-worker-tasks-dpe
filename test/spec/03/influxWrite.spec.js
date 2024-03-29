/**
 * Tests for influxWrite tasks
 */

describe('influxWrite tasks', function () {
  this.timeout(60000)

  const now = new Date()
  const model = {
    props: {},
    state: {
      _id: 'taskMachine-influxWrite-current',
      source_defaults: {
        some_default: 'default'
      },
      sources: [
        {
          description: 'Write prepared points to Influx',
          error_subject: 'influxWrite.err',
          sub_options: {
            ack_wait: 60000,
            durable_name: 'influxWrite',
            max_in_flight: 100
          },
          sub_to_subject: 'influxWrite.in.' + main.ts,
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
    tasks = require('../../../dist').influxWrite

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
          'sources.influxWrite_in_' + main.ts + '.some_default',
          'default'
        )
      })
  })

  it('should drop csi database', function () {
    return model.private.influx
      .dropDatabase('ucnrs__ucac_angelo')
      .catch(_ => {})
  })

  it('should process csi data', function () {
    return helper.loadData(dataFileName.csiOut).then(data => {
      const msgStr = JSON.stringify(data)

      return new Promise((resolve, reject) => {
        model.private.stan.publish(
          'influxWrite.in.' + main.ts,
          msgStr,
          (err, guid) => (err ? reject(err) : resolve(guid))
        )
      })
    })
  })

  it('should drop decoded database', function () {
    return model.private.influx.dropDatabase('ucnrs__ucbu_burns').catch(_ => {})
  })

  it('should process decoded data', function () {
    return helper.loadData(dataFileName.decodePseudoBinaryOut).then(data => {
      const msgStr = JSON.stringify(data)

      return new Promise((resolve, reject) => {
        model.private.stan.publish(
          'influxWrite.in.' + main.ts,
          msgStr,
          (err, guid) => (err ? reject(err) : resolve(guid))
        )
      })
    })
  })

  it('should wait for 5 seconds to load points', function () {
    return new Promise(resolve => setTimeout(resolve, 5000))
  })

  it('should have loaded csi points', function () {
    return model.private.influx
      .query('select * from source_tenmin', {
        database: 'ucnrs__ucac_angelo'
      })
      .then(results => {
        expect(results).to.have.lengthOf(2)

        expect(results).to.have.nested.property('0.time')
        expect(results[0].time.getTime()).to.equal(1545660000000)
        expect(results).to.have.nested.property('0.Extra', 1545660000000)
        expect(results).to.have.nested.property('0.Day_of_Year', 358)

        expect(results).to.have.nested.property('1.time')
        expect(results[1].time.getTime()).to.equal(1545663600000)
        expect(results).to.have.nested.property('1.Extra', 1545663600000)
        expect(results).to.have.nested.property('1.Day_of_Year', 358)
      })
  })

  it('should have loaded decoded points', function () {
    return model.private.influx
      .query('select * from source_goes_tenmin', {
        database: 'ucnrs__ucbu_burns'
      })
      .then(results => {
        expect(results).to.have.lengthOf(1)

        expect(results).to.have.nested.property('0.time')
        expect(results[0].time.getTime()).to.equal(1545660000000)
        expect(results).to.have.nested.property('0.Extra', 1545660000000)
        expect(results).to.have.nested.property('0.col01', 358)
      })
  })
})
