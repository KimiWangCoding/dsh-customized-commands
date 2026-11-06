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
 *   - `name` must exactly match a known custom command;
 *   - a token inside a fenced code block (``` or ~~~) or a same-line backtick
 *     span is an example, never a command.
 *
 * Expansion replaces the token with `"\n" + prompt + "\n"` so the prompt always
 * forms its own paragraph; surrounding text and unknown tokens are untouched.
 *
 * @module @kimiwangcoding/dsh-customized-commands/expander
 */

/** Token grammar; the leading separator is captured so `start` points at `/`. */
const C_TokenSource = '(^|\\s)\\/([a-z0-9][a-z0-9_-]*)(?=$|\\s)'

/** A fenced code block opens with at least three backticks or tildes. */
const C_FenceOpen = /^(`{3,}|~{3,})/u
/** A closing fence carries no info string (surrounding whitespace is trimmed). */
const C_FenceClose = /^(`{3,}|~{3,})$/u

/**
 * Range of text that must stay literal.
 * @typedef {{ start: number, end: number }} ProtectedRange
 */

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
 * Split a text into line spans (newline excluded, `\r` retained).
 * @param {string} text - source text.
 * @returns {Array<{ start: number, end: number, raw: string }>} line spans.
 */
function SplitLines(text) {
  const lines = []
  let offset = 0
  for (const raw of text.split('\n')) {
    const start = offset
    const end = start + raw.length
    lines.push({ start, end, raw })
    offset = end + 1
  }
  return lines
}

/**
 * Append same-line inline-code spans found in `[from, to)`.
 *
 * A run of N backticks opens a span closed by another run of exactly N
 * backticks on the same line; an unmatched run stays ordinary text. Backslash
 * escapes are skipped. Same-line scope is deliberate: chat messages often use a
 * lone backtick, and cross-line pairing would hide unrelated commands.
 *
 * @param {string} text - source text.
 * @param {number} from - segment start.
 * @param {number} to - segment end.
 * @param {ProtectedRange[]} out - collected ranges.
 */
function ScanInlineCode(text, from, to, out) {
  let i = from
  while (i < to) {
    if (text[i] === '\\') {
      i += 2
      continue
    }
    if (text[i] !== '`') {
      i += 1
      continue
    }

    let run = 0
    while (i + run < to && text[i + run] === '`') run += 1
    const runStart = i

    let lineEnd = i + run
    while (lineEnd < to && text[lineEnd] !== '\n') lineEnd += 1

    let cursor = i + run
    let found = -1
    while (cursor < lineEnd) {
      if (text[cursor] === '\\') {
        cursor += 2
        continue
      }
      if (text[cursor] !== '`') {
        cursor += 1
        continue
      }
      let closeRun = 0
      while (cursor + closeRun < lineEnd && text[cursor + closeRun] === '`') closeRun += 1
      if (closeRun === run) {
        found = cursor
        break
      }
      cursor += closeRun
    }

    if (found === -1) {
      i = runStart + run
      continue
    }
    out.push({ start: runStart, end: found + run })
    i = found + run
  }
}

/**
 * Compute every range that must stay literal: fenced code blocks plus
 * same-line inline-code spans outside those fences.
 * @param {string} text - source text.
 * @returns {ProtectedRange[]} sorted, non-overlapping ranges.
 */
function ComputeProtectedRanges(text) {
  const ranges = []
  const lines = SplitLines(text)

  let fence = null
  for (const line of lines) {
    if (fence === null) {
      const open = C_FenceOpen.exec(line.raw.trimStart())
      if (open !== null) {
        fence = { char: open[1][0], length: open[1].length, start: line.start }
      }
      continue
    }
    const close = C_FenceClose.exec(line.raw.trim())
    if (close !== null && close[1][0] === fence.char && close[1].length >= fence.length) {
      ranges.push({ start: fence.start, end: line.end })
      fence = null
    }
  }
  if (fence !== null) ranges.push({ start: fence.start, end: text.length })

  let cursor = 0
  for (const range of ranges.slice().sort((left, right) => left.start - right.start)) {
    if (cursor < range.start) ScanInlineCode(text, cursor, range.start, ranges)
    cursor = Math.max(cursor, range.end)
  }
  if (cursor < text.length) ScanInlineCode(text, cursor, text.length, ranges)

  ranges.sort((left, right) => left.start - right.start)
  return ranges
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
  const protectedRanges = ComputeProtectedRanges(text)
  const pattern = new RegExp(C_TokenSource, 'gu')
  const tokens = []
  let rangeIndex = 0
  let match

  while ((match = pattern.exec(text)) !== null) {
    const name = match[2]
    const command = index.get(name)
    if (command === undefined) continue

    const start = match.index + match[1].length
    while (
      rangeIndex < protectedRanges.length &&
      protectedRanges[rangeIndex].end <= start
    ) {
      rangeIndex += 1
    }
    const range = protectedRanges[rangeIndex]
    if (range !== undefined && start >= range.start) continue

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
