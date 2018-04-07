/**
 * Tests for transform/patch tasks
 */

describe('transform/patch tasks', function () {
  this.timeout(30000)

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
          error_subject: 'dpe.patch.v1.err.decodePseudoBinary',
          preprocessing_expr: [
            "($org := context.org_slug ~> $safeName;",
            "$station := context.station ~> $safeName;",
            "$table := context.table ~> $safeName;",
            "$tags := ['org' & '$' & $org, 'source$goes', 'station' & '$' & $station, 'table' & '$' & $table];",
            "$time := payload.time;",
            "$params := {'tags': $tags, 'time': $time};",
            "$ ~> |$|{'params': $params, 'payload': payload.body}|;)"
          ],
          pub_to_subject: 'dpe.patch.v1.out',
          sub_options: {
            ack_wait: 10000,
            // durable_name: 'decodePseudoBinary'
          },
          sub_to_subject: 'dpe.decodePseudoBinary.v1.out'
        },
        {
          description: 'Patch records imported from CSI',
          error_subject: 'dpe.patch.v1.err.csi',
          preprocessing_expr: [
            "($org := context.org_slug ~> $safeName;",
            "$station := payload.station ~> $safeName;",
            "$table := payload.table ~> $safeName;",
            "$tags := ['org' & '$' & $org, 'source$csi', 'station' & '$' & $station, 'table' & '$' & $table];",
            "$time := payload.timeString & 'Z';",
            "$context := $merge([context, {'station': payload.station, 'table': payload.table}]);",
            "$params := {'tags': $tags, 'time': $time};",
            "$payload := $reduce(payload.fields, function($p, $c){$merge([$p, {$safeName($c.name, false): $c.value}])}, {});",
            "$ ~> |$|{'context': $context, 'params': $params, 'payload': $payload}|;)"
          ],
          pub_to_subject: 'dpe.patch.v1.out',
          sub_options: {
            ack_wait: 10000,
            // durable_name: 'csi'
          },
          sub_to_subject: 'csi.import.v1.out'
        }
      ],
      static_rules: [
        {
          begins_at: '2000-01-01T00:00:00.000Z',
          definition: {
            transform_expr: [
              "$ ~> |$|{'time': $time().add(8, 'h').toMillis()},['Sta_Id']|"
            ]
          },
          ends_before: '2100-01-01T00:00:00.000Z',
          tags: [
            'org$ucnrs',
            'source$csi',
            'table$tenmin'
          ]
        },
        {
          begins_at: '2000-01-01T00:00:00.000Z',
          definition: {
            transform_expr: [
              "$ ~> |$|{'Extra': time}|"
            ]
          },
          ends_before: '2100-01-01T00:00:00.000Z',
          tags: [
            'org$ucnrs'
          ]
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
    tasks = require('../../dist').transform

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
      expect(model).to.have.property('preprocessingExprsReady', true)
      expect(model).to.have.property('sourcesReady', true)
      expect(model).to.have.property('stanCheckReady', false)
      expect(model).to.have.property('stanReady', true)
      expect(model).to.have.property('staticRulesReady', true)
      expect(model).to.have.property('subscriptionsCloseReady', false)
      expect(model).to.have.property('subscriptionsReady', true)
      expect(model).to.have.property('versionTsReady', false)

      // Check for defaults
      expect(model).to.have.nested.property('sources.dpe_decodePseudoBinary_v1_out.some_default', 'default')
      expect(model).to.have.nested.property('sources.csi_import_v1_out.some_default', 'default')
    })
  })

  it('should patch for 5 seconds', function () {
    return new Promise(resolve => setTimeout(resolve, 5000)).then(() => {
      delete model.versionTs
    })
  })

  it('should spin down for 5 seconds', function () {
    return new Promise(resolve => setTimeout(resolve, 5000))
  })
})
