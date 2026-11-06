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
const C_TestDir = mkdtempSync(join(C_TempBase, 'send-path-'))
after(() => {
  rmSync(C_TestDir, { recursive: true, force: true })
})

const C_FilePath = join(C_TestDir, 'commands.json')
writeFileSync(
  C_FilePath,
  JSON.stringify(
    {
      version: 1,
      commands: [
        { name: 'review', description: '审查', prompt: 'REVIEW_BODY' },
        { name: 'fix', description: '修复', prompt: 'FIX_BODY' },
      ],
    },
    null,
    2,
  ),
  'utf8',
)

/**
 * Run one draft text through the real pre-step listener.
 * @param {string} text - user draft.
 * @returns {Promise<string>} text that enters the model request.
 */
async function Send(text) {
  const listener = CreatePreStepListener({ filePath: C_FilePath })
  const decision = {
    kind: 'enter',
    messages: [{ role: 'user', content: [{ type: 'text', text }] }],
  }
  const result = await listener(undefined, async () => decision)
  return result.messages[0].content[0].text
}

test('send path: inline command expands in place', async () => {
  assert.equal(await Send('请 /review 这段代码'), '请 \nREVIEW_BODY\n 这段代码')
})

test('send path: standalone and multiple commands', async () => {
  assert.equal(await Send('/review'), '\nREVIEW_BODY\n')
  assert.equal(await Send('/fix 然后 /review'), '\nFIX_BODY\n 然后 \nREVIEW_BODY\n')
})

test('send path: unknown and punctuation-bounded tokens stay literal', async () => {
  assert.equal(await Send('请 /unknown 与 /review。'), '请 /unknown 与 /review。')
})

test('send path: code blocks and inline code stay literal', async () => {
  assert.equal(
    await Send('请 /review\n```\n/review\n```'),
    '请 \nREVIEW_BODY\n\n```\n/review\n```',
  )
  assert.equal(await Send('请 `x /review` 或 /fix'), '请 `x /review` 或 \nFIX_BODY\n')
})
