'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { compileScenarios, namesFrom, linkScenarioRefs } = require('../skills/quescha-bot/compiler')
const { builders } = require('../skills/quescha-bot/compiler/builders')

const names = { lists: { Заявки: 10001 }, globals: { Телефон: 20001 } }
const sample = `
await scenario('Заявка', async (qb, ctx) => {
  await qb.step('чтение', { name: 'Читать', config: qb.cfg.listRead(ctx.lists['Заявки'], { 'Имя': 'имя' }, { pole: 'ClientID', cmp: '=', value: '[ClientID]', filtervar: 'есть' }), next: 'ответ' })
  await qb.step('ответ', { name: 'Ответ', config: qb.cfg.ops(), branches: [{ cond: '#{есть} = 0', next: 'пусто' }], done: { exit: true, exitmes: '#{имя}' } })
  await qb.step('пусто', { name: 'Пусто', config: qb.cfg.ops(), done: { exit: true, exitmes: 'Нет записей' } })
})`

test('complete max instructions match their publication manifest', () => {
  const manifest = require('../skills/quescha-bot/references/instruction-manifest.json')
  for (const [name, expected] of Object.entries(manifest.files)) {
    const data = fs.readFileSync(path.join(__dirname, '../skills/quescha-bot/references', name))
    assert.equal(crypto.createHash('sha256').update(data).digest('hex'), expected.sha256)
    assert.equal(data.length, expected.bytes)
    assert.ok(data.length > 100000)
  }
})

test('all documented builders exist', () => {
  const expected = ['ai', 'checkAnswer', 'checkVar', 'checktags', 'crm', 'doc', 'gcalendar', 'gdrive', 'gsheets', 'http', 'js', 'link', 'listAdd', 'listCopy', 'listDelete', 'listEdit', 'listFind', 'listRead', 'listString', 'listSync', 'listToGlobal', 'maxchannel', 'media', 'ops', 'payment', 'referal', 'set', 'setGlobal', 'setVar', 'setVars', 'splitVar', 'tgchannel', 'waitData', 'webapp', 'yadisk']
  assert.deepEqual(Object.keys(builders).sort(), expected.sort())
})

test('scenario with lists and branches compiles to three linked actions', async () => {
  const result = await compileScenarios(sample, names)
  assert.deepEqual(result.problems, [])
  assert.equal(result.list[0].actions.length, 3)
  const [read, answer, empty] = result.list[0].actions
  assert.equal(read.action.value, 'data')
  assert.equal(answer.conditions[0].nextaction, null)
  assert.equal(answer.conditions[1].nextaction.value, empty.id)
  assert.equal(answer.conditions[1].cond, '#{есть} = 0')
})

test('unknown builder returns an error instead of a broken bot', async () => {
  const result = await compileScenarios("await scenario('Bad', async qb => { await qb.step('x', { config: qb.cfg.magic() }) })", names)
  assert.ok(result.problems.length > 0)
  assert.equal(result.list[0].actions.length, 0)
})

test('configuration cannot be mistaken for subscriber data', async () => {
  const result = await compileScenarios("await scenario('Bad', async (qb, ctx) => { const rows = qb.cfg.listRead(ctx.lists['Заявки'], {}); await qb.step('x', { config: qb.cfg.ops(), next: rows.length ? 'x' : 'done' }) })", names)
  assert.ok(result.problems.join(' ').includes('настройку'))
})

test('sandbox rejects process and require', async () => {
  const result = await compileScenarios("await scenario('Bad', async qb => { process.exit(); require('fs') })", names)
  assert.ok(result.problems.join(' ').includes('Запрещённые'))
})

test('compiler worker can be terminated on an infinite loop', async () => {
  await assert.rejects(compileScenarios("await scenario('Loop', async qb => { while (true) {} })", names, { timeout: 50 }), /30 секунд/)
})

test('scenario references are linked by exact name', () => {
  const bot = {
    external: [{ id: 50001, name: 'Заявка' }],
    messages: [{ message: JSON.stringify([{ id: 'start000', externalbefore: { label: 'Заявка', value: 0 }, conditionlist: [] }]) }]
  }
  const linked = linkScenarioRefs(bot)
  assert.equal(linked.fixed, 1)
  assert.equal(JSON.parse(bot.messages[0].message)[0].externalbefore.value, 50001)
  assert.deepEqual(namesFrom({ global: [{ id: 1, name: 'Цена' }] }).globals, { Цена: 1 })
})


test('compiler rejects unknown labels and unsupported done fields', async () => {
  const unknown = await compileScenarios("await scenario('Bad', async qb => { await qb.step('x', { config: qb.cfg.ops(), next: 'missing' }) })", names)
  assert.ok(unknown.problems.join(' ').includes('несуществующий шаг'))
  assert.equal(unknown.list[0].actions.length, 0)
  const done = await compileScenarios("await scenario('Bad', async qb => { await qb.step('x', { config: qb.cfg.ops(), done: { imaginary: true } }) })", names)
  assert.ok(done.problems.join(' ').includes('Неизвестное поле'))
})

test('builder aliases and finish labels compile to the canonical format', async () => {
  const result = await compileScenarios(`await scenario('Алиасы', async qb => {
    await qb.step('first', { config: qb.cfg.setvariable('answer', 'ok'), next: 'last' })
    await qb.step('last', { config: qb.cfg.noop(), next: 'done', done: { exit: true } })
  })`, names)
  assert.deepEqual(result.problems, [])
  const [first, last] = result.list[0].actions
  assert.equal(first.operations[0].varsave[0].varname, 'answer')
  assert.equal(first.conditions[0].nextaction.value, last.id)
  assert.equal(last.conditions[0].nextaction, null)
})

test('actionseveryone and array-form messages retain their storage shape', () => {
  const bot = {
    external: [{ id: 50001, name: 'Общий сценарий' }],
    messages: [
      { actionseveryone: '{"label":"Общий сценарий","value":0}', message: JSON.stringify([{ conditionlist: [] }]) },
      { actionseveryone: { label: 'Общий сценарий', value: 0 }, message: [{ externalbefore: 'Общий сценарий', conditionlist: [] }] }
    ]
  }
  const result = linkScenarioRefs(bot)
  assert.equal(result.fixed, 3)
  assert.equal(JSON.parse(bot.messages[0].actionseveryone).value, 50001)
  assert.equal(bot.messages[1].actionseveryone.value, 50001)
  assert.ok(Array.isArray(bot.messages[1].message))
  assert.equal(bot.messages[1].message[0].externalbefore.value, 50001)
})
