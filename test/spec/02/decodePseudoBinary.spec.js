/**
 * Tests for decodePseudoBinary tasks
 */

describe('decodePseudoBinary tasks', function () {
  this.timeout(60000)

  const now = new Date()
  const model = {
    props: {},
    state: {
      _id: 'taskMachine-decodePseudoBinary-current',
      source_defaults: {
        some_default: 'default'
      },
      sources: [
        {
          description: 'Decode DCP messages imported from GOES',
          error_subject: 'goes.decodePseudoBinary.err',
          preprocessing_expr: [
            /* eslint-disable quotes */
            "($org := context.org_slug ~> $safeName;",
            "$addr := payload.header.address ~> $safeName;",
            "$tags := ['org' & '$' & $org, 'addr' & '$' & $addr];",
            "$time := payload.header.timeDate;",
            "$skip := $addr = 'bec0035c' ? true : false;",
            "$params := {'skip': $skip, 'tags': $tags, 'time': $time};",
            "$ ~> |$|{'params': $params, 'payload': payload.body}|;)"
            /* eslint-enable quotes */
          ],
          pub_to_subject: 'goes.decodePseudoBinary.out',
          sub_options: {
            ack_wait: 10000,
            durable_name: 'decodePseudoBinary'
          },
          sub_to_subject: 'goes.decodePseudoBinary.in'
        }
      ],
      static_rules: [
        {
          begins_at: '2000-01-01T00:00:00.000Z',
          definition: {
            decode_columns: [
              'col01', 'col02', 'col03', 'col04', 'col05', 'col06', 'col07', 'col08', 'col09', 'col10',
              'col11', 'col12', 'col13', 'col14', 'col15', 'col16', 'col17', 'col18', 'col19', 'col20',
              'col21', 'col22', 'col23', 'col24', 'col25', 'col26', 'col27'
            ],
            decode_format: 'fp2_27',
            decode_slice: [1, 487],
            time_edit: 'so_h',
            time_interval: 600
          },
          ends_before: '2100-01-01T00:00:00.000Z',
          tags: [
            'org$ucnrs',
            'addr$bec025b0'
          ]
        }
      ],
      created_at: now,
      updated_at: now
    }
  }

  const dataFileName = {
    goesOut: 'goes_import_out'
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
    value: 'decodePseudoBinary'
  })
  Object.defineProperty(model, 'private', {
    enumerable: false,
    configurable: false,
    writable: false,
    value: {}
  })

  let tasks
  let machine
  let messages
  let sub

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
    tasks = require('../../../dist').decodePseudoBinary

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
      /* eslint-disable-next-line no-unused-expressions */
      expect(success).to.be.true

      // Verify task state
      expect(model).to.have.property('preprocessingExprsReady', true)
      expect(model).to.have.property('sourcesReady', true)
      expect(model).to.have.property('stanCheckReady', false)
      expect(model).to.have.property('stanCloseReady', false)
      expect(model).to.have.property('stanReady', true)
      expect(model).to.have.property('staticRulesReady', true)
      expect(model).to.have.property('subscriptionsReady', true)
      expect(model).to.have.property('versionTsReady', false)

      // Check for defaults
      expect(model).to.have.nested.property('sources.goes_decodePseudoBinary_in.some_default', 'default')
    })
  })

  it('should process goes data', function () {
    return helper.loadData(dataFileName.goesOut).then(data => {
      const msgStr = JSON.stringify(data)

      return new Promise((resolve, reject) => {
        model.private.stan.publish('goes.decodePseudoBinary.in', msgStr, (err, guid) => err ? reject(err) : resolve(guid))
      })
    })
  })

  it('should subscribe to decoded messages', function () {
    const opts = model.private.stan.subscriptionOptions()
    opts.setDeliverAllAvailable()
    opts.setDurableName('decodePseudoBinary')

    sub = model.private.stan.subscribe('goes.decodePseudoBinary.out', opts)
    messages = []
    sub.on('message', msg => {
      messages.push(JSON.parse(msg.getData()))
    })
  })

  it('should wait for 5 seconds to collect messages', function () {
    return new Promise(resolve => setTimeout(resolve, 5000))
  })

  it('should have decoded messages', function () {
    sub.removeAllListeners()

    expect(messages).to.have.lengthOf(6)
    expect(messages).to.have.nested.property('0.payload.time', 1545660000000)
    expect(messages).to.have.nested.property('0.payload.col01', 358)
  })

  it('should reconfigure', function () {
    const now = new Date()

    model.scratch = {}
    model.state = {
      _id: 'taskMachine-decodePseudoBinary-current',
      source_defaults: {
        some_default: 'default'
      },
      sources: [
        {
          description: 'Decode DCP messages imported from GOES',
          error_subject: 'dpe.decodePseudoBinary.v1.err.goes',
          preprocessing_expr: [
            /* eslint-disable quotes */
            "($org := context.org_slug ~> $safeName;",
            "$addr := payload.header.address ~> $safeName;",
            "$tags := ['org' & '$' & $org, 'addr' & '$' & $addr];",
            "$time := payload.header.timeDate;",
            "$params := {'tags': $tags, 'time': $time};",
            "$ ~> |$|{'params': $params, 'payload': payload.body}|;)"
            /* eslint-enable quotes */
          ],
          pub_to_subject: 'goes.decodePseudoBinary.out',
          sub_options: {
            ack_wait: 10000,
            durable_name: 'decodePseudoBinary'
          },
          sub_to_subject: 'goes.decodePseudoBinary.in'
        }
      ],
      static_rules: [
        {
          begins_at: '2000-01-01T00:00:00.000Z',
          definition: {
            decode_columns: [
              'c01', 'c02', 'c03', 'c04', 'c05', 'c06', 'c07', 'c08', 'c09', 'c10',
              'c11', 'c12', 'c13', 'c14', 'c15', 'c16', 'c17', 'c18', 'c19', 'c20',
              'c21', 'c22', 'c23', 'c24', 'c25', 'c26', 'c27'
            ],
            decode_format: 'fp2_27',
            decode_slice: [1, 487],
            time_edit: 'so_h',
            time_interval: 600
          },
          ends_before: '2100-01-01T00:00:00.000Z',
          tags: [
            'org$ucnrs',
            'addr$bec025b0'
          ]
        }
      ],
      created_at: now,
      updated_at: now
    }

    return machine.clear().start().then(success => {
      /* eslint-disable-next-line no-unused-expressions */
      expect(success).to.be.true

      // Verify task state
      expect(model).to.have.property('preprocessingExprsReady', true)
      expect(model).to.have.property('sourcesReady', true)
      expect(model).to.have.property('stanCheckReady', true)
      expect(model).to.have.property('stanCloseReady', true)
      expect(model).to.have.property('stanReady', true)
      expect(model).to.have.property('staticRulesReady', true)
      expect(model).to.have.property('subscriptionsReady', true)
      expect(model).to.have.property('versionTsReady', false)

      // Check for defaults
      expect(model).to.have.nested.property('sources.goes_decodePseudoBinary_in.some_default', 'default')
    })
  })

  it('should process goes data', function () {
    return helper.loadData(dataFileName.goesOut).then(data => {
      const msgStr = JSON.stringify(data)

      return new Promise((resolve, reject) => {
        model.private.stan.publish('goes.decodePseudoBinary.in', msgStr, (err, guid) => err ? reject(err) : resolve(guid))
      })
    })
  })

  it('should subscribe to decoded messages', function () {
    const opts = model.private.stan.subscriptionOptions()
    opts.setDeliverAllAvailable()
    opts.setDurableName('decodePseudoBinary')

    sub = model.private.stan.subscribe('goes.decodePseudoBinary.out', opts)
    messages = []
    sub.on('message', msg => {
      messages.push(JSON.parse(msg.getData()))
    })
  })

  it('should wait for 5 seconds to collect messages', function () {
    return new Promise(resolve => setTimeout(resolve, 5000))
  })

  it('should have decoded messages', function () {
    sub.removeAllListeners()

    expect(messages).to.have.lengthOf(6)
    expect(messages).to.have.nested.property('0.payload.time', 1545660000000)
    expect(messages).to.have.nested.property('0.payload.c01', 358)
  })
})
