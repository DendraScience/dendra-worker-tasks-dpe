/**
 * Tests for transform/patch tasks
 */

describe('transform/patch tasks', function () {
  this.timeout(60000)

  const now = new Date()
  const model = {
    props: {},
    state: {
      _id: 'taskMachine-patch-current',
      source_defaults: {
        some_default: 'default'
      },
      sources: [
        {
          description: 'Patch decoded Pseudo Binary data',
          error_subject: 'decodePseudoBinary.patch.err',
          preprocessing_expr: [
            /* eslint-disable quotes */
            '($org := context.org_slug ~> $safeName;',
            '$station := context.station ~> $safeName;',
            '$table := context.table ~> $safeName;',
            "$tags := ['org' & '$' & $org, 'source$goes', 'station' & '$' & $station, 'table' & '$' & $table];",
            '$time := payload.time;',
            "$params := {'tags': $tags, 'time': $time};",
            "$ ~> |$|{'params': $params, 'payload': payload.body}|;)"
            /* eslint-enable quotes */
          ],
          pub_to_subject: 'decodePseudoBinary.patch.out',
          sub_options: {
            ack_wait: 10000,
            durable_name: 'patch'
          },
          sub_to_subject: 'decodePseudoBinary.patch.in'
        },
        {
          description: 'Patch records imported from CSI',
          error_subject: 'csi.patch.err',
          preprocessing_expr: [
            /* eslint-disable quotes */
            '($org := context.org_slug ~> $safeName;',
            '$station := payload.station ~> $safeName;',
            '$table := payload.table ~> $safeName;',
            "$tags := ['org' & '$' & $org, 'source$csi', 'station' & '$' & $station, 'table' & '$' & $table];",
            "$time := payload.timeString & 'Z';",
            "$context := $merge([context, {'station': payload.station, 'table': payload.table}]);",
            "$params := {'tags': $tags, 'time': $time};",
            '$payload := $reduce(payload.fields, function($p, $c){$merge([$p, {$safeName($c.name, false): $c.value}])}, {});',
            "$ ~> |$|{'context': $context, 'params': $params, 'payload': $payload}|;)"
            /* eslint-enable quotes */
          ],
          pub_to_subject: 'csi.patch.out',
          sub_options: {
            ack_wait: 10000,
            durable_name: 'patch'
          },
          sub_to_subject: 'csi.patch.in'
        }
      ],
      static_rules: [
        {
          begins_at: '2000-01-01T00:00:00.000Z',
          definition: {
            transform_expr: [
              "$ ~> |$|{'time': $time().add(8, 'h').toMillis()},['Sta_ID']|"
            ]
          },
          ends_before: '2100-01-01T00:00:00.000Z',
          tags: ['org$ucnrs', 'source$csi', 'table$tenmin']
        },
        {
          begins_at: '2000-01-01T00:00:00.000Z',
          definition: {
            transform_expr: ["$ ~> |$|{'Extra': time}|"]
          },
          ends_before: '2100-01-01T00:00:00.000Z',
          tags: ['org$ucnrs']
        }
      ],
      created_at: now,
      updated_at: now
    }
  }

  const dataFileName = {
    csiOut: 'csi_import_out',
    decodePseudoBinaryOut: 'goes_decodePseudoBinary_out_0'
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
    tasks = require('../../../dist').transform

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
        expect(model).to.have.property('preprocessingExprsReady', true)
        expect(model).to.have.property('sourcesReady', true)
        expect(model).to.have.property('stanCheckReady', false)
        expect(model).to.have.property('stanCloseReady', false)
        expect(model).to.have.property('stanReady', true)
        expect(model).to.have.property('subscriptionsReady', true)
        expect(model).to.have.property('versionTsReady', false)

        // Check for defaults
        expect(model).to.have.nested.property(
          'sources.decodePseudoBinary_patch_in.some_default',
          'default'
        )
        expect(model).to.have.nested.property(
          'sources.csi_patch_in.some_default',
          'default'
        )
      })
  })

  it('should process csi data', function () {
    return helper.loadData(dataFileName.csiOut).then(data => {
      const msgStr = JSON.stringify(data)

      return new Promise((resolve, reject) => {
        model.private.stan.publish('csi.patch.in', msgStr, (err, guid) =>
          err ? reject(err) : resolve(guid)
        )
      })
    })
  })

  it('should subscribe to patched messages', function () {
    const opts = model.private.stan.subscriptionOptions()
    opts.setDeliverAllAvailable()
    opts.setDurableName('patch')

    sub = model.private.stan.subscribe('csi.patch.out', opts)
    messages = []
    sub.on('message', msg => {
      messages.push(JSON.parse(msg.getData()))
    })
  })

  it('should wait for 5 seconds to collect messages', function () {
    return new Promise(resolve => setTimeout(resolve, 5000))
  })

  it('should have patched messages', function () {
    sub.removeAllListeners()

    expect(messages).to.have.lengthOf(1)
    expect(messages).to.have.nested.property('0.payload.time', 1545663600000)
    expect(messages).to.have.nested.property('0.payload.Extra', 1545663600000)
    expect(messages).to.have.nested.property('0.payload.Day_of_Year', 358)
    expect(messages).to.not.have.nested.property('0.payload.Sta_ID')
  })

  it('should process decoded data', function () {
    return helper.loadData(dataFileName.decodePseudoBinaryOut).then(data => {
      const msgStr = JSON.stringify(data)

      return new Promise((resolve, reject) => {
        model.private.stan.publish(
          'decodePseudoBinary.patch.in',
          msgStr,
          (err, guid) => (err ? reject(err) : resolve(guid))
        )
      })
    })
  })

  it('should subscribe to patched messages', function () {
    const opts = model.private.stan.subscriptionOptions()
    opts.setDeliverAllAvailable()
    opts.setDurableName('patch')

    sub = model.private.stan.subscribe('decodePseudoBinary.patch.out', opts)
    messages = []
    sub.on('message', msg => {
      messages.push(JSON.parse(msg.getData()))
    })
  })

  it('should wait for 5 seconds to collect messages', function () {
    return new Promise(resolve => setTimeout(resolve, 5000))
  })

  it('should have patched messages', function () {
    sub.removeAllListeners()

    expect(messages).to.have.lengthOf(1)
    expect(messages).to.have.nested.property('0.payload.time', 1545660000000)
    expect(messages).to.have.nested.property('0.payload.Extra', 1545660000000)
    expect(messages).to.have.nested.property('0.payload.col01', 358)
  })
})
