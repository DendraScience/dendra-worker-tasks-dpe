/**
 * Close subscriptions if defined and new state is detected.
 */

module.exports = {
  guard (m) {
    return !m.subscriptionsCloseError &&
      m.private.stan && m.stanConnected &&
      (m.subscriptionsTs !== m.versionTs) &&
      m.private.subscriptions
  },

  execute (m) { return true },

  assign (m, res, {logger}) {
    logger.info('Subscriptions closing')

    m.private.subscriptions.forEach(sub => {
      sub.close()
      sub.removeAllListeners()
    })

    delete m.private.subscriptions
  }
}
