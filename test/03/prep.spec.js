/**
 * Tests for transform/prep tasks
 */

describe('transform/prep tasks', function () {
  this.timeout(30000)

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
          error_subject: 'dpe.prep.v1.err.patch',
          preprocessing_expr: [
            "($org := context.org_slug ~> $safeName;",
            "$station := context.station ~> $safeName;",
            "$table := context.table ~> $safeName;",
            "$tags := ['org' & '$' & $org, 'station' & '$' & $station, 'table' & '$' & $table];",
            "$time := payload.time;",
            "$params := {'tags': $tags, 'time': $time};",
            "$options := {'database': $org & '__' & $station, 'precision': 'ms'};",
            "$fields := payload ~> $deleteNulls ~> $deleteKeys(['time']);",
            "$points := [{'fields': $fields, 'measurement': 'source_' & $table, 'time': $time}];",
            "$payload := {'options': $options, 'points': $points};",
            "$ ~> |$|{'params': $params, 'payload': $payload}|;)"
          ],
          pub_to_subject: 'dpe.prep.v1.out',
          sub_options: {
            ack_wait: 10000,
            // durable_name: 'patch'
          },
          sub_to_subject: 'dpe.patch.v1.out'
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
          tags: [
            'xorg$ucnrs'
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
      expect(model).to.have.nested.property('sources.dpe_patch_v1_out.some_default', 'default')
    })
  })

  it('should prep for 5 seconds', function () {
    return new Promise(resolve => setTimeout(resolve, 5000)).then(() => {
      delete model.versionTs
    })
  })

  it('should spin down for 5 seconds', function () {
    return new Promise(resolve => setTimeout(resolve, 5000))
  })
})
