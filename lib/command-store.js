/**
 * Persistent store for user-defined slash commands.
 *
 * The store owns the JSON document at
 * `%USERPROFILE%\.dsh\dsh-customized-commands\commands.json`:
 *
 * ```json
 * {
 *   "version": 1,
 *   "commands": [
 *     { "name": "review", "description": "严格代码审查", "prompt": "..." }
 *   ]
 * }
 * ```
 *
 * Responsibilities are deliberately narrow so the module stays testable
 * without the Harness runtime:
 *   - name/command validation (format, length, built-in collisions, duplicates);
 *   - tolerant loading (missing file, unreadable file, invalid JSON, invalid
 *     entries are reported instead of thrown);
 *   - atomic saving with a timestamped backup of the previous file.
 *
 * The settings page (S5) and the Host HTTP API (S2) both build on this module.
 *
 * @module @kimiwangcoding/dsh-customized-commands/command-store
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** Document version written by this build. */
export const C_StoreVersion = 1
/** Directory name under `~/.dsh` that owns the command document. */
export const C_StoreDirectoryName = 'dsh-customized-commands'
/** Command document file name. */
export const C_StoreFileName = 'commands.json'
/** Maximum command-name length accepted by validation. */
export const C_MaxCommandNameLength = 32
/** Maximum description length accepted by validation. */
export const C_MaxDescriptionLength = 200
/** Maximum prompt length accepted by validation. */
export const C_MaxPromptLength = 100_000

/**
 * First-party command names a user command must never shadow.
 *
 * `compact`, `goal`, `plan`, `feedback`, `permission` and `export` are Host
 * commands; `file` and `model` are built-in client menu actions. The Host half
 * unions this list with the runtime command registry before validating, so a
 * command registered by another plugin is reserved as well.
 */
export const C_ReservedCommandNames = Object.freeze([
  'compact',
  'export',
  'feedback',
  'file',
  'goal',
  'model',
  'permission',
  'plan',
])

/** Lowercase ASCII name: starts alphanumeric, then letters/digits/underscore/dash. */
const C_CommandNamePattern = /^[a-z0-9][a-z0-9_-]*$/

/**
 * Build a failed validation result.
 * @param {string} code - stable machine-readable reason.
 * @param {string} message - Chinese user-facing fallback message.
 * @param {string} [field] - offending field, when known.
 * @returns {{ ok: false, code: string, message: string, field?: string }}
 */
function Fail(code, message, field) {
  return { ok: false, code, message, ...(field === undefined ? {} : { field }) }
}

/**
 * Resolve the default command-document path.
 * @param {string} [home] - home directory override (tests); defaults to `os.homedir()`.
 * @returns {string} absolute path to `commands.json`.
 */
export function ResolveStorePath(home = homedir()) {
  return join(home, '.dsh', C_StoreDirectoryName, C_StoreFileName)
}

/**
 * Validate one command name.
 *
 * The name must match `^[a-z0-9][a-z0-9_-]*$`, stay within the length limit,
 * and not collide with a reserved (built-in or already used) name.
 *
 * @param {unknown} name - candidate name without the leading slash.
 * @param {{ reservedNames?: readonly string[] }} [options] - reserved-name override.
 * @returns {{ ok: true, name: string } | { ok: false, code: string, message: string }}
 */
export function ValidateCommandName(name, options = {}) {
  const reservedNames = options.reservedNames ?? C_ReservedCommandNames
  if (typeof name !== 'string' || name.length === 0) {
    return Fail('invalid-name', '命令名不能为空', 'name')
  }
  if (name.length > C_MaxCommandNameLength) {
    return Fail('invalid-name', `命令名不能超过 ${C_MaxCommandNameLength} 个字符`, 'name')
  }
  if (!C_CommandNamePattern.test(name)) {
    return Fail(
      'invalid-name',
      '命令名必须以小写字母或数字开头，且只能包含小写字母、数字、_ 和 -',
      'name',
    )
  }
  if (reservedNames.includes(name)) {
    return Fail('reserved-name', `“${name}” 与内置命令冲突，请换一个名称`, 'name')
  }
  return { ok: true, name }
}

