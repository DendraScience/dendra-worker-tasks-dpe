/**
 * Create webhooks if not defined.
 */

const Agent = require('agentkeepalive')
const { HttpsAgent } = require('agentkeepalive')
const axios = require('axios')

function agentOptions() {
  return {
    timeout: 60000,
    freeSocketTimeout: 30000
  }
}

const httpAgent = new Agent(agentOptions())
const httpsAgent = new HttpsAgent(agentOptions())

module.exports = {
  guard(m) {
    return !m.webhooksError && !m.private.webhooks
  },

  execute(m, { logger }) {
    const cfg = Object.assign({ default: {} }, m.$app.get('clients').webhooks)
    const webhooks = {}

    Object.keys(cfg).forEach(key => {
      webhooks[key] = axios.create(
        Object.assign(
          {
            maxRedirects: 0,
            method: 'POST',
            timeout: 60000
          },
          cfg[key],
          {
            httpAgent,
            httpsAgent
          }
        )
      )
    })

    return webhooks
  },

  assign(m, res, { logger }) {
    m.private.webhooks = res

    logger.info('Webhooks ready')
  }
}
