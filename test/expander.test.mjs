import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  ExpandCommandTokens,
  IndexCommands,
  ScanCommandTokens,
} from '../lib/expander.js'

const C_Index = IndexCommands([
  { name: 'review', description: '审查', prompt: 'REVIEW_BODY' },
  { name: 'fix', description: '修复', prompt: 'FIX_BODY' },
])

test('expands a command at the start of the text', () => {
  const result = ExpandCommandTokens('/review', C_Index)
  assert.equal(result.text, '\nREVIEW_BODY\n')
  assert.equal(result.changed, true)
  assert.deepEqual(result.applied, ['review'])
})

test('expands a command after a leading space and keeps the space', () => {
  const result = ExpandCommandTokens('请 /review', C_Index)
  assert.equal(result.text, '请 \nREVIEW_BODY\n')
})

test('expands a command after a newline into its own paragraph', () => {
  const result = ExpandCommandTokens('先做\n/review\n后做', C_Index)
  assert.equal(result.text, '先做\n\nREVIEW_BODY\n\n后做')
})

test('expands every known command in text order', () => {
  const result = ExpandCommandTokens('/fix and /review', C_Index)
  assert.equal(result.text, '\nFIX_BODY\n and \nREVIEW_BODY\n')
  assert.deepEqual(result.applied, ['fix', 'review'])
})

test('leaves unknown commands and ordinary text untouched', () => {
  const result = ExpandCommandTokens('/unknown /review', C_Index)
  assert.equal(result.text, '/unknown \nREVIEW_BODY\n')
  assert.deepEqual(result.applied, ['review'])
})

test('does not expand glued or suffixed tokens', () => {
  for (const text of ['abc/review', '/reviewX', '/review/x', '/review。', '/review,', '/review、']) {
    const result = ExpandCommandTokens(text, C_Index)
    assert.equal(result.text, text, `unexpected expansion for ${text}`)
    assert.equal(result.changed, false)
  }
})

test('does not expand when no command matches', () => {
  const result = ExpandCommandTokens('普通消息', C_Index)
  assert.equal(result.text, '普通消息')
  assert.equal(result.changed, false)
  assert.deepEqual(result.applied, [])
})

test('does not rescan an inserted prompt body', () => {
  const index = IndexCommands([{ name: 'review', prompt: 'REVIEW /fix' }])
  const result = ExpandCommandTokens('/review', index)
  assert.equal(result.text, '\nREVIEW /fix\n')
})

test('ScanCommandTokens reports the slash offsets', () => {
  const tokens = ScanCommandTokens('a /review b', C_Index)
  assert.equal(tokens.length, 1)
  assert.equal(tokens[0].name, 'review')
  assert.equal(tokens[0].start, 2)
  assert.equal(tokens[0].end, 9)
})

test('IndexCommands ignores malformed entries', () => {
  const index = IndexCommands([{ name: 'ok', prompt: 'p' }, { name: 'no-prompt' }, null])
  assert.deepEqual([...index.keys()], ['ok'])
})

test('handles empty and non-string text', () => {
  assert.deepEqual(ScanCommandTokens('', C_Index), [])
  assert.deepEqual(ScanCommandTokens(undefined, C_Index), [])
  assert.deepEqual(ExpandCommandTokens('', C_Index), { text: '', changed: false, applied: [] })
})

test('expands commands after CRLF separators', () => {
  const result = ExpandCommandTokens('a\r\n/review', C_Index)
  assert.equal(result.text, 'a\r\n\nREVIEW_BODY\n')
})

test('does not expand inside a fenced code block', () => {
  const text = '示例：\n```text\n/review\n```\n结束'
  const result = ExpandCommandTokens(text, C_Index)
  assert.equal(result.text, text)
  assert.equal(result.changed, false)
})

test('expands outside fences but not inside them', () => {
  const text = '请 /review\n```\n/fix\n```\n再 /fix'
  const result = ExpandCommandTokens(text, C_Index)
  assert.equal(result.text, '请 \nREVIEW_BODY\n\n```\n/fix\n```\n再 \nFIX_BODY\n')
  assert.deepEqual(result.applied, ['review', 'fix'])
})

test('does not expand inside a same-line backtick span', () => {
  const text = '请 `x /review` 或 /review'
  const result = ExpandCommandTokens(text, C_Index)
  assert.equal(result.text, '请 `x /review` 或 \nREVIEW_BODY\n')
  assert.deepEqual(result.applied, ['review'])
})

test('does not expand inside a double-backtick span', () => {
  const text = '`` x /review `` 与 /review'
  const result = ExpandCommandTokens(text, C_Index)
  assert.equal(result.text, '`` x /review `` 与 \nREVIEW_BODY\n')
})

test('supports tilde fences and unclosed fences', () => {
  assert.equal(ExpandCommandTokens('~~~\n/review\n~~~', C_Index).changed, false)
  assert.equal(ExpandCommandTokens('```\n/review', C_Index).changed, false)
})

test('a shorter fence does not close a longer one', () => {
  const text = '````\n/review\n```\n/review\n````'
  assert.equal(ExpandCommandTokens(text, C_Index).changed, false)
})

test('recognizes indented and language-tagged fences', () => {
  const text = '  ```js\n/review\n  ```\n/review'
  const result = ExpandCommandTokens(text, C_Index)
  assert.equal(result.text, '  ```js\n/review\n  ```\n\nREVIEW_BODY\n')
})
