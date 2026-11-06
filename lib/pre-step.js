/**
 * `agent/pre-step` listener for prompt expansion.
 *
 * The listener runs after `next()` so other listeners' decisions survive, and
 * only rewrites `kind: 'enter'` decisions. User-message text blocks whose text
 * contains known `/xxx` tokens are expanded; every other block, message, and
 * decision field is preserved. Failures degrade to the original decision.
 *
 * Kept as a factory so tests can point it at a temporary store and a fake
 * reserved-name resolver without a running Harness.
 *
 * @module @kimiwangcoding/dsh-customized-commands/pre-step
 */

import { C_ReservedCommandNames, LoadStore } from './command-store.js'
import { ExpandCommandTokens, IndexCommands } from './expander.js'

/**
 * Expand one user message.
 * @param {object} message - candidate message.
 * @param {Map<string, { name: string, prompt: string }>} index - command lookup.
 * @returns {{ message: object, changed: boolean }} original or rewritten message.
 */
function ExpandMessage(message, index) {
  if (
    message === null ||
    typeof message !== 'object' ||
    message.role !== 'user' ||
    !Array.isArray(message.content)
  ) {
    return { message, changed: false }
  }

  let changed = false
  const content = message.content.map((block) => {
    if (
      block === null ||
      typeof block !== 'object' ||
      block.type !== 'text' ||
      typeof block.text !== 'string'
    ) {
      return block
    }
    const result = ExpandCommandTokens(block.text, index)
    if (!result.changed) return block
    changed = true
    return { ...block, text: result.text }
  })

  return changed ? { message: { ...message, content }, changed: true } : { message, changed: false }
}

/**
 * Create the `agent/pre-step` listener.
 *
 * @param {{
 *   filePath?: string,
 *   resolveReservedNames?: () => readonly string[],
 *   warn?: (message: string) => void,
 * }} [options]
 *   - path override (tests), reserved-name resolver, and non-fatal warning sink.
 * @returns {(payload: unknown, next: () => Promise<object>) => Promise<object>}
 *   the waterfall listener.
 */
export function CreatePreStepListener(options = {}) {
  const filePath = options.filePath
  const resolveReservedNames = options.resolveReservedNames ?? (() => C_ReservedCommandNames)
  const warn = options.warn ?? (() => {})

  return async function PreStepListener(_payload, next) {
    const decision = await next()
    if (decision === undefined || decision === null || decision.kind !== 'enter') {
      return decision
    }

    try {
      const loaded = LoadStore({ filePath, reservedNames: resolveReservedNames() })
      if (loaded.commands.length === 0) return decision

      const index = IndexCommands(loaded.commands)
      const expanded = decision.messages.map((message) => ExpandMessage(message, index))
      if (!expanded.some((entry) => entry.changed)) return decision

      return { ...decision, messages: expanded.map((entry) => entry.message) }
    } catch (error) {
      warn(`[dsh-customized-commands] pre-step expansion failed: ${String(error)}`)
      return decision
    }
  }
}
