'use strict'

const actions = (bot, name) => JSON.parse(bot.external.find(item => item.name === name).actions)
const save = (bot, name, items) => { bot.external.find(item => item.name === name).actions = JSON.stringify(items) }
const operation = (items, type) => items.flatMap(action => action.operations || []).find(op => op.oplistaction && op.oplistaction.value === type)

module.exports = [
  {
    name: 'Чужие записи становятся видимы без ClientID',
    mutate (bot) {
      const items = actions(bot, 'Мои записи')
      const read = operation(items, 'readrow')
      read.oplistcond = read.oplistcond.filter(item => item.oplistpole !== 'ClientID')
      save(bot, 'Мои записи', items)
    }
  },
  {
    name: 'Цену можно подменить вводом клиента',
    mutate (bot) {
      const items = actions(bot, 'Создать запись')
      operation(items, 'addrow').oplistpoles.find(item => item.pole === 'Цена').value = '#{цена_от_клиента}'
      save(bot, 'Создать запись', items)
    }
  },
  {
    name: 'Потерян телефон в сохранённой записи',
    mutate (bot) {
      const items = actions(bot, 'Создать запись')
      const add = operation(items, 'addrow')
      add.oplistpoles = add.oplistpoles.filter(item => item.pole !== 'Телефон')
      save(bot, 'Создать запись', items)
    }
  },
  {
    name: 'Удалена ветка недоступной услуги',
    mutate (bot) {
      const items = actions(bot, 'Создать запись')
      const read = items.find(item => item.name === 'Найти активную услугу и её цену')
      read.conditions = read.conditions.filter(item => item.cond !== '#{услугаесть} = 0')
      save(bot, 'Создать запись', items)
    }
  },
  {
    name: 'Список записей больше не выводится сообщениями',
    mutate (bot) {
      const items = actions(bot, 'Мои записи')
      operation(items, 'readrow').oplistsavesend = false
      save(bot, 'Мои записи', items)
    }
  },
  {
    name: 'В сообщении появилась несуществующая функция',
    expect: 'E_DRYRUN',
    mutate (bot) {
      const items = JSON.parse(bot.messages[0].message)
      items.find(item => item.id === 'start000').text += '\n[NoSuchFunction(1)]'
      bot.messages[0].message = JSON.stringify(items)
    }
  }
]
