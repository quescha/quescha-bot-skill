'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const AdmZip = require('adm-zip')
const { loadBot, checkBot, runTests, runMutations } = require('../skills/quescha-bot/src/workspace')

const example = path.join(__dirname, '../skills/quescha-bot/assets/examples/booking')
const bin = path.join(__dirname, '../skills/quescha-bot/bin/quescha-bot.js')

test('complex booking example passes full checks, semantic tests and mutations', async () => {
  const { root, bot } = await loadBot(example)
  const validation = await checkBot(root, bot)
  assert.equal(validation.ok, true, JSON.stringify(validation.issues))
  assert.equal(validation.errors, 0)
  assert.equal(validation.warnings, 0)
  assert.equal(bot.external.length, 2)
  assert.equal(bot.external.reduce((sum, item) => sum + JSON.parse(item.actions).length, 0), 6)
  const tests = await runTests(root, bot)
  assert.equal(tests.ok, true, JSON.stringify(tests.results))
  assert.equal(tests.total, 6)
  const mutations = await runMutations(root, bot)
  assert.equal(mutations.ok, true, JSON.stringify(mutations.results))
  assert.equal(mutations.caught, 6)
})

test('complex booking example builds into an independently readable ZIP', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'quescha-booking-'))
  try {
    const workspace = path.join(temporary, 'booking')
    fs.cpSync(example, workspace, { recursive: true })
    const result = spawnSync(process.execPath, [bin, 'build', workspace, '--json'], { encoding: 'utf8' })
    assert.equal(result.status, 0, result.stdout + result.stderr)
    const body = JSON.parse(result.stdout)
    assert.equal(body.ok, true)
    const zip = new AdmZip(body.archive.output)
    const bot = JSON.parse(zip.readAsText('data.txt'))
    assert.equal(bot.lists.length, 2)
    assert.ok(bot.external.every(item => JSON.parse(item.actions).length > 0))
    const inspected = spawnSync(process.execPath, [bin, 'inspect', body.archive.output, '--json'], { encoding: 'utf8' })
    assert.equal(inspected.status, 0, inspected.stdout + inspected.stderr)
    assert.equal(JSON.parse(inspected.stdout).errors, 0)
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true })
  }
})
