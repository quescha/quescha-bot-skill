'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { validateExport } = require('../skills/quescha-bot/src/validate')

const starter = () => JSON.parse(fs.readFileSync(path.join(__dirname, '../skills/quescha-bot/assets/starter/bot.json'), 'utf8'))
const codes = result => result.issues.filter(x => x.severity === 'error').map(x => x.code)

test('starter is valid with no warnings', () => {
  const result = validateExport(starter())
  assert.equal(result.ok, true)
  assert.equal(result.errors, 0)
  assert.equal(result.warnings, 0)
})

test('all 18 fields are required', () => {
  const bot = starter()
  delete bot.global
  const result = validateExport(bot)
  assert.ok(codes(result).includes('E_FIELD_MISSING'))
})

test('nested JSON must remain a string', () => {
  const bot = starter()
  bot.messages[0].message = JSON.parse(bot.messages[0].message)
  assert.ok(codes(validateExport(bot)).includes('E_NESTED_JSON_TYPE'))
})

test('broken block reference is rejected', () => {
  const bot = starter()
  const blocks = JSON.parse(bot.messages[0].message)
  blocks[0].btn[0].nextMessage.value = 'absent00'
  bot.messages[0].message = JSON.stringify(blocks)
  assert.ok(codes(validateExport(bot)).includes('E_BLOCK_TARGET'))
})

test('payment callback block cannot have incoming transition', () => {
  const bot = starter()
  const blocks = JSON.parse(bot.messages[0].message)
  blocks[1].acceptpayment = true
  bot.messages[0].message = JSON.stringify(blocks)
  assert.ok(codes(validateExport(bot)).includes('E_PAYMENT_INCOMING'))
})

test('list row length must match headers', () => {
  const bot = starter()
  bot.lists.push({ id: 200001, name: 'Услуги', headers: '["Название","Цена"]', ordernumber: 0, count: null, BotGroupId: 100001 })
  bot.listdata.push({ id: 200002, data: '["Стрижка"]', ListId: 200001 })
  assert.ok(codes(validateExport(bot)).includes('E_LIST_ROW_LENGTH'))
})

test('likely Telegram token is rejected', () => {
  const bot = starter()
  bot.global[0].value = '123456789:' + 'A'.repeat(35)
  assert.ok(codes(validateExport(bot)).includes('E_SECRET_TELEGRAM'))
})

test('overlapping blocks are rejected', () => {
  const bot = starter()
  const blocks = JSON.parse(bot.messages[0].message)
  blocks[1].x = blocks[0].x
  blocks[1].y = blocks[0].y
  bot.messages[0].message = JSON.stringify(blocks)
  assert.ok(codes(validateExport(bot)).includes('E_BLOCK_OVERLAP'))
})
