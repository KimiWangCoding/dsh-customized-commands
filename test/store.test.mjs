import assert from 'node:assert/strict'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  C_StoreVersion,
  LoadStore,
  ResolveStorePath,
  SaveStore,
  ValidateCommand,
  ValidateCommandList,
  ValidateCommandName,
} from '../lib/command-store.js'

/** Repository root, one directory above this test file. */
const C_Root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
/** Writable sandbox for this test file (inside the workspace, cleaned up after). */
const C_TempBase = join(C_Root, 'test', '.tmp')
mkdirSync(C_TempBase, { recursive: true })
const C_TestDir = mkdtempSync(join(C_TempBase, 'store-'))
after(() => {
  rmSync(C_TestDir, { recursive: true, force: true })
})

/**
 * Absolute path inside this test's sandbox.
 * @param {string} name - file name.
 * @returns {string} absolute path.
 */
function TempPath(name) {
  return join(C_TestDir, name)
}

/**
 * Write one JSON document into the sandbox.
 * @param {string} name - file name.
 * @param {unknown} value - value to serialize.
 * @returns {string} absolute path.
 */
function WriteJson(name, value) {
  const filePath = TempPath(name)
  writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8')
  return filePath
}

test('ResolveStorePath points at ~/.dsh/dsh-customized-commands/commands.json', () => {
  const resolved = ResolveStorePath('C:/Users/tester')
  assert.equal(
    resolved,
    join('C:/Users/tester', '.dsh', 'dsh-customized-commands', 'commands.json'),
  )
})

test('LoadStore reports a missing file as an empty store', () => {
  const result = LoadStore({ filePath: TempPath('missing.json') })
  assert.equal(result.exists, false)
  assert.deepEqual(result.commands, [])
  assert.deepEqual(result.ignored, [])
  assert.equal(result.error, null)
})

test('LoadStore loads valid commands and ignores invalid entries', () => {
  const filePath = WriteJson('mixed.json', {
    version: 1,
    commands: [
      { name: 'review', description: '审查', prompt: '请审查\n第二行' },
      { name: 'Bad', description: 'x', prompt: 'x' },
      { name: 'plan', description: 'x', prompt: 'x' },
      { name: 'review', description: 'dup', prompt: 'dup' },
      { name: 'empty', description: '', prompt: '   ' },
      { name: 'ok', description: '', prompt: 'ok' },
    ],
  })

  const result = LoadStore({ filePath })
  assert.equal(result.exists, true)
  assert.equal(result.version, 1)
  assert.equal(result.error, null)
  assert.deepEqual(
    result.commands.map((command) => command.name),
    ['review', 'ok'],
  )
  assert.equal(result.commands[0].prompt, '请审查\n第二行')

  assert.equal(result.ignored.length, 4)
  const codes = result.ignored.map((entry) => entry.code).sort()
  assert.deepEqual(codes, ['duplicate-name', 'empty-prompt', 'invalid-name', 'reserved-name'])
})

test('LoadStore refuses a malformed JSON document', () => {
  const filePath = TempPath('broken.json')
  writeFileSync(filePath, '{ not json', 'utf8')

  const result = LoadStore({ filePath })
  assert.equal(result.error.code, 'invalid-json')
  assert.deepEqual(result.commands, [])
})

test('LoadStore rejects a non-object top level', () => {
  const result = LoadStore({ filePath: WriteJson('array.json', []) })
  assert.equal(result.error.code, 'invalid-format')
})

test('LoadStore rejects a non-array commands field', () => {
  const result = LoadStore({
    filePath: WriteJson('shape.json', { version: 1, commands: {} }),
  })
  assert.equal(result.error.code, 'invalid-format')
})

test('LoadStore treats a missing commands field as an empty list', () => {
  const result = LoadStore({ filePath: WriteJson('empty.json', { version: 1 }) })
  assert.deepEqual(result.commands, [])
  assert.equal(result.error, null)
})

