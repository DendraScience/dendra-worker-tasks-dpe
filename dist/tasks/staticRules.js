"use strict";

/**
 * Prepare model rules if not defined, or when new state is detected.
 */
const jsonata = require('jsonata');

const moment = require('../lib/moment-fn');

const {
  Decoder
} = require('@dendra-science/goes-pseudo-binary');

const {
  MomentEditor
} = require('@dendra-science/utils-moment');

const {
  registerHelpers
} = require('../lib/jsonata-utils');

module.exports = {
  guard(m) {
    return !m.staticRulesError && m.state.static_rules && m.staticRulesTs !== m.versionTs;
  },

  execute(m) {
    return m.state.static_rules.map(rule => {
      const obj = Object.assign({}, rule, {
        begins_at: moment(rule.begins_at),
        ends_before: moment(rule.ends_before)
      });
      const {
        definition
      } = rule;

      if (definition) {
        if (definition.decode_format) obj.decoder = new Decoder(definition.decode_format);
        if (definition.time_edit) obj.editor = new MomentEditor(definition.time_edit);

        if (Array.isArray(definition.transform_expr)) {
          const expr = jsonata(definition.transform_expr.join(' '));
          registerHelpers(expr);
          obj.transformExpr = expr;
        }
      }

      return obj;
    });
  },

  assign(m, res, {
    logger
  }) {
    m.private.staticRules = res;
    m.staticRulesTs = m.versionTs;
    logger.info('Static rules ready');
  }

};