/**
 * Tests for archive tasks
 */

describe('archive tasks', function () {
  this.timeout(30000)

  const now = new Date()
  const model = {
    props: {},
    state: {
      _id: 'taskMachine-archive-current',
      source_defaults: {
        some_default: 'default'
      },
      sources: [
        {
          description: 'Archive records imported from CSI',
          error_subject: 'dpe.archive.v1.err.csi',
          preprocessing_expr: [
            "($org := context.org_slug ~> $safeName;",
            "$station := payload.station ~> $safeName;",
            "$table := payload.table ~> $safeName;",
            "$time := payload.timeString;",
            "$recNum := $pad($string(payload.recordNumber), -10, '0');",
            "$docId := $join([$org, 'csi', $station, $table, $substring($time, 0, 10), $substring($time, 11, 2), $substring($time, 14, 2)], '-') & '_' & $recNum;",
            "$valid := $contains($docId, /^\\w+-csi-\\w+-\\w+-\\d{4}-\\d{2}-\\d{2}-\\d{2}-\\d{2}_\\d{10}$/);",
            "$params := $valid ? {'document_id': $docId} : {};",
            "$ ~> |$|{'params': $params}|;)"
          ],
          sub_options: {
            ack_wait: 10000,
            // durable_name: 'csi'
          },
          sub_to_subject: 'csi.import.v1.out'
        },
        {
          description: 'Archive DCP messages imported from GOES',
          error_subject: 'dpe.archive.v1.err.goes',
          preprocessing_expr: [
            "($org := context.org_slug ~> $safeName;",
            "$addr := payload.header.address ~> $safeName;",
            "$time := payload.header.timeDate;",
            "$docId := $join([$org, 'goes', $addr, $substring($time, 0, 10), $substring($time, 11, 2)], '-');",
            "$valid := $contains($docId, /^\\w+-goes-\\w+-\\d{4}-\\d{2}-\\d{2}-\\d{2}$/);",
            "$params := $valid ? {'document_id': $docId} : {};",
            "$ ~> |$|{'params': $params}|;)"
          ],
          sub_options: {
            ack_wait: 10000,
            // durable_name: 'goes'
          },
          sub_to_subject: 'goes.import.v1.out'
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
    value: 'archive'
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
    tasks = require('../../dist').archive

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
      expect(model).to.have.property('subscriptionsCloseReady', false)
      expect(model).to.have.property('subscriptionsReady', true)
      expect(model).to.have.property('versionTsReady', false)

      // Check for defaults
      expect(model).to.have.nested.property('sources.csi_import_v1_out.some_default', 'default')
      expect(model).to.have.nested.property('sources.goes_import_v1_out.some_default', 'default')
    })
  })

  it('should archive for 5 seconds', function () {
    return new Promise(resolve => setTimeout(resolve, 5000))
  })

  it('should reconfigure', function () {
    const now = new Date()

    model.scratch = {}
    model.state = {
      _id: 'taskMachine-archive-current',
      source_defaults: {
        some_default: 'default'
      },
      sources: [
        {
          description: 'Archive records imported from CSI',
          error_subject: 'dpe.archive.v1.err.csi',
          preprocessing_expr: [
            "($org := context.org_slug ~> $safeName;",
            "$station := payload.station ~> $safeName;",
            "$table := payload.table ~> $safeName;",
            "$time := payload.timeString;",
            "$recNum := $pad($string(payload.recordNumber), -10, '0');",
            "$docId := $join([$org, 'xyz', $station, $table, $substring($time, 0, 10), $substring($time, 11, 2), $substring($time, 14, 2)], '-') & '_' & $recNum;",
            "$valid := $contains($docId, /^\\w+-xyz-\\w+-\\w+-\\d{4}-\\d{2}-\\d{2}-\\d{2}-\\d{2}_\\d{10}$/);",
            "$params := $valid ? {'document_id': $docId} : {};",
            "$ ~> |$|{'params': $params}|;)"
          ],
          sub_options: {
            ack_wait: 10000,
            // durable_name: 'csi'
          },
          sub_to_subject: 'csi.import.v1.out'
        }
      ],
      created_at: now,
      updated_at: now
    }

    return machine.clear().start().then(success => {
      expect(success).to.be.true

      // Verify task state
      expect(model).to.have.property('preprocessingExprsReady', true)
      expect(model).to.have.property('sourcesReady', true)
      expect(model).to.have.property('stanCheckReady', false)
      expect(model).to.have.property('stanReady', false)
      expect(model).to.have.property('subscriptionsCloseReady', true)
      expect(model).to.have.property('subscriptionsReady', true)
      expect(model).to.have.property('versionTsReady', false)

      // Check for defaults
      expect(model).to.have.nested.property('sources.csi_import_v1_out.some_default', 'default')
    })
  })

  it('should archive for 5 seconds', function () {
    return new Promise(resolve => setTimeout(resolve, 5000)).then(() => {
      delete model.versionTs
    })
  })

  it('should spin down for 5 seconds', function () {
    return new Promise(resolve => setTimeout(resolve, 5000))
  })
})