/**
 * Validate and normalize one command entry.
 *
 * `originalName` marks an edit of an existing command: keeping the same name
 * is not a duplicate. Pass `existingNames` for create/import checks.
 *
 * @param {unknown} candidate - raw entry from JSON or the settings form.
 * @param {{
 *   reservedNames?: readonly string[],
 *   existingNames?: readonly string[],
 *   originalName?: string,
 * }} [options] - validation context.
 * @returns {{ ok: true, command: { name: string, description: string, prompt: string } }
 *   | { ok: false, code: string, message: string, field?: string }}
 */
export function ValidateCommand(candidate, options = {}) {
  const reservedNames = options.reservedNames ?? C_ReservedCommandNames
  const existingNames = options.existingNames ?? []
  const originalName = options.originalName

  if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return Fail('invalid-command', '命令必须是一个对象')
  }

  const nameResult = ValidateCommandName(candidate.name, { reservedNames })
  if (!nameResult.ok) return nameResult
  const name = nameResult.name

  if (name !== originalName && existingNames.includes(name)) {
    return Fail('duplicate-name', `命令 “${name}” 已存在`, 'name')
  }

  const description = candidate.description ?? ''
  if (typeof description !== 'string') {
    return Fail('invalid-description', '命令简述必须是字符串', 'description')
  }
  if (description.length > C_MaxDescriptionLength) {
    return Fail(
      'description-too-long',
      `命令简述不能超过 ${C_MaxDescriptionLength} 个字符`,
      'description',
    )
  }

  const prompt = candidate.prompt
  if (typeof prompt !== 'string' || prompt.trim().length === 0) {
    return Fail('empty-prompt', '命令 prompt 不能为空', 'prompt')
  }
  if (prompt.length > C_MaxPromptLength) {
    return Fail('prompt-too-long', `命令 prompt 不能超过 ${C_MaxPromptLength} 个字符`, 'prompt')
  }

  return {
    ok: true,
    command: Object.freeze({ name, description, prompt }),
  }
}

/**
 * Validate a complete command list in order, rejecting duplicates.
 * @param {unknown} commands - candidate list.
 * @param {readonly string[]} [reservedNames] - reserved-name override.
 * @returns {{ ok: true, commands: Array<{ name: string, description: string, prompt: string }> }
 *   | { ok: false, code: string, message: string, index?: number }}
 */
export function ValidateCommandList(commands, reservedNames = C_ReservedCommandNames) {
  if (!Array.isArray(commands)) {
    return Fail('invalid-format', 'commands 必须是数组')
  }
  const names = []
  const normalized = []
  for (let index = 0; index < commands.length; index += 1) {
    const result = ValidateCommand(commands[index], {
      reservedNames,
      existingNames: names,
    })
    if (!result.ok) {
      return { ...result, index }
    }
    names.push(result.command.name)
    normalized.push(result.command)
  }
  return { ok: true, commands: normalized }
}

/**
 * Load the command document without throwing.
 *
 * Failure modes are reported in `error` (file-level) or `ignored` (entry-level)
 * while every valid command is still returned:
 *   - missing file → empty store, no error;
 *   - unreadable file → `error.code = 'unreadable'`, no commands;
 *   - malformed JSON → `error.code = 'invalid-json'`, no commands;
 *   - wrong top-level shape → `error.code = 'invalid-format'`, no commands;
 *   - invalid entries → listed in `ignored`, valid entries still load.
 *
 * @param {{ filePath?: string, home?: string, reservedNames?: readonly string[] }} [options]
 *   - path and validation context overrides.
 * @returns {{
 *   filePath: string,
 *   exists: boolean,
 *   version: number | null,
 *   commands: Array<{ name: string, description: string, prompt: string }>,
 *   ignored: Array<{ index: number, name?: string, code: string, message: string }>,
 *   error: null | { code: string, message: string, detail: string | null },
 * }}
 */
