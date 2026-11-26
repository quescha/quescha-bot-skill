'use strict'

const blocks = bot => JSON.parse(bot.messages[0].message)
const actions = (bot, name) => JSON.parse(bot.external.find(item => item.name === name).actions)
const operation = (items, type) => items.flatMap(action => action.operations || []).find(op => op.oplistaction && op.oplistaction.value === type)

module.exports = [
  {
    name: 'Анкета собирает услугу, имя, телефон и дату и ведёт к сохранению',
    run (bot, assert) {
      const items = blocks(bot)
      const expected = { service0: 'услуга', name0000: 'имя', phone000: 'телефон', date0000: 'дата' }
      for (const [id, variable] of Object.entries(expected)) assert.equal(items.find(item => item.id === id).answervar, variable)
      assert.equal(items.find(item => item.id === 'date0000').conditionlist[0].nextmessage.value, 'save0000')
      assert.equal(items.find(item => item.id === 'save0000').externalbefore.label, 'Создать запись')
    }
  },
  {
    name: 'Цена берётся из активной услуги, а не из ввода клиента',
    run (bot, assert) {
      const items = actions(bot, 'Создать запись')
      const read = operation(items, 'readrow')
      assert.equal(read.namelist.label, 'Услуги')
      assert.equal(read.focuslast, true)
      assert.deepEqual(read.oplistsaveinvar, [{ pole: 'Название', string: 'название' }, { pole: 'Цена', string: 'цена' }])
      assert.ok(read.oplistcond.some(item => item.oplistpole === 'Код' && item.oplistvalue === '[Data1]'))
      assert.ok(read.oplistcond.some(item => item.oplistpole === 'Активна' && item.oplistvalue === 'да'))
      const add = operation(items, 'addrow')
      const fields = Object.fromEntries(add.oplistpoles.map(item => [item.pole, item.value]))
      assert.equal(fields['Цена'], '#{цена}')
      assert.equal(fields['Услуга'], '#{название}')
    }
  },
  {
    name: 'Запись содержит все данные анкеты и исходно имеет статус Новая',
    run (bot, assert) {
      const add = operation(actions(bot, 'Создать запись'), 'addrow')
      const fields = Object.fromEntries(add.oplistpoles.map(item => [item.pole, item.value]))
      assert.deepEqual(fields, {
        'Номер': '#{номер}', 'Услуга': '#{название}', 'Цена': '#{цена}',
        'Имя': '#{имя}', 'Телефон': '#{телефон}', 'Дата': '#{дата}', 'Статус': 'Новая'
      })
      const headers = JSON.parse(bot.lists.find(item => item.name === 'Записи').headers)
      for (const pole of ['ClientID', 'Messenger', 'BotID', 'CreationDate']) assert.ok(headers.includes(pole), pole)
    }
  },
  {
    name: 'Недоступная услуга не доходит до добавления записи',
    run (bot, assert) {
      const items = actions(bot, 'Создать запись')
      const read = items.find(item => item.name === 'Найти активную услугу и её цену')
      const missing = read.conditions.find(item => item.cond === '#{услугаесть} = 0')
      const target = items.find(item => item.id === missing.nextaction.value)
      assert.equal(target.name, 'Сообщить о недоступной услуге')
      assert.equal(target.conditions[0].exit, true)
      assert.equal(operation([target], 'addrow'), undefined)
    }
  },
  {
    name: 'Мои записи отбираются по всем трём автополям подписчика',
    run (bot, assert) {
      const read = operation(actions(bot, 'Мои записи'), 'readrow')
      const filters = Object.fromEntries(read.oplistcond.map(item => [item.oplistpole, item.oplistvalue]))
      assert.deepEqual(filters, { ClientID: '[ClientID]', Messenger: '[Messenger]', BotID: '[BotID]' })
    }
  },
  {
    name: 'Найденные записи выводятся отдельными сообщениями с меню после списка',
    run (bot, assert) {
      const items = actions(bot, 'Мои записи')
      const read = operation(items, 'readrow')
      assert.equal(read.oplistsavesend, true)
      assert.match(read.oplistsavesendmes, /#\{м_услуга\}/)
      const owner = items.find(item => item.operations && item.operations.includes(read))
      assert.equal(owner.conditions[0].exit, true)
      assert.equal(owner.conditions[0].exitbtn[0].nextMessage, 'start000')
    }
  }
]
