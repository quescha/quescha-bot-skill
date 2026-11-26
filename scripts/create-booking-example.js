'use strict'

const fs = require('fs')
const path = require('path')

function condition (nextmessage) {
  return {
    nextmessage: nextmessage || null, getdata: false, getdataurl: null, externalafter: null,
    exitwait: false, exitatonce: false, webhookcheck: false, webhook: null,
    emailcheck: false, email: null, messengercheck: false, messenger: null,
    addtagcheck: false, addtag: [], deltagcheck: false, deltag: [], tagdata: '', cond: '',
    metrika: false, metrikaid: [], metrikaname: null, metrikacounter: ''
  }
}

function ref (label, value) { return { label, value } }
function button (id, name, label, value, data) {
  return {
    id, name, url: '', action: 'nextmessage', addtag: null, deltag: null,
    nextMessage: ref(label, value), nextData: '', data: data || '', intentBtn: null
  }
}

function block (id, name, order, x, y, text, extra = {}) {
  const { next, ...fields } = extra
  return Object.assign({
    id, x, y, order, name, text, media: [], btn: [], number: false, regex: false,
    regexval: '', email: false, phone: false, getdata: false, getdataurl: null,
    externalbefore: null, acceptpayment: false, dontwaitanswer: false, answervar: '',
    fileid: '', fileidnote: false, waitinterval: '', waitunit: null, ticklim: '',
    wronganswer: null, conditionlist: [condition(next)], messengercheck: false
  }, fields)
}

const blocks = [
  block('start000', 'Главное меню', 0, 0, 0, 'Здравствуйте! Это #{g_Название салона}. Выберите действие.', {
    btn: [
      button(0, 'Записаться', 'Выбор услуги', 'service0', 'book'),
      button(1, 'Мои записи', 'Мои записи', 'mylist00', 'mine')
    ]
  }),
  block('service0', 'Выбор услуги', 1, 340, 0, 'Выберите услугу.', {
    answervar: 'услуга', next: ref('Имя клиента', 'name0000'),
    btn: [
      button(0, 'Стрижка', 'Имя клиента', 'name0000', 'cut'),
      button(1, 'Окрашивание', 'Имя клиента', 'name0000', 'color'),
      button(2, 'Маникюр', 'Имя клиента', 'name0000', 'nails'),
      button(3, 'В меню', 'Главное меню', 'start000', 'menu')
    ]
  }),
  block('name0000', 'Имя клиента', 2, 680, 0, 'Введите ваше имя.', {
    answervar: 'имя', next: ref('Телефон клиента', 'phone000'),
    btn: [button(0, 'Отмена', 'Главное меню', 'start000', 'cancel')],
    btnsettings: { tg: { inrow: [], inline: true, clearkeyboard: false, contact: false, contacttext: 'Отправить номер телефона', location: false, locationtext: 'Отправить свое месторасположение', venue: false, venuetext: 'Отправить точку на карте', replace: false, disablepreview: false, disablenotification: false, protectcontent: false, mediabulk: false } }
  }),
  block('phone000', 'Телефон клиента', 3, 1020, 0, 'Введите номер телефона.', {
    answervar: 'телефон', phone: true, wronganswer: ref('Телефон клиента', 'phone000'),
    next: ref('Дата записи', 'date0000'),
    btnsettings: {
      tg: { inrow: [], inline: false, clearkeyboard: false, contact: true, contacttext: 'Отправить номер телефона', location: false, locationtext: 'Отправить свое месторасположение', venue: false, venuetext: 'Отправить точку на карте', replace: false, disablepreview: false, disablenotification: false, protectcontent: false, mediabulk: false },
      max: { contact: true, contacttext: 'Отправить номер телефона' }
    }
  }),
  block('date0000', 'Дата записи', 4, 1360, 0, 'Укажите желаемую дату и время записи, например: 20.12.2026 в 15:30.', {
    answervar: 'дата', next: ref('Сохранение записи', 'save0000'),
    btn: [button(0, 'Отмена', 'Главное меню', 'start000', 'cancel')],
    btnsettings: { tg: { inrow: [], inline: true, clearkeyboard: true, contact: false, contacttext: 'Отправить номер телефона', location: false, locationtext: 'Отправить свое месторасположение', venue: false, venuetext: 'Отправить точку на карте', replace: false, disablepreview: false, disablenotification: false, protectcontent: false, mediabulk: false } }
  }),
  block('save0000', 'Сохранение записи', 5, 1700, 0, '[Actions]', {
    externalbefore: ref('Создать запись', 150001)
  }),
  block('mylist00', 'Мои записи', 6, 340, 320, '[Actions]', {
    externalbefore: ref('Мои записи', 150002)
  })
]

