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

test('host half exports a side-effect free apply()', async () => {
  const hostModule = await import(pathToFileURL(resolve(C_Root, 'index.js')).href)
  assert.equal(typeof hostModule.apply, 'function')
  assert.doesNotThrow(() => hostModule.apply())
})

test('client half registers the settings section and one guarded slash source', async () => {
  /** Module spec captured from the simulated module loader. */
  let moduleSpec
  globalThis.window = {
    __ModuleLoader__: {
      load(spec) {
        moduleSpec = spec
      },
    },
  }

  await import(`${pathToFileURL(resolve(C_Root, 'client.js')).href}?smoke=1`)
  assert.equal(moduleSpec.id, '@kimiwangcoding/dsh-customized-commands')

  /** Minimal React surface: the placeholder is never rendered in this smoke test. */
  const React = { createElement: (..._args) => ({}) }
  const plugin = moduleSpec.factory((name) => {
    if (name === 'react') return React
    throw new Error(`unexpected require: ${name}`)
  })
  assert.equal(typeof plugin.apply, 'function')
  assert.ok(plugin.inject.includes('slots'))
  assert.ok(
    plugin.inject.includes('inputTriggers'),
    'inputTriggers must be declared; the dynamic client sandbox gates service access by inject',
  )

  const registeredSections = []
  const registeredSources = []
  const ctx = {
    slots: {
      inject(_name, callback) {
        callback()
      },
      register(registration, component) {
        registeredSections.push({ registration, component })
        return () => {}
      },
    },
    get(name) {
      if (name !== 'inputTriggers') return undefined
      return {
        registerSource(source) {
          registeredSources.push(source)
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
  }

  plugin.apply(ctx)

  assert.equal(registeredSections.length, 1)
  assert.equal(registeredSections[0].registration.name, 'settings.section')
  assert.equal(registeredSections[0].registration.id, 'dsh-customized-commands')
  assert.equal(typeof registeredSections[0].component, 'function')

  assert.equal(registeredSources.length, 1)
  const source = registeredSources[0]
  assert.equal(source.trigger, '/')
  assert.equal(source.name, 'dsh-customized-commands')
  assert.deepEqual(source.lexicon(), ['dcc-hello'])
  // Regression guard: ui-input-trigger calls `.then()` on the returned value.
  const pendingCandidates = source.candidates()
  assert.equal(
    typeof pendingCandidates.then,
    'function',
    'candidates must return a Promise',
  )
  const candidates = await pendingCandidates
  assert.equal(candidates.length, 1)
  assert.equal(candidates[0].section, '自定义命令')
  assert.equal(typeof candidates[0].description, 'string')
  const picked = source.onPick({})
  assert.equal(
    picked.text,
    '/dcc-hello ',
    'a menu pick must insert the command token, not the prompt text',
  )
})
