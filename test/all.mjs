// Single entry point for the local test run (`node test/all.mjs`).
// Each imported file registers its own node:test cases.
import './smoke.mjs'
import './store.test.mjs'
import './expander.test.mjs'
import './scenario.test.mjs'
