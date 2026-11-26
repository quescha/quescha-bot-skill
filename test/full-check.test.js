'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { fullCheck } = require('../skills/quescha-bot/src/full-check')
const { runMutations } = require('../skills/quescha-bot/src/workspace')

const starter = path.join(__dirname, '../skills/quescha-bot/assets/starter')
const bin = path.join(__dirname, '../skills/quescha-bot/bin/quescha-bot.js')

function workspace () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quescha-full-check-'))
  fs.cpSync(starter, dir, { recursive: true })
  return dir
}

function addUnknownFunction (dir) {
  const file = path.join(dir, 'bot.json')
  const bot = JSON.parse(fs.readFileSync(file, 'utf8'))
  const blocks = JSON.parse(bot.messages[0].message)
  blocks[0].text += '\n[DefinitelyUnknown(1)]'
  bot.messages[0].message = JSON.stringify(blocks)
  fs.writeFileSync(file, JSON.stringify(bot, null, 2))
}

test('full dry-run accepts the standalone starter', async () => {
  const bot = JSON.parse(fs.readFileSync(path.join(starter, 'bot.json'), 'utf8'))
  const result = await fullCheck(bot)
  assert.equal(result.ok, true, JSON.stringify(result.issues))
  assert.equal(result.errors, 0)
  assert.equal(result.warnings, 0)
  assert.equal(result.dryrun.errors, 0)
})

test('full dry-run catches an error missed by the schema validator', async () => {
  const dir = workspace()
  try {
    addUnknownFunction(dir)
    const bot = JSON.parse(fs.readFileSync(path.join(dir, 'bot.json'), 'utf8'))
    const result = await fullCheck(bot)
    assert.equal(result.ok, false)
    assert.ok(result.issues.some(issue => issue.code === 'E_DRYRUN' && issue.message.includes('DefinitelyUnknown')))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('build refuses an archive when only full dry-run finds the error', () => {
  const dir = workspace()
  try {
    addUnknownFunction(dir)
    const result = spawnSync(process.execPath, [bin, 'build', dir, '--json'], { encoding: 'utf8' })
    assert.equal(result.status, 1, result.stdout + result.stderr)
    const body = JSON.parse(result.stdout)
    assert.equal(body.stage, 'check')
    assert.ok(body.issues.some(issue => issue.code === 'E_DRYRUN'))
    assert.equal(fs.existsSync(path.join(dir, 'dist', 'coffee-guide.zip')), false)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('mutation testing includes full dry-run diagnostics', async () => {
  const dir = workspace()
  try {
    fs.writeFileSync(path.join(dir, 'mutations.js'), `'use strict'\nmodule.exports = [{ name: 'Неизвестная функция', expect: 'E_DRYRUN', mutate (bot) { const blocks = JSON.parse(bot.messages[0].message); blocks[0].text += '[DefinitelyUnknown(1)]'; bot.messages[0].message = JSON.stringify(blocks) } }]\n`)
    const bot = JSON.parse(fs.readFileSync(path.join(dir, 'bot.json'), 'utf8'))
    const result = await runMutations(dir, bot)
    assert.equal(result.ok, true, JSON.stringify(result.results))
    assert.ok(result.results[0].caughtBy.includes('E_DRYRUN'))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})


test('incomplete Telegram button settings are rejected before runtime', async () => {
  const bot = JSON.parse(fs.readFileSync(path.join(starter, 'bot.json'), 'utf8'))
  const blocks = JSON.parse(bot.messages[0].message)
  blocks[0].btnsettings = { tg: { inline: true } }
  bot.messages[0].message = JSON.stringify(blocks)
  const result = await fullCheck(bot)
  assert.equal(result.ok, false)
  assert.ok(result.issues.some(issue => issue.code === 'E_BUTTON_SETTINGS'))
})
