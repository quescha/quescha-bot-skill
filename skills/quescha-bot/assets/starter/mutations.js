'use strict'

const blocks = bot => JSON.parse(bot.messages[0].message)
const saveBlocks = (bot, value) => { bot.messages[0].message = JSON.stringify(value) }

module.exports = [
  {
    name: 'Кнопка меню ведёт на несуществующий блок',
    expect: 'E_BLOCK_TARGET',
    mutate (bot) {
      const value = blocks(bot)
      value.find(x => x.id === 'start000').btn[0].nextMessage.value = 'missing0'
      saveBlocks(bot, value)
    }
  },
  {
    name: 'У цепочки удалены все способы запуска',
    expect: 'E_CHAIN_TRIGGER',
    mutate (bot) {
      const chain = bot.chains[0]
      chain.subscription = false
      chain.dialog = false
      chain.nothandled = false
      chain.keywords = 'null'
      chain.addtagstart = 'null'
    }
  },
  {
    name: 'Два блока наложены друг на друга',
    expect: 'E_BLOCK_OVERLAP',
    mutate (bot) {
      const value = blocks(bot)
      const start = value.find(x => x.id === 'start000')
      const menu = value.find(x => x.id === 'menu0000')
      menu.x = start.x
      menu.y = start.y
      saveBlocks(bot, value)
    }
  },
  {
    name: 'Телефон остался пустым',
    mutate (bot) { bot.global.find(x => x.name === 'Телефон').value = '' }
  }
]
