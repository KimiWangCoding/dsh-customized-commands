/**
 * Pure slash-command token scanning and prompt expansion.
 *
 * The Host half uses these helpers inside `agent/pre-step`: every user message
 * that enters a step is rewritten before the model request is assembled.
 *
 * Recognition rules (fixed by the product requirements):
 *   - the token is `/name` where `name` matches `^[a-z0-9][a-z0-9_-]*$`;
 *   - the character before `/` is the start of the text, a space, or a newline;
 *   - the character after `name` is a space, a newline, or the end of the text;
 *   - `name` must exactly match a known custom command.
 *
 * Expansion replaces the token with `"\n" + prompt + "\n"` so the prompt always
 * forms its own paragraph; surrounding text and unknown tokens are untouched.
 *
 * @module @kimiwangcoding/dsh-customized-commands/expander
 */

/** Token grammar; the leading separator is captured so `start` points at `/`. */
const C_TokenSource = '(^|\\s)\\/([a-z0-9][a-z0-9_-]*)(?=$|\\s)'

/**
 * Build a name→command lookup.
 * @param {Iterable<{ name: string, prompt: string }> | undefined} commands
 *   - command list or other iterable.
 * @returns {Map<string, { name: string, prompt: string }>} name index.
 */
export function IndexCommands(commands) {
  const index = new Map()
  if (commands === undefined || commands === null) return index
  for (const command of commands) {
    if (
      command !== null &&
      typeof command === 'object' &&
      typeof command.name === 'string' &&
      typeof command.prompt === 'string'
    ) {
      index.set(command.name, command)
    }
  }
  return index
}

/**
 * Scan a text for known command tokens.
 *
 * @param {string} text - message text.
 * @param {Map<string, { name: string, prompt: string }> | Iterable<{ name: string, prompt: string }>}
 *   commands - lookup or command list.
 * @returns {Array<{ name: string, start: number, end: number, prompt: string }>}
 *   tokens in text order, where `start` is the `/` index.
 */
export function ScanCommandTokens(text, commands) {
  if (typeof text !== 'string' || text.length === 0) return []
  const index = commands instanceof Map ? commands : IndexCommands(commands)
  const pattern = new RegExp(C_TokenSource, 'gu')
  const tokens = []
  let match
  while ((match = pattern.exec(text)) !== null) {
    const name = match[2]
    const command = index.get(name)
    if (command === undefined) continue
    const start = match.index + match[1].length
    tokens.push({
      name,
      start,
      end: start + 1 + name.length,
      prompt: command.prompt,
    })
  }
  return tokens
}

/**
 * Expand every known command token in one text.
 *
 * The scan runs over the original text, so prompt bodies are never rescanned
 * (no recursive expansion). Each token becomes `"\n" + prompt + "\n"`.
 *
 * @param {string} text - message text.
 * @param {Map<string, { name: string, prompt: string }> | Iterable<{ name: string, prompt: string }>}
 *   commands - lookup or command list.
 * @returns {{ text: string, changed: boolean, applied: string[] }}
 *   expanded text, whether anything changed, and the applied command names.
 */
export function ExpandCommandTokens(text, commands) {
  const tokens = ScanCommandTokens(text, commands)
  if (tokens.length === 0) return { text, changed: false, applied: [] }

  let output = ''
  let cursor = 0
  const applied = []
  for (const token of tokens) {
    output += text.slice(cursor, token.start)
    output += `\n${token.prompt}\n`
    cursor = token.end
    applied.push(token.name)
  }
  output += text.slice(cursor)
  return { text: output, changed: true, applied }
}
