'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const AdmZip = require('adm-zip')

const bin = path.join(__dirname, '../skills/quescha-bot/bin/quescha-bot.js')
function run (args, cwd) {
  const result = spawnSync(process.execPath, [bin, ...args, '--json'], { cwd, encoding: 'utf8' })
  let body
  try { body = JSON.parse(result.stdout) } catch (e) { body = { stdout: result.stdout, stderr: result.stderr } }
  return { ...result, body }
}

test('E2E init → edit → build → inspect → unpack', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quescha-e2e-'))
  try {
    let result = run(['init', 'bot', '--name', 'Тестовый бот', '--slug', 'test-bot'], dir)
    assert.equal(result.status, 0, result.stderr)
    const workspace = path.join(dir, 'bot')
    const source = path.join(workspace, 'bot.json')
    const bot = JSON.parse(fs.readFileSync(source, 'utf8'))
    bot.groups[0].name = 'Изменённый бот'
    fs.writeFileSync(source, JSON.stringify(bot, null, 2))
    fs.writeFileSync(path.join(workspace, 'upload', 'readme.txt'), 'public attachment')

    result = run(['build', 'bot'], dir)
    assert.equal(result.status, 0, result.stderr)
    const archive = path.join(workspace, 'dist', 'test-bot.zip')
    assert.ok(fs.existsSync(archive))
    const zip = new AdmZip(archive)
    assert.equal(JSON.parse(zip.readAsText('data.txt')).groups[0].name, 'Изменённый бот')
    assert.equal(zip.readAsText('upload/readme.txt'), 'public attachment')

    result = run(['inspect', archive], dir)
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.body.ok, true)
    assert.equal(result.body.errors, 0)

    result = run(['unpack', archive, 'copy'], dir)
    assert.equal(result.status, 0, result.stderr)
    assert.equal(fs.readFileSync(path.join(dir, 'copy', 'upload', 'readme.txt'), 'utf8'), 'public attachment')
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'copy', 'bot.json'), 'utf8')).groups[0].name, 'Изменённый бот')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('CLI refuses to build a broken bot', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quescha-fail-'))
  try {
    assert.equal(run(['init', 'bot'], dir).status, 0)
    const source = path.join(dir, 'bot', 'bot.json')
    const bot = JSON.parse(fs.readFileSync(source, 'utf8'))
    bot.chains[0].subscription = false
    bot.chains[0].keywords = 'null'
    fs.writeFileSync(source, JSON.stringify(bot))
    const result = run(['build', 'bot'], dir)
    assert.equal(result.status, 1)
    assert.equal(result.body.ok, false)
    assert.equal(result.body.stage, 'check')
    assert.equal(fs.existsSync(path.join(dir, 'bot', 'dist', 'coffee-guide.zip')), false)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