export function LoadStore(options = {}) {
  const filePath = options.filePath ?? ResolveStorePath(options.home)
  const reservedNames = options.reservedNames ?? C_ReservedCommandNames
  const result = {
    filePath,
    exists: false,
    version: null,
    commands: [],
    ignored: [],
    error: null,
  }

  if (!existsSync(filePath)) return result
  result.exists = true

  let text
  try {
    text = readFileSync(filePath, 'utf8')
  } catch (error) {
    result.error = {
      code: 'unreadable',
      message: '无法读取 commands.json',
      detail: String(error),
    }
    return result
  }

  let document
  try {
    document = JSON.parse(text)
  } catch (error) {
    result.error = {
      code: 'invalid-json',
      message: 'commands.json 不是有效的 JSON',
      detail: String(error),
    }
    return result
  }

  if (document === null || typeof document !== 'object' || Array.isArray(document)) {
    result.error = {
      code: 'invalid-format',
      message: 'commands.json 的顶层必须是一个对象',
      detail: null,
    }
    return result
  }

  if (typeof document.version === 'number') result.version = document.version

  if (document.commands === undefined) return result
  if (!Array.isArray(document.commands)) {
    result.error = {
      code: 'invalid-format',
      message: 'commands.json 的 commands 字段必须是数组',
      detail: null,
    }
    return result
  }

  const seen = []
  document.commands.forEach((candidate, index) => {
    const validation = ValidateCommand(candidate, { reservedNames, existingNames: seen })
    if (!validation.ok) {
      result.ignored.push({
        index,
        ...(candidate !== null && typeof candidate === 'object' && typeof candidate.name === 'string'
          ? { name: candidate.name }
          : {}),
        code: validation.code,
        message: validation.message,
      })
      return
    }
    seen.push(validation.command.name)
    result.commands.push(validation.command)
  })

  return result
}

/**
 * Save the full command list atomically.
 *
 * Order of operations: validate everything → back up the existing document →
 * write a temporary sibling → rename over the target. The backup is
 * `commands.json.bak-<stamp>` for a parseable document and
 * `commands.json.broken-<stamp>` for one that is not valid JSON, so a repair
 * never silently destroys the broken file.
 *
 * @param {unknown} commands - complete list to persist.
 * @param {{
 *   filePath?: string,
 *   home?: string,
 *   reservedNames?: readonly string[],
 * }} [options] - path and validation context overrides.
 * @returns {{ ok: true, filePath: string, backupPath: string | null, count: number }
 *   | { ok: false, code: string, message: string, detail?: string, index?: number }}
 */
export function SaveStore(commands, options = {}) {
  const filePath = options.filePath ?? ResolveStorePath(options.home)
  const reservedNames = options.reservedNames ?? C_ReservedCommandNames

  const normalized = ValidateCommandList(commands, reservedNames)
  if (!normalized.ok) {
    const { ok: _ok, ...failure } = normalized
    return { ok: false, ...failure, message: normalized.message }
  }

  let backupPath = null
  try {
    mkdirSync(dirname(filePath), { recursive: true })

    if (existsSync(filePath)) {
      const broken = !IsParseableFile(filePath)
      backupPath = `${filePath}.${broken ? 'broken' : 'bak'}-${Timestamp()}`
      copyFileSync(filePath, backupPath)
    }

    const payload = `${JSON.stringify(
      { version: C_StoreVersion, commands: normalized.commands },
      null,
      2,
    )}\n`
    const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`
    try {
      writeFileSync(tempPath, payload, 'utf8')
      renameSync(tempPath, filePath)
    } catch (error) {
      try {
        rmSync(tempPath, { force: true })
      } catch (_cleanupError) {
        // A leftover temp file is harmless; the write error is the real failure.
      }
      throw error
    }

    return { ok: true, filePath, backupPath, count: normalized.commands.length }
  } catch (error) {
    return {
      ok: false,
      code: 'write-failed',
      message: '写入 commands.json 失败',
      detail: String(error),
    }
  }
}

/**
 * Whether one existing file contains valid JSON.
 * @param {string} filePath - absolute file path.
 * @returns {boolean} true when the file can be parsed as JSON.
 */
function IsParseableFile(filePath) {
  try {
    JSON.parse(readFileSync(filePath, 'utf8'))
    return true
  } catch (_error) {
    return false
  }
}

/**
 * Filesystem-safe timestamp with a random suffix, used in backup names.
 * @returns {string} e.g. `2026-11-06T11-48-00-123Z-a1b2`.
 */
function Timestamp() {
  const iso = new Date().toISOString().replace(/[:.]/gu, '-')
  const suffix = Math.random().toString(36).slice(2, 6)
  return `${iso}-${suffix}`
}
