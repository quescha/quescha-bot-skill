'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

test('copied skill bundle works without repository or npm dependencies', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quescha-bundle-'))
  try {
    const bundle = path.join(dir, 'quescha-bot')
    fs.cpSync(path.join(__dirname, '../skills/quescha-bot'), bundle, { recursive: true })
    const bin = path.join(bundle, 'bin', 'quescha-bot.js')
    const run = args => spawnSync(process.execPath, [bin, ...args, '--json'], { cwd: dir, encoding: 'utf8' })
    let result = run(['init', 'workspace', '--slug', 'standalone'])
    assert.equal(result.status, 0, result.stderr)
    result = run(['build', 'workspace'])
    assert.equal(result.status, 0, result.stderr)
    const archive = path.join(dir, 'workspace', 'dist', 'standalone.zip')
    assert.ok(fs.existsSync(archive))
    result = run(['inspect', archive])
    assert.equal(result.status, 0, result.stderr)
    const report = JSON.parse(result.stdout)
    assert.equal(report.ok, true)
    assert.equal(report.errors, 0)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
