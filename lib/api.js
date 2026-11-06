/**
 * Host HTTP actions consumed by the plugin's settings page.
 *
 * The Harness connection carrier serves this handler at
 * `POST /api/dsh-customized-commands` with a JSON body:
 *
 *   { "action": "list" }
 *   { "action": "save", "command": { name, description, prompt }, "originalName"?: string }
 *   { "action": "delete", "name": string }
 *
 * Every response is JSON with an `ok` flag. Business failures keep HTTP 200 so
 * the settings page can render the exact reason; malformed requests use 400 and
 * unexpected exceptions use 500.
 *
 * The handler is created with an optional `filePath` and a reserved-name
 * resolver so unit tests can run against a temporary document and a fake
 * runtime command catalog.
 *
 * @module @kimiwangcoding/dsh-customized-commands/api
 */

import {
  C_ReservedCommandNames,
  LoadStore,
  SaveStore,
  ValidateCommand,
} from './command-store.js'

/** Route served to the browser half. */
export const C_ApiPath = '/api/dsh-customized-commands'

/** Upper bound for one settings request body. */
const C_MaxBodyBytes = 1024 * 1024

/**
 * Error class for malformed request bodies, mapped to HTTP 400.
 */
class RequestError extends Error {
  constructor(message) {
    super(message)
    this.name = 'RequestError'
  }
}

/**
 * Create the settings API handler.
 *
 * @param {{
 *   filePath?: string,
 *   resolveReservedNames?: () => readonly string[],
 * }} [options]
 *   - `filePath` overrides the default `commands.json` path (tests);
 *     `resolveReservedNames` returns the current built-in/runtime command names.
 * @returns {(request: Request) => Promise<Response>} fetch-style handler.
 */
export function CreateApiHandler(options = {}) {
  const filePath = options.filePath
  const resolveReservedNames = options.resolveReservedNames ?? (() => C_ReservedCommandNames)

  /**
   * Produce the complete list payload used by every successful response.
   * @returns {object} current store snapshot plus the file location.
   */
  function BuildListPayload() {
    const loaded = LoadStore({ filePath, reservedNames: resolveReservedNames() })
    return {
      ok: true,
      commands: loaded.commands,
      ignored: loaded.ignored,
      error: loaded.error,
      filePath: loaded.filePath,
      exists: loaded.exists,
      version: loaded.version,
    }
  }

  /**
   * Create or update one command.
   * @param {object} body - parsed request body.
   * @returns {object} list payload plus `backupPath`, or a failure payload.
   */
  function HandleSave(body) {
    const reservedNames = resolveReservedNames()
    const originalName = typeof body.originalName === 'string' ? body.originalName : undefined
    const loaded = LoadStore({ filePath, reservedNames })
    const existingNames = loaded.commands
      .map((command) => command.name)
      .filter((name) => name !== originalName)

    const validation = ValidateCommand(body.command, {
      reservedNames,
      existingNames,
      originalName,
    })
    if (!validation.ok) {
      return {
        ok: false,
        code: validation.code,
        message: validation.message,
        ...(validation.field === undefined ? {} : { field: validation.field }),
      }
    }

    let next
    if (originalName !== undefined) {
      const index = loaded.commands.findIndex((command) => command.name === originalName)
      if (index < 0) {
        return {
          ok: false,
          code: 'not-found',
          message: `要修改的命令 “${originalName}” 不存在`,
        }
      }
      next = loaded.commands.slice()
      next[index] = validation.command
    } else {
      next = [...loaded.commands, validation.command]
    }

    const saved = SaveStore(next, { filePath, reservedNames })
    if (!saved.ok) {
      return {
        ok: false,
        code: saved.code,
        message: saved.message,
        ...(saved.detail === undefined ? {} : { detail: saved.detail }),
      }
    }
    return { ...BuildListPayload(), backupPath: saved.backupPath }
  }

  /**
   * Delete one command by name.
   * @param {object} body - parsed request body.
   * @returns {object} list payload plus `backupPath`, or a failure payload.
   */
  function HandleDelete(body) {
    const reservedNames = resolveReservedNames()
    if (typeof body.name !== 'string' || body.name.length === 0) {
      return { ok: false, code: 'invalid-request', message: '缺少命令名' }
    }

    const loaded = LoadStore({ filePath, reservedNames })
    const next = loaded.commands.filter((command) => command.name !== body.name)
    if (next.length === loaded.commands.length) {
      return { ok: false, code: 'not-found', message: `命令 “${body.name}” 不存在` }
    }

    const saved = SaveStore(next, { filePath, reservedNames })
    if (!saved.ok) {
      return {
        ok: false,
        code: saved.code,
        message: saved.message,
        ...(saved.detail === undefined ? {} : { detail: saved.detail }),
      }
    }
    return { ...BuildListPayload(), backupPath: saved.backupPath }
  }

  /**
   * One fetch-style request handler.
   * @param {Request} request - authenticated request from the connection carrier.
   * @returns {Promise<Response>} JSON response.
   */
  return async function HandleApiRequest(request) {
    try {
      const body = await ReadJsonBody(request)
      if (body === null || typeof body !== 'object' || Array.isArray(body)) {
        return JsonResponse(400, {
          ok: false,
          code: 'invalid-request',
          message: '请求体必须是 JSON 对象',
        })
      }

      if (body.action === 'list') return JsonResponse(200, BuildListPayload())
      if (body.action === 'save') return JsonResponse(200, HandleSave(body))
      if (body.action === 'delete') return JsonResponse(200, HandleDelete(body))

      return JsonResponse(400, {
        ok: false,
        code: 'unknown-action',
        message: '未知操作',
      })
    } catch (error) {
      if (error instanceof RequestError) {
        return JsonResponse(400, {
          ok: false,
          code: 'invalid-request',
          message: error.message,
        })
      }
      return JsonResponse(500, {
        ok: false,
        code: 'internal',
        message: '插件内部错误',
        detail: String(error),
      })
    }
  }
}

/**
 * Read and parse a JSON request body.
 *
 * Reads the stream manually (matching the carrier's buffered body contract)
 * and enforces a size limit before parsing.
 *
 * @param {Request} request - incoming request.
 * @returns {Promise<unknown>} parsed JSON value.
 * @throws {RequestError} when the body is too large or not valid JSON.
 */
async function ReadJsonBody(request) {
  const stream = request?.body
  if (stream === undefined || stream === null) return null

  const reader = stream.getReader()
  const chunks = []
  let total = 0
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      if (value !== undefined) {
        total += value.byteLength
        if (total > C_MaxBodyBytes) throw new RequestError('请求体过大')
        chunks.push(Buffer.from(value))
      }
    }
  } finally {
    reader.releaseLock()
  }

  const text = Buffer.concat(chunks).toString('utf8').trim()
  if (text === '') return null
  try {
    return JSON.parse(text)
  } catch (_error) {
    throw new RequestError('请求体不是有效的 JSON')
  }
}

/**
 * Build one JSON response.
 * @param {number} status - HTTP status code.
 * @param {unknown} value - JSON-serializable payload.
 * @returns {Response} response with no-store caching.
 */
function JsonResponse(status, value) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}