test('SaveStore writes the document atomically with version metadata', () => {
  const filePath = TempPath('save.json')
  const result = SaveStore(
    [{ name: 'review', description: '审查', prompt: 'prompt body' }],
    { filePath },
  )

  assert.equal(result.ok, true)
  assert.equal(result.count, 1)
  assert.equal(result.backupPath, null)

  const document = JSON.parse(readFileSync(filePath, 'utf8'))
  assert.equal(document.version, C_StoreVersion)
  assert.deepEqual(document.commands, [
    { name: 'review', description: '审查', prompt: 'prompt body' },
  ])
  assert.deepEqual(
    readdirSync(C_TestDir).filter((name) => name.includes('.tmp-')),
    [],
    'the temporary file must be renamed away',
  )
})

test('SaveStore backs up a parseable document before rewriting', () => {
  const filePath = TempPath('backup.json')
  SaveStore([{ name: 'first', description: '', prompt: 'first' }], { filePath })
  const second = SaveStore([{ name: 'second', description: '', prompt: 'second' }], {
    filePath,
  })

  assert.equal(second.ok, true)
  assert.ok(second.backupPath !== null && existsSync(second.backupPath))
  assert.match(second.backupPath, /\.bak-/u)
  const backup = JSON.parse(readFileSync(second.backupPath, 'utf8'))
  assert.equal(backup.commands[0].name, 'first')
})

test('SaveStore backs up a malformed document as .broken instead of losing it', () => {
  const filePath = TempPath('repair.json')
  writeFileSync(filePath, '{ broken', 'utf8')

  const result = SaveStore([{ name: 'fresh', description: '', prompt: 'fresh' }], {
    filePath,
  })
  assert.equal(result.ok, true)
  assert.ok(result.backupPath !== null && existsSync(result.backupPath))
  assert.match(result.backupPath, /\.broken-/u)
  assert.equal(readFileSync(result.backupPath, 'utf8'), '{ broken')
})

test('SaveStore rejects an invalid list without touching the file', () => {
  const filePath = TempPath('guard.json')
  SaveStore([{ name: 'keep', description: '', prompt: 'keep' }], { filePath })
  const before = readFileSync(filePath, 'utf8')

  const result = SaveStore([{ name: 'Bad', description: '', prompt: 'x' }], { filePath })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'invalid-name')
  assert.equal(readFileSync(filePath, 'utf8'), before)
})

test('ValidateCommandName enforces the documented format', () => {
  assert.equal(ValidateCommandName('review').ok, true)
  assert.equal(ValidateCommandName('a1_-').ok, true)
  assert.equal(ValidateCommandName('1review').ok, true)
  assert.equal(ValidateCommandName('').code, 'invalid-name')
  assert.equal(ValidateCommandName('Review').code, 'invalid-name')
  assert.equal(ValidateCommandName('-review').code, 'invalid-name')
  assert.equal(ValidateCommandName('a b').code, 'invalid-name')
  assert.equal(ValidateCommandName('a'.repeat(33)).code, 'invalid-name')
  assert.equal(ValidateCommandName('plan').code, 'reserved-name')
  assert.equal(ValidateCommandName('plan', { reservedNames: [] }).ok, true)
})

test('ValidateCommand permits keeping the same name while editing', () => {
  const result = ValidateCommand(
    { name: 'review', description: 'new', prompt: 'new prompt' },
    { existingNames: ['review'], originalName: 'review' },
  )
  assert.equal(result.ok, true)
})

test('ValidateCommand rejects duplicates and empty prompts', () => {
  assert.equal(
    ValidateCommand(
      { name: 'review', description: '', prompt: 'p' },
      { existingNames: ['review'] },
    ).code,
    'duplicate-name',
  )
  assert.equal(
    ValidateCommand({ name: 'review', description: '', prompt: '   ' }).code,
    'empty-prompt',
  )
  assert.equal(
    ValidateCommand({ name: 'review', description: 1, prompt: 'p' }).code,
    'invalid-description',
  )
})

test('ValidateCommandList reports the failing index', () => {
  const result = ValidateCommandList([
    { name: 'ok', description: '', prompt: 'p' },
    { name: 'Bad', description: '', prompt: 'p' },
  ])
  assert.equal(result.ok, false)
  assert.equal(result.code, 'invalid-name')
  assert.equal(result.index, 1)
})