const bot = {
  groupnull: false,
  groups: [{ id: 100001, name: 'Синтетический бот записи в салон', ordernumber: 1 }],
  chains: [{
    id: 100101, code: '100000000000101', name: 'Запись в салон', ordernumber: 1,
    BotGroupId: 100001, channel: '[]', active: true, sended: 0, planned: 0, canceled: 0,
    addtagstart: 'null', deltagstart: 'null', addtagstop: 'null', deltagstop: 'null',
    keywords: '["меню","запись","салон","старт"]', dialog: false, nothandled: false,
    subscription: true, rangetime: false, rangedays: '["пн","вт","ср","чт","пт","сб","вс"]',
    rangetimestart: 0, rtshour: '00', rtsminute: '00', rangetimeend: 0, rtehour: '00',
    rteminute: '00', additional: null, webhook: null, email: '[]', hidden: false, messenger: '[]'
  }],
  messages: [{
    id: 100201, ordernumber: 0, message: JSON.stringify(blocks), acode: 'quescha_skill_booking_demo',
    interval: '0', intervalnum: 1, dimension: 'now', dimensionlabel: 'сразу', intfromstart: 0,
    anytime: true, exacttime: 0, exacttimehour: '00', exacttimeminute: '00', code: '100000000000201',
    name: 'Сценарий записи', sended: 0, planned: 0, active: true, chatmessage: false,
    singlechat: false, scenario: true, scenariotype: 'common', exit: 'выход', exitanswer: null,
    stepback: 'назад', actionseveryone: null, BotChainId: 100101
  }],
  schedules: [], scheduleschains: [], schedulesmessages: [], shops: [], shopschains: [],
  shopsmessages: [], landings: [],
  lists: [
    { id: 110001, name: 'Услуги', headers: JSON.stringify(['Код', 'Название', 'Цена', 'Активна', 'ClientID', 'Messenger', 'BotID', 'CreationDate']), ordernumber: 0, BotGroupId: 100001 },
    { id: 110002, name: 'Записи', headers: JSON.stringify(['Номер', 'Услуга', 'Цена', 'Имя', 'Телефон', 'Дата', 'Статус', 'ClientID', 'Messenger', 'BotID', 'CreationDate']), ordernumber: 1, BotGroupId: 100001 }
  ],
  listdata: [
    { id: 120001, ListId: 110001, data: JSON.stringify(['cut', 'Стрижка', '1500', 'да', '', '', '', '']), ordernumber: 0 },
    { id: 120002, ListId: 110001, data: JSON.stringify(['color', 'Окрашивание', '4500', 'да', '', '', '', '']), ordernumber: 1 },
    { id: 120003, ListId: 110001, data: JSON.stringify(['nails', 'Маникюр', '2200', 'да', '', '', '', '']), ordernumber: 2 }
  ],
  global: [{ id: 130001, name: 'Название салона', note: 'Публичное название в сообщениях бота', value: 'Демонстрационный салон', ordernumber: 0, BotGroupId: 100001 }],
  external: [
    { id: 150001, name: 'Создать запись', ordernumber: 0, actions: '[]', BotGroupId: 100001, CrmId: null },
    { id: 150002, name: 'Мои записи', ordernumber: 1, actions: '[]', BotGroupId: 100001, CrmId: null }
  ],
  webapp: [], webapprubric: [], webappdata: []
}

const target = path.join(__dirname, '../skills/quescha-bot/assets/examples/booking')
fs.mkdirSync(target, { recursive: true })
fs.writeFileSync(path.join(target, 'bot.json'), JSON.stringify(bot, null, 2) + '\n')
console.log(path.join(target, 'bot.json'))
