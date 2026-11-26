'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { runTests, runMutations } = require('../skills/quescha-bot/src/workspace')
const path = require('node:path')
const fs = require('node:fs')

const root = path.join(__dirname, '../skills/quescha-bot/assets/starter')
const bot = () => JSON.parse(fs.readFileSync(path.join(root, 'bot.json'), 'utf8'))

test('starter semantic tests pass', async () => {
  const result = await runTests(root, bot())
  assert.equal(result.ok, true)
  assert.equal(result.total, 3)
})

test('starter mutation suite catches every mutation', async () => {
  const result = await runMutations(root, bot())
  assert.equal(result.ok, true)
  assert.equal(result.caught, 4)
  assert.equal(result.missed, 0)
})

test('mutation harness fails when a mutation is missed', async () => {
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'quescha-mutation-'))
  try {
    for (const file of ['bot.config.json', 'bot.json', 'tests.js']) fs.copyFileSync(path.join(root, file), path.join(dir, file))
    fs.writeFileSync(path.join(dir, 'mutations.js'), 'module.exports=[{name:"no-op",mutate(bot){}}]')
    const result = await runMutations(dir, bot())
    assert.equal(result.ok, false)
    assert.equal(result.missed, 1)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
