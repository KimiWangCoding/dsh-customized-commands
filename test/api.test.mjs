import assert from 'node:assert/strict'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { C_ApiPath, CreateApiHandler } from '../lib/api.js'

/** Repository root, one directory above this test file. */
const C_Root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
/** Writable sandbox for this test file. */
const C_TempBase = join(C_Root, 'test', '.tmp')
mkdirSync(C_TempBase, { recursive: true })
const C_TestDir = mkdtempSync(join(C_TempBase, 'api-'))
after(() => {
  rmSync(C_TestDir, { recursive: true, force: true })
})

/**
 * Create a handler backed by a dedicated file inside the sandbox.
 * @param {string} fileName - sandbox file name.
 * @returns {(request: Request) => Promise<Response>} API handler.
 */
function CreateHandler(fileName) {
  return CreateApiHandler({
    filePath: join(C_TestDir, fileName),
    resolveReservedNames: () => ['compact', 'plan'],
  })
}

/**
 * Send one JSON request to a handler.
 * @param {(request: Request) => Promise<Response>} handler - API handler.
 * @param {unknown} body - object to serialize, or a raw string.
 * @returns {Promise<{ status: number, value: any }>} status and parsed payload.
 */
async function Post(handler, body) {
  const request = new Request(`http://localhost${C_ApiPath}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
  const response = await handler(request)
  return { status: response.status, value: await response.json() }
}

test('list returns an empty store for a missing file', async () => {
  const { status, value } = await Post(CreateHandler('missing.json'), { action: 'list' })
  assert.equal(status, 200)
  assert.equal(value.ok, true)
  assert.equal(value.exists, false)
  assert.deepEqual(value.commands, [])
  assert.equal(value.error, null)
})

test('save creates a command and list returns it', async () => {
  const handler = CreateHandler('create.json')
  const created = await Post(handler, {
    action: 'save',
    command: { name: 'review', description: '审查', prompt: 'body' },
  })
  assert.equal(created.value.ok, true)
  assert.deepEqual(
    created.value.commands.map((command) => command.name),
    ['review'],
  )
  const document = JSON.parse(readFileSync(join(C_TestDir, 'create.json'), 'utf8'))
  assert.equal(document.commands[0].prompt, 'body')

  const listed = await Post(handler, { action: 'list' })
  assert.deepEqual(
    listed.value.commands.map((command) => command.name),
    ['review'],
  )
})

test('save rejects duplicates, reserved names and malformed names', async () => {
  const handler = CreateHandler('invalid.json')
  await Post(handler, {
    action: 'save',
    command: { name: 'review', description: '', prompt: 'p' },
  })

  const duplicate = await Post(handler, {
    action: 'save',
    command: { name: 'review', description: '', prompt: 'p' },
  })
  assert.equal(duplicate.value.ok, false)
  assert.equal(duplicate.value.code, 'duplicate-name')

  const reserved = await Post(handler, {
    action: 'save',
    command: { name: 'plan', description: '', prompt: 'p' },
  })
  assert.equal(reserved.value.code, 'reserved-name')

  const malformed = await Post(handler, {
    action: 'save',
    command: { name: 'Bad', description: '', prompt: 'p' },
  })
  assert.equal(malformed.value.code, 'invalid-name')
})

test('save edits a command, can rename it, and rejects a missing original', async () => {
  const handler = CreateHandler('edit.json')
  await Post(handler, {
    action: 'save',
    command: { name: 'review', description: 'old', prompt: 'old' },
  })

  const edited = await Post(handler, {
    action: 'save',
    originalName: 'review',
    command: { name: 'check', description: 'new', prompt: 'new' },
  })
  assert.equal(edited.value.ok, true)
  assert.deepEqual(
    edited.value.commands.map((command) => command.name),
    ['check'],
  )

  const missing = await Post(handler, {
    action: 'save',
    originalName: 'nope',
    command: { name: 'x', description: '', prompt: 'x' },
  })
  assert.equal(missing.value.code, 'not-found')
})

test('delete removes a command and reports an unknown name', async () => {
  const handler = CreateHandler('delete.json')
  await Post(handler, {
    action: 'save',
    command: { name: 'temp', description: '', prompt: 'p' },
  })

  const deleted = await Post(handler, { action: 'delete', name: 'temp' })
  assert.equal(deleted.value.ok, true)
  assert.deepEqual(deleted.value.commands, [])

  const missing = await Post(handler, { action: 'delete', name: 'temp' })
  assert.equal(missing.value.ok, false)
  assert.equal(missing.value.code, 'not-found')
})

test('unknown actions and malformed bodies are client errors', async () => {
  const unknown = await Post(CreateHandler('unknown.json'), { action: 'nope' })
  assert.equal(unknown.status, 400)
  assert.equal(unknown.value.code, 'unknown-action')

  const malformed = await Post(CreateHandler('malformed.json'), '{ not json')
  assert.equal(malformed.status, 400)
  assert.equal(malformed.value.code, 'invalid-request')

  const handler = CreateHandler('empty-body.json')
  const emptyResponse = await handler(
    new Request(`http://localhost${C_ApiPath}`, { method: 'POST' }),
  )
  assert.equal(emptyResponse.status, 400)
  assert.equal((await emptyResponse.json()).code, 'invalid-request')
})

test('a broken document is reported and repaired with a .broken backup', async () => {
  const filePath = join(C_TestDir, 'broken.json')
  writeFileSync(filePath, '{ broken', 'utf8')
  const handler = CreateApiHandler({
    filePath,
    resolveReservedNames: () => ['plan'],
  })

  const listed = await Post(handler, { action: 'list' })
  assert.equal(listed.value.ok, true)
  assert.equal(listed.value.error.code, 'invalid-json')
  assert.deepEqual(listed.value.commands, [])

  const saved = await Post(handler, {
    action: 'save',
    command: { name: 'fresh', description: '', prompt: 'fresh prompt' },
  })
  assert.equal(saved.value.ok, true)
  assert.match(saved.value.backupPath, /\.broken-/u)
  assert.equal(readFileSync(saved.value.backupPath, 'utf8'), '{ broken')
})
