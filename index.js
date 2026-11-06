/**
 * Host half of the `dsh-customized-commands` bundle.
 *
 * S0 scaffold: the Host half only proves that the bundle loads. Later stages
 * add the command store (`commands.json`), the HTTP actions consumed by the
 * settings page, and the `agent/pre-step` expansion of `/xxx` tokens.
 *
 * @module @kimiwangcoding/dsh-customized-commands
 */

/** Loader-visible plugin name; also used by logs and diagnostics. */
export const name = 'dsh-customized-commands'

/**
 * Bundle entry point. Intentionally side-effect free during S0: the Host half
 * must load before any storage or network resource is registered, so a bundle
 * with a missing data file can never break Harness startup.
 */
export function apply() {}
