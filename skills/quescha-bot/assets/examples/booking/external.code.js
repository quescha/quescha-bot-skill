await scenario('Создать запись', async (qb, ctx) => {
  await qb.step('услуга', {
    name: 'Найти активную услугу и её цену',
    config: qb.cfg.listRead(ctx.lists['Услуги'], { 'Название': 'название', 'Цена': 'цена' }, {
      conds: [
        { pole: 'Код', cmp: '=', value: '[Data1]' },
        { pole: 'Активна', cmp: '=', value: 'да', logic: 'and' }
      ],
      last: true,
      filtervar: 'услугаесть'
    }),
    branches: [{ cond: '#{услугаесть} = 0', next: 'нетуслуги' }],
    next: 'номер'
  })
  await qb.step('номер', {
    name: 'Сформировать номер записи',
    config: qb.cfg.js("varstore['номер'] = 'З-' + String(Date.now())"),
    next: 'записать'
  })
  await qb.step('записать', {
    name: 'Сохранить запись текущего подписчика',
    config: qb.cfg.listAdd(ctx.lists['Записи'], {
      'Номер': '#{номер}',
      'Услуга': '#{название}',
      'Цена': '#{цена}',
      'Имя': '#{имя}',
      'Телефон': '#{телефон}',
      'Дата': '#{дата}',
      'Статус': 'Новая'
    }),
    done: {
      exit: true,
      exitmes: 'Запись #{номер} создана: #{название}, #{дата}. Стоимость: #{цена} ₽.',
      exitbtn: [{ id: 0, name: 'В меню', url: '', action: 'nextmessage', nextMessage: 'start000', nextData: '', data: 'menu', addtag: null, deltag: null, intentBtn: null }]
    }
  })
  await qb.step('нетуслуги', {
    name: 'Сообщить о недоступной услуге',
    config: qb.cfg.ops(),
    done: {
      exit: true,
      exitmes: 'Эта услуга сейчас недоступна. Выберите другую.',
      exitbtn: [{ id: 0, name: 'Выбрать услугу', url: '', action: 'nextmessage', nextMessage: 'service0', nextData: '', data: 'retry', addtag: null, deltag: null, intentBtn: null }]
    }
  })
})

await scenario('Мои записи', async (qb, ctx) => {
  await qb.step('прочитать', {
    name: 'Показать только записи текущего подписчика',
    config: qb.cfg.listRead(ctx.lists['Записи'], {
      'Услуга': 'м_услуга',
      'Дата': 'м_дата',
      'Статус': 'м_статус'
    }, {
      conds: [
        { pole: 'ClientID', cmp: '=', value: '[ClientID]' },
        { pole: 'Messenger', cmp: '=', value: '[Messenger]', logic: 'and' },
        { pole: 'BotID', cmp: '=', value: '[BotID]', logic: 'and' }
      ],
      filtervar: 'м_есть'
    }, {
      send: {
        mes: '#{м_услуга}\n#{м_дата}\nСтатус: #{м_статус}',
        btn: [],
        len: 10
      }
    }),
    branches: [{ cond: '#{м_есть} = 0', next: 'пусто' }],
    done: {
      exit: true,
      exitmes: 'Ваши записи:',
      exitbtn: [{ id: 0, name: 'В меню', url: '', action: 'nextmessage', nextMessage: 'start000', nextData: '', data: 'menu', addtag: null, deltag: null, intentBtn: null }]
    }
  })
  await qb.step('пусто', {
    name: 'Сообщить об отсутствии записей',
    config: qb.cfg.ops(),
    done: {
      exit: true,
      exitmes: 'У вас пока нет записей.',
      exitbtn: [{ id: 0, name: 'Записаться', url: '', action: 'nextmessage', nextMessage: 'service0', nextData: '', data: 'book', addtag: null, deltag: null, intentBtn: null }]
    }
  })
})
