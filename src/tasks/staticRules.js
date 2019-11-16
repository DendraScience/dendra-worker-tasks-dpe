/**
 * Prepare model rules if not defined, or when new state is detected.
 */

const moment = require('../lib/moment-fn')

module.exports = {
  guard(m) {
    return (
      !m.staticRulesError &&
      m.state.static_rules &&
      m.state.static_rules.length > 0 &&
      m.staticRulesTs !== m.versionTs
    )
  },

  execute(m) {
    return m.state.static_rules.map(rule => {
      return Object.assign({}, rule, {
        begins_at: moment(rule.begins_at),
        ends_before: moment(rule.ends_before)
      })
    })
  },

  assign(m, res, { logger }) {
    m.private.staticRules = res
    m.staticRulesTs = m.versionTs

    logger.info('Static rules ready')
  }
}
