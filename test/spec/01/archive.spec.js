/**
 * Tests for archive tasks
 */

describe('archive tasks', function() {
  this.timeout(60000)

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
          error_subject: 'csi.archive.err',
          preprocessing_expr: [
            /* eslint-disable quotes */
            '($org := context.org_slug ~> $safeName;',
            '$station := payload.station ~> $safeName;',
            '$table := payload.table ~> $safeName;',
            '$time := payload.timeString;',
            "$recNum := $pad($string(payload.recordNumber), -10, '0');",
            "$docId := $join([$org, 'csi', $station, $table, $substring($time, 0, 10), $substring($time, 11, 2), $substring($time, 14, 2)], '-') & '_' & $recNum;",
            '$valid := $contains($docId, /^\\w+-csi-\\w+-\\w+-\\d{4}-\\d{2}-\\d{2}-\\d{2}-\\d{2}_\\d{10}$/);',
            "$params := $valid ? {'document_id': $docId} : {};",
            "$ ~> |$|{'params': $params}|;)"
            /* eslint-enable quotes */
          ],
          sub_options: {
            ack_wait: 10000,
            durable_name: 'archive'
          },
          sub_to_subject: 'csi.archive.in'
        },
        {
          description: 'Archive DCP messages imported from GOES',
          error_subject: 'goes.archive.err',
          preprocessing_expr: [
            /* eslint-disable quotes */
            '($org := context.org_slug ~> $safeName;',
            '$addr := payload.header.address ~> $safeName;',
            '$time := payload.header.timeDate;',
            "$docId := $join([$org, 'goes', $addr, $substring($time, 0, 10), $substring($time, 11, 2)], '-');",
            '$valid := $contains($docId, /^\\w+-goes-\\w+-\\d{4}-\\d{2}-\\d{2}-\\d{2}$/);',
            "$params := $valid ? {'document_id': $docId} : {};",
            "$ ~> |$|{'params': $params}|;)"
            /* eslint-enable quotes */
          ],
          sub_options: {
            ack_wait: 10000,
            durable_name: 'archive'
          },
          sub_to_subject: 'goes.archive.in'
        }
      ],
      created_at: now,
      updated_at: now
    }
  }

  const dataFileName = {
    csiOut: 'csi_import_out',
    goesOut: 'goes_import_out'
  }
  const documentId = {
    csi1: 'ucnrs-csi-ucac_angelo-tenmin-2018-12-24-07-00_0000017829',
    csi2: 'ucnrs-xyz-ucac_angelo-tenmin-2018-12-24-07-00_0000017829',
    goes: 'ucnrs-goes-bec025b0-2018-12-24-14'
  }
  const documentService = main.app
    .get('connections')
    .archiveStore.app.service('/documents')

  const removeDocument = async id => {
    try {
      await documentService.remove(id)
    } catch (_) {}
  }
  const cleanup = async () => {
    await removeDocument(documentId.csi1)
    await removeDocument(documentId.csi2)
    await removeDocument(documentId.goes)
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

  before(async function() {
    return cleanup()
  })

  after(async function() {
    await cleanup()

    await Promise.all([
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
    tasks = require('../../../dist').archive

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
        expect(model).to.have.property('subscriptionsReady', true)
        expect(model).to.have.property('versionTsReady', false)

        // Check for defaults
        expect(model).to.have.nested.property(
          'sources.csi_archive_in.some_default',
          'default'
        )
        expect(model).to.have.nested.property(
          'sources.goes_archive_in.some_default',
          'default'
        )
      })
  })

  it('should process csi data', function() {
    return helper.loadData(dataFileName.csiOut).then(data => {
      const msgStr = JSON.stringify(data)

      return new Promise((resolve, reject) => {
        model.private.stan.publish('csi.archive.in', msgStr, (err, guid) =>
          err ? reject(err) : resolve(guid)
        )
      })
    })
  })

  it('should process goes data', function() {
    return helper.loadData(dataFileName.goesOut).then(data => {
      const msgStr = JSON.stringify(data)

      return new Promise((resolve, reject) => {
        model.private.stan.publish('goes.archive.in', msgStr, (err, guid) =>
          err ? reject(err) : resolve(guid)
        )
      })
    })
  })

  it('should wait for 5 seconds', function() {
    return new Promise(resolve => setTimeout(resolve, 5000))
  })

  it('should get archived csi document', function() {
    return documentService.get(documentId.csi1).then(doc => {
      expect(doc).to.have.nested.property(
        'content.payload.station',
        'ucac_angelo'
      )
    })
  })

  it('should get archived goes document', function() {
    return documentService.get(documentId.goes).then(doc => {
      expect(doc).to.have.nested.property(
        'content.payload.header.address',
        'BEC025B0'
      )
    })
  })

  it('should reconfigure', function() {
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
          error_subject: 'csi.archive.err',
          preprocessing_expr: [
            /* eslint-disable quotes */
            '($org := context.org_slug ~> $safeName;',
            '$station := payload.station ~> $safeName;',
            '$table := payload.table ~> $safeName;',
            '$time := payload.timeString;',
            "$recNum := $pad($string(payload.recordNumber), -10, '0');",
            "$docId := $join([$org, 'xyz', $station, $table, $substring($time, 0, 10), $substring($time, 11, 2), $substring($time, 14, 2)], '-') & '_' & $recNum;",
            '$valid := $contains($docId, /^\\w+-xyz-\\w+-\\w+-\\d{4}-\\d{2}-\\d{2}-\\d{2}-\\d{2}_\\d{10}$/);',
            "$params := $valid ? {'document_id': $docId} : {};",
            "$ ~> |$|{'params': $params}|;)"
            /* eslint-enable quotes */
          ],
          sub_options: {
            ack_wait: 10000,
            durable_name: 'archive'
          },
          sub_to_subject: 'csi.archive.in'
        }
      ],
      created_at: now,
      updated_at: now
    }

    return machine
      .clear()
      .start()
      .then(success => {
        /* eslint-disable-next-line no-unused-expressions */
        expect(success).to.be.true

        // Verify task state
        expect(model).to.have.property('preprocessingExprsReady', true)
        expect(model).to.have.property('sourcesReady', true)
        expect(model).to.have.property('stanCheckReady', true)
        expect(model).to.have.property('stanCloseReady', true)
        expect(model).to.have.property('stanReady', true)
        expect(model).to.have.property('subscriptionsReady', true)
        expect(model).to.have.property('versionTsReady', false)

        // Check for defaults
        expect(model).to.have.nested.property(
          'sources.csi_archive_in.some_default',
          'default'
        )
      })
  })

  it('should process csi data', function() {
    return helper.loadData(dataFileName.csiOut).then(data => {
      const msgStr = JSON.stringify(data)

      return new Promise((resolve, reject) => {
        model.private.stan.publish('csi.archive.in', msgStr, (err, guid) =>
          err ? reject(err) : resolve(guid)
        )
      })
    })
  })

  it('should wait for 5 seconds', function() {
    return new Promise(resolve => setTimeout(resolve, 5000))
  })

  it('should get archived csi document', function() {
    return documentService.get(documentId.csi2).then(doc => {
      expect(doc).to.have.nested.property(
        'content.payload.station',
        'ucac_angelo'
      )
    })
  })
})
