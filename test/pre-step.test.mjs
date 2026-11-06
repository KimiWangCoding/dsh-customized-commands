import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { CreatePreStepListener } from '../lib/pre-step.js'

/** Repository root, one directory above this test file. */
const C_Root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
/** Writable sandbox for this test file. */
const C_TempBase = join(C_Root, 'test', '.tmp')
mkdirSync(C_TempBase, { recursive: true })
const C_TestDir = mkdtempSync(join(C_TempBase, 'pre-step-'))
after(() => {
  rmSync(C_TestDir, { recursive: true, force: true })
})

/**
 * Write a command document into the sandbox.
 * @param {string} name - file name.
 * @param {Array<{ name: string, description: string, prompt: string }>} commands
 *   - commands to persist.
 * @returns {string} absolute file path.
 */
function WriteStore(name, commands) {
  const filePath = join(C_TestDir, name)
  writeFileSync(filePath, JSON.stringify({ version: 1, commands }, null, 2), 'utf8')
  return filePath
}

/**
 * Build an `enter` decision with one user message.
 * @param {string} text - first text block.
 * @param {Array<object>} [extraBlocks] - additional content blocks.
 * @returns {object} PreStepDecision-shaped value.
 */
function CreateDecision(text, extraBlocks = []) {
  return {
    kind: 'enter',
    messages: [{ role: 'user', content: [{ type: 'text', text }, ...extraBlocks] }],
    startsRequestSeries: true,
  }
}

test('expands text blocks and preserves other blocks and decision fields', async () => {
  const filePath = WriteStore('single.json', [
    { name: 'review', description: '', prompt: 'REVIEW_BODY' },
  ])
  const listener = CreatePreStepListener({ filePath, resolveReservedNames: () => ['plan'] })
  const imageBlock = { type: 'image', attachment: { id: 'image-1' } }
  const decision = CreateDecision('请 /review 这段', [imageBlock])

  const result = await listener(undefined, async () => decision)

  assert.equal(result.messages[0].content[0].text, '请 \nREVIEW_BODY\n 这段')
  assert.deepEqual(result.messages[0].content[1], imageBlock)
  assert.equal(result.startsRequestSeries, true)
})

test('leaves a reject decision untouched', async () => {
  const listener = CreatePreStepListener({ filePath: WriteStore('reject.json', []) })
  const decision = { kind: 'reject' }
  assert.equal(await listener(undefined, async () => decision), decision)
})

test('returns the original decision when nothing matches', async () => {
  const listener = CreatePreStepListener({
    filePath: WriteStore('nomatch.json', [{ name: 'review', description: '', prompt: 'BODY' }]),
  })
  const decision = CreateDecision('普通消息')
  assert.equal(await listener(undefined, async () => decision), decision)
})

test('returns the original decision when the store has no commands', async () => {
  const listener = CreatePreStepListener({ filePath: WriteStore('empty.json', []) })
  const decision = CreateDecision('/review')
  assert.equal(await listener(undefined, async () => decision), decision)
})

test('expands every message and every text block', async () => {
  const filePath = WriteStore('multi.json', [
    { name: 'review', description: '', prompt: 'R' },
    { name: 'fix', description: '', prompt: 'F' },
  ])
  const listener = CreatePreStepListener({ filePath })
  const decision = {
    kind: 'enter',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: '/review' },
          { type: 'text', text: '/fix' },
        ],
      },
      { role: 'user', content: [{ type: 'text', text: 'no command' }] },
    ],
  }

  const result = await listener(undefined, async () => decision)
  assert.equal(result.messages[0].content[0].text, '\nR\n')
  assert.equal(result.messages[0].content[1].text, '\nF\n')
  assert.equal(result.messages[1].content[0].text, 'no command')
})

test('a failing reserved-name resolver leaves the decision untouched and warns', async () => {
  const warnings = []
  const listener = CreatePreStepListener({
    filePath: WriteStore('warn.json', []),
    resolveReservedNames: () => {
      throw new Error('boom')
    },
    warn: (message) => warnings.push(message),
  })
  const decision = CreateDecision('/review')

  const result = await listener(undefined, async () => decision)
  assert.equal(result, decision)
  assert.equal(warnings.length, 1)
})
