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

import { LoadStore, SaveStore } from '../lib/command-store.js'
import { ExpandCommandTokens, IndexCommands } from '../lib/expander.js'

/** Repository root, one directory above this test file. */
const C_Root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
/** Writable sandbox for this test file. */
const C_TempBase = join(C_Root, 'test', '.tmp')
mkdirSync(C_TempBase, { recursive: true })
const C_TestDir = mkdtempSync(join(C_TempBase, 'scenario-'))
after(() => {
  rmSync(C_TestDir, { recursive: true, force: true })
})

test('end-to-end: mixed document, backup, rewrite, expansion and broken repair', () => {
  const filePath = join(C_TestDir, 'commands.json')
  const original = {
    version: 1,
    commands: [
      {
        name: 'review',
        description: '严格代码审查',
        prompt: '请你以资深代码审查者的身份检查下面的内容。',
      },
      { name: 'Bad', description: '大写', prompt: 'x' },
      { name: 'plan', description: '内置冲突', prompt: 'x' },
      { name: 'review', description: '重复', prompt: 'x' },
      { name: 'empty', description: '空 prompt', prompt: '   ' },
      { name: 'fix', description: '修复', prompt: '请修复下面的问题。' },
    ],
  }
  writeFileSync(filePath, JSON.stringify(original, null, 2), 'utf8')

  // 1. Load: only valid, non-reserved, non-duplicate entries survive.
  const loaded = LoadStore({ filePath })
  assert.equal(loaded.error, null)
  assert.deepEqual(
    loaded.commands.map((command) => command.name),
    ['review', 'fix'],
  )
  assert.deepEqual(loaded.ignored.map((entry) => entry.code).sort(), [
    'duplicate-name',
    'empty-prompt',
    'invalid-name',
    'reserved-name',
  ])

  // 2. Save: backup keeps the entire original mixed document.
  const saved = SaveStore(loaded.commands, { filePath })
  assert.equal(saved.ok, true)
  assert.ok(saved.backupPath !== null)
  assert.match(saved.backupPath, /\.bak-/u)
  const backupDocument = JSON.parse(readFileSync(saved.backupPath, 'utf8'))
  assert.equal(backupDocument.commands.length, 6)

  // 3. The rewritten document carries only the valid subset.
  const rewritten = JSON.parse(readFileSync(filePath, 'utf8'))
  assert.equal(rewritten.version, 1)
  assert.deepEqual(
    rewritten.commands.map((command) => command.name),
    ['review', 'fix'],
  )

  // 4. Expansion wraps the prompt in its own paragraph and keeps surroundings.
  const expanded = ExpandCommandTokens('请 /review 这段代码', IndexCommands(loaded.commands))
  assert.equal(
    expanded.text,
    '请 \n请你以资深代码审查者的身份检查下面的内容。\n 这段代码',
  )
  assert.deepEqual(expanded.applied, ['review'])

  // 5. A broken document is reported, never loaded, and preserved on repair.
  const brokenPath = join(C_TestDir, 'broken.json')
  writeFileSync(brokenPath, '{ not json', 'utf8')
  const brokenLoad = LoadStore({ filePath: brokenPath })
  assert.equal(brokenLoad.error.code, 'invalid-json')
  assert.deepEqual(brokenLoad.commands, [])

  const repaired = SaveStore(
    [{ name: 'fresh', description: '', prompt: 'fresh prompt' }],
    { filePath: brokenPath },
  )
  assert.equal(repaired.ok, true)
  assert.match(repaired.backupPath, /\.broken-/u)
  assert.equal(readFileSync(repaired.backupPath, 'utf8'), '{ not json')
})

test('end-to-end: a missing file is created on first save without a backup', () => {
  const filePath = join(C_TestDir, 'nested', 'commands.json')
  const result = SaveStore(
    [{ name: 'first', description: '首个命令', prompt: 'hello' }],
    { filePath },
  )
  assert.equal(result.ok, true)
  assert.equal(result.backupPath, null)
  const document = JSON.parse(readFileSync(filePath, 'utf8'))
  assert.deepEqual(document.commands.map((command) => command.name), ['first'])
})
