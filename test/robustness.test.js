'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { validateExport } = require('../skills/quescha-bot/src/validate')
const { createZip, readZip } = require('../skills/quescha-bot/src/zip')

const starter = () => JSON.parse(fs.readFileSync(path.join(__dirname, '../skills/quescha-bot/assets/starter/bot.json'), 'utf8'))

test('null record produces a validation issue instead of an exception', () => {
  const bot = starter()
  bot.groups[0] = null
  const result = validateExport(bot)
  assert.equal(result.ok, false)
  assert.ok(result.issues.some(x => x.code === 'E_RECORD_TYPE'))
})

test('duplicate ZIP entry names are ambiguous and rejected', () => {
  const buffer = createZip([
    { name: 'data.txt', data: Buffer.from('{"first":true}') },
    { name: 'data.txt', data: Buffer.from('{"second":true}') }
  ])
  assert.throws(() => readZip(buffer), /Дубликат/)
})
