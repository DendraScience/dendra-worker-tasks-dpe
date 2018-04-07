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
          error_subject: 'dpe.influxWrite.v1.err.prep',
          sub_options: {
            ack_wait: 60000,
            // durable_name: 'prep',
            max_in_flight: 100
          },
          sub_to_subject: 'dpe.prep.v1.out',
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
      model.private.stan ? new Promise((resolve, reject) => {
        model.private.stan.removeAllListeners()
        model.private.stan.once('close', resolve)
        model.private.stan.once('error', reject)
        model.private.stan.close()
      }) : Promise.resolve()
    ])
  })

  it('should import', function () {
    tasks = require('../../dist').influxWrite

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

    return machine.clear().start().then(success => {
      expect(success).to.be.true

      // Verify task state
      expect(model).to.have.property('sourcesReady', true)
      expect(model).to.have.property('stanCheckReady', false)
      expect(model).to.have.property('stanReady', true)
      expect(model).to.have.property('subscriptionsCloseReady', false)
      expect(model).to.have.property('subscriptionsReady', true)
      expect(model).to.have.property('versionTsReady', false)

      // Check for defaults
      expect(model).to.have.nested.property('sources.dpe_prep_v1_out.some_default', 'default')
    })
  })

  it('should write for 40 seconds', function () {
    return new Promise(resolve => setTimeout(resolve, 40000)).then(() => {
      delete model.versionTs
    })
  })

  it('should spin down for 15 seconds', function () {
    return new Promise(resolve => setTimeout(resolve, 15000))
  })
})
