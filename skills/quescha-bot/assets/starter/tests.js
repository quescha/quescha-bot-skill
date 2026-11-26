'use strict'

const blocks = bot => JSON.parse(bot.messages[0].message)

module.exports = [
  {
    name: 'Главное меню даёт три понятных выбора',
    run (bot, assert) {
      const start = blocks(bot).find(x => x.id === 'start000')
      assert.ok(start)
      assert.deepEqual(start.btn.map(x => x.name), ['Меню и цены', 'Адрес и телефон', 'Часы работы'])
    }
  },
  {
    name: 'Телефон вынесен в глобальную переменную и используется',
    run (bot, assert) {
      const phone = bot.global.find(x => x.name === 'Телефон')
      assert.ok(phone && phone.value.trim())
      const where = blocks(bot).find(x => x.id === 'where000')
      assert.match(where.text, /#\{g_Телефон\}/)
    }
  },
  {
    name: 'Каждый информационный экран возвращает в меню',
    run (bot, assert) {
      for (const id of ['menu0000', 'where000', 'hours000']) {
        const block = blocks(bot).find(x => x.id === id)
        assert.ok(block.btn.some(x => x.nextMessage && x.nextMessage.value === 'start000'), id)
      }
    }
  }
]
