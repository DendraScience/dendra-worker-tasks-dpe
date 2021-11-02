/**
 * Class for batch writing points.
 */

const LRU = require('modern-lru')
const debounce = require('lodash.debounce')

class PointsWriter {
  constructor(...opts) {
    Object.assign(this, ...opts, {
      callbacks: [],
      points: []
    })

    this.debouncedWrite = debounce(
      this.write.bind(this),
      this.batch_interval || 1000,
      {
        leading: false,
        trailing: true
      }
    )
  }

  static cached(key, limit, ...opts) {
    let { cache } = this
    if (!cache) cache = this.cache = new LRU(limit | 0 || 100)

    let writer = cache.get(key)
    if (!writer) {
      writer = new PointsWriter(...opts)

      cache.set(key, writer)
    }

    return writer
  }

  check(cb) {
    const { callbacks, options, points, debouncedWrite } = this

    callbacks.push(cb)

    this.logger.info(`Checking (${points.length}) point(s)`, options)

    if (points.length >= this.batch_size) {
      this.logger.info('Flushing queue', this.options)

      debouncedWrite.flush()
    } else {
      debouncedWrite()
    }
  }
}

module.exports = {
  PointsWriter
}
