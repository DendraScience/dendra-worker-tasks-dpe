/**
 * Tests for webhookSend tasks
 */

describe('webhookSend tasks', function () {
  this.timeout(60000)

  const now = new Date()
  const model = {
    props: {},
    state: {
      _id: 'taskMachine-webhookSend-current',
      source_defaults: {
        some_default: 'default'
      },
      sources: [
        {
          description: 'Write prepared points to SFTP webhook',
          error_subject: 'webhookSend.err',
          sub_options: {
            ack_wait: 60000,
            durable_name: 'webhookSend',
            max_in_flight: 100
          },
          sub_to_subject: 'webhookSend.in.' + main.ts,
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
    csiOut: 'csi_prep_out_cdec'
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
    tasks = require('../../../dist').webhookSend

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
          'sources.webhookSend_in_' + main.ts + '.some_default',
          'default'
        )
      })
  })

  it('should process csi data', function () {
    return helper.loadData(dataFileName.csiOut).then(data => {
      const msgStr = JSON.stringify(data)

      return new Promise((resolve, reject) => {
        model.private.stan.publish(
          'webhookSend.in.' + main.ts,
          msgStr,
          (err, guid) => (err ? reject(err) : resolve(guid))
        )
      })
    })
  })

  it('should wait for 5 seconds to load points', function () {
    return new Promise(resolve => setTimeout(resolve, 5000))
  })
})
