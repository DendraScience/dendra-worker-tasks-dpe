"use strict";

/**
 * Parse preprocessing expressions after the sources are ready.
 */
const jsonata = require('jsonata');

const {
  registerHelpers
} = require('../lib/jsonata-utils');

module.exports = {
  guard(m) {
    return !m.preprocessingExprsError && m.sourcesTs === m.versionTs && m.preprocessingExprsTs !== m.versionTs;
  },

  execute(m, {
    logger
  }) {
    return m.sourceKeys.reduce((objs, sourceKey) => {
      const source = m.sources[sourceKey];
      const expr = source.preprocessing_expr;

      if (!Array.isArray(expr)) {
        logger.warn('Preprocessing expression must be an Array', {
          sourceKey
        });
      } else {
        try {
          const obj = objs[sourceKey] = jsonata(expr.join(' '));
          registerHelpers(obj);
        } catch (err) {
          logger.info('Preprocessing expression error', {
            err,
            expr,
            sourceKey
          });
        }
      }

      return objs;
    }, {});
  },

  assign(m, res, {
    logger
  }) {
    m.private.preprocessingExprs = res;
    m.preprocessingExprsTs = m.versionTs;
    logger.info('Preprocessing expressions ready');
  }

};