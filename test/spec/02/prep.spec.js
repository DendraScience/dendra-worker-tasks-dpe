/**
 * Tests for transform/prep tasks
 */

describe('transform/prep tasks', function() {
  this.timeout(60000)

  const now = new Date()
  const model = {
    props: {},
    state: {
      _id: 'taskMachine-prep-current',
      source_defaults: {
        some_default: 'default'
      },
      sources: [
        {
          description: 'Prepare payload for writing to Influx',
          error_subject: 'prep.err',
          preprocessing_expr: [
            /* eslint-disable quotes */
            '($org := context.org_slug ~> $safeName;',
            '$station := context.station ~> $safeName;',
            '$table := context.table ~> $safeName;',
            "$tags := ['org' & '$' & $org, 'station' & '$' & $station, 'table' & '$' & $table];",
            '$time := payload.time;',
            "$params := {'tags': $tags, 'time': $time};",
            "$options := {'database': $org & '__' & $station, 'precision': 'ms'};",
            "$fields := payload ~> $deleteNulls ~> $deleteKeys(['time']);",
            "$points := [{'fields': $fields, 'measurement': 'source_' & $table, 'time': $time}];",
            "$payload := {'options': $options, 'points': $points};",
            "$ ~> |$|{'params': $params, 'payload': $payload}|;)"
            /* eslint-enable quotes */
          ],
          pub_to_subject: 'prep.out',
          sub_options: {
            ack_wait: 10000,
            durable_name: 'prep'
          },
          sub_to_subject: 'prep.in'
        }
      ],
      static_rules: [
        {
          begins_at: '2000-01-01T00:00:00.000Z',
          definition: {
            transform_expr: [
              "$ ~> |points|{'tags': {'month': $time().format('MM')}}|"
            ]
          },
          ends_before: '2100-01-01T00:00:00.000Z',
          tags: ['xorg$ucnrs']
        }
      ],
      created_at: now,
      updated_at: now
    }
  }

  const dataFileName = {
    csiOut: 'csi_patch_out',
    decodePseudoBinaryOut: 'decodePseudoBinary_patch_out'
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
  let messages
  let sub

  after(function() {
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

  it('should import', function() {
    tasks = require('../../../dist').transform

    expect(tasks).to.have.property('sources')
  })

  it('should create machine', function() {
    machine = new tm.TaskMachine(model, tasks, {
      helpers: {
        logger: console
      },
      interval: 500
    })

    expect(machine).to.have.property('model')
  })

  it('should run', function() {
    model.scratch = {}

    return machine
      .clear()
      .start()
      .then(success => {
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
        expect(model).to.have.nested.property(
          'sources.prep_in.some_default',
          'default'
        )
      })
  })

  it('should process csi data', function() {
    return helper.loadData(dataFileName.csiOut).then(data => {
      const msgStr = JSON.stringify(data)

      return new Promise((resolve, reject) => {
        model.private.stan.publish('prep.in', msgStr, (err, guid) =>
          err ? reject(err) : resolve(guid)
        )
      })
    })
  })

  it('should subscribe to prepared messages', function() {
    const opts = model.private.stan.subscriptionOptions()
    opts.setDeliverAllAvailable()
    opts.setDurableName('prep`')

    sub = model.private.stan.subscribe('prep.out', opts)
    messages = []
    sub.on('message', msg => {
      messages.push(JSON.parse(msg.getData()))
    })
  })

  it('should wait for 5 seconds to collect messages', function() {
    return new Promise(resolve => setTimeout(resolve, 5000))
  })

  it('should have prepared messages', function() {
    expect(messages).to.have.lengthOf(1)
    expect(messages).to.have.nested.property(
      '0.payload.options.database',
      'ucnrs__ucac_angelo'
    )
    expect(messages).to.have.nested.property(
      '0.payload.options.precision',
      'ms'
    )
    expect(messages).to.have.nested.property(
      '0.payload.points.0.time',
      1545663600000
    )
    expect(messages).to.have.nested.property(
      '0.payload.points.0.measurement',
      'source_tenmin'
    )
    expect(messages).to.have.nested.property(
      '0.payload.points.0.fields.Extra',
      1545663600000
    )
    expect(messages).to.have.nested.property(
      '0.payload.points.0.fields.Day_of_Year',
      358
    )
  })

  it('should process decoded data', function() {
    messages = []

    return helper.loadData(dataFileName.decodePseudoBinaryOut).then(data => {
      const msgStr = JSON.stringify(data)

      return new Promise((resolve, reject) => {
        model.private.stan.publish('prep.in', msgStr, (err, guid) =>
          err ? reject(err) : resolve(guid)
        )
      })
    })
  })

  it('should wait for 5 seconds to collect messages', function() {
    return new Promise(resolve => setTimeout(resolve, 5000))
  })

  it('should have prepared messages', function() {
    sub.removeAllListeners()

    expect(messages).to.have.lengthOf(1)
    expect(messages).to.have.nested.property(
      '0.payload.options.database',
      'ucnrs__ucbu_burns'
    )
    expect(messages).to.have.nested.property(
      '0.payload.options.precision',
      'ms'
    )
    expect(messages).to.have.nested.property(
      '0.payload.points.0.time',
      1545660000000
    )
    expect(messages).to.have.nested.property(
      '0.payload.points.0.measurement',
      'source_goes_tenmin'
    )
    expect(messages).to.have.nested.property(
      '0.payload.points.0.fields.Extra',
      1545660000000
    )
    expect(messages).to.have.nested.property(
      '0.payload.points.0.fields.col01',
      358
    )
  })
})
