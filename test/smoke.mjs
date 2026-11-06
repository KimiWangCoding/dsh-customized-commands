import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** Repository root, one directory above this test file. */
const C_Root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Read and parse one JSON resource from the package.
 * @param {string} relativePath - path relative to the package root.
 * @returns {unknown} parsed JSON value.
 */
function ReadJson(relativePath) {
  return JSON.parse(readFileSync(resolve(C_Root, relativePath), 'utf8'))
}

test('manifest and display resources are present and valid', () => {
  const packageJson = ReadJson('package.json')
  assert.equal(packageJson.name, '@kimiwangcoding/dsh-customized-commands')
  assert.equal(packageJson.type, 'module')
  assert.equal(packageJson.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(packageJson.dsh.client.platform, 'web')
  assert.ok(Array.isArray(packageJson.files) && packageJson.files.length > 0)

  for (const relativePath of [
    'index.js',
    'client.js',
    'cordis.patch.yml',
    'locale/zh.json',
    'locale/en.json',
    'icon.svg',
  ]) {
    assert.ok(readFileSync(resolve(C_Root, relativePath)).length > 0, relativePath)
  }

  assert.equal(ReadJson('locale/zh.json').meta.title, '自定义命令')
  assert.equal(ReadJson('locale/en.json').meta.title, 'Custom commands')

  const patch = readFileSync(resolve(C_Root, 'cordis.patch.yml'), 'utf8')
  assert.match(patch, /dsh-customized-commands/u)
  assert.match(patch, /insert:/u)
})

test('host half exports apply() and registers the pre-step listener', async () => {
  const hostModule = await import(pathToFileURL(resolve(C_Root, 'index.js')).href)
  assert.equal(typeof hostModule.apply, 'function')

  const events = []
  const fakeCtx = {
    on(eventName, _listener) {
      events.push(eventName)
      return () => {}
    },
    get() {
      return undefined
    },
    inject(_deps, _callback) {
      return () => {}
    },
    logger: { warn() {} },
  }
  assert.doesNotThrow(() => hostModule.apply(fakeCtx))
  assert.deepEqual(events, ['agent/pre-step'])
})

/**
 * Import one fresh client-module instance under a stubbed browser environment.
 * @param {string} tag - unique import cache key.
 * @param {(url: string, init: object) => Promise<Response>} fetchImpl - fetch stub.
 * @returns {Promise<object>} captured module-loader spec.
 */
async function LoadClientModule(tag, fetchImpl) {
  /** Module spec captured from the simulated module loader. */
  let spec
  globalThis.window = {
    __ModuleLoader__: {
      load(value) {
        spec = value
      },
    },
  }
  globalThis.document = { baseURI: 'http://localhost/' }
  globalThis.fetch = fetchImpl
  await import(`${pathToFileURL(resolve(C_Root, 'client.js')).href}?${tag}`)
  return spec
}

/**
 * Mount the client plugin against a minimal slots/input-triggers context.
 * @param {object} spec - module-loader spec.
 * @returns {{ sections: object[], sources: object[] }} captured registrations.
 */
function MountClient(spec) {
  const sections = []
  const sources = []
  const React = { createElement: (...args) => ({ args }) }
  const plugin = spec.factory((name) => {
    if (name === 'react') return React
    throw new Error(`unexpected require: ${name}`)
  })

  const ctx = {
    slots: {
      inject(_name, callback) {
        callback()
      },
      register(registration, component) {
        sections.push({ registration, component })
        return () => {}
      },
    },
    get(name) {
      if (name !== 'inputTriggers') return undefined
      return {
        registerSource(source) {
          sources.push(source)
          return () => {}
        },
      }
    },
    effect(callback) {
      const dispose = callback()
      return () => {
        if (typeof dispose === 'function') dispose()
      }
    },
    logger: { warn() {} },
  }

  assert.doesNotThrow(() => plugin.apply(ctx))
  return { sections, sources }
}

test('client half serves menu rows and highlight names from the command API', async () => {
  const calls = []
  const spec = await LoadClientModule('store-ok', async (url, init) => {
    calls.push({ url: String(url), init })
    return new Response(
      JSON.stringify({
        ok: true,
        commands: [
          { name: 'review', description: '严格审查', prompt: 'REVIEW' },
          { name: 'fix', description: '修复问题', prompt: 'FIX' },
        ],
        ignored: [{ index: 2, name: 'plan', code: 'reserved-name', message: '冲突' }],
        error: null,
        filePath: 'C:/Users/x/.dsh/dsh-customized-commands/commands.json',
        exists: true,
        version: 1,
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  })

  const { sections, sources } = MountClient(spec)
  assert.equal(sections.length, 1)
  assert.equal(sections[0].registration.name, 'settings.section')
  assert.equal(sections[0].registration.id, 'dsh-customized-commands')
  assert.equal(sources.length, 1)

  const source = sources[0]
  assert.equal(source.trigger, '/')
  assert.equal(source.name, 'dsh-customized-commands')

  const pending = source.candidates(undefined, { query: '' })
  assert.equal(typeof pending.then, 'function', 'candidates must return a Promise')
  const all = await pending
  assert.deepEqual(
    all.map((row) => row.name),
    ['review', 'fix'],
  )
  assert.equal(all[0].section, '自定义命令')
  assert.equal(all[0].description, '严格审查')

  const filtered = await source.candidates(undefined, { query: '修' })
  assert.deepEqual(
    filtered.map((row) => row.name),
    ['fix'],
  )

  assert.deepEqual(source.lexicon(), ['review', 'fix'])
  assert.equal(source.onPick({ candidate: { name: 'review' } }).text, '/review ')

  assert.equal(calls.length, 1)
  assert.ok(calls[0].url.endsWith('/api/dsh-customized-commands'))
  assert.equal(JSON.parse(calls[0].init.body).action, 'list')
  assert.equal(calls[0].init.credentials, 'same-origin')
})

test('client half stays usable when the command API is unreachable', async () => {
  const spec = await LoadClientModule('store-fail', async () => {
    throw new Error('offline')
  })

  const { sections, sources } = MountClient(spec)
  assert.equal(sections.length, 1)
  assert.equal(sources.length, 1)

  const rows = await sources[0].candidates(undefined, { query: '' })
  assert.deepEqual(rows, [])
  assert.deepEqual(sources[0].lexicon(), [])
})
