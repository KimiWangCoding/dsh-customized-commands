/**
 * Host half of the `dsh-customized-commands` bundle.
 *
 * Responsibilities:
 *   1. HTTP actions for the settings page (`lib/api.js`), served through the
 *      Harness connection carrier;
 *   2. `agent/pre-step` expansion (`lib/pre-step.js`): every user message that
 *      enters a model step has its known `/xxx` tokens replaced with the
 *      configured prompt before the request is assembled. The session log keeps
 *      the typed token, which is the agreed product behaviour.
 *
 * Both features degrade safely: a missing connection carrier disables only the
 * settings API, and any expansion failure leaves the decision untouched.
 *
 * @module @kimiwangcoding/dsh-customized-commands
 */

import { CreateApiHandler, C_ApiPath } from './lib/api.js'
import { C_ReservedCommandNames } from './lib/command-store.js'
import { CreatePreStepListener } from './lib/pre-step.js'

/** Loader-visible plugin name; also used by logs and diagnostics. */
export const name = 'dsh-customized-commands'

/**
 * Bundle entry point.
 * @param {object} ctx - plugin context.
 */
export function apply(ctx) {
  /**
   * Report one non-fatal plugin warning.
   * @param {string} message - warning text.
   */
  function Warn(message) {
    try {
      ctx.logger?.warn?.(message)
    } catch (_error) {
      // Logging must never break the plugin.
    }
  }

  /**
   * Collect the reserved command names: the first-party set plus every
   * command currently registered for a live agent (another plugin may own
   * one). Failures are contained because agents can be mid-teardown.
   * @returns {string[]} reserved names.
   */
  function CollectReservedNames() {
    const names = new Set(C_ReservedCommandNames)
    try {
      const commands = ctx.get('commands')
      const agents = ctx.get('agents')
      if (commands !== undefined && agents !== undefined) {
        for (const agent of agents.list()) {
          try {
            const descriptors = commands.list(agent)
            if (Array.isArray(descriptors)) {
              for (const descriptor of descriptors) {
                if (
                  descriptor !== null &&
                  typeof descriptor === 'object' &&
                  typeof descriptor.name === 'string'
                ) {
                  names.add(descriptor.name)
                }
              }
            }
          } catch (_agentError) {
            // A disposed agent cannot answer; skip it.
          }
        }
      }
    } catch (_error) {
      // The runtime catalog is unavailable; the static set still applies.
    }
    return [...names]
  }

  /**
   * Install the `agent/pre-step` rewrite. The plugin context owns the
   * subscription, so it is removed with the plugin row.
   */
  function InstallPreStep() {
    ctx.on(
      'agent/pre-step',
      CreatePreStepListener({
        resolveReservedNames: CollectReservedNames,
        warn: Warn,
      }),
    )
  }

  /**
   * Install the settings API route on the connection carrier.
   *
   * A CLI profile without a connection service simply keeps the pre-step
   * expansion and skips the route.
   */
  function InstallApi() {
    if (typeof ctx.inject !== 'function') {
      Warn('[dsh-customized-commands] ctx.inject unavailable; settings API disabled')
      return
    }
    ctx.inject(['connection'], (scope) => {
      let register
      try {
        register = scope.connection?.fetch?.register
      } catch (_error) {
        register = undefined
      }
      if (typeof register !== 'function') {
        Warn(
          '[dsh-customized-commands] connection.fetch.register is unavailable; settings API disabled',
        )
        return
      }

      const handler = CreateApiHandler({
        resolveReservedNames: () => CollectReservedNames(),
      })
      const dispose = register({
        path: C_ApiPath,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: (request) => handler(request),
      })
      if (typeof dispose === 'function') {
        scope.effect(() => dispose)
      }
    })
  }

  InstallPreStep()
  InstallApi()
}
