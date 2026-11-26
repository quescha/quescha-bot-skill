// Прогон бота вхолостую: всё, что можно проверить не запуская конструктор.
//
// Компилятор конструктора ловит только свои ошибки — переходы в несуществующее
// действие и неполные операции. Молча проходят вещи, из-за которых бот
// не работает у клиента: переменная, которую никто не заполнил; блок, до
// которого не дойти; кнопка на несуществующий блок; JS-код с опечаткой.
//
// Проверки общие для любого бота. Задание конкретного бота передаётся
// в opts: жизненные значения для JS-действий и список требований.
const fs = require('fs')
const substitutions = require('./substitutions.json')

// Системные переменные и шаблоны: их заполняет движок, а не сценарий
const SYSVAR = /^(_|g_)/
const KNOWNVAR = new Set([
  'listlength',
  // метка из ссылки запуска: /start <метка>, payload ВКонтакте
  'start',
  'media_url', 'media_urls', 'media_count', 'media_type', 'media_ext', 'media_duration', 'ismedia',
  'media_sent', 'media_notsent', 'media_error',
  'sticker_id', 'sticker_emoji', 'sticker_set', 'sticker_url',
  'ai_answer', 'calendarrecord', 'channel_subscription', 'botid', 'messenger', 'clientid',
  'shop_order_id', 'shop_summary', 'shop_buy_list',
  // Возврат из мини-приложения «Каталог»: движок кладёт состав заказа
  // и ItemsID в varstore ещё до сценариев (BotsController, ветка
  // web_app_data). ItemsID передают в платёжную ссылку, чтобы после
  // оплаты списались остатки товаров
  'ItemsID', 'catalogorder'
])
// Автополя списка: их движок заполняет сам, если значение пустое
const AUTOPOLE = ['ClientID', 'Messenger', 'BotID', 'CreationDate']
// Эти ставит только ExternalController — путь вебхука и мини-приложения
const WEBHOOKONLY = ['_clientid', '_messenger', '_channelid', '_request', '_request_headers', '_response']

function run (datapath, opts) {
  const o = opts || {}
  const bot = JSON.parse(fs.readFileSync(datapath, 'utf8'))

  // Что платёж вернёт в блок приёма: имена payloads и переменная суммы,
  // заданные при создании ссылки, — они путешествуют через платёжную систему
  const paymentBack = new Set()
  for (const e of bot.external) {
    for (const a of JSON.parse(e.actions)) {
      if (!a.payment || !a.payment.type || a.payment.type.value !== 'getlink') continue
      if (a.payment.vsum) paymentBack.add(a.payment.vsum)
      for (const pl of a.payment.payloads || []) if (pl.name) paymentBack.add(pl.name)
    }
  }


  let errors = 0
  let warns = 0
  const err = (m) => { errors++; console.log('  ОШИБКА: ' + m) }
  const warn = (m) => { warns++; console.log('  замечание: ' + m) }
  // Настоящая ошибка под своим именем: в разборе мёртвых сценариев err
  // затеняют замечанием, и вот через это имя до неё всё равно можно дойти
  const errRaw = err
  const ok = (m) => console.log('  ok: ' + m)
  const head = (t) => { console.log('\n' + '─'.repeat(70)); console.log(t) }

  // ── 1. Ссылочная целостность блоков ──────────────────────────────────────
  head('1. БЛОКИ: переходы, кнопки, вызовы сценариев')

  // id блока живёт ВНУТРИ шага цепочки, а не во всём боте: и переход
  // (nextmessage), и «Запустить блок» ищут его только в массиве блоков
  // текущего шага (externalhelpers.js: messageNumForStart перебирает
  // переданный message). Поэтому рецепт вправе разложить один и тот же
  // шаблон блоков по всем урокам — одинаковые id в РАЗНЫХ шагах законны,
  // и ошибка тут только на повторе внутри ОДНОГО шага.
  //
  // Оборотная сторона: справочник ниже общий на бот, и у повторяющегося id
  // в нём остаётся первый блок. Правила, считающие блоки и достижимость,
  // видят такой клон один раз — на многошаговых рецептах их числа занижены.
  // Это ограничение проверки, а не бота: чтобы считать иначе, справочник
  // пришлось бы вести по шагам, а ссылки на блок в общих сценариях
  // указывают на все шаги сразу и различить их нечем
  const allBlocks = {}
  const blocksOf = {}
  const clones = {}
  // Набор переходов «nextMessage: "#{блоки}"»: меню собирает код, кладя id
  // блоков в массив (инструкция, раздел о наборах кнопок). Цели ищем в коде
  // того же сценария — в действиях, которые пишут эту переменную: все строки
  // в кавычках, совпадающие с id существующих блоков
  const наборБлоков = (e, to) => {
    const м = String(to || '').match(/^#\{([^}]+)\}$/)
    if (!м) return []
    const имя = м[1]
    const out = new Set()
    for (const a of JSON.parse(e.actions)) {
      const код = a.jscode && (typeof a.jscode === 'string' ? a.jscode : a.jscode.data)
      if (!код || String(код).indexOf("varstore['" + имя + "']") === -1) continue
      const re = /['"]([A-Za-z0-9_]{1,40})['"]/g
      let s
      while ((s = re.exec(String(код)))) if (allBlocks[s[1]]) out.add(s[1])
    }
    return [...out]
  }
  for (const m of bot.messages) {
    const arr = JSON.parse(m.message)
    blocksOf[m.id] = arr
    const seen = {}
    for (const b of arr) {
      if (seen[b.id]) err('id блока «' + b.id + '» встречается дважды в шаге «' + (m.name || m.id) + '»')
      seen[b.id] = true
      if (allBlocks[b.id]) { clones[b.id] = (clones[b.id] || 1) + 1; continue }
      allBlocks[b.id] = { block: b, message: m }
      // Редактор выдаёт блокам восьмизначные id, но движок ходит по любому
      // непустому id: в готовом боте биржи мастеров блоки названы словами
      // (start, category, address) и бот работает годами. Поэтому замечание,
      // а не ошибка: важна уникальность и то, что ссылки на id совпадают
      if (!/^[a-zA-Z0-9]{8}$/.test(b.id)) {
        warn('id блока «' + b.id + '» не в формате редактора (8 знаков [a-zA-Z0-9]). ' +
          'Движок такой id понимает, но при сборке нового бота держись формата редактора')
      }
    }
  }
  const clonedIds = Object.keys(clones)
  if (clonedIds.length) {
    // Рецепты вроде «Курс с уроками» кладут один шаблон блоков в каждый шаг.
    // Это норма, но числа блоков и достижимости ниже считают такой блок один
    // раз — говорим об этом вслух, чтобы их не читали как потерю блоков
    ok('блоков всего: ' + Object.keys(allBlocks).length + ' (одинаковых id в разных шагах: ' +
      clonedIds.length + ' — шаблон разложен по шагам, движку это не мешает; ' +
      'в подсчётах ниже такой блок считается один раз)')
  } else {
    ok('блоков всего: ' + Object.keys(allBlocks).length + ', id уникальны и по формату')
  }

  const externalByName = {}
  const externalById = {}
  for (const e of bot.external) { externalByName[e.name] = e; externalById[e.id] = e }

  // Ссылка блока на сценарий: { label, value }. Движок ходит по value
  // (BotsController: opt.id = m[num].externalbefore.value), подпись — для глаз.
  // Ищем так же: сначала номер, потом имя
  const scenOf = (ref) => {
    if (!ref) return null
    return externalById[ref.value] || externalByName[ref.label] || null
  }

  const incoming = {}
  for (const m of bot.messages) {
    const arr = blocksOf[m.id]
    const local = new Set(arr.map(b => b.id))
    for (const b of arr) {
      if (!Array.isArray(b.conditionlist) || b.conditionlist.length === 0) {
        err('блок «' + b.name + '»: пустой conditionlist')
      }
      // Условие обязательно там, где веток больше одной. И первая ветка —
      // всегда «иначе»: движок при нескольких ветках начинает перебор
      // со второй (bcontrolup.js: condstart = 1), поэтому её условие
      // не проверяется никогда. Условие, записанное первым, просто не работает,
      // а сам блок теряет ветку по умолчанию — подписчик встаёт намертво
      if ((b.conditionlist || []).length > 1) {
        if (String(b.conditionlist[0].cond || '').trim()) {
          // Условие в первой ветке движок не читает. Но если у этой ветки нет
          // и перехода, терять нечего: подписчик и так остаётся на блоке —
          // ровно то, что задумано «условием». Такое встречается в готовых
          // ботах как подпись «сюда приходит вот это» и поломкой не является
          if (b.conditionlist[0].nextmessage) {
            err('блок «' + b.name + '»: условие «' + b.conditionlist[0].cond + '» стоит первой веткой, ' +
              'а движок проверяет ветки со второй — это условие не сработает никогда. ' +
              'Первой всегда идёт ветка без условия, условия ставятся ниже')
          } else {
            warn('блок «' + b.name + '»: у первой ветки записано условие «' + b.conditionlist[0].cond +
              '» — движок его не читает. Перехода у ветки нет, поведение не меняется, ' +
              'но запись вводит в заблуждение: условия ставятся со второй ветки')
          }
        }
        for (let i = 1; i < b.conditionlist.length; i++) {
          if (!b.conditionlist[i].cond) err('блок «' + b.name + '»: ветка ' + (i + 1) + ' без условия cond')
        }
      }
      for (const c of b.conditionlist || []) {
        if (c.nextmessage) {
          if (!local.has(c.nextmessage.value)) {
            err('блок «' + b.name + '»: переход на блок «' + c.nextmessage.value + '», которого нет в этом сценарии')
          } else incoming[c.nextmessage.value] = (incoming[c.nextmessage.value] || 0) + 1
        }
        if (c.externalafter && !scenOf(c.externalafter)) {
          err('блок «' + b.name + '»: externalafter зовёт сценарий «' + c.externalafter.label + '», которого нет')
        }
        if (c.cond === undefined) err('блок «' + b.name + '»: у условия нет поля cond')
      }
      // wronganswer строкой: движок такой текст НЕ показывает вовсе.
      // Подписчик отправил «завтра» вместо телефона и не получил ничего,
      // написал ещё раз — снова тишина. Проверено стендом на настоящем
      // движке; в каталоге так молчали 36 ботов
      if (typeof b.wronganswer === 'string' && b.wronganswer.trim()) {
        err('блок «' + b.name + '»: wronganswer задан текстом («' + b.wronganswer.trim().slice(0, 40) +
          '…»), а движок ждёт ССЫЛКУ на блок { label, value }. Текст не покажется: при неверном ответе бот промолчит. ' +
          'Сделай отдельный блок «не распознали» с кнопками «Ввести ещё раз» и «В меню»')
      }
      // Переход при неверном ответе — такой же вход в блок, как кнопка:
      // движок уводит туда подписчика сам, когда проверка не прошла
      if (b.wronganswer && b.wronganswer.value) {
        if (!local.has(b.wronganswer.value)) {
          err('блок «' + b.name + '»: при неверном ответе уводит на блок «' + b.wronganswer.value + '», которого нет')
        } else incoming[b.wronganswer.value] = (incoming[b.wronganswer.value] || 0) + 1
      }
      for (const t of b.btn || []) {
        if (t.action === 'nextmessage') {
          if (!t.nextMessage || !t.nextMessage.value) err('блок «' + b.name + '»: кнопка «' + t.name + '» без цели')
          else if (!local.has(t.nextMessage.value)) err('блок «' + b.name + '»: кнопка «' + t.name + '» ведёт на несуществующий блок')
          else incoming[t.nextMessage.value] = (incoming[t.nextMessage.value] || 0) + 1
        }
        if (t.action === 'nextmessage' && t.nextMessage && typeof t.nextMessage !== 'object') {
          err('блок «' + b.name + '»: у кнопки «' + t.name + '» nextMessage строкой, а у блоков он объект')
        }
      }
      if (b.externalbefore) {
        const sc = externalByName[b.externalbefore.label]
        const byid = externalById[b.externalbefore.value]
        if (!sc && !byid) {
          err('блок «' + b.name + '»: externalbefore зовёт сценарий «' + b.externalbefore.label +
            '» (id ' + b.externalbefore.value + '), которого нет ни по имени, ни по номеру')
        } else if (!sc && byid) {
          warn('блок «' + b.name + '»: подпись сценария «' + b.externalbefore.label +
            '» устарела, на деле зовётся «' + byid.name + '». Движок ходит по номеру, бот работает — ' +
            'но в редакторе это читается неверно')
        } else if (b.externalbefore.value !== sc.id) {
          if (byid) {
            warn('блок «' + b.name + '»: подпись сценария «' + b.externalbefore.label +
              '» указывает на один сценарий, а номер — на другой, «' + byid.name + '». ' +
              'Движок ходит по номеру, работает «' + byid.name + '» — но в редакторе читается неверно')
          } else {
            err('блок «' + b.name + '»: externalbefore.value=' + b.externalbefore.value + ', а у сценария id=' + sc.id)
          }
        }
      }
      // [External] и [Actions] — один и тот же шаблон: substitution.js
      // подставляет на их место сообщение сценария
      if ((b.text.includes('[Actions]') || b.text.includes('[External]')) && !b.externalbefore) {
        err('блок «' + b.name + '»: в тексте [Actions], но сценарий действий не назначен')
      }
      // Пустые блоки запрещены: конструктор такой блок не сохранит.
      // Блоку, который сам ничего не говорит (только планирует или считает),
      // ставят [Actions] — сценарий вернёт пустое сообщение, и бот промолчит
      const hasmedia = (b.media || []).length > 0 || b.fileid
      if (!String(b.text || '').trim() && !hasmedia) {
        err('блок «' + b.name + '» пустой: ни текста, ни вложений. ' +
          'Если он должен молчать — поставь [Actions] и сценарий с пустым сообщением')
      }
    }
  }
  ok('переходы блоков и вызовы сценариев ведут на существующие цели')

  // Кнопки сценариев тоже ведут на блоки, и это законный вход
  for (const e of bot.external) {
    for (const a of JSON.parse(e.actions)) {
      for (const c of a.conditions || []) {
        for (const key of ['exitbtn', 'sendtobtn', 'notifybtn', 'messengerbtn', 'doctobtn', 'docxtobtn']) {
          for (const t of c[key] || []) {
            const to = String(t.nextMessage || '')
            if (to && allBlocks[to]) incoming[to] = (incoming[to] || 0) + 1
            for (const id of наборБлоков(e, to)) incoming[id] = (incoming[id] || 0) + 1
          }
        }
        // Блок, назначенный на будущее, — тоже вход, хоть кнопки на него
        // и нет: «Запустить блок», «Запустить напоминание» и «Уведомление»
        // приводят подписчика туда сами
        for (const key of ['startmesnum', 'startmesnotifynum', 'backnotifynum']) {
          const to = String(c[key] || '')
          if (to && allBlocks[to]) incoming[to] = (incoming[to] || 0) + 1
        }
      }
      // Кнопки постраничного вывода списка (send) — такие же переходы:
      // «Открыть №…» с кодом строки в поле Data
      for (const op of a.operations || []) {
        for (const t of op.oplistsavesendbtn || []) {
          const to = String(t.nextMessage || '')
          if (t.action === 'nextmessage' && to && allBlocks[to]) incoming[to] = (incoming[to] || 0) + 1
        }
      }
    }
  }

  for (const m of bot.messages) {
    const arr = blocksOf[m.id]
    for (let i = 0; i < arr.length; i++) {
      if (i === 0) continue
      if (arr[i].acceptpayment) continue
      // блок с трансляцией геопозиции запускает сам движок — на каждое
      // обновление координат (ветка edited_message.location), переход
      // на него не нужен
      if (arr[i].btnsettings && arr[i].btnsettings.tg && arr[i].btnsettings.tg.livegeo) continue
      if (!incoming[arr[i].id]) {
        // В готовых ботах встречается блок-полка: владелец грузит в него
        // картинки товаров, чтобы взять ссылки для списка. Подписчику он
        // не показывается, и перехода на него быть не должно. Отличаем
        // по пустоте: ни сценария, ни кнопок, ни перехода, текст — заглушка
        const b = arr[i]
        const полка = !b.externalbefore && (b.btn || []).length === 0 &&
          String(b.text || '').trim().length <= 3 &&
          !(b.conditionlist || []).some(c => c.nextmessage)
        if (полка) {
          warn('блок «' + b.name + '» недостижим и пуст — похоже на полку для файлов: ' +
            'в такой блок владелец грузит картинки, чтобы взять ссылки. Если это не она, блок лишний')
        } else {
          err('блок «' + b.name + '» недостижим: на него никто не переходит')
        }
      }
    }
  }
  ok('недостижимых блоков нет')

  // ── 2. Кнопки из сценариев действий ──────────────────────────────────────
  head('2. КНОПКИ СЦЕНАРИЕВ: ведут на существующие блоки')

  let btncount = 0
  for (const e of bot.external) {
    for (const a of JSON.parse(e.actions)) {
      for (const c of a.conditions || []) {
        for (const key of ['exitbtn', 'sendtobtn', 'notifybtn', 'messengerbtn', 'doctobtn', 'docxtobtn']) {
          for (const t of c[key] || []) {
            if (t.action !== 'nextmessage') continue
            btncount++
            const to = String(t.nextMessage || '')
            if (!to) { err('«' + e.name + '» / «' + a.name + '»: кнопка «' + t.name + '» без цели'); continue }
            if (typeof t.nextMessage === 'object') {
              err('«' + e.name + '»: у кнопки «' + t.name + '» nextMessage объектом, а в сценариях он строка')
            }
            if (/^#\{[^}]+\}$/.test(to)) {
              // Набор переходов: id блоков кладёт в массив код сценария
              if (!наборБлоков(e, to).length) {
                err('«' + e.name + '» / «' + a.name + '»: кнопка «' + t.name + '» ведёт на набор ' + to +
                  ', но код сценария не кладёт в эту переменную ни одного id существующего блока')
              }
            } else if (!allBlocks[to] && !/^\d+$/.test(to)) {
              err('«' + e.name + '» / «' + a.name + '»: кнопка «' + t.name + '» ведёт на «' + to + '» — такого блока нет')
            }
          }
        }
        if (c.startmesnum) {
          const to = String(c.startmesnum)
          if (!allBlocks[to] && !/^\d+$/.test(to)) err('«' + e.name + '»: переход на блок «' + to + '» — такого блока нет')
        }
      }
    }
  }
  ok('кнопок с переходом на блок: ' + btncount + ', все цели существуют')

  // Кнопки сценария движок СКЛАДЫВАЕТ с кнопками блока, а не заменяет их:
  // на выходе «вернуться в сценарий» bcontrolup делает btn = exitbtn.concat(btn).
  // Одна и та же кнопка, заданная в обоих местах, показывается дважды.
  // Сверяем адрес перехода, а не подпись: «В меню» и «Передумал» на один
  // блок — это те же две кнопки в одно место
  const кудаКнопка = (t) => {
    const n = t && t.nextMessage
    if (n && typeof n === 'object') return String(n.value || '')
    return String(n || '')
  }
  const владельцыСценария = {}
  for (const m of bot.messages) {
    for (const b of (blocksOf[m.id] || [])) {
      for (const поле of ['externalbefore', 'externalafter']) {
        const метка = b[поле] && b[поле].label
        if (!метка) continue
        владельцыСценария[метка] = владельцыСценария[метка] || []
        владельцыСценария[метка].push(b)
      }
    }
  }
  let дублей = 0
  for (const e of bot.external) {
    const свои = владельцыСценария[e.name] || []
    for (const a of JSON.parse(e.actions)) {
      for (const c of a.conditions || []) {
        if (!c.exit || !(c.exitbtn || []).length) continue
        const цель = (c.exittype === 'startmes' && c.startmesnum && allBlocks[String(c.startmesnum)])
          ? [allBlocks[String(c.startmesnum)]]
          : свои
        if (!цель.length) continue
        for (const t of c.exitbtn) {
          const адрес = кудаКнопка(t)
          if (!адрес) continue
          const всюду = цель.every(b => (b.btn || []).some(к => кудаКнопка(к) === адрес))
          if (!всюду) continue
          дублей++
          err('«' + e.name + '» / «' + a.name + '»: кнопка «' + t.name + '» ведёт на «' + адрес +
            '», и такая же кнопка есть у блока «' + цель[0].name + '». Движок складывает кнопки шага ' +
            'с кнопками блока — подписчик увидит две одинаковые. Убери её из сценария или из блока')
        }
      }
    }
  }
  if (!дублей) ok('кнопки блоков и сценариев не повторяют друг друга')

  // ── 3. Ссылки на списки и глобальные ─────────────────────────────────────
  head('3. СПИСКИ И ГЛОБАЛЬНЫЕ: ссылки внутри действий')

  const listById = {}
  for (const l of bot.lists) listById[l.id] = l
  const globalById = {}
  for (const g of bot.global) globalById[g.id] = g
  const listHeaders = {}
  for (const l of bot.lists) listHeaders[l.id] = JSON.parse(l.headers)

  let refs = 0
  function checkPole (where, listid, pole) {
    if (!pole || typeof pole !== 'string') return
    if (!listHeaders[listid]) return
    if (!listHeaders[listid].includes(pole)) {
      err(where + ': поля «' + pole + '» нет в списке «' + listById[listid].name + '»')
    }
  }

  for (const e of bot.external) {
    for (const a of JSON.parse(e.actions)) {
      const where = '«' + e.name + '» / «' + a.name + '»'
      for (const op of a.operations || []) {
        if (op.type !== 'list') continue
        const lid = op.namelist && op.namelist.value
        if (!lid) { err(where + ': операция со списком без выбранного списка'); continue }
        if (!listById[lid]) { err(where + ': ссылка на список id=' + lid + ', которого нет'); continue }
        refs++
        if (op.namelist.label !== listById[lid].name) {
          // Движок берёт список по номеру (external.js: List.findOne по
          // namelist.value), подпись рядом — для глаз в редакторе. Список
          // переименовали — бот работает по-прежнему, а в действии осталось
          // старое имя. Мешает это человеку, а не боту
          warn(where + ': подпись списка «' + op.namelist.label + '» устарела, на деле это «' +
            listById[lid].name + '». Движок ходит по номеру, бот работает — но в редакторе читается неверно')
        }
        for (const p of op.oplistpoles || []) {
          // пустое поле в снимке — просто устаревшая подпись колонки
          if (!p.value) continue
          if (!listHeaders[lid] || listHeaders[lid].includes(p.pole)) continue
          err(where + ': поле «' + p.pole + '» со значением «' + String(p.value).slice(0, 40) +
            '» в списке «' + listById[lid].name + '» не существует — при записи движок пересобирает ' +
            'поля по нынешним заголовкам, и это значение потеряется молча')
        }
        // Движок сам пересобирает поля по заголовкам списка (external.js:
        // AddRowList → refreshpoles), поэтому порядок в операции неважен,
        // а пропущенное поле молча пишется пустым. Для ClientID, Messenger,
        // BotID и CreationDate это правильно: пустые он заполняет сам.
        // А вот пропущенное рабочее поле — это молча потерянные данные
        if (op.oplistaction && op.oplistaction.value === 'addrow') {
          const got = new Set((op.oplistpoles || []).map(p => p.pole))
          const lost = (listHeaders[lid] || []).filter(h => !got.has(h) && AUTOPOLE.indexOf(h) === -1)
          if (lost.length) {
            warn(where + ': при добавлении строки не заданы поля ' + lost.join(', ') +
              ' списка «' + listById[lid].name + '» — они запишутся пустыми. ' +
              'Автополя (ClientID, Messenger, BotID, CreationDate) движок заполняет сам')
          }
        }
        for (const p of op.oplistsaveinvar || []) checkPole(where, lid, p.pole)
        for (const p of op.oplisteditpoles || []) checkPole(where, lid, p.editpole)
        for (const p of op.oplistcond || []) checkPole(where, lid, p.oplistpole)
        for (const p of op.oplistgetstring || []) if (p.pole) checkPole(where, lid, p.pole)
        if (op.sortcheck) checkPole(where, lid, op.sortlistpole)
        const tid = op.oplisttarget && op.oplisttarget.value
        for (const p of op.oplistaddtolist || []) {
          if (p.pole) checkPole(where, lid, p.pole)
          if (tid) checkPole(where + ' (цель)', tid, p.targetpole)
        }
        for (const v of op.varsave || []) {
          if (v.globaltarget && v.globaltarget.value && !globalById[v.globaltarget.value]) {
            err(where + ': запись в глобальную id=' + v.globaltarget.value + ', которой нет')
          }
        }
      }
    }
  }
  ok('операций со списками: ' + refs + ', все ссылки и названия полей сходятся')

  // ── Путь подписчика: граф шагов и данные на нём ──────────────────────────
  //
  // Считается один раз и используется дважды: проверкой 4 (у сценария есть
  // всё, что он читает) и проверкой 12 (данные есть на каждом пути сюда).
  //
  // Рёбра пути: переходы блока, кнопки блока, запуск блока из сценария
  // (startmesnum) и кнопки сообщения выхода (exitbtn). Кнопки sendtobtn,
  // notifybtn и messengerbtn ведут ДРУГОГО подписчика — сотрудника,
  // поэтому это отдельные точки входа, а не продолжение пути клиента.

  const jumpsCache = {}
  const jumpsOf = (e) => {
    if (jumpsCache[e.name]) return jumpsCache[e.name]
    const mine = { client: [], staff: [] }
    for (const a of JSON.parse(e.actions)) {
      for (const c of a.conditions || []) {
        if (c.exit) {
          if (c.exittype === 'startmes' && c.startmesnum) mine.client.push(String(c.startmesnum))
          for (const t of c.exitbtn || []) {
            if (t.action !== 'nextmessage' || !t.nextMessage) continue
            mine.client.push(String(t.nextMessage))
            for (const id of наборБлоков(e, t.nextMessage)) mine.client.push(id)
          }
        }
        for (const key of ['sendtobtn', 'notifybtn', 'messengerbtn']) {
          for (const t of c[key] || []) {
            if (t.action === 'nextmessage' && t.nextMessage) mine.staff.push(String(t.nextMessage))
          }
        }
      }
    }
    // кнопки постраничного вывода списка ведут того же подписчика
    for (const a of JSON.parse(e.actions)) {
      for (const op of a.operations || []) {
        for (const t of op.oplistsavesendbtn || []) {
          if (t.action === 'nextmessage' && t.nextMessage) mine.client.push(String(t.nextMessage))
        }
      }
    }
    jumpsCache[e.name] = mine
    return mine
  }

  // сценарии блока: до показа сообщения и после ответа подписчика
  const scenBefore = (b) => scenOf(b.externalbefore)
  const scenAfter = (b) => {
    const out = []
    for (const c of b.conditionlist || []) {
      if (c.externalafter && scenOf(c.externalafter)) out.push(scenOf(c.externalafter))
    }
    return out
  }
  const scenariosOn = (b) => {
    const out = []
    const bf = scenBefore(b)
    if (bf) out.push(bf)
    return out.concat(scenAfter(b))
  }

  const nextOf = {}
  const staffEntries = new Set()
  const addNext = (from, to) => {
    if (!to || !allBlocks[to]) return
    if (!nextOf[from]) nextOf[from] = new Set()
    nextOf[from].add(String(to))
  }
  for (const id of Object.keys(allBlocks)) {
    const b = allBlocks[id].block
    for (const c of b.conditionlist || []) if (c.nextmessage) addNext(id, c.nextmessage.value)
    for (const t of b.btn || []) {
      if (t.action === 'nextmessage' && t.nextMessage && t.nextMessage.value) addNext(id, t.nextMessage.value)
    }
    // Неверный ответ — тоже шаг пути: движок уводит туда сам
    if (b.wronganswer && b.wronganswer.value) addNext(id, b.wronganswer.value)
    for (const e of scenariosOn(b)) {
      const j = jumpsOf(e)
      for (const to of j.client) addNext(id, to)
      for (const to of j.staff) if (allBlocks[to]) staffEntries.add(String(to))
    }
  }

  // Точки входа: первый блок каждого сообщения цепочки — с него начинается
  // рассылка. Плюс блоки, которые открывает сотрудник кнопкой из уведомления
  const entries = []
  for (const m of bot.messages) {
    const arr = blocksOf[m.id]
    if (arr.length) entries.push(arr[0].id)
  }
  for (const id of staffEntries) if (entries.indexOf(id) === -1) entries.push(id)

  const reach = new Set()
  const stack0 = entries.slice()
  while (stack0.length) {
    const id = stack0.pop()
    if (reach.has(id) || !allBlocks[id]) continue
    reach.add(id)
    for (const to of nextOf[id] || []) stack0.push(to)
  }

  // Что появляется на шаге: ответ подписчика и всё, что записали сценарии
  const genAnswer = {}
  const genBefore = {}
  const genAfter = {}
  const scenarioNeeds = {}
  const guardedBy = {}
  const produced = new Set()
  const scenProduces = (e) => {
    const out = new Set()
    const acts = JSON.parse(e.actions)
    for (const a of acts) for (const v of producedBy(a)) out.add(v)
    if (!scenarioNeeds[e.name]) {
      // Сценарий может сам прикрыться: «если данных нет — вот шаг, где их
      // берут». Такую переменную он не требует от пути, а возвращает
      // подписчика туда, где она появится
      const guard = new Set()
      for (const a of acts) {
        for (const c of a.conditions || []) {
          if (!c.exit || c.exittype !== 'startmes' || !c.startmesnum) continue
          for (const v of reads(c.cond || '')) guard.add(v)
        }
      }
      guardedBy[e.name] = guard
      const need = new Set()
      for (const v of reads(acts)) if (!out.has(v) && !guard.has(v)) need.add(v)
      scenarioNeeds[e.name] = need
    }
    return out
  }
  for (const id of Object.keys(allBlocks)) {
    const b = allBlocks[id].block
    genAnswer[id] = new Set(b.answervar ? [b.answervar] : [])
    genBefore[id] = new Set()
    genAfter[id] = new Set()
    const bf = scenBefore(b)
    if (bf) for (const v of scenProduces(bf)) genBefore[id].add(v)
    for (const e of scenAfter(b)) for (const v of scenProduces(e)) genAfter[id].add(v)
    for (const s of [genAnswer[id], genBefore[id], genAfter[id]]) for (const v of s) produced.add(v)
  }

  const preds = {}
  for (const from of Object.keys(nextOf)) {
    for (const to of nextOf[from]) (preds[to] = preds[to] || []).push(from)
  }
  const declared = new Set(o.outervars || [])
  // may — переменная может быть заполнена хотя бы на одном пути сюда,
  // must — заполнена на каждом. Первое отвечает «есть ли данные вообще»,
  // второе — «у всех ли, кто сюда пришёл»
  const mayIn = {}
  const mayOut = {}
  const mustIn = {}
  const mustOut = {}
  for (const id of Object.keys(allBlocks)) {
    mayIn[id] = new Set(); mayOut[id] = new Set()
    mustIn[id] = new Set(); mustOut[id] = new Set(produced)
  }
  for (let pass = 0; pass < 60; pass++) {
    let changed = false
    for (const id of Object.keys(allBlocks)) {
      if (!reach.has(id)) continue
      const inmay = new Set()
      let inmust = null
      const ps = (preds[id] || []).filter(p => reach.has(p))
      // В точку входа подписчик попадает и с пустыми руками — с неё цепочка
      // начинается. Без этого кольцо «меню → шаг → меню» убедило бы само
      // себя, что данные шага есть всегда
      const isentry = entries.indexOf(id) > -1
      for (const p of ps) {
        for (const v of mayOut[p]) inmay.add(v)
        if (isentry) continue
        if (inmust === null) inmust = new Set(mustOut[p])
        else for (const v of Array.from(inmust)) if (!mustOut[p].has(v)) inmust.delete(v)
      }
      if (inmust === null) inmust = new Set()
      // outervars — обещание автора: эту переменную заполняет другая цепочка
      // или возврат из мини-приложения, значит она есть на любом пути
      for (const v of declared) inmust.add(v)
      const outmay = new Set(inmay)
      const outmust = new Set(inmust)
      for (const s of [genAnswer[id], genBefore[id], genAfter[id]]) {
        for (const v of s) { outmay.add(v); outmust.add(v) }
      }
      if (outmay.size !== mayOut[id].size || outmust.size !== mustOut[id].size ||
        inmay.size !== mayIn[id].size || inmust.size !== mustIn[id].size) changed = true
      mayIn[id] = inmay; mayOut[id] = outmay
      mustIn[id] = inmust; mustOut[id] = outmust
    }
    if (!changed) break
  }

  // Где какой сценарий вызывается — и что к этому моменту уже заполнено
  const ownersOf = {}
  for (const id of Object.keys(allBlocks)) {
    const b = allBlocks[id].block
    const bf = scenBefore(b)
    if (bf) (ownersOf[bf.name] = ownersOf[bf.name] || []).push({ id: id, when: 'before' })
    for (const e of scenAfter(b)) (ownersOf[e.name] = ownersOf[e.name] || []).push({ id: id, when: 'after' })
  }

  // ── 4. Переменные: кто заполняет то, что читают ──────────────────────────
  head('4. ПЕРЕМЕННЫЕ: у каждой #{имя} есть шаг, который её заполняет')

  // Что заполняет ОДНА операция действия
  function producedByOp (op) {
    const out = []
    for (const p of op.oplistsaveinvar || []) out.push(p.string)
    for (const v of op.varsave || []) if (v.varname) out.push(v.varname)
    if (op.oplistfiltervar) out.push(op.oplistfiltervar)
    if (op.oplistchangefiltervar) out.push(op.oplistchangefiltervar)
    if (op.oplistreadvar) out.push(op.oplistreadvar)
    return out
  }

  function producedBy (a) {
    const out = []
    for (const op of a.operations || []) for (const v of producedByOp(op)) out.push(v)
    if (a.jscode && a.jscode.data) {
      const re = /varstore\s*\[\s*['"]([^'"]+)['"]\s*\]\s*=/g
      let m
      while ((m = re.exec(a.jscode.data))) out.push(m[1])
      // Имя переменной, собранное в коде: varstore['stop_' + (i + 1)] = …
      //
      // Так пишут, когда одним циклом заполняют набор однотипных переменных.
      // Целого имени в коде нет, и по нему проверка ругалась на живые
      // переменные. Запоминаем приставку: всё, что с неё начинается,
      // считается заполненным этим шагом.
      const rep = /varstore\s*\[\s*['"]([^'"]*)['"]\s*\+/g
      while ((m = rep.exec(a.jscode.data))) if (m[1]) out.push(m[1] + '*')
    }
    // Платёж возвращает данные не туда, откуда ушёл: ссылку заполняет
    // «сформировать ссылку», а результат, сумму и всё, что положили
    // в payloads, — «принять платёж» в блоке, который запускает платёжная
    // система. Для проверки переменных это такой же источник, как список
    if (a.payment && a.payment.type) {
      if (a.payment.vlink) out.push(a.payment.vlink)
      if (a.payment.vsum) out.push(a.payment.vsum)
      if (a.payment.type.value === 'acceptpay') {
        out.push('payment_result')
        out.push('payment_name')
        out.push('sum')
        // Приём платежа возвращает то, что положили В ССЫЛКУ: payloads и сумму
        // задают при её создании, а приходят они обратно сюда — вместе
        // с уведомлением платёжной системы
        for (const back of paymentBack) out.push(back)
      }
    }
    for (const key of ['getdata', 'chatgpt', 'webapp', 'links', 'checktags', 'tgchannel', 'maxchannel',
      'gsheets', 'crm', 'gcalendar', 'gdrive', 'yadisk', 'doc', 'acceptmedia']) {
      const c = a[key]
      if (!c) continue
      for (const f of ['resultvar', 'answervar', 'varname', 'invitelinkvar', 'adminlistvar',
        'membercountvar', 'recidvar', 'infovar', 'imgurlvar', 'responsevar', 'linkvar', 'docvar',
        // проверки записи в календарь: 1 — уже записан на это время / предел
        // предстоящих записей исчерпан, 0 — записали (external.js)
        'doublevar', 'futurevar',
        // «Календарь: получить запись» раскладывает её по переменным, имена
        // которых заданы полями самого действия (external.js webappGetRecord)
        'format1var', 'format2var', 'timevar', 'singledatevar', 'settimevar',
        'recordIdvar', 'eventvar', 'durationvar', 'allrecords',
        // данные канала, комментарии, подарки, номер темы форума
        'chatinfovar', 'commentsvar', 'giftlistvar', 'topicvar',
        'doclinkvar']) {
        if (c[f]) out.push(c[f])
      }
      // Имена, которые движок ставит сам, без поля в действии
      if (key === 'webapp' && c.type && c.type.value === 'cal_del_record') out.push('delrecinfo')
      if (key === 'webapp' && c.type && c.type.value === 'cal_get_records') { out.push('recids_'); out.push('reclength') }
      // У дисков имена переменных лежат в операциях: ссылка на загруженный
      // файл, его id и ответ сервиса
      for (const op of c.op || []) {
        for (const f of ['fileurlvar', 'fileidvar', 'resultvar', 'responsevar']) {
          if (op[f]) out.push(op[f])
        }
      }
      for (const d of c.acceptdata || []) if (d.tovar) out.push(d.tovar)
      for (const d of c.savevars || []) if (d.varname) out.push(d.varname)
    }
    // У календаря имена переменных лежат в собственных полях: дата приходит
    // в format1/format2, время — в time, номер записи — в recordId,
    // список записей — в allrecords. Это тоже «кто заполнил»
    const w = a.webapp
    const wtype = w && w.type && w.type.value
    if (wtype === 'cal_data') {
      for (const f of ['format1', 'format2', 'time', 'recordId']) if (w[f]) out.push(w[f])
    }
    // «Каталог: обработка заказа» раскладывает заказ из мини-приложения
    // по переменным, имена которых заданы полями самого действия
    // (bcontrolup.js, ветка cat_order: varstore[webapp.orderlist] и прочие).
    // Поля tax движок не заполняет — оно закомментировано, поэтому его тут нет
    if (wtype === 'cat_order') {
      for (const f of ['orderlist', 'totalsum', 'orderId', 'isorder', 'title', 'description',
        'descrmin', 'price', 'oldprice', 'size', 'color', 'code', 'count', 'sum']) {
        if (w[f]) out.push(w[f])
      }
    }
    if (wtype === 'cal_get_records') {
      for (const f of ['allrecords', 'recnum']) if (w[f]) out.push(w[f])
    }
    for (const o of (a.referal && a.referal.op) || []) {
      for (const f of ['resultvar', 'balancevar', 'paidvar', 'levelvar', 'clientidvar',
        'messengervar', 'botidvar', 'clientlinkvar', 'fullnamevar', 'namevar']) {
        if (o[f]) out.push(o[f])
      }
    }
    return out.filter(Boolean)
  }

  function reads (obj) {
    const out = []
    const re = /#\{([^}]+)\}/g
    let m
    const text = JSON.stringify(obj)
    while ((m = re.exec(text))) out.push(m[1])
    return out
  }

  // Что сценарий застаёт в момент запуска: всё, что заполнено на путях
  // к блокам, где он вызван. Сценарий, вызванный после ответа подписчика,
  // видит ещё и сам ответ; вызванный до показа сообщения — пока нет
  const seedFor = (e) => {
    const owners = ownersOf[e.name] || []
    // Блок приёма платежа запускает КОЛБЕК платёжной системы, а не переход:
    // путей к нему нет и быть не должно. Но колбек продолжает тот же разговор
    // того же подписчика, и всё, что он успел заполнить по дороге к оплате,
    // на месте. Поэтому такой сценарий судим как вебхучный — по всему боту
    const колбек = owners.some(o => allBlocks[o.id] && allBlocks[o.id].block.acceptpayment)
    if (!owners.length || колбек) {
      // вебхук, приём платежа или мини-приложение: пути к нему нет,
      // судить не по чему
      const all = new Set(declared)
      for (const id of Object.keys(allBlocks)) for (const v of genAnswer[id]) all.add(v)
      for (const id of Object.keys(allBlocks)) for (const v of genBefore[id]) all.add(v)
      for (const id of Object.keys(allBlocks)) for (const v of genAfter[id]) all.add(v)
      return all
    }
    const seed = new Set(declared)
    for (const own of owners) {
      for (const v of mayIn[own.id] || []) seed.add(v)
      if (own.when === 'after') {
        for (const v of genAnswer[own.id]) seed.add(v)
        for (const v of genBefore[own.id]) seed.add(v)
      }
    }
    return seed
  }

  // Сценарий живой, если его зовёт блок (до отправки или на переходе), либо
  // он сам ждёт данные снаружи — тогда его запускает вебхук, а не блок
  const usedScenarios = new Set()
  for (const m of bot.messages) {
    for (const b of blocksOf[m.id]) {
      if (scenOf(b.externalbefore)) usedScenarios.add(scenOf(b.externalbefore).name)
      for (const c of b.conditionlist || []) {
        if (scenOf(c.externalafter)) usedScenarios.add(scenOf(c.externalafter).name)
      }
    }
  }
  const waitsData = (e) => JSON.parse(e.actions).some(a => a.action && a.action.value === 'getdata' &&
    a.getdata && a.getdata.type && a.getdata.type.value === 'waiting')
  // Сценарий на вебхуке мини-приложения: код приложения зовёт его меткой
  // {{webhook:Название}}, установка подставит адрес (appwebhook.js). Такой
  // сценарий отвечает приложению через _response и молча заканчивается
  const byHook = new Set()
  const МЕТКА = /\{\{\s*webhook\s*:\s*([^}]+?)\s*\}\}/gi
  for (const w of bot.webapp || []) {
    const s = typeof w.settings === 'string' ? w.settings : JSON.stringify(w.settings || '')
    let m
    МЕТКА.lastIndex = 0
    while ((m = МЕТКА.exec(s))) byHook.add(m[1].trim().toLowerCase())
  }
  const hooked = (e) => byHook.has(String(e.name || '').trim().toLowerCase())
  const dead = new Set()
  for (const e of bot.external) {
    if (usedScenarios.has(e.name) || waitsData(e) || hooked(e)) continue
    dead.add(e.name)
  }
  if (dead.size) {
    err('сценариев, которых никто не зовёт: ' + dead.size + ' — ' + [...dead].map(n => '«' + n + '»').join(', ') +
      '. Ни блока с таким сценарием, ни ожидания данных снаружи: это остатки прошлых доработок, их место в корзине')
  } else ok('каждый сценарий кто-то вызывает')

  // всё, что бот хоть где-то кладёт в переменные: по этому отличаем
  // «переменной нет вовсе» от «её заполняют, но на другом пути»
  const заполняетКтоТо = new Set()
  for (const e of bot.external) {
    for (const a of JSON.parse(e.actions)) for (const v of producedBy(a)) заполняетКтоТо.add(v)
  }
  for (const m of bot.messages) {
    for (const b of blocksOf[m.id]) if (b.answervar) заполняетКтоТо.add(b.answervar)
  }

  let varsChecked = 0
  for (const e of bot.external) {
    // внутренности мёртвого сценария не разбираем: переменные ему никто
    // не готовит просто потому, что пути к нему нет
    if (dead.has(e.name)) continue
    const actions = JSON.parse(e.actions)
    const known = seedFor(e)
    for (const a of actions) {
      const own = producedBy(a)
      const before = JSON.parse(JSON.stringify(a))
      delete before.conditions
      // Шаблон «Вывести список в бот» читает переменные строки, которые
      // заполняет эта же операция: их проверяем не по «что было до шага»,
      // а по «что он сам заполнил»
      const sendparts = []
      for (const op of before.operations || []) {
        if (op.oplistsavesendmes) { sendparts.push(op.oplistsavesendmes); op.oplistsavesendmes = '' }
        if (op.oplistsavesendbtn) { sendparts.push(JSON.stringify(op.oplistsavesendbtn)); op.oplistsavesendbtn = [] }
      }
      const after = new Set(known)
      own.forEach(v => after.add(v))

      // Заполнена ли переменная: своим именем или приставкой от кода,
      // который собирает имена сам (varstore['stop_' + i])
      const isFilled = (pool, name) => {
        if (pool.has(name)) return true
        for (const v of pool) {
          if (typeof v === 'string' && v.endsWith('*') && name.startsWith(v.slice(0, -1))) return true
        }
        return false
      }

      const check = (list, pool, where) => {
        for (const name of list) {
          varsChecked++
          if (SYSVAR.test(name) || KNOWNVAR.has(name)) continue
          if (!isFilled(pool, name)) {
            const гдеТоЕсть = заполняетКтоТо.has(name)
            const вУсловии = where === 'блок «Сделать»'
            if (!вУсловии && where === 'сообщения ветки' && !гдеТоЕсть) {
              err('«' + e.name + '» / «' + a.name + '» (сообщение ветки): читается #{' + name +
                '}, но её нигде не заполняют — подписчик увидит дыру в тексте. ' +
                'Обычно это остаток отладки: убери из сообщения')
              continue
            }
            if (гдеТоЕсть) {
              warn('«' + e.name + '» / «' + a.name + '» (' + where + '): читается #{' + name +
                '}, а заполняют её в другом месте бота. Если подписчик придёт сюда мимо того шага, ' +
                'значение будет пустым')
              continue
            }
            if (!вУсловии) {
              warn('«' + e.name + '» / «' + a.name + '» (' + where + '): читается #{' + name +
                '}, но её нигде не заполняют — подставится пустая строка. Если так очищают поле, ' +
                'всё верно; если ждали значение, оно потерялось')
              continue
            }
            err('«' + e.name + '» / «' + a.name + '» (' + where + '): читается #{' + name +
              '}, но её никто не заполнил раньше')
          }
        }
      }
      // Операции идут по порядку и делят varstore: то, что заполнила первая,
      // вторая уже видит. Поэтому проверяем накопительно, а не по общему
      // набору «что было до шага»
      const shell = JSON.parse(JSON.stringify(before))
      delete shell.operations
      const pool = new Set(known)
      check(reads(shell), pool, 'настройки')
      for (const op of before.operations || []) {
        check(reads(op), pool, 'настройки')
        for (const v of producedByOp(op)) pool.add(v)
      }
      check(reads(sendparts), after, 'вывод списка в бот')
      // сами условия ветвления — с них и спрос строгий
      check(reads((a.conditions || []).map(c => c.cond || '')), after, 'блок «Сделать»')
      // остальные поля веток (сообщения, отправки, письма) — это текст:
      // незаполненная переменная станет пустым местом, а не мёртвой веткой
      const беззУсловий = (a.conditions || []).map(c => {
        const копия = JSON.parse(JSON.stringify(c))
        delete копия.cond
        return копия
      })
      check(reads(беззУсловий), after, 'сообщения ветки')
      own.forEach(v => known.add(v))
    }
  }
  ok('обращений к переменным: ' + varsChecked + ', все заполняются раньше чтения')

  // ── 5. JS-код ────────────────────────────────────────────────────────────
  head('5. JS-КОД: выполняется тем же способом, что и в движке')

  // Наборов данных может быть несколько: одного мало, чтобы поймать ошибку
  // в ветке, до которой этот набор не доходит (умолчание вместо настройки,
  // деление на постоянное число вместо счётчика)
  const cases = [{ name: 'основной', store: o.jsstore || {}, check: o.jscheck }].concat(o.cases || [])

  // Все переменные, которые бот хоть где-то заполняет. К запуску кода они
  // существуют — пустые или нет, но существуют, и метод строки на них
  // не падает. Значения из opts (jsstore, cases) перекрывают этот фон
  // Фон — то, что бот кладёт в varstore ДО кода: чтение списков, присвоения,
  // ответ подписчика. Выходы самого кода сюда не берём: разбирать, посчитал
  // ли код правильно, — дело проверок под бота, и подложенное значение
  // сделало бы такую проверку слепой
  const jsseed = {}
  for (const e of bot.external) {
    for (const a of JSON.parse(e.actions)) {
      if (a.jscode && a.jscode.data) continue
      for (const v of producedBy(a)) if (typeof v === 'string' && !v.endsWith('*')) jsseed[v] = ''
    }
  }
  for (const m of bot.messages) {
    for (const b of blocksOf[m.id]) if (b.answervar) jsseed[b.answervar] = ''
  }
  // Тело и заголовки входящего запроса: их приносит вебхук, и код вебхучного
  // сценария первым делом их разбирает. Пустая строка тут не годится —
  // JSON.parse('') падает, и прогон ругался на код, который в жизни работает
  jsseed['_request'] = '{}'
  jsseed['_request_headers'] = '{}'
  jsseed['_response'] = ''
  // Ответ сервера кладут целиком в переменную и разбирают кодом. Пустая
  // строка снова означала бы падение на JSON.parse — подкладываем пустой
  // объект: у ответа всегда есть какая-то форма
  for (const e of bot.external) {
    for (const a of JSON.parse(e.actions)) {
      for (const key of ['getdata', 'chatgpt']) {
        const c = a[key]
        if (!c) continue
        if (c.resultvar) jsseed[c.resultvar] = '{}'
        if (c.responsevar) jsseed[c.responsevar] = '{}'
      }
    }
  }

  // Переменные, с которыми код обращается как с массивом
  for (const e of bot.external) {
    for (const a of JSON.parse(e.actions)) {
      if (!a.jscode || !a.jscode.data) continue
      const код = String(a.jscode.data)
      const пат = /varstore\s*\[\s*['"]([^'"]+)['"]\s*\]\s*\.\s*(join|map|filter|forEach|push|splice|concat|indexOf|slice|some|every|reduce|sort)\b/g
      for (const м of код.matchAll(пат)) {
        if (jsseed[м[1]] === undefined || jsseed[м[1]] === '') jsseed[м[1]] = []
      }
    }
  }

  let jsruns = 0
  for (const e of bot.external) {
    for (const a of JSON.parse(e.actions)) {
      if (!a.jscode || !a.jscode.data) continue
      jsruns++
      // движок подставляет шаблоны и переменные, затем выполняет
      // new Function('varstore', ...) — см. SubstitutionForCode
      let code = a.jscode.data
      for (const key of Object.keys(o.templates || {})) {
        code = code.split(key).join(o.templates[key])
      }
      // Подстановка вне кавычек: пустое значение ломает разбор всего кода.
      // Комментарии из проверки убираем: подстановка в них остаётся
      // комментарием и сломать ничего не может
      const безКомментариев = String(code).split(String.fromCharCode(10))
        .map(s => { const j = s.indexOf('//'); return j > -1 ? s.slice(0, j) : s })
        .join(String.fromCharCode(10))
      for (const м of безКомментариев.matchAll(/#\{([^}]+)\}/g)) {
        const до = безКомментариев.slice(0, м.index)
        const вКавычках = ((до.match(/'/g) || []).length % 2) === 1 || ((до.match(/"/g) || []).length % 2) === 1
        if (вКавычках) continue
        warn('«' + e.name + '» / «' + a.name + '»: в коде подстановка #{' + м[1] + '} стоит вне кавычек. ' +
          'Движок подставит значение прямо в текст кода — пустое значение сделает код ' +
          'синтаксически неверным, и действие не выполнится ВООБЩЕ, молча. ' +
          "Читай переменную как varstore['" + м[1] + "']")
      }
      // Строка со скобки после законченной строки — это не новая команда,
      // а продолжение прежней: «т.push(…)» и «(список).forEach(…)» склеятся
      // в «т.push(…)(список)», и код упадёт уже у клиента — синтаксически
      // он верен (аварии по адресу, 21.09.2026). Лечится «;» в начале строки
      {
        const строки = безКомментариев.split(String.fromCharCode(10)).map(s => s.trim())
        let прежняя = ''
        for (const с of строки) {
          if (!с) continue
          if (/^[([]/.test(с) && /[\wА-Яа-яЁё$)\]}'"`]$/.test(прежняя)) {
            err('«' + e.name + '» / «' + a.name + '»: строка кода «' + с.slice(0, 50) + '» начинается со скобки ' +
              'сразу после «…' + прежняя.slice(-30) + '» — JavaScript склеит их в одно выражение, и код упадёт ' +
              'на выполнении. Поставь «;» в начале строки')
          }
          прежняя = с
        }
      }
      // подставляем значения так же, как движок: число числом, остальное строкой
      code = String(code).replace(/#\{([^}]+)\}/g, function (все, имя, поз) {
        const v = (o.jsstore && o.jsstore[имя] !== undefined) ? o.jsstore[имя] : jsseed[имя]
        // Внутри кавычек движок кладёт значение как ТЕКСТ — обрамлять его
        // ещё раз нельзя, иначе получится '"{}"' вместо '{}'
        const до = code.slice(0, поз)
        const вКавычках = ((до.match(/'/g) || []).length % 2) === 1 || ((до.match(/"/g) || []).length % 2) === 1
        if (v === undefined || v === null || v === '') return вКавычках ? '' : '0'
        if (вКавычках) return String(v)
        if (typeof v === 'number' || /^-?\d+([.,]\d+)?$/.test(String(v))) return String(v)
        return JSON.stringify(String(v))
      })
      // Код выполняем напрямую, а не внутри промиса. Исключение внутри промиса
      // становится НЕОБРАБОТАННЫМ ОТКАЗОМ: try/catch вокруг вызова его не
      // ловит, и Node роняет весь прогон вместо строчки об ошибке в одном
      // действии. Для дела разницы нет — код действия синхронный, а varstore
      // он правит по месту
      const src = code + '\nreturn varstore'

      // Синтаксическая ошибка В КОДЕ видна уже при сборке функции — до того,
      // как код что-то выполнил. Это настоящая поломка: движок такое действие
      // не выполнит вовсе и промолчит. А вот падение НА ВЫПОЛНЕНИИ значит
      // совсем другое: значения переменных прогон выдумал, и споткнуться код
      // мог именно об них. Раньше эти два случая не различались, и разбор
      // чужого бота получал ошибку на каждом JSON.parse пустой строки:
      // JSON.parse('') тоже кидает SyntaxError, хотя код исправен
      let fn = null
      try {
        // eslint-disable-next-line no-new-func
        fn = new Function('varstore', src)
      } catch (ex) {
        err('«' + e.name + '» / «' + a.name + '»: в коде синтаксическая ошибка — ' + ex.message +
          '. Движок такое действие не выполнит вовсе, молча')
        continue
      }

      for (const one of cases) {
        try {
          // Случай — это «та же жизнь, но вот здесь иначе»: он ДОПОЛНЯЕТ
          // основной набор данных, а не заменяет его. Иначе случай тихо
          // проходит вхолостую: перечисленных полей хватает на одну проверку,
          // остальные массивы пусты, и код отрабатывает не то, что задумано
          const store = Object.assign({}, jsseed, o.jsstore || {}, one.store || {})
          fn(store)
          if (o.show && one.name === 'основной') {
            const got = o.show.filter(k => store[k] !== undefined && store[k] !== '')
            if (got.length) {
              console.log('    «' + a.name + '» → ' + got.map(k => k + '=' + JSON.stringify(store[k]).slice(0, 110)).join(', '))
            }
          }
          if (typeof one.check === 'function') {
            one.check(a.name, store, {
              err: (m) => err('[' + one.name + '] ' + m),
              ok: (m) => ok('[' + one.name + '] ' + m),
              warn: (m) => warn('[' + one.name + '] ' + m)
            })
          }
        } catch (ex) {
          // Набор данных задан разбором (jsstore/cases своих ботов) — значит
          // он близок к боевому, и падение настоящее. Не задан — прогон
          // кормит код пустыми значениями, и спотыкается код об них
          const ownseed = !!(o.jsstore || (one.store && Object.keys(one.store).length))
          const said = '«' + e.name + '» / «' + a.name + '» [' + one.name + ']: код упал на выполнении — ' + ex.message
          if (ownseed) err(said)
          else {
            warn(said + '. Значения переменных прогон выдумал — проверь код ' +
              'на боевом ответе сам, особенно ветку «пришло не то, что ждали»')
          }
        }
      }
    }
  }
  ok('JS-действий выполнено: ' + jsruns + ', наборов данных: ' + cases.length)

  // ── 6. Достижимость действий ─────────────────────────────────────────────
  head('6. СЦЕНАРИИ: все действия достижимы, тупиков нет')

  // Сценарии проходных блоков: блок ответа не ждёт и сам ведёт дальше,
  // поэтому такому сценарию законно кончиться молча
  const passthrough = new Set()
  for (const m of bot.messages) {
    for (const b of blocksOf[m.id]) {
      if (!b.dontwaitanswer) continue
      const goes = (b.conditionlist || []).some(c => c.nextmessage && c.nextmessage.value)
      if (!goes) continue
      for (const key of ['externalbefore', 'externalafter']) {
        if (b[key] && b[key].label) passthrough.add(b[key].label)
      }
    }
    // Сценарий «до блока» у блока со СВОИМ текстом тоже вправе кончиться
    // молча: он готовит данные — подставляет вопрос, считает цену, — а дальше
    // сообщение покажет сам блок и будет ждать ответа. Подписчик не остаётся
    // ни с чем, потому что текст у блока есть
    for (const b of blocksOf[m.id]) {
      const текст = String(b.text || '').trim()
      if (!текст || текст.indexOf('[Actions]') > -1) continue
      if (b.externalbefore && b.externalbefore.label) passthrough.add(b.externalbefore.label)
    }

    // Сценарий «на переходе» блока подписчику не отвечает вовсе: движок
    // его сообщение не отправляет (об этом говорит проверка ниже). Значит
    // молчаливый конец у него законен — он делает свою работу с данными,
    // а дальше ведёт сам блок: маршрутом или кнопками
    for (const b of blocksOf[m.id]) {
      const goes = (b.conditionlist || []).some(c => c.nextmessage && c.nextmessage.value) ||
        (b.btn || []).some(t => t.url || t.nextMessage)
      if (!goes) continue
      for (const c of b.conditionlist || []) {
        if (c.externalafter && c.externalafter.label) passthrough.add(c.externalafter.label)
      }
    }
  }
  // Сценарий-планировщик: отложенный запуск сообщения не отправляет,
  // поэтому в ветке «напоминать не о чем» ему и правда нечего делать —
  // блок молчит, а подписчик остаётся с тем, что ему ответили раньше
  for (const e of bot.external) {
    for (const a of JSON.parse(e.actions)) {
      for (const c of a.conditions || []) {
        if (c.startmestime && c.startmestimedata) passthrough.add(e.name)
      }
    }
  }

  for (const e of bot.external) {
    const actions = JSON.parse(e.actions)
    if (!actions.length) { err('«' + e.name + '»: пустой сценарий'); continue }
    const byId = {}
    for (const a of actions) byId[a.id] = a
    const seen = new Set()
    const stack = [actions[0].id]
    while (stack.length) {
      const id = stack.pop()
      if (seen.has(id) || !byId[id]) continue
      seen.add(id)
      for (const c of byId[id].conditions || []) {
        if (c.nextaction && c.nextaction.value) stack.push(c.nextaction.value)
      }
    }
    // мёртвый сценарий уже назван целиком выше — разбирать его внутренности
    // значит показать тот же мусор второй раз
    if (!dead.has(e.name)) {
      for (const a of actions) if (!seen.has(a.id)) err('«' + e.name + '»: действие «' + a.name + '» недостижимо')
    }
    for (const a of actions) {
      // Пара «поле = значение» и «поле != значение» по одному и тому же полю
      // закрывает все случаи: ветка «иначе» при ней недостижима, и вести
      // из неё некуда. Так собраны развилки «да/нет» в рецептах —
      // придираться тут не к чему
      const SEP = String.fromCharCode(1)
      const eqs = new Set()
      const nes = new Set()
      for (const cc of (a.conditions || []).slice(1)) {
        const s = String(cc.cond || '')
        const ne = s.indexOf('!=')
        if (ne > -1) { nes.add(s.slice(0, ne).trim() + SEP + s.slice(ne + 2).trim()); continue }
        const eq = s.indexOf('=')
        if (eq > -1) eqs.add(s.slice(0, eq).trim() + SEP + s.slice(eq + 1).trim())
      }
      const covered = [...nes].some(x => eqs.has(x))

      for (let i = 0; i < (a.conditions || []).length; i++) {
        const c = a.conditions[i]
        const goes = c.nextaction && c.nextaction.value
        const does = c.exit || c.exitmes || c.sendto || c.addtagcheck || c.deltagcheck ||
          c.webhookcheck || c.emailcheck || c.messengercheck || c.exittype === 'startmes'
        if (!goes && !does) {
          if (i === 0 && covered) continue
          // Проходной блок — законное исключение: сценарий проверяет условия,
          // при отказе уводит сам, а при успехе молча заканчивается, и дальше
          // ведёт сам блок. Ответа он не ждёт и переход у него есть,
          // так что подписчик не остаётся ни с чем
          if (passthrough.has(e.name)) continue
          if (hooked(e)) continue
          warn('«' + e.name + '» / «' + a.name + '»: ветка ' + (i === 0 ? '«иначе»' : '«' + c.cond + '»') +
            ' ни к чему не ведёт — сценарий здесь оборвётся')
        }
      }
    }
  }
  ok('проверено сценариев: ' + bot.external.length)

  // ── 7. Цепочки ───────────────────────────────────────────────────────────
  head('7. ЦЕПОЧКИ: запуск, каналы, привязка блоков')

  for (const c of bot.chains) {
    const mine = bot.messages.filter(m => m.BotChainId === c.id)
    if (!mine.length) err('цепочка «' + c.name + '» без блоков')
    const started = c.subscription || c.dialog || c.nothandled ||
      (c.keywords && c.keywords !== 'null') || (c.addtagstart && c.addtagstart !== 'null')
    if (!started) err('цепочка «' + c.name + '» ничем не запускается')
    if (c.channel !== '[]') warn('цепочка «' + c.name + '»: канал жёстко записан в выгрузку')
  }
  ok('цепочек: ' + bot.chains.length + ', все запускаются и содержат блоки')

  // ── 7е. Поиск по основе слова ────────────────────────────────────────────
  head('7е. ОСНОВА СЛОВА: с какой стороны ищем')

  // Две галочки отбора работают только вместе. «Искать по основе слова»
  // сравнивает наборы основ, а «Обратное сравнение» решает, ЧТО В ЧЁМ
  // ищется (external.js: [OpListBasis:'целое'||'искомое']):
  //   с обратным   — все слова ПОЛЯ есть в значении (в сообщении подписчика);
  //   без обратного — все слова ЗНАЧЕНИЯ есть в поле.
  // Второе для «ответить шаблоном на живую фразу» не годится: длинное
  // сообщение целиком в короткую ключевую фразу не поместится, и отбор
  // не найдёт ничего. Ошибка тихая — список просто всегда пуст.
  //
  // Но бывает и наоборот: поле длинное («математика, физика» у репетитора),
  // а значение короткое («Математика» из заявки). Тогда прямое сравнение
  // как раз и нужно. Какая сторона длиннее, прогон знать не может, поэтому
  // замечание называет оба случая, а решает автор бота
  let основ = 0
  for (const e of bot.external) {
    for (const a of JSON.parse(e.actions)) {
      for (const op of a.operations || []) {
        for (const c of op.oplistcond || []) {
          if (!c.oplistbasis) continue
          основ++
          if (c.oplistreversecheck) continue
          const знач = String(c.oplistvalue || '')
          // сравнение поля с полем оставляем: там стороны выбирает автор
          if (c.oplistwithcheck) continue
          warn('«' + e.name + '» / «' + a.name + '»: у отбора по полю «' + c.oplistpole +
            '» включено «Искать по основе слова», но выключено «Обратное сравнение». ' +
            'Значит слова значения ' + (знач ? '(' + знач.slice(0, 30) + ') ' : '') +
            'ищутся В ПОЛЕ. Так верно, когда поле длинное, а значение короткое ' +
            '(«математика» в поле «математика, физика»). Если наоборот — короткое ' +
            'поле и длинная фраза в значении, — нужно «Обратное сравнение», ' +
            'иначе отбор не найдёт ничего')
        }
      }
    }
  }
  ok('отборов по основе слова: ' + основ)

  // ── 7ж. Ключи и адреса чужих аккаунтов ───────────────────────────────────
  head('7ж. КЛЮЧИ: не зашиты ли они в действия')

  const СЛОВА = /^(multipart|application|Content|Accept|Authorization|charset|boundary|utf|json|form|data|true|false|null|undefined)/i
  const ключиНайдено = []
  const адресаНайдено = {}
  for (const e of bot.external) {
    for (const a of JSON.parse(e.actions)) {
      const g = a.getdata
      if (!g) continue
      const места = [['адресе', g.url], ['теле запроса', g.sendjson], ['теле запроса', g.sendbody],
        ['заголовках', JSON.stringify(g.headings || [])]]
      for (const [где, текст] of места) {
        if (!текст) continue
        const строка = String(текст)
        // подстановки вырезаем: они как раз и есть правильный способ
        const голый = строка.replace(/#\{[^}]*\}/g, ' ').replace(/\[[A-Za-zА-Яа-я0-9_()]+\]/g, ' ')
        for (const кусок of голый.match(/[A-Za-z0-9_\-]{25,}/g) || []) {
          if (СЛОВА.test(кусок)) continue
          // должен быть похож на ключ: и буквы, и цифры вперемешку
          if (!/[a-z]/.test(кусок) || !/[A-Z0-9]/.test(кусок)) continue
          ключиНайдено.push('«' + e.name + '» / «' + (a.name || a.id) + '» (в ' + где + '): ' +
            кусок.slice(0, 12) + '…' + кусок.slice(-4) + ', ' + кусок.length + ' знаков')
        }
      }
      // адрес чужого аккаунта в URL: домен третьего уровня без подстановки
      const м = String(g.url || '').match(/^https?:\/\/([a-z0-9-]+)\.([a-z0-9-]+\.[a-z]{2,})/i)
      // Общедоступные сервисы: адрес у всех один, вынимать его в настройки
      // незачем. Список дополняется по мере встреч
      const ОБЩИЕ = ['www', 'api', 'gate', 'geocode-maps', 'static-maps', 'suggest-maps',
        'sheets', 'docs', 'drive', 'cloud-api', 'oauth', 'graph', 'b2b',
        // DaData: suggestions.dadata.ru — один адрес у всех, ключ в заголовке
        'suggestions']
      if (м && ОБЩИЕ.indexOf(м[1].toLowerCase()) === -1) {
        адресаНайдено[м[0]] = (адресаНайдено[м[0]] || 0) + 1
      }
    }
  }
  for (const с of ключиНайдено) {
    err('ключ записан прямо в действие — ' + с + '. Выгрузка бота уезжает каждому, ' +
      'кто его скачает, вместе с ключом. Держи ключ в списке настроек и подставляй переменной')
  }
  if (!ключиНайдено.length) ok('ключей, записанных прямо в действия, нет')
  for (const адрес of Object.keys(адресаНайдено)) {
    warn('адрес личного аккаунта «' + адрес + '» зашит в ' + адресаНайдено[адрес] +
      ' действ. — у другого владельца адрес свой. Вынеси его в список настроек ' +
      'и подставляй переменной, иначе бот придётся править руками в каждом действии')
  }

  // ── 8. Списки и данные ───────────────────────────────────────────────────
  head('8. СПИСКИ: заголовки и строки данных')

  // В какие списки бот ПИШЕТ. Автополя (ClientID, Messenger, BotID,
  // CreationDate) движок заполняет сам при записи строки, и по ним потом
  // отбирают «мои» строки. Справочнику, который владелец заполняет руками
  // и бот только читает (услуги и цены, категории), они не нужны — требовать
  // их там значит звать ошибкой то, что верно
  const пишетВСписок = new Set()
  for (const e of bot.external) {
    for (const a of JSON.parse(e.actions)) {
      for (const op of a.operations || []) {
        const действие = op.oplistaction && op.oplistaction.value
        if (['addrow', 'editrow', 'delrow'].indexOf(действие) === -1) continue
        if (op.namelist && op.namelist.value) пишетВСписок.add(op.namelist.value)
        for (const v of op.varsave || []) if (v.listtarget && v.listtarget.value) пишетВСписок.add(v.listtarget.value)
      }
      for (const v of (a.operations || []).flatMap(op => op.varsave || [])) {
        if (v.listtarget && v.listtarget.value) пишетВСписок.add(v.listtarget.value)
      }
    }
  }
  for (const l of bot.lists) {
    const h = JSON.parse(l.headers)
    if (пишетВСписок.has(l.id)) {
      for (const auto of ['ClientID', 'Messenger', 'BotID', 'CreationDate']) {
        if (!h.includes(auto)) err('список «' + l.name + '» без автополя ' + auto)
      }
    }
    const rows = bot.listdata.filter(d => d.ListId === l.id)
    for (const r of rows) {
      const d = JSON.parse(r.data)
      if (d.length !== h.length) err('список «' + l.name + '»: в строке ' + d.length + ' значений, а полей ' + h.length)
    }
  }
  ok('заголовки и длины строк сходятся, строк данных: ' + bot.listdata.length)

  // ── 9. Системные переменные ──────────────────────────────────────────────
  head('9. СИСТЕМНЫЕ ПЕРЕМЕННЫЕ: заполнены ли там, где читаются')

  const calledFrom = {}
  for (const id of Object.keys(allBlocks)) {
    const b = allBlocks[id].block
    if (b.externalbefore) (calledFrom[b.externalbefore.label] = calledFrom[b.externalbefore.label] || []).push(b)
    for (const c of b.conditionlist || []) {
      if (c.externalafter) (calledFrom[c.externalafter.label] = calledFrom[c.externalafter.label] || []).push(b)
    }
  }
  // _request и _request_headers движок кладёт в varstore на КАЖДОМ входящем
  // обновлении мессенджера (BotsController: varstore['_request'] =
  // JSON.stringify(request)), а не только в вебхучном сценарии. Поэтому
  // в сценарии от блока там лежит сырое обновление мессенджера — этим
  // пользуются готовые боты, чтобы разобрать возврат из мини-приложения
  const ОТМЕССЕНДЖЕРА = new Set(['_request', '_request_headers'])
  for (const e of bot.external) {
    const fromBlock = (calledFrom[e.name] || []).length > 0
    for (const v of WEBHOOKONLY) {
      if (!e.actions.includes('#{' + v + '}') || !fromBlock) continue
      if (ОТМЕССЕНДЖЕРА.has(v)) {
        warn('«' + e.name + '»: читается #{' + v + '}, а сценарий вызывается блоком. ' +
          'Там будет сырое обновление мессенджера, а не тело вебхука — если ждали ' +
          'поля стороннего сервиса, они не придут')
        continue
      }
      err('«' + e.name + '»: читается #{' + v + '}, но сценарий вызывается блоком — ' +
        'эту переменную ставит только вебхук. Подстановка даст пустую строку')
    }
  }
  ok('переменных вебхука в сценариях, вызванных блоком, нет')

  // ── 7а. Ветка «иначе» с действиями ───────────────────────────────────────
  head('7а. ВЕТКА «ИНАЧЕ»: выполняются ли её действия')

  // Движок при нескольких ветках проверяет только ветки с условиями
  // (bcontrolup.js: condstart = 1). Если ни одна не сошлась, а у ветки
  // «иначе» НЕТ отметки elsefull, из неё берётся ТОЛЬКО переход — её блок
  // «Сделать» не выполняется: ни сообщение выхода, ни отправки, ни теги.
  // Подписчик не получает ничего, ошибки нет.
  //
  // С отметкой (её ставят сборка кодом и редактор, с 01.10.2026) «иначе»
  // идёт последней тем же путём, что сработавшая ветка, и её «Сделать»
  // выполняется (bothelpers.condOrder) — такую ветку здесь не трогаем.
  //
  // Без отметки правильно: в «иначе» оставить только переход на шаг,
  // который делает то, что нужно по умолчанию.
  let elses = 0
  for (const e of bot.external) {
    for (const a of JSON.parse(e.actions)) {
      const conds = a.conditions || []
      if (conds.length < 2) continue
      elses++
      const c0 = conds[0]
      // Та же первая ветка и у действия сценария: её условие не читается
      if (String(c0.cond || '').trim()) {
        err('«' + e.name + '» / «' + a.name + '»: условие «' + c0.cond + '» стоит первой веткой, ' +
          'а движок проверяет ветки со второй — оно не сработает никогда. ' +
          'Первой всегда идёт ветка «иначе» без условия')
      }
      // с отметкой «Сделать» ветки «иначе» выполняется — проверять нечего
      if (c0.elsefull) continue
      const payload = []
      if (c0.exitmes) payload.push('сообщение выхода')
      // Запуск блока из «иначе» тоже не выполняется: сценарий молча
      // заканчивается, подписчик остаётся на прежнем экране и ответа не видит.
      // На этом полдня искался «молчащий» резерв в дилерском кабинете
      if (c0.exit && c0.exittype === 'startmes' && c0.startmesnum) payload.push('запуск блока «' + c0.startmesnum + '»')
      if (c0.sendto) payload.push('отправка в бот')
      if (c0.messengercheck) payload.push('сообщение сотруднику')
      if (c0.addtagcheck) payload.push('добавление тегов')
      if (c0.deltagcheck) payload.push('снятие тегов')
      if (c0.webhookcheck) payload.push('вебхук')
      if (c0.emailcheck) payload.push('письмо')
      // Переход в «иначе» ничего не спасает: движок берёт из неё ТОЛЬКО
      // переход, а «сделать» пропускает целиком. Письмо, которое положили
      // рядом с переходом, не уходит никому и никогда
      if (payload.length && c0.nextaction && c0.nextaction.value) {
        err('«' + e.name + '» / «' + a.name + '»: в ветке «иначе» задано ' + payload.join(', ') +
          ' вместе с переходом. Движок возьмёт из «иначе» только переход, а «сделать» пропустит — ' +
          'это не выполнится никогда. Вынеси «сделать» в отдельный шаг и веди «иначе» на него')
      }
      if (payload.length && !(c0.nextaction && c0.nextaction.value)) {
        // Часто «иначе» — это копия соседней ветки, оставленная при правке:
        // то же сообщение уже отдаёт условная ветка, и подписчик его увидит.
        // Тогда это мусор, а не потеря
        const первая = a.conditions[0] || {}
        const копия = (a.conditions || []).some((x, i) => i > 0 && (
          (x.exit && x.exitmes && x.exitmes === первая.exitmes) ||
          (x.sendto && x.sendtomes && x.sendtomes === первая.sendtomes))) ||
          // отвечают условные ветки, а «иначе» просто осталось заполненным
          (a.conditions || []).some((x, i) => i > 0 && x.exit && (x.exitmes || (x.exitbtn || []).length))
        if (копия) {
          warn('«' + e.name + '» / «' + a.name + '»: в ветке «иначе» задано ' + payload.join(', ') +
            ', но у неё нет перехода — движок это не выполнит. То же сообщение отдаёт условная ветка, ' +
            'так что подписчик его увидит; сама запись — остаток правки')
        } else {
          err('«' + e.name + '» / «' + a.name + '»: в ветке «иначе» задано ' + payload.join(', ') +
            ', но у неё нет перехода. При несовпадении условий сценарий просто закончится, ' +
            'и это не выполнится. Либо веди «иначе» переходом на отдельный шаг, либо поставь ' +
            'ЭТИ настройки последней веткой с условием «1»: оно всегда истинно, а проверяются ' +
            'ветки по порядку — значит сработает, если не подошла ни одна другая')
        }
      }
    }
  }
  ok('действий, у которых есть ветвление: ' + elses + ', ветка «иначе» безопасна')

  // ── 7б. Выход выключен, а настройки выхода заданы ────────────────────────
  head('7б. ВЫХОД: включён ли он там, где настроен')

  // Движок читает весь блок «Выход» только под флагом exit
  // (bcontrolup.js: if (conditions[c].exit) { … }). Без него сообщение выхода,
  // кнопки, переход на блок и отложенный запуск молча не срабатывают —
  // в редакторе при этом всё заполнено и выглядит рабочим
  let exits = 0
  for (const e of bot.external) {
    // внутренности мёртвого сценария не считаем ошибками: сам он уже назван
    const мёртвый = dead.has(e.name)
    const err = мёртвый ? warn : errRaw
    for (const a of JSON.parse(e.actions)) {
      for (let i = 0; i < (a.conditions || []).length; i++) {
        const c = a.conditions[i]
        const filled = []
        if (c.exitmes) filled.push('сообщение выхода')
        if ((c.exitbtn || []).length) filled.push('кнопки выхода')
        if ((c.exitmedia || []).length) filled.push('медиа выхода')
        if (c.exittype === 'startmes' && c.startmesnum) filled.push('переход на блок')
        if (c.startmestime && c.startmestimedata) filled.push('отложенный запуск')
        if (filled.length) {
          exits++
          if (!c.exit) {
            // Если ветка ведёт к следующему действию, сценарий продолжается
            // и своё дело делает — заполненные поля выхода тут просто остались
            // от прошлой правки. Если же продолжения нет, сценарий на этой
            // ветке заканчивается молча, и настройки были единственным, что
            // подписчик должен был увидеть, — вот это уже поломка
            const дальшеЕсть = !!c.nextaction
            if (дальшеЕсть) {
              warn('«' + e.name + '» / «' + a.name + '»: настроено ' + filled.join(', ') +
                ', но «Выход» не отмечен (exit: true) — движок эти поля не читает. ' +
                'Сценарий идёт дальше, так что это остаток прошлой правки: убери или включи выход')
            } else if ((a.conditions || []).some(x => x !== c && x.exit && (x.exitmes || (x.exitbtn || []).length))) {
              warn('«' + e.name + '» / «' + a.name + '»: настроено ' + filled.join(', ') +
                ', но «Выход» не отмечен (exit: true) — движок эти поля не читает. ' +
                'Отвечает другая ветка этого же действия, так что это остаток правки')
            } else if (waitsData(e)) {
              warn('«' + e.name + '» / «' + a.name + '»: настроено ' + filled.join(', ') +
                ', но «Выход» не отмечен (exit: true). Сценарий запущен вебхуком — отвечать всё равно ' +
                'некому, так что это остаток настройки, а не потерянное сообщение')
            } else {
              err('«' + e.name + '» / «' + a.name + '»: настроено ' + filled.join(', ') +
                ', но «Выход» не отмечен (exit: true) — движок не прочитает эти настройки вовсе, ' +
                'а продолжения у ветки нет: сценарий закончится молча')
            }
          }
        }

        // Тот же капкан у остальных возможностей блока «Сделать»: у каждой
        // своя галочка-выключатель, и заполненные поля без неё не работают
        const switches = [
          ['addtagcheck', (x) => (x.addtag || []).length > 0, 'теги на добавление'],
          ['deltagcheck', (x) => (x.deltag || []).length > 0, 'теги на снятие'],
          ['webhookcheck', (x) => !!x.webhook, 'вебхук'],
          ['emailcheck', (x) => !!x.email, 'письмо'],
          ['sendto', (x) => !!x.sendtomes || (x.sendtosubscribers || []).length > 0, 'отправка в бот'],
          ['messengercheck', (x) => !!x.messengermes || (x.messengerbtn || []).length > 0, 'сообщение сотруднику'],
          ['metrika', (x) => (x.metrikaid || []).length > 0, 'цели Метрики']
        ]
        for (const [flag, has, what] of switches) {
          if (!has(c) || c[flag]) continue
          // Та же мера, что и у выхода: ветка, которая делает что-то ещё
          // (выход или переход к следующему действию), работает — заполненное
          // поле под снятой галочкой осталось от правки. Ветка, которая
          // больше ничего не делает, молча не делает ничего
          if (c.exit || c.nextaction) {
            warn('«' + e.name + '» / «' + a.name + '»: заполнено «' + what + '», но галочка ' +
              flag + ' не стоит — движок это поле не читает. Остаток прошлой правки: ' +
              'убери или включи галочку')
          } else {
            err('«' + e.name + '» / «' + a.name + '»: заполнено «' + what + '», но галочка ' +
              flag + ' не стоит — движок эти настройки не прочитает, а больше ветка ничего не делает')
          }
        }
      }
    }
  }
  ok('веток с настройками выхода: ' + exits + ', выключатели везде включены')

  // ── 7в. Двойной шаг: и сценарий уводит, и блок не ждёт ───────────────────
  head('7в. ДВОЙНОЙ ШАГ: блок «не ждёт ответа», а его сценарий сам уводит')

  // Отметка «Переход без ожидания ответа» двигает подписчика на следующий блок
  // сама. Если сценарий этого блока ТОЖЕ уводит (выход «Запустить блок»),
  // шага получается два: сценарий приводит на нужный блок, а отметка тут же
  // уносит с него дальше. Подписчик видит два сообщения подряд, а его ответ
  // уходит во второе — первый вопрос остаётся без ответа.
  //
  // Ошибка тихая: в редакторе всё выглядит правильно, и заметна она только
  // при запуске бота.
  let dwachecked = 0
  for (const m of bot.messages) {
    for (const b of blocksOf[m.id]) {
      if (!b.dontwaitanswer) continue
      dwachecked++
      const ref = b.externalbefore
      if (!ref || !ref.label) continue
      const sc = (bot.external || []).find(e => e.name === ref.label)
      if (!sc) continue
      let jumps = 0
      let exitsall = 0
      for (const a of JSON.parse(sc.actions)) {
        for (const c of a.conditions || []) {
          if (!c.exit) continue
          exitsall++
          if (c.exittype === 'startmes' && c.startmesnum) jumps++
        }
      }
      // Блок, который ничего не показывает, двух сообщений подряд дать
      // не может: его собственное сообщение пустое и не отправляется.
      // Такие технические блоки — законный способ провести подписчика
      // цепочкой «без ожидания» до блока с задержкой: задержка читается
      // только у блока, на который пришли ПЕРЕХОДОМ, и цепочку до неё
      // как раз и держит эта отметка
      const текстпуст = !String(b.text || '').replace(/\[Actions\]|\[External\]/g, '').trim()
      let своёсообщение = false
      for (const a of JSON.parse(sc.actions)) {
        for (const c of a.conditions || []) {
          if (c.exit && c.exitmes && String(c.exitmes).trim()) своёсообщение = true
        }
      }
      if (текстпуст && !своёсообщение && !(b.btn || []).length) continue

      // ругаемся, только когда сценарий уводит ВСЕГДА: если часть веток
      // уводит, а часть нет, отметка как раз и дорабатывает за них
      if (exitsall > 0 && jumps === exitsall) {
        err('блок «' + b.name + '»: стоит «Переход без ожидания ответа», а его сценарий ' +
          '«' + sc.name + '» сам уводит на блок всеми ' + exitsall + ' выходами. Шага выйдет два: ' +
          'подписчик увидит два сообщения подряд, а ответит на второе. Сними отметку — ' +
          'решает сценарий')
      }
    }
  }
  ok('блоков без ожидания ответа: ' + dwachecked + ', двойного шага нет')

  // ── 8а. Двойной вызов сценария ───────────────────────────────────────────
  head('8а. ВЫЗОВЫ СЦЕНАРИЕВ: один и тот же не выполняется дважды')

  // Сценарий, назначенный и на переход с блока (externalafter), и на следующий
  // блок (externalbefore), выполнится ДВА раза подряд. Заявка запишется дважды,
  // счётчик прибавится дважды, клиент получит два одинаковых сообщения.
  // Ошибки при этом нигде не видно — просто дубли в списке
  let pairs = 0
  for (const m of bot.messages) {
    const arr = blocksOf[m.id]
    const byId = {}
    for (const b of arr) byId[b.id] = b
    for (const b of arr) {
      for (const c of b.conditionlist || []) {
        if (!c.externalafter || !c.nextmessage) continue
        const to = byId[c.nextmessage.value]
        if (!to || !to.externalbefore) continue
        pairs++
        if (String(to.externalbefore.label) === String(c.externalafter.label)) {
          err('блок «' + b.name + '» зовёт сценарий «' + c.externalafter.label +
            '» при переходе, и тот же сценарий стоит на блоке «' + to.name +
            '» — он выполнится дважды подряд')
        }
      }
    }
  }
  ok('двойных вызовов сценария нет (проверено переходов со сценарием: ' + pairs + ')')

  // ── 8б. Запрос телефона и клавиатура ─────────────────────────────────────
  head('8б. КНОПКИ ТЕЛЕФОНА И ГЕОПОЗИЦИИ: появятся ли они и уберутся ли потом')

  let contacts = 0
  let geos = 0
  for (const m of bot.messages) {
    const arr = blocksOf[m.id]
    const byId = {}
    for (const b of arr) byId[b.id] = b
    // Цепочка без единой кнопки написана под каналы, где кнопок нет вовсе
    // (Avito, маркетплейсы, WhatsApp): кнопку телефона там требовать не с кого
    let anybtn = false
    for (const b of arr) if ((b.btn || []).length > 0) anybtn = true
    for (const b of arr) {
      const bs = b.btnsettings || {}
      const tg = bs.tg || {}
      // именно телефон: «номер заказа» — это не он
      const wantphone = /телефон|phone|мобильн/i.test(String(b.text || '') + ' ' + String(b.answervar || ''))
      if (!tg.contact && !(bs.max || {}).contact) {
        if (wantphone && (b.answervar || '') && anybtn) {
          err('блок «' + b.name + '» просит телефон, но кнопки «Отправить номер телефона» нет. ' +
            'Набирать номер руками в Telegram и MAX никто не станет: нужен btnsettings ' +
            '(tg.contact + tg.inline:false, max.contact)')
        }
        continue
      }
      contacts++
      // Кнопка телефона живёт в клавиатуре под полем ввода, а она уходит,
      // как только сообщению собирают inline-клавиатуру. Собирают её не всегда:
      // в send.js ветка с inline_keyboard работает, только когда у блока есть
      // СВОИ кнопки (item.btn.length > 0) или медиа (textWithPicBtn).
      // У простого текста без кнопок и медиа contact добавляется отдельной
      // веткой и работает даже при inline:true — там уходит reply-клавиатура
      // с одной кнопкой телефона. У MAX выбора нет вовсе: там contact
      // добавляется всегда, inline на него не влияет
      // Кнопки сценария движок складывает с кнопками блока ещё до отправки,
      // поэтому для send.js они такие же «свои»: экран с кнопкой телефона
      // теряет её и тогда, когда кнопки приходят из exitbtn
      let изСценария = 0
      for (const поле of ['externalbefore', 'externalafter']) {
        const метка = b[поле] && b[поле].label
        if (!метка) continue
        const сц = (bot.external || []).find(x => x.name === метка)
        if (!сц) continue
        for (const a of JSON.parse(сц.actions)) {
          for (const c of a.conditions || []) изСценария += (c.exitbtn || []).length
        }
      }
      const ownbtn = (b.btn || []).length > 0
      const ownmedia = (b.media || []).length > 0 || !!b.fileid
      if (tg.contact && tg.inline !== false && (ownbtn || ownmedia || изСценария)) {
        const откуда = ownbtn ? 'есть свои кнопки' : (изСценария ? 'кнопки приходят из сценария' : 'есть медиа')
        err('блок «' + b.name + '»: contact:true, но у блока ' + откуда + ' и inline:true — ' +
          'Telegram получит inline-клавиатуру, а кнопка телефона живёт в клавиатуре под полем ввода. ' +
          'Поставь inline:false или убери с этого блока ' +
          (ownbtn ? 'свои кнопки' : (изСценария ? 'кнопки сценария' : 'медиа')))
      }
      // клавиатуру должен убрать следующий блок, иначе кнопка телефона
      // останется висеть на всех дальнейших шагах
      const nexts = []
      for (const c of b.conditionlist || []) if (c.nextmessage) nexts.push(c.nextmessage.value)
      for (const t of b.btn || []) if (t.nextMessage && t.nextMessage.value) nexts.push(t.nextMessage.value)
      let cleared = false
      for (const id of nexts) {
        const to = byId[id]
        if (to && to.btnsettings && to.btnsettings.tg && to.btnsettings.tg.clearkeyboard) cleared = true
      }
      if (nexts.length && !cleared) {
        // Движок ставит клавиатуре one_time_keyboard: true (send.js), и после
        // нажатия Телеграм её сворачивает. Но тот, кто наберёт номер руками,
        // нажатия не делает: клавиатура остаётся висеть под полем ввода
        // на всех следующих шагах. Убирает её настройка кнопок следующего
        // блока «Очистить клавиатуру под полем ввода»
        err('блок «' + b.name + '» запрашивает телефон, а следующий блок не убирает клавиатуру. ' +
          'Поставь ему настройку кнопок «Очистить клавиатуру под полем ввода» ' +
          '(btnsettings.tg.clearkeyboard): иначе у того, кто наберёт номер руками, ' +
          'кнопка телефона останется висеть на следующих шагах')
      }
    }
  }
  // Геопозиция — та же клавиатура под полем ввода, те же две ловушки:
  // при своих кнопках и inline:true её не будет видно, а после ответа
  // она останется висеть, пока следующий блок не поставит clearkeyboard
  for (const m of bot.messages) {
    const arr = blocksOf[m.id]
    const byId = {}
    for (const b of arr) byId[b.id] = b
    for (const b of arr) {
      const bs = b.btnsettings || {}
      const tg = bs.tg || {}
      if (!tg.location && !(bs.vk || {}).location && !(bs.max || {}).location) continue
      geos++
      // Про «кнопки не будет видно» есть отдельное правило ниже — оно смотрит
      // и Telegram, и ВКонтакте. Здесь только то, чего там нет
      const nexts = []
      for (const c of b.conditionlist || []) if (c.nextmessage) nexts.push(c.nextmessage.value)
      for (const t2 of b.btn || []) if (t2.nextMessage && t2.nextMessage.value) nexts.push(t2.nextMessage.value)
      let cleared = false
      for (const id of nexts) {
        const to = byId[id]
        if (to && to.btnsettings && to.btnsettings.tg && to.btnsettings.tg.clearkeyboard) cleared = true
      }
      if (nexts.length && !cleared) {
        err('блок «' + b.name + '» запрашивает геопозицию, а следующий блок не убирает клавиатуру. ' +
          'Поставь ему настройку кнопок «Очистить клавиатуру под полем ввода» ' +
          '(btnsettings.tg.clearkeyboard): иначе у того, кто напишет адрес словами, ' +
          'кнопка останется висеть на следующих шагах')
      }
      // Точку присылают в client_latitude и client_longitude — БЕЗ подчёркивания
      // в начале. Если бот их нигде не читает, геокнопка бесполезна: адрес
      // потеряется, а мастер поедет наугад
      let читает = false
      for (const e of bot.external || []) {
        const s = String(e.actions || '')
        if (s.indexOf('client_latitude') > -1 || s.indexOf('client_longitude') > -1) читает = true
      }
      if (!читает) {
        warn('блок «' + b.name + '» просит геопозицию, но ни один сценарий не читает ' +
          'client_latitude и client_longitude. Присланная точка никуда не попадёт: ' +
          'в переменную ответа от неё приходит пусто')
      }
    }
  }

  // Свои кнопки блока с запросом телефона или геопозиции Телеграм кладёт
  // в ту же клавиатуру под полем ввода (send.js, keyboard), а у такой кнопки
  // нет перехода: нажатие приходит ТЕКСТОМ её названия. Без ветки по этому
  // тексту «🏠 В меню» станет ответом шага — телефоном или адресом
  let replyBtns = 0
  for (const m of bot.messages) {
    for (const b of blocksOf[m.id]) {
      const tg = (b.btnsettings || {}).tg || {}
      if (tg.inline !== false || !(tg.contact || tg.location || tg.venue)) continue
      for (const k of b.btn || []) {
        if (!k.name || k.action === 'url') continue
        replyBtns++
        const слова = String(k.name).replace(/[^0-9A-Za-zА-Яа-яЁё ]/g, ' ').trim().replace(/\s+/g, ' ')
        const ловит = (b.conditionlist || []).slice(1).some(c => слова && String(c.cond || '').indexOf(слова) > -1)
        if (!ловит && b.phone) {
          warn('блок «' + b.name + '»: в Телеграме кнопка «' + k.name + '» ляжет в клавиатуру под полем ввода ' +
            'и придёт ТЕКСТОМ названия — проверка телефона его отбросит раньше любых веток. ' +
            'Убери кнопку с блока, а выход в меню дай на блоке неверного ответа')
        } else if (!ловит) {
          warn('блок «' + b.name + '»: в Телеграме кнопка «' + k.name + '» ляжет в клавиатуру под полем ввода ' +
            'и придёт ТЕКСТОМ названия, а не переходом — нажатие станет ответом шага. Добавь ветку ' +
            '{ cond: "\'[Answer]\' INCLUDE \'' + слова + '\'", nextmessage: ... } без сценария на переходе')
        }
      }
    }
  }
  ok('блоков с запросом телефона: ' + contacts + ', геопозиции: ' + geos + ', настройки верные; своих кнопок в клавиатуре: ' + replyBtns)

  // ── 8ж. Чтение списка стирает ответ подписчика ──────────────────────────
  head('8ж. ОТВЕТ ПОДПИСЧИКА И ЧТЕНИЕ СПИСКА: не стёрт ли ответ перед записью')

  // Чтение списка в переменную сначала ОБНУЛЯЕТ её (oplistsaveclearvar,
  // external.js: SaveInVarList) — и когда строка не нашлась, переменная так
  // и остаётся пустой. Если имя совпало с переменной ответа блока, ответ
  // подписчика пропадает. Ловушка срабатывает там, где проверяют «уже
  // заведён?» и на ветке «нет» записывают анкету: имя водителя, введённое
  // минуту назад, ложится в список пустым (готовый бот такси)
  const answerVars = new Map()
  for (const m of bot.messages) for (const b of blocksOf[m.id]) if (b.answervar) answerVars.set(b.answervar, b.name)
  let clobberChecked = 0
  for (const e of bot.external) {
    const acts = JSON.parse(e.actions)
    const byId = {}
    acts.forEach((a, i) => { byId[a.id] = i })
    const nexts = (c) => (c && c.nextaction && byId[c.nextaction.value] !== undefined) ? [byId[c.nextaction.value]] : []
    acts.forEach((a, i) => {
      for (const op of a.operations || []) {
        if (!op.oplistaction || op.oplistaction.value !== 'readrow' || !op.oplistsaveclearvar || !op.oplistfiltervar) continue
        const F = op.oplistfiltervar
        const стёрты = (op.oplistsaveinvar || []).map(s => s.string).filter(v => v && answerVars.has(v))
        if (!стёрты.length) continue
        clobberChecked++
        // куда идём, когда строка НЕ нашлась
        const conds = a.conditions || []
        const есть1 = new RegExp('#\\{' + F + '\\}\\s*=\\s*1')
        const есть0 = new RegExp('#\\{' + F + '\\}\\s*=\\s*0')
        let start = []
        for (let c = 1; c < conds.length; c++) if (есть0.test(conds[c].cond || '')) start = start.concat(nexts(conds[c]))
        if (!start.length && conds.slice(1).some(c => есть1.test(c.cond || ''))) start = nexts(conds[0])
        if (!start.length) continue
        const seen = new Set()
        const queue = start.slice()
        while (queue.length) {
          const k = queue.shift()
          if (seen.has(k)) continue
          seen.add(k)
          const b = acts[k]
          const text = JSON.stringify(b)
          for (const v of стёрты) {
            if (text.indexOf('#{' + v + '}') === -1 && text.indexOf("varstore['" + v + "']") === -1) continue
            err('«' + e.name + '» / «' + a.name + '»: чтение списка обнуляет #{' + v + '} — ответ блока «' +
              answerVars.get(v) + '», — а когда строка не нашлась, шаг «' + b.name + '» берёт эту переменную. ' +
              'Ответ подписчика туда уже не доедет: читай поле в переменную с другим именем или назови ответ блока иначе')
          }
          for (const c of b.conditions || []) for (const n of nexts(c)) queue.push(n)
        }
      }
    })
  }
  ok('чтений списка в переменные ответов блоков проверено: ' + clobberChecked)

  // ── 8з. Встречные потоки: кнопка-значение и текущий блок ────────────────
  head('8з. ВСТРЕЧНЫЕ ПОТОКИ: не разберёт ли нажатие чужой блок')

  // Кнопку-значение (nextdata) разбирает ТЕКУЩИЙ блок подписчика, а не экран,
  // на котором кнопка показана. Текущий блок сдвигают встречные потоки:
  // уведомления от других подписчиков с кнопками-переходами, переписка,
  // блоки по времени. Водитель написал пассажиру, нажал «Подъезжаю» —
  // значение ушло в переписку (готовый бот такси). Кнопка действия над
  // записью должна вести ПЕРЕХОДОМ на блок-обработчик, а что нажато — в data
  const потоки = []
  let уведомленийСКнопками = 0
  let поВремени = 0
  for (const e of bot.external) {
    for (const a of JSON.parse(e.actions)) {
      for (const c of a.conditions || []) {
        if (c.sendto && (c.sendtobtn || []).length) уведомленийСКнопками++
        if (c.startmestime || c.backnotify || c.startmesnotify) поВремени++
      }
    }
  }
  if (уведомленийСКнопками) потоки.push('уведомления другим подписчикам с кнопками: ' + уведомленийСКнопками)
  if (поВремени) потоки.push('блоки по времени: ' + поВремени)

  // значения кнопок: строкой или набором из кода сценария
  const приставкиЗначения = (e, v) => {
    const мv = /^#\{([^}]+)\}$/.exec(v)
    if (!мv) return [v]
    const out = []
    for (const a of JSON.parse(e.actions)) {
      const код = a.jscode && (typeof a.jscode === 'string' ? a.jscode : a.jscode.data)
      if (!код || String(код).indexOf("varstore['" + мv[1] + "']") === -1) continue
      const re = /['"]([A-Za-zА-Яа-яЁё_]{1,16}~)/g
      let q
      while ((q = re.exec(String(код)))) out.push(q[1])
    }
    return out
  }
  let значенийВсего = 0
  for (const e of bot.external) {
    for (const a of JSON.parse(e.actions)) {
      const кнопки = []
      for (const c of a.conditions || []) {
        for (const b of c.exitbtn || []) if (b.action === 'nextdata') кнопки.push(['экран', b])
        for (const b of c.sendtobtn || []) if (b.action === 'nextdata') кнопки.push(['уведомление', b])
      }
      for (const op of a.operations || []) for (const b of op.oplistsavesendbtn || []) if (b.action === 'nextdata') кнопки.push(['список', b])
      for (const [где, b] of кнопки) {
        значенийВсего++
        const знач = String(b.nextData || '')
        // команды (/start, /menu) разбирает сам движок, а не текущий блок
        if (знач.charAt(0) === '/') continue
        if (где === 'уведомление') {
          // Получатель уведомления стоит где угодно. Годится, только если
          // значение разбирает КАЖДЫЙ блок, ждущий ответа (пульт оператора)
          const ждущие = []
          for (const m of bot.messages) for (const bb of blocksOf[m.id]) if (!bb.dontwaitanswer) ждущие.push(bb)
          const приставки = приставкиЗначения(e, знач).map(p => p.replace(/~.*$/, '~'))
          // Разбирает блок сам — веткой, или сценарий, куда ведёт его «иначе»
          // (пульт оператора: все экраны уводят в разговор, а тот узнаёт
          // значение первым шагом)
          const знаетСценарий = (сц) => !!сц && приставки.some(p => сц.actions.indexOf("'" + p) > -1)
          const разбирает = (bb) => {
            if ((bb.conditionlist || []).slice(1).some(c => приставки.some(p => String(c.cond || '').indexOf(p) > -1))) return true
            const иначе = (bb.conditionlist || [])[0]
            if (!иначе) return false
            if (иначе.externalafter && знаетСценарий(scenOf(иначе.externalafter))) return true
            const цель = иначе.nextmessage && allBlocks[иначе.nextmessage.value] && allBlocks[иначе.nextmessage.value].block
            return !!(цель && цель.externalbefore && знаетСценарий(scenOf(цель.externalbefore)))
          }
          const везде = приставки.length && ждущие.every(разбирает)
          if (!везде) {
            err('«' + e.name + '» / «' + a.name + '»: кнопка «' + b.name + '» в уведомлении другому подписчику — значением (' + знач +
              '). Получатель стоит на любом блоке, и нажатие разберёт он. Сделай переходом на блок с data')
          }
        }
      }
    }
  }
  // Опасно не само нажатие со старого сообщения, а текстовый шаг, который
  // его примет: значение «st~go» уйдёт ответом шага — собеседнику в переписку
  // или в список. Такой шаг ищем: ждёт ответа, у него нет своих веток под
  // значения бота, а ответ дальше отправляется другому подписчику
  const значенияБота = new Set()
  for (const e of bot.external) {
    for (const a of JSON.parse(e.actions)) {
      const все = []
      for (const c of a.conditions || []) for (const b of c.exitbtn || []) if (b.action === 'nextdata') все.push(String(b.nextData || ''))
      for (const op of a.operations || []) for (const b of op.oplistsavesendbtn || []) if (b.action === 'nextdata') все.push(String(b.nextData || ''))
      for (const v of все) {
        if (v.charAt(0) === '/') continue
        for (const p of приставкиЗначения(e, v)) {
          const мп = /^([^~]{1,16}~)/.exec(p)
          if (мп) значенияБота.add(мп[1])
          else if (p && p.indexOf('#{') === -1) значенияБота.add(p)
        }
      }
    }
  }
  const шлёт = (сц, переменная) => {
    if (!сц) return false
    for (const a of JSON.parse(сц.actions)) {
      for (const c of a.conditions || []) {
        if (!c.sendto) continue
        const текст = String(c.sendtomes || '')
        if (текст.indexOf('[Answer]') > -1 || (переменная && текст.indexOf('#{' + переменная + '}') > -1)) return true
      }
    }
    return false
  }
  let текстовыхШагов = 0
  // Пересылка написанного другому подписчику — уже встречный поток, других не ждём
  if (значенияБота.size) {
    for (const m of bot.messages) {
      for (const b of blocksOf[m.id]) {
        if (b.dontwaitanswer) continue
        const иначе = (b.conditionlist || [])[0]
        if (!иначе) continue
        const свои = (b.conditionlist || []).slice(1).map(c => String(c.cond || '')).join(' ')
        if ([...значенияБота].every(p => свои.indexOf(p) > -1)) continue
        // Экран выбора (ветки по значениям или свои кнопки-значения в сценарии)
        // ждёт значение, а не текст: чужое значение там не найдёт записи.
        // Опасен настоящий текстовый шаг — переписка, комментарий
        if (/INCLUDE\s*'[^']*~/.test(свои)) continue
        const сцДо = b.externalbefore && scenOf(b.externalbefore)
        if (сцДо && /"action":"nextdata"/.test(сцДо.actions)) continue
        if ((b.btn || []).some(k => k.action === 'nextdata')) continue
        const цель = иначе.nextmessage && allBlocks[иначе.nextmessage.value] && allBlocks[иначе.nextmessage.value].block
        const перешлёт = шлёт(иначе.externalafter && scenOf(иначе.externalafter), b.answervar) ||
          (цель && цель.id !== b.id && шлёт(цель.externalbefore && scenOf(цель.externalbefore), b.answervar))
        if (!перешлёт) continue
        текстовыхШагов++
        warn('блок «' + b.name + '» пересылает написанное другому подписчику, а в боте есть кнопки-значения (' +
          [...значенияБота].slice(0, 5).join(', ') + '). Нажатие такой кнопки со старого сообщения, ' +
          'пока человек стоит здесь, уйдёт собеседнику текстом. Кнопки действий делай переходом на блок с data')
      }
    }
  }
  ok('кнопок-значений: ' + значенийВсего + (потоки.length ? ', встречные потоки: ' + потоки.join('; ') : ', встречных потоков нет') +
    '; шагов, пересылающих ответ при кнопках-значениях: ' + текстовыхШагов)

  // Кнопка геопозиции и кнопка «точка на карте» в Телеграме — обе
  // request_location (send.js): обе шлют ТЕКУЩЕЕ место. Выбрать точку на карте
  // можно только скрепкой — это объясняют текстом
  for (const m of bot.messages) {
    for (const b of blocksOf[m.id]) {
      const tg = (b.btnsettings || {}).tg || {}
      if (tg.location && tg.venue) {
        err('блок «' + b.name + '»: кнопки «' + (tg.locationtext || 'местоположение') + '» и «' + (tg.venuetext || 'точка на карте') +
          '» в Телеграме делают одно и то же — отправляют текущее место. Оставь одну, а для точки на карте напиши, как её прислать: ' +
          'скрепка 📎 → Геопозиция → выбрать место → «Отправить выбранную геопозицию» (МАКС: скрепка → Место → «Поделиться геолокацией»)')
      }
    }
  }

  // Данные кнопки в Телеграме: всё нажатие не длиннее 64 байт. Подстановку
  // считаем как 10 байт; вышло больше — сообщение с такой кнопкой не уйдёт вовсе
  const байт = (t) => Buffer.byteLength(String(t), 'utf8')
  const сПодстановкой = (t) => String(t || '').replace(/#\{[^}]+\}|\[[A-Za-z]+\d?\]/g, 'XXXXXXXXXX')
  let длиннее = 0
  const нажатие = (b) => {
    if (b.action === 'nextdata') return 'nd+|+' + сПодстановкой(b.nextData) + '+|+'
    if (b.action === 'nextmessage') {
      const цель = typeof b.nextMessage === 'object' && b.nextMessage ? 'nm+|+' + b.nextMessage.value + '+|+' : 'nmn+|' + (String(b.nextMessage || '').startsWith('#{') ? 'XXXXXXXX' : String(b.nextMessage || '')) + '|+'
      return цель + (b.data ? 'da+|' + сПодстановкой(b.data) + '|+' : '')
    }
    return ''
  }
  const проверитьКнопку = (где, b) => {
    const н = нажатие(b)
    if (!н) return
    const мерка = байт(н)
    if (мерка <= 64) return
    // набор из кода: данные неизвестны до запуска — не судим
    if (/^#\{[^}]+\}$/.test(String(b.nextData || b.data || ''))) return
    длиннее++
    warn(где + ': кнопка «' + b.name + '» — нажатие займёт около ' + мерка + ' байт, у Телеграма предел 64. ' +
      'Клади в данные короткий код латиницей, а остальное бери из списка по коду')
  }
  for (const m of bot.messages) for (const b of blocksOf[m.id]) for (const k of b.btn || []) проверитьКнопку('блок «' + b.name + '»', k)
  for (const e of bot.external) {
    for (const a of JSON.parse(e.actions)) {
      for (const c of a.conditions || []) for (const key of ['exitbtn', 'sendtobtn', 'notifybtn']) for (const k of c[key] || []) проверитьКнопку('«' + e.name + '»', k)
      for (const op of a.operations || []) for (const k of op.oplistsavesendbtn || []) проверитьКнопку('«' + e.name + '» (список)', k)
    }
  }
  ok('данных кнопок длиннее 64 байт: ' + длиннее)

  // ── 8е. Трансляция геопозиции ────────────────────────────────────────────
  head('8е. ТРАНСЛЯЦИЯ ГЕОПОЗИЦИИ: кто и куда запишет присланную точку')

  // livegeo — не кнопка, а настройка блока. Включённая, она заставляет
  // движок на КАЖДОЕ обновление координат от Телеграма запускать сценарий
  // этого блока (BotsController, ветка edited_message.location), где бы
  // подписчик в этот момент ни стоял. Отсюда и ловушки
  let liveblocks = 0
  for (const m of bot.messages) {
    for (const b of blocksOf[m.id]) {
      if (!b.btnsettings || !b.btnsettings.tg || !b.btnsettings.tg.livegeo) continue
      liveblocks++
      if (!b.externalbefore) {
        err('блок «' + b.name + '»: включена трансляция геопозиции, но сценария на блоке нет. ' +
          'Точки от Телеграма будут приходить в пустоту — записать их некому')
        continue
      }
      const e = (bot.external || []).find(x => x.name === b.externalbefore.label ||
        String(x.id) === String(b.externalbefore.value))
      if (!e) continue
      const код = String(e.actions || '')
      if (код.indexOf('client_latitude') === -1 && код.indexOf('client_longitude') === -1) {
        err('«' + e.name + '»: сценарий стоит на блоке с трансляцией геопозиции, ' +
          'но не читает client_latitude и client_longitude. Координаты приходят только в них')
      }
      // Сценарий трансляции срабатывает десятки раз подряд. Если его ветки
      // уводят подписчика на другой блок, при каждом обновлении координат
      // его будет выбрасывать с того места, где он стоял
      let назад = false
      let уводит = false
      for (const a of JSON.parse(e.actions || '[]')) {
        for (const c of a.conditions || []) {
          if (!c.exit) continue
          if (c.exittype === 'back') назад = true
          if (c.exittype === 'startmes') уводит = true
        }
      }
      if (!назад) {
        warn('«' + e.name + '»: сценарий трансляции геопозиции нигде не выходит веткой ' +
          '«вернуться в сценарий» (exittype: back). Он срабатывает на каждое обновление ' +
          'координат — без этой ветки подписчика будет сбивать с его шага')
      }
      if (уводит) {
        warn('«' + e.name + '»: сценарий трансляции геопозиции запускает блок ' +
          '(exittype: startmes). Координаты приходят десятки раз подряд, и каждый раз ' +
          'подписчик будет получать этот блок заново')
      }
    }
  }
  ok('блоков с трансляцией геопозиции: ' + liveblocks + (liveblocks ? ', сценарии на месте' : ''))

  // ── 8г. Кнопки навигации ─────────────────────────────────────────────────
  head('8г. КНОПКИ: есть ли чем управлять следующим шагом')

  // Кнопки «Отправить номер телефона», «Отправить месторасположение»
  // и «Точку на карте» живут в клавиатуре ПОД полем ввода, а она уходит,
  // как только сообщению собирают inline-клавиатуру.
  //
  // ВАЖНО, и на этом проверка однажды наврала: inline-клавиатуру собирают
  // НЕ ВСЕГДА. В send.js есть отдельная ветка «Отправляем только текстовое
  // сообщение без кнопок»: там btnrows = [] и contact добавляется независимо
  // от inline. То есть у блока-вопроса без своих кнопок и без медиа кнопка
  // телефона появляется даже при inline: true — и так собран весь каталог.
  // Ошибка настоящая только там, где сообщению И правда достаётся
  // inline-клавиатура: у блока есть свои кнопки или медиа
  let phonechecked = 0
  for (const m of bot.messages) {
    for (const b of blocksOf[m.id]) {
      const bs = b.btnsettings || {}
      const естьКнопки = (b.btn || []).length > 0
      const естьМедиа = (b.media || []).length > 0 || !!b.fileid
      // MAX здесь не проверяется: у него нет настройки inline вовсе,
      // кнопки телефона и месторасположения добавляются всегда
      for (const [mes, name] of [['tg', 'Telegram'], ['vk', 'ВКонтакте']]) {
        const s = bs[mes]
        if (!s || !s.inline) continue
        if (!естьКнопки && !естьМедиа) continue
        const asks = []
        if (s.contact) asks.push('телефона')
        if (s.location) asks.push('месторасположения')
        if (s.venue) asks.push('точки на карте')
        if (!asks.length) continue
        err('блок «' + b.name + '»: кнопка ' + asks.join(' и ') + ' в ' + name +
          ' не появится — у блока есть ' + (естьКнопки ? 'свои кнопки' : 'медиа') +
          ' и включён inline, поэтому сообщению собирают встроенную клавиатуру, ' +
          'а кнопка ' + asks[0] + ' живёт в клавиатуре под полем ввода. ' +
          'Выключи inline у этого блока или убери с него ' + (естьКнопки ? 'кнопки' : 'медиа'))
      }
      phonechecked++
    }
  }
  ok('блоков с запросом телефона и геопозиции проверено: ' + phonechecked)

  // Подписчик не должен листать историю, чтобы вернуться в меню или сделать
  // следующий шаг. У каждого блока в канале с кнопками должна быть хотя бы
  // одна: следующий шаг, «В меню» или «Отмена».
  //
  // Исключения законные: блок, который запрашивает телефон или геопозицию
  // (свои кнопки отменяют этот запрос), и цепочки для каналов без кнопок
  let navchecked = 0
  for (const m of bot.messages) {
    const arr = blocksOf[m.id]
    let anybtn = false
    for (const b of arr) if ((b.btn || []).length > 0) anybtn = true
    if (!anybtn) continue // цепочка для канала без кнопок

    // Разговорная петля бота-оператора: цепочка ловит любое обращение,
    // а блок без кнопок возвращается сам на себя. Это не тупик, а приём
    // сообщений: подписчик пишет, ответ приходит от менеджера снаружи.
    // Шаг, который ведёт только в такую петлю, — тоже часть разговора
    const chain = bot.chains.find(c => c.id === m.BotChainId)
    const talk = new Set()
    if (chain && chain.dialog) {
      for (const b of arr) {
        if ((b.btn || []).length > 0) continue
        if ((b.conditionlist || []).some(c => c.nextmessage && c.nextmessage.value === b.id)) talk.add(b.id)
      }
      for (const b of arr) {
        if ((b.btn || []).length > 0 || talk.has(b.id)) continue
        const goes = (b.conditionlist || []).filter(c => c.nextmessage)
        if (goes.length > 0 && goes.every(c => talk.has(c.nextmessage.value))) talk.add(b.id)
      }
    }

    for (const b of arr) {
      if (talk.has(b.id)) { navchecked++; continue }
      if ((b.btn || []).length > 0) { navchecked++; continue }
      // до недостижимого блока подписчик не доходит — кнопки ему не нужны,
      // а про саму недостижимость уже сказано выше
      if (!reach.has(b.id)) { navchecked++; continue }
      const bs = b.btnsettings || {}
      const asks = (bs.tg && (bs.tg.contact || bs.tg.location || bs.tg.venue)) ||
        (bs.max && (bs.max.contact || bs.max.location))
      if (asks) { navchecked++; continue }
      // проходной блок ответа не ждёт — навигация ему не нужна
      if (b.dontwaitanswer) { navchecked++; continue }
      // Блок, который ничего не показывает (весь текст — [Actions], а сценарий
      // выходит без сообщения), кнопок не требует: их некуда прикрепить.
      // И блок, которому кнопки приходят из сценария (exitbtn), — тоже:
      // они добавляются к кнопкам блока, своя такая же дала бы дубль
      if (b.externalbefore) {
        const sc = scenOf(b.externalbefore)
        if (sc) {
          const onlytpl = ['[Actions]', '[External]'].indexOf(String(b.text || '').trim()) > -1
          if (onlytpl && !/"exitmes":"[^"]+"/.test(sc.actions)) { navchecked++; continue }
          if (/"exitbtn":\[\{/.test(sc.actions)) { navchecked++; continue }
          // Сценарий уводит на другой блок ВСЕМИ выходами — этот блок
          // подписчику не показывается вовсе, тупиком он быть не может.
          // Кнопки ему не нужны: они были бы на невидимом сообщении
          let exits = 0
          let jumps = 0
          for (const a of JSON.parse(sc.actions)) {
            for (const c of a.conditions || []) {
              if (!c.exit) continue
              exits++
              if (c.exittype === 'startmes' && c.startmesnum) jumps++
            }
          }
          if (exits > 0 && jumps === exits) { navchecked++; continue }
        }
      }
      // Шаг анкеты: блок задаёт вопрос и безусловным переходом ведёт
      // на следующий. Тупиком он не является — подписчик отвечает и идёт
      // дальше, — но выйти из анкеты ему нечем. Это неудобство, а не поломка:
      // в готовом боте биржи мастеров так собраны все анкеты
      const анкета = (b.conditionlist || []).some(c => !String(c.cond || '').trim() && c.nextmessage)
      if (анкета) {
        warn('блок «' + b.name + '» без кнопок: ответ уводит дальше по анкете, но выйти из неё ' +
          'нечем — добавь «Отмена» или «В меню», иначе подписчик застрянет в опроснике')
      } else {
        err('блок «' + b.name + '» без кнопок: подписчику нечем перейти дальше или вернуться ' +
          'в меню — он будет листать историю. Добавь кнопку следующего шага или «В меню»')
      }
    }
  }
  ok('блоков с навигацией: ' + navchecked)

  // ── 8в. Достижимость цепочек ─────────────────────────────────────────────
  head('8в. ЦЕПОЧКИ: доберётся ли подписчик до тех, что запускаются словами')

  // Подписчик, стоящий на блоке одной цепочки, пишет слово — и оно уходит
  // как ответ текущему блоку. До ключевых слов другой цепочки дело не доходит,
  // если та цепочка ловит всё подряд (nothandled/dialog)
  const catchall = bot.chains.filter(c => c.nothandled || c.dialog)
  if (catchall.length) {
    for (const c of bot.chains) {
      if (c.nothandled || c.dialog || c.subscription) continue
      const bytag = c.addtagstart && c.addtagstart !== 'null'
      if (bytag) continue
      // Про цепочку совсем без запуска уже сказано проверкой 7. Повторять
      // здесь «запускается только словами» — вводить в заблуждение: слов
      // у неё тоже нет
      const bywords = c.keywords && c.keywords !== 'null' && c.keywords !== '[]'
      if (!bywords) continue
      err('цепочка «' + c.name + '» запускается только словами, а цепочка «' + catchall[0].name +
        '» ловит любое сообщение — слово уйдёт как ответ текущему блоку, и до этой цепочки ' +
        'дело не дойдёт. Нужно: блоки в той же цепочке и кнопка, либо запуск по тегу (addtagstart)')
    }
  }
  ok('цепочек, запускаемых словами при наличии ловящей всё: проверено')

  // ── 9а. Синтаксис условий ────────────────────────────────────────────────
  head('9а. УСЛОВИЯ: союзы, кавычки, регистр')

  // Движок перед вычислением заменяет & на && и | на ||. Поэтому написанное
  // сразу двойным превращается в четверное, выражение не разбирается,
  // и условие молча становится ложным — ветка не срабатывает никогда
  const BADLOGIC = [
    ['&&', 'двойной &&'],
    ['||', 'двойной ||'],
    [' И ', 'слово «И»'],
    [' ИЛИ ', 'слово «ИЛИ»'],
    [' AND ', 'слово AND'],
    [' OR ', 'слово OR']
  ]
  let condcount = 0
  const checkCond = (expr, where, мягко) => {
    const err = мягко ? warn : errRaw
    if (!expr) return
    condcount++
    for (const [bad, what] of BADLOGIC) {
      if (expr.indexOf(bad) > -1) {
        err(where + ': в условии ' + what + ' — движок понимает только одиночные & и |, ' +
          'иначе выражение не вычислится и ветка не сработает никогда: ' + expr)
      }
    }
    const quotes = (expr.match(/'/g) || []).length
    if (quotes % 2 !== 0) err(where + ': в условии нечётное число кавычек: ' + expr)

    // «Не равно» пишется только как !=. Привычное по SQL и по редактору
    // списков «<>» движок не понимает: он меняет = на ==, а «<>» оставляет
    // как есть, jexl такое выражение не разбирает — и условие МОЛЧА
    // становится ложным. Ветка не срабатывает никогда, ошибки в журнале нет.
    //
    // Проверка родилась на боте такси: «водитель не заблокирован» было
    // написано через «<>», и одобренный водитель на линии видел
    // «заказы только для одобренных»
    if (/<>/.test(expr)) {
      err(where + ': в условии «<>» — движок понимает только != , иначе выражение ' +
        'не вычислится и ветка не сработает никогда: ' + expr)
    }

    // КАВЫЧКИ С ОБЕИХ СТОРОН. Движок сравнивает стороны КАК ТЕКСТ, вместе
    // с кавычками (replaceEquals в externalhelpers): '[Answer]' = 'o~close'
    // сравнивает «o~close» с «o~close», а [Answer] = 'o~close' — «o~close»
    // с «'o~close'». Второе не совпадёт никогда, и ветка молча мертва:
    // при «=» она не срабатывает вообще, при «!=» срабатывает всегда.
    // В журнале отладки при этом ничего нет — условие просто ложно.
    //
    // Проверка родилась на боте операторов: пульт не отзывался ни на одну
    // кнопку, потому что все переходы были написаны без кавычек слева
    for (const part of expr.split(/[&|]/)) {
      var кусок = part.trim().replace(/^\(+/, '').replace(/\)+$/, '').trim()
      if (!кусок || /include/i.test(кусок) || кусок.indexOf('<') > -1 || кусок.indexOf('>') > -1) continue
      var знак = кусок.indexOf('!=') > -1 ? '!=' : (кусок.indexOf('=') > -1 ? '=' : '')
      if (!знак) continue
      var стороны = кусок.split(знак)
      if (стороны.length !== 2) continue
      var л = стороны[0].trim()
      var п = стороны[1].trim()
      var вкавычках = (s) => s.length > 1 && s[0] === "'" && s[s.length - 1] === "'"
      if (вкавычках(л) === вкавычках(п)) continue
      var скавычками = вкавычках(л) ? л : п
      var без = скавычками.slice(1, -1)
      // СРАВНЕНИЕ С ПУСТОТОЙ. Долго считалось, что «#{имя} = ''» движок
      // разбирает сам. Проверка на движке показала обратное: пустая сторона
      // не проходит через replaceEquals (isNaN('') === false), выражение
      // уходит в jexl как есть — и подставленный текст читается там как имя
      // переменной. Работает это, только пока в переменной одно слово из букв:
      //
      //   привет != ''              → true (сошло за имя переменной)
      //   привет, не работает != '' → разбор падает → ЛОЖЬ
      //   12:30 != ''               → разбор падает → ЛОЖЬ
      //   (пусто) = ''              → разбор падает → ЛОЖЬ, и ветка
      //                               «значение пустое» не сработает НИКОГДА
      //
      // В кавычках с обеих сторон считается верно при любом тексте.
      // Проверка родилась на третьем боте техподдержки: догоняющее сообщение
      // клиента доходило до оператора, только если было одним словом
      if (!без) {
        err(where + ': сравнение с пустотой без кавычек: ' + кусок +
          ' — движок отдаёт такое выражение как есть, и подставленный текст ' +
          'читается как имя переменной. Сработает, только пока значение — ' +
          'одно слово из букв: запятая, двоеточие, цифры с пробелом или пустое ' +
          'значение ломают разбор, и ветка молча становится ложной. Обе стороны ' +
          'в кавычки: ' + (вкавычках(л) ? л + ' ' + знак + " '" + п + "'" : "'" + л + "' " + знак + ' ' + п))
        continue
      }
      if (/^-?\d+([.,]\d+)?$/.test(без)) {
        warn(where + ': в условии кавычки только с одной стороны: ' + кусок +
          '. Пока в переменной число, это работает, но стоит пустому значению ' +
          'или тексту — ветка замолчит. Надёжнее взять в кавычки обе стороны')
      } else {
        err(where + ': в условии кавычки только с одной стороны: ' + кусок +
          ' — движок сравнивает стороны как текст, вместе с кавычками, поэтому ' +
          (знак === '=' ? 'ветка не сработает НИКОГДА' : 'ветка срабатывает ВСЕГДА') +
          '. Обе стороны в кавычки: ' + (вкавычках(л) ? л + ' ' + знак + " '" + п + "'" : "'" + л + "' " + знак + ' ' + п))
      }
    }
  }
  for (const m of bot.messages) {
    for (const b of blocksOf[m.id]) {
      for (const c of b.conditionlist || []) checkCond(c.cond, 'блок «' + b.name + '»')
    }
  }
  for (const e of bot.external) {
    // в мёртвом сценарии условия проверяем, но ошибкой не считаем:
    // сам сценарий уже назван мусором выше
    const мягко = dead.has(e.name)
    for (const a of JSON.parse(e.actions)) {
      for (const c of a.conditions || []) checkCond(c.cond, '«' + e.name + '» / «' + a.name + '»', мягко)
    }
  }
  ok('условий с выражением: ' + condcount + ', союзы, кавычки и регистр записаны верно')

  // ── 9е. Счётчик отбора — это признак, а не количество ────────────────────
  head('9е. СЧЁТЧИК ОТБОРА: признак «нашлось», а не число строк')

  // Движок кладёт в счётчик отбора «1» или «0» (bcontrolup.js: filteredList2
  // .length > 0 → '1', иначе '0'). Считать им места, остатки и суммы нельзя:
  // «12 мест минус 1» даст 11 при любом числе записавшихся. Число строк
  // берут длиной массива прочитанных строк
  const flagvars = new Set()
  for (const e of bot.external) {
    for (const a of JSON.parse(e.actions)) {
      for (const op of a.operations || []) if (op.oplistfiltervar) flagvars.add(op.oplistfiltervar)
    }
  }
  let flagsused = 0
  for (const e of bot.external) {
    for (const a of JSON.parse(e.actions)) {
      const code = (a.jscode && a.jscode.data) || ''
      for (const v of flagvars) {
        const q = '[\'"]'
        const inarith = new RegExp('(parseInt|parseFloat|Number)\\s*\\(\\s*(String\\s*\\(\\s*)?varstore\\s*\\[\\s*' + q + v + q)
        if (inarith.test(code)) {
          err('«' + e.name + '» / «' + a.name + '»: счётчик отбора #{' + v + '} считается числом, ' +
            'а движок кладёт туда только 1 или 0. Число строк бери длиной массива: ' +
            '[].concat(varstore[…]).length')
        }
      }
      for (const c of a.conditions || []) {
        const cond = String(c.cond || '')
        for (const v of flagvars) {
          if (cond.indexOf('#{' + v + '}') === -1) continue
          flagsused++
          if (/[<>]=?s*([2-9]|dd+)/.test(cond)) {
            err('«' + e.name + '» / «' + a.name + '»: счётчик отбора #{' + v + '} сравнивается с числом ' +
              'больше единицы — там всегда 1 или 0: ' + cond)
          }
        }
      }
    }
  }
  ok('счётчиков отбора: ' + flagvars.size + ', сравнений с ними: ' + flagsused + ', все как признак')

  // ── 9з. Экран со списком ─────────────────────────────────────────────────
  head('9з. СПИСОК НА ЭКРАНЕ: по сообщению на строку, а не массив в текст')

  // Когда действие читает из списка несколько строк, движок кладёт в переменную
  // МАССИВ (external.js: SaveInVarList). В тексте сообщения он подставится
  // как ["Москва","Казань"] — подписчик увидит JSON, а кнопка с таким же
  // массивом в данных не откроет ничего.
  //
  // Списки показывает сам движок: у операции чтения включается «Вывести список
  // в бот» (oplistsavesend). Тогда на каждую строку уходит своё сообщение,
  // и в нём — значения ИМЕННО этой строки, включая данные кнопки
  let screens = 0
  for (const e of bot.external) {
    const acts = JSON.parse(e.actions)

    // переменные, куда читаются строки без ограничения одной
    const many = {}
    for (const a of acts) {
      for (const op of a.operations || []) {
        if (op.type !== 'list' || !op.oplistaction || op.oplistaction.value !== 'readrow') continue
        const one = op.focuscheck && (op.focusonlylast || (+op.focusrowmin === 1 && +op.focusrowmax === 1))
        if (one) continue
        for (const m of op.oplistsaveinvar || []) {
          if (m.string) many[m.string] = { act: a.name, list: op.namelist ? op.namelist.label : '', sends: !!op.oplistsavesend }
        }
      }
      // массивы, собранные кодом: varstore['x'] = <переменная-массив>
      const code = (a.jscode && a.jscode.data) || ''
      for (const m of code.matchAll(/varstore\['([^']+)'\]\s*=\s*([A-Za-z_$][\w$]*)\s*[;\n]/g)) {
        const isArr = new RegExp('var\\s+' + m[2].replace(/\$/g, '\\$') + '\\s*=\\s*\\[').test(code)
        if (isArr) many[m[1]] = { act: a.name, list: 'JS код', sends: false }
      }
    }
    if (Object.keys(many).length === 0) continue

    // Массив в кнопке сам по себе НЕ ошибка: движок разворачивает его
    // в кнопку на строку (externalhelpers.js: BulkBtnSend), но только когда
    // и подпись, и данные кнопки — ЦЕЛИКОМ переменная, без текста вокруг.
    // Подпись из нескольких переменных («#{откуда} → #{куда}») или данные
    // с приставкой («t~#{номер}») развернуть нечем: выйдет одна кнопка
    // на все строки, с JSON внутри
    const bare = (t) => /^\s*#\{[^{}]+\}\s*$/.test(String(t || ''))
    for (const a of acts) {
      for (const c of a.conditions || []) {
        for (const b of (c.exitbtn || []).concat(c.sendtobtn || [])) {
          const data = String(b.nextData || b.nextMessage || b.url || '')
          const inbtn = String(b.name || '') + ' ' + data
          const hit = Object.keys(many).filter(n => inbtn.indexOf('#{' + n + '}') > -1)
          if (!hit.length) continue
          if (bare(b.name) && bare(data)) continue
          screens++
          err('«' + e.name + '» / «' + a.name + '»: кнопка «' + String(b.name).slice(0, 30) + '» подставляет ' +
            hit.map(n => '#{' + n + '}').join(', ') + ' — там строки списка «' + many[hit[0]].list + '». ' +
            'Развернуть по строкам движок их не сможет: выйдет одна кнопка на все строки, с JSON внутри. ' +
            'Включи «Вывести список в бот» у чтения «' + many[hit[0]].act + '»: движок отправит по сообщению ' +
            'на строку и подставит в кнопку номер именно этой строки')
        }
        // Сообщение с такой переменной — замечание, а не ошибка: чаще всего
        // отбор сузили ключом до одной строки, и массива там не будет
        for (const place of [['сообщение выхода', c.exitmes], ['сообщение отправки в бот', c.sendtomes]]) {
          if (!place[1]) continue
          const hit = Object.keys(many).filter(n => String(place[1]).indexOf('#{' + n + '}') > -1)
          if (!hit.length) continue
          warn('«' + e.name + '» / «' + a.name + '»: ' + place[0] + ' подставляет ' +
            hit.map(n => '#{' + n + '}').join(', ') + ' — если отбор вернёт больше одной строки, ' +
            'подписчик увидит ["строка1","строка2"]. Одна строка — сузь отбор до неё, много — выводи «Вывести список в бот»')
        }
      }
    }
  }
  ok('экранов со списком, выведенных массивом в текст: ' + screens)

  // ── 9г2. Выбор из справочника: одно сообщение вместо десяти ──────────────
  //
  // Постраничная отправка шлёт ПО СООБЩЕНИЮ НА СТРОКУ. Для карточки это то,
  // что нужно: своя фотография, описание, цена, несколько кнопок. Но когда
  // от строки требуются только название и кнопка «выбрать», в переписку
  // уходит десять сообщений с одной кнопкой каждое — а тот же выбор
  // помещается в ОДНО сообщение с набором кнопок: имена и значения читаются
  // в две переменные, и движок разворачивает их сам (BulkBtnSend).
  //
  // Признак «это просто выбор»: одна кнопка на строку и короткое сообщение
  // в одну строку. Замечание, а не ошибка: решает всё-таки автор
  let simplerows = 0
  for (const e of bot.external) {
    for (const a of JSON.parse(e.actions)) {
      for (const op of a.operations || []) {
        if (!op.oplistsavesend) continue
        const btns = op.oplistsavesendbtn || []
        const mes = String(op.oplistsavesendmes || '')
        if (btns.length !== 1) continue
        if (mes.indexOf('\n') > -1 || mes.length > 100) continue
        simplerows++
        warn('«' + e.name + '» / «' + a.name + '»: список «' +
          (op.namelist ? op.namelist.label : '') + '» выводится по сообщению на строку, ' +
          'а в строке только текст «' + mes.slice(0, 40) + '» и одна кнопка. ' +
          'Это выбор из справочника: он помещается в одно сообщение с набором кнопок — ' +
          'прочитай название и код в две переменные и подставь их в одну кнопку типа «Значение» ' +
          '(name: "#{названия}", nextData: "#{коды}")')
      }
    }
  }
  ok('постраничных выводов, похожих на простой выбор: ' + simplerows)

  // ── 9д. Документ по шаблону ──────────────────────────────────────────────
  head('9д. ДОКУМЕНТ ПО ШАБЛОНУ: метки и значения')

  // В файле .docx метка пишется фигурными скобками — {номер}, а в действии
  // указывается только ИМЯ, без скобок: движок кладёт значение в data[имя],
  // и подстановку делает easy-template-x. Скобки в имени дадут метку {{номер}},
  // которой в документе нет.
  //
  // Элемент с пустым значением движок пропускает целиком
  // (external.js: if (createdoc[i].name && createdoc[i].value)) — метка
  // останется в готовом документе как есть
  let docitems = 0
  for (const e of bot.external) {
    for (const a of JSON.parse(e.actions)) {
      for (const it of a.createdoc || []) {
        docitems++
        const where = '«' + e.name + '» / «' + a.name + '», метка «' + it.name + '»'
        if (/[{}]/.test(String(it.name || ''))) {
          err(where + ': имя метки записано со скобками. В действии пишется только имя, ' +
            'скобки ставятся в самом файле шаблона: {' + String(it.name).replace(/[{}]/g, '') + '}')
        }
        if (!String(it.name || '').trim()) err('«' + e.name + '» / «' + a.name + '»: у элемента шаблона нет имени метки')
        // Тип — объект { label, value }: движок читает type.value. Строкой
        // элемент не узнаётся, и метка остаётся в документе незаполненной
        if (!it.type || typeof it.type !== 'object' || !it.type.value) {
          err(where + ': тип элемента «' + (typeof it.type === 'object' ? JSON.stringify(it.type) : it.type) +
            '» не объект { label, value } — движок элемент не узнает и метку не заполнит')
        }
        if (it.type && it.type.value === 'variable' && !String(it.value || '').trim()) {
          err(where + ': значение пустое — движок пропустит элемент, и метка останется в документе')
        }
      }
    }
  }
  ok('элементов шаблона документа: ' + docitems)

  // ── 9г. Ссылка на файл ───────────────────────────────────────────────────
  head('9г. МЕДИА: откуда берётся #{media_url} и куда девается файл')

  // В мессенджерах движок обнуляет media_url на каждом входящем сообщении
  // и заполняет её ТОЛЬКО внутри действия «Приём и пересылка медиа»
  // (external.js: reSendMedia → varstore['media_url']). Без этого действия
  // ссылка пустая, а в списке у каждого файла окажется пустая строка.
  //
  // Адресат обязателен по второй причине: копия на сервере удаляется через
  // минуту (deleteFileDelay(60)), ссылка мессенджера истекает ещё раньше.
  // Пересланный файл остаётся в переписке получателя — это и есть хранилище.
  //
  // Каналы-площадки (Avito, WB, Ozon, Циан, TikTok, Instagram) присылают свою
  // ссылку вместе с событием: для них проверка отключается флагом platformmedia
  // Поля imgurl и audiourl движок подставляет ТОЛЬКО у своих типов запроса
  // (external.js: imgurl — «Анализ изображения», audiourl — «Анализ аудио»
  // и «Аудио в текст»). У остальных типов такое поле осталось от копирования
  // сценария и не читается вовсе — считать его чтением ссылки нельзя
  const AIURL = { imgurl: ['Анализ изображения'], audiourl: ['Анализ аудио', 'Аудио в текст'] }
  const aiType = (g) => String((g && g.type && g.type.value) || (g && g.type) || '')
  const liveText = (a) => {
    if (!a.chatgpt) return JSON.stringify(a)
    const copy = JSON.parse(JSON.stringify(a))
    for (const f of Object.keys(AIURL)) {
      if (AIURL[f].indexOf(aiType(copy.chatgpt)) === -1) copy.chatgpt[f] = ''
    }
    return JSON.stringify(copy)
  }

  let mediareads = 0
  for (const e of bot.external) {
    // внутренности мёртвого сценария не считаем ошибками: сам он уже назван
    const err = dead.has(e.name) ? warn : errRaw
    const acts = JSON.parse(e.actions)
    const reads = acts.some(a => liveText(a).indexOf('media_url') > -1)
    if (!reads) {
      // ссылка помянута только в поле, которое этот тип запроса не читает
      if (acts.some(a => JSON.stringify(a).indexOf('media_url') > -1)) {
        warn('«' + e.name + '»: #{media_url} стоит в поле, которого этот тип запроса ' +
          'к нейросети не читает (imgurl — только у «Анализ изображения», audiourl — ' +
          'у «Анализ аудио» и «Аудио в текст»). Поле осталось от копирования сценария, ' +
          'движок его не подставляет — вреда нет, но и смысла тоже')
      }
      continue
    }
    mediareads++
    if (o.platformmedia) continue
    const got = acts.filter(a => a.action && a.action.value === 'sendmedia')
    if (!got.length) {
      err('«' + e.name + '»: читается #{media_url}, но действия «Приём и пересылка медиа» в сценарии нет — ' +
        'ссылка будет пустой. Эту переменную заполняет только оно')
      continue
    }
    // Пустой список адресатов законен: это режим «только получить ссылку»,
    // когда файл тут же уходит на Яндекс или Google Диск. Тогда в сценарии
    // обязано быть действие диска, которое забирает #{media_url}, — иначе
    // через минуту копия удалится и файла не останется нигде
    const todisk = acts.some(a => {
      for (const key of ['gdrive', 'yadisk']) {
        const c = a[key]
        if (!c) continue
        if (JSON.stringify(c).indexOf('media_url') > -1) return true
      }
      return false
    })
    // Ссылку забирает не только диск. Действие «Нейросеть» читает её полями
    // imgurl и audiourl: файл там не хранят — его ПОКАЗЫВАЮТ нейросети,
    // и она успевает скачать его за ту же минуту, пока копия жива.
    // Так собран подсчёт калорий по фото: адресат ему не нужен и не нужен
    // диск, картинка нужна ровно на один запрос
    const toai = acts.some(a => {
      const g = a.chatgpt
      if (!g) return false
      for (const f of Object.keys(AIURL)) {
        if (AIURL[f].indexOf(aiType(g)) === -1) continue
        if (String(g[f] || '').indexOf('media_url') > -1) return true
      }
      return false
    })
    // Третий законный путь — отправка в группу или канал вложением
    // (messagemedia у «Группы и каналы»): мессенджер скачивает файл сразу,
    // и он остаётся в группе. Так приёмная пересылает в тему файл клиента
    // из МАКСа, ВК или с сайта: File ID этих мессенджеров Телеграм не примет
    const togroup = acts.some(a => {
      for (const key of ['tgchannel', 'maxchannel']) {
        const c = a[key]
        if (!c || !Array.isArray(c.messagemedia)) continue
        if (c.messagemedia.some(m => String(m || '').indexOf('media_url') > -1)) return true
      }
      return false
    })
    // То же, но ссылку переносит код: действие JS читает media_url(s)
    // и раскладывает ссылки по переменным, а «Группы и каналы» шлёт их
    // вложениями. Так приёмная отправляет в тему каждый файл альбома
    // отдельным сообщением — ссылок несколько, и прямо #{media_url} в
    // отправке не стоит
    const byjs = acts.some(a => {
      const j = a.jscode
      const код = j ? (typeof j === 'string' ? j : String(j.data || '')) : ''
      return код.indexOf('media_url') > -1
    }) && acts.some(a => {
      for (const key of ['tgchannel', 'maxchannel']) {
        const c = a[key]
        if (c && Array.isArray(c.messagemedia) && c.messagemedia.some(m => String(m || '').trim())) return true
      }
      return false
    })
    for (const a of got) {
      const to = (a.acceptmedia && a.acceptmedia.subscribers) || []
      const emp = a.acceptmedia && a.acceptmedia.to === 'employee'
      // «keep» — файл остаётся на сервере, ссылку кладут в список
      const keep = a.acceptmedia && a.acceptmedia.keep === true
      if (!to.length && !emp && !todisk && !toai && !togroup && !byjs && !keep) {
        err('«' + e.name + '» / «' + a.name + '»: у приёма медиа нет ни адресата, ни сохранения на диск — ' +
          'файл не останется нигде: копия на сервере удаляется примерно через минуту. ' +
          'Либо перешли сотруднику или администратору (ClientID, Messenger, BotID), ' +
          'либо тут же сохрани #{media_url} на Яндекс или Google Диск')
      }
    }
  }
  ok('сценариев, работающих со ссылкой на файл: ' + mediareads)

  // ── 9в. Перенос строки записан двумя символами ───────────────────────────
  head('9в. ПЕРЕНОСЫ СТРОК: настоящие, а не «\\n» в тексте')

  // В выгрузке перенос строки — это сам символ переноса. Если в значение
  // попала пара символов «обратная косая + n» (лишнее экранирование при
  // сборке JSON), подписчик увидит её как есть: «Заявка принята\n\nМы свяжемся»
  // одной строкой. Ошибки нет, сообщение просто выглядит сломанным.
  //
  // JS-код не трогаем: там \n внутри строки кода — это правильно
  const VISIBLE = ['exitmes', 'sendtomes', 'messengermes', 'emailmes', 'notifymes',
    'info', 'event', 'oplistsavesendmes']
  let texts = 0
  const scanLit = (v, where) => {
    if (typeof v !== 'string' || v.indexOf('\\n') === -1) return
    err(where + ': перенос строки записан двумя символами «\\n» — подписчик увидит их в тексте. ' +
      'Ставь настоящий перенос: ' + JSON.stringify(v.slice(0, 80)))
  }
  for (const m of bot.messages) {
    for (const b of blocksOf[m.id]) {
      texts++
      scanLit(b.text, 'блок «' + b.name + '»')
      for (const t of b.btn || []) scanLit(t.name, 'блок «' + b.name + '», кнопка')
    }
  }
  for (const e of bot.external) {
    for (const a of JSON.parse(e.actions)) {
      const copy = JSON.parse(JSON.stringify(a))
      delete copy.jscode
      const seen = new Set()
      const walk = (o) => {
        if (!o || typeof o !== 'object' || seen.has(o)) return
        seen.add(o)
        for (const k of Object.keys(o)) {
          const v = o[k]
          if (typeof v === 'string') {
            if (VISIBLE.indexOf(k) > -1) { texts++; scanLit(v, '«' + e.name + '» / «' + a.name + '» → ' + k) }
          } else walk(v)
        }
      }
      walk(copy)
    }
  }
  ok('проверено текстов: ' + texts + ', переносы строк настоящие')

  // ── 9б. Выражение внутри функции ─────────────────────────────────────────
  head('9б. ПОРЯДОК ЗАМЕН: выражение {{ }} внутри функции [ ]')

  // Замены идут по очереди: переменные → функции [ ] → выражения {{ }}.
  // Значит внутрь функции выражение класть нельзя: к моменту работы функции
  // там ещё «{{ 3 * 60 }}», аргумент не распознаётся, и функция МОЛЧА остаётся
  // строкой. Проверено на живой ExternalSubstitution:
  //   [AddMinutes(20.08.2026 10:00, {{ 3 * 60 }})] → строка как есть
  //   [AddMinutes(20.08.2026 10:00, #{минут})]     → 20.08.2026 13:00
  const badexpr = /\[[A-Za-z]+\([^\]]*\{\{[^\]]*\}\}[^\]]*\)\]/
  let exprchecked = 0
  const scanExpr = (text, where) => {
    if (!text || typeof text !== 'string') return
    if (text.indexOf('{{') === -1) return
    exprchecked++
    if (badexpr.test(text)) {
      err(where + ': выражение {{ }} стоит внутри функции [ ] — функция отработает ' +
        'раньше выражения и молча останется строкой. Посчитай выражение отдельным ' +
        'шагом в переменную, а в функцию подставь переменную: ' + text.slice(0, 120))
    }
  }
  for (const e of bot.external) {
    for (const a of JSON.parse(e.actions)) {
      const where = '«' + e.name + '» / «' + a.name + '»'
      const walk = (v) => {
        if (typeof v === 'string') scanExpr(v, where)
        else if (Array.isArray(v)) v.forEach(walk)
        else if (v && typeof v === 'object') Object.keys(v).forEach(k => walk(v[k]))
      }
      walk(a)
    }
  }
  for (const m of bot.messages) {
    for (const b of blocksOf[m.id]) {
      scanExpr(b.text, 'блок «' + b.name + '»')
      for (const t of b.btn || []) scanExpr(t.url, 'блок «' + b.name + '», кнопка «' + t.name + '»')
      for (const c of b.conditionlist || []) scanExpr(c.cond, 'блок «' + b.name + '», условие')
    }
  }
  ok('мест с выражением {{ }}: ' + exprchecked + ', ни одно не спрятано внутрь функции')

  // ── 9ж. Выдуманная функция-шаблон ────────────────────────────────────────
  head('9ж. ФУНКЦИИ ШАБЛОНОВ: все ли они есть в конструкторе')

  // Замена работает по списку известных функций. Незнакомую движок не трогает
  // вовсе — и в список или в сообщение уходит её ТЕКСТ: «[AddDays(15.08.2026,
  // 14)]» вместо даты. Ошибка молчаливая: компилятор доволен, прогон проходит,
  // а клиент видит квадратные скобки. Имена берём из самого движка, чтобы
  // список не разъезжался с кодом
  const known = new Set(substitutions.names)
  const shapes = {}
  for (const [name, source] of Object.entries(substitutions.shapes)) {
    try { shapes[name] = new RegExp(source) } catch (error) {}
  }
  let funcsseen = 0
  const scanFunc = (text, where) => {
    if (!text || typeof text !== 'string' || text.indexOf('[') === -1) return
    for (const m of text.matchAll(/\[([A-Za-zА-Яа-я]+)\(/g)) {
      funcsseen++
      if (known.size && !known.has(m[1])) {
        err(where + ': функции [' + m[1] + '(…)] в конструкторе нет — движок оставит её текстом. ' +
          'Проверь имя по справочнику подстановок: ' + text.slice(0, 120))
        continue
      }
      // Форма записи: имя есть, а движок вызов не узнаёт. Вырезаем вызов
      // от имени до ближайшей «)]» и примеряем его к образцу движка
      const shape = shapes[m[1]]
      if (!shape) continue
      const at = text.indexOf('[' + m[1] + '(', m.index === undefined ? 0 : m.index)
      if (at === -1) continue
      const end = text.indexOf(')]', at)
      if (end === -1) continue
      const call = text.slice(at, end + 2)
      // Движок видит вызов уже ПОСЛЕ замены переменных и простых шаблонов:
      // порядок замен — переменные, потом функции. Поэтому «#{дней}»
      // к моменту работы функции давно число, и примерять образец
      // к исходному тексту нельзя — получится ложная тревога
      const ready = call.replace(/#\{[^}]*\}/g, '1').replace(/\[[A-Za-zА-Яа-я]+\]/g, '1')
      // вложенная функция внутри вызова: разобрать её здесь нечем,
      // а гадать хуже, чем промолчать
      if (ready.slice(m[1].length + 2).indexOf('(') > -1) continue
      if (!shape.test(ready)) {
        err(where + ': вызов «' + call + '» не совпадает с образцом движка ' + shape +
          ' — функция не сработает и останется в тексте как есть')
      }
    }
  }
  for (const e of bot.external) {
    for (const a of JSON.parse(e.actions)) {
      const where = '«' + e.name + '» / «' + a.name + '»'
      // JS-код пропускаем: замены в нём не работают вовсе (об этом своя
      // проверка), а «[String(…)» после массива читалось бы как функция
      const walk = (v) => {
        if (typeof v === 'string') scanFunc(v, where)
        else if (Array.isArray(v)) v.forEach(walk)
        else if (v && typeof v === 'object') Object.keys(v).forEach(k => { if (k !== 'jscode') walk(v[k]) })
      }
      walk(a)
    }
  }
  for (const m of bot.messages) {
    for (const b of blocksOf[m.id]) {
      scanFunc(b.text, 'блок «' + b.name + '»')
      for (const t of b.btn || []) { scanFunc(t.name, 'блок «' + b.name + '», кнопка'); scanFunc(t.url, 'блок «' + b.name + '», ссылка кнопки') }
      for (const c of b.conditionlist || []) scanFunc(c.cond, 'блок «' + b.name + '», условие')
    }
  }
  ok('вызовов функций-шаблонов: ' + funcsseen + ', все известны конструктору (' + known.size + ' функций)')

  // ── 9з. Сообщение при отложенном запуске ─────────────────────────────────
  head('9з. ОТЛОЖЕННЫЙ ЗАПУСК: сообщение при нём не уходит')

  // С отложенным запуском движок ничего сейчас не отправляет: он запоминает,
  // какой блок и когда запустить, и на этом заканчивает (bcontrolup: после
  // client.update идёт return). Значит exitmes рядом с startmestime — это
  // сообщение, которого подписчик НЕ получит. Ошибка выглядит безобидно:
  // и текст на месте, и напоминание поставлено, а клиент не получил ничего.
  // Ответ и планирование — два разных шага: первый отвечает, второй молчит
  let planned = 0
  for (const e of bot.external) {
    for (const a of JSON.parse(e.actions)) {
      for (const c of a.conditions || []) {
        if (!c.startmestime || !c.startmestimedata) continue
        planned++
        const says = (c.exitmes && String(c.exitmes).trim()) || (c.exitbtn || []).length ||
          (c.exitmedia || []).length || c.exitfileid
        if (says) {
          err('«' + e.name + '» / «' + a.name + '»: при отложенном запуске задано сообщение — ' +
            'подписчик его не получит, движок только планирует блок и заканчивает. ' +
            'Ответь в одном шаге, а отложенный запуск поставь следующим')
        }
      }
    }
  }
  ok('отложенных запусков: ' + planned + ', сообщений при них не задано')

  // ── 9м. Экран, который перерисовывает сам себя ───────────────────────────
  head('9п. НЕЙРОСЕТЬ: молчание должно быть разобрано')

  // Запрос к нейросети стоит денег ВЛАДЕЛЬЦУ бота и может не ответить:
  // кончился баланс, отозван ключ, упал шлюз. Действие возвращает признак
  // в resultvar — и его надо читать ветвлением, иначе подписчик получит
  // пустой экран, а бот пойдёт дальше как ни в чём не бывало.
  let запросов = 0
  for (const e of bot.external || []) {
    let acts
    try { acts = JSON.parse(e.actions) } catch (err) { continue }
    for (const a of acts) {
      if (!a.action || a.action.value !== 'chatgpt' || !a.chatgpt) continue
      запросов++
      const признак = String(a.chatgpt.resultvar || '').trim()
      if (!признак) {
        warn('«' + e.name + '» / «' + (a.name || '') + '»: у запроса к нейросети не задан resultvar. ' +
          'Нейросеть может смолчать — кончился баланс, отозван ключ, упал шлюз, — ' +
          'и подписчик увидит пустой экран. Заведи признак и разбери его ветвлением')
        continue
      }
      // читает ли кто-нибудь этот признак условием
      let читают = false
      for (const c of a.conditions || []) {
        if (String(c.cond || '').indexOf(признак) > -1) читают = true
      }
      if (!читают) {
        for (const b of acts) {
          for (const c of b.conditions || []) {
            if (String(c.cond || '').indexOf(признак) > -1) читают = true
          }
        }
      }
      if (!читают) {
        warn('«' + e.name + '» / «' + (a.name || '') + '»: признак ответа нейросети #{' + признак +
          '} заведён, но ни одна ветка его не читает. Молчание нейросети пройдёт незамеченным')
      }
    }
  }
  if (запросов) ok('запросов к нейросети: ' + запросов + ', молчание разобрано')

  head('9н. ГОТОВЫЙ БОТ: интеграции подставляются только в НЕПУСТОЕ поле')

  // Установщик готового бота (AccountController.setBotTheme) меняет
  // платёжную систему, гугл-аккаунт, CRM, ассистента и диски так:
  //     if (actions[j].payment.name && payment) actions[j].payment.name = payment
  // Пустое поле он пропускает. Значит бот, выложенный в каталог с пустой
  // платёжной системой, у клиента останется без неё — молча, без единой
  // ошибки: ссылки просто не создаются. Заглушка должна быть непустой
  // и ОДНА И ТА ЖЕ во всех действиях, чтобы подстановка легла всюду.
  const ИНТЕГРАЦИИ = [
    ['payment', 'name', 'платёжная система'],
    ['gsheets', 'name', 'гугл-таблицы'],
    ['crm', 'name', 'CRM'],
    ['chatgpt', 'assistant', 'ассистент нейросети'],
    ['gdrive', 'name', 'гугл-диск'],
    ['yadisk', 'name', 'яндекс-диск']
  ]
  let интеграций = 0
  const заглушки = {}
  for (const e of bot.external || []) {
    let acts
    try { acts = JSON.parse(e.actions) } catch (err) { continue }
    for (const a of acts) {
      const тип = a.action && a.action.value
      for (const [ключ, поле, имя] of ИНТЕГРАЦИИ) {
        if (тип !== ключ || !a[ключ]) continue
        // приём платежа систему не выбирает: его зовёт колбек той, что платила
        if (ключ === 'payment' && a.payment.type && a.payment.type.value === 'acceptpay') continue
        // счёт и возврат звёзд выставляет сам бот: платёжная система
        // аккаунта в них не участвует (bcontrolup, starinvoice/starrefund)
        if (ключ === 'payment' && a.payment.type && (a.payment.type.value === 'starinvoice' || a.payment.type.value === 'starrefund')) continue
        // Ассистент нужен нейросети только в режиме «Ответ по файлу»
        // (external.js). В обычном запросе поле не читается вовсе,
        // и требовать его — придирка
        if (ключ === 'chatgpt' && a.chatgpt.type !== 'Ответ по файлу') continue
        интеграций++
        const v = a[ключ][поле]
        if (!v) {
          err('«' + e.name + '» / «' + (a.name || '') + '»: ' + имя + ' не выбрана. ' +
            'В готовом боте это поле НЕ ДОЛЖНО быть пустым: установщик подставляет ' +
            'выбранную клиентом интеграцию только в непустое, и бот останется без неё. ' +
            'Поставь заглушку kit.integration(...)')
          continue
        }
        const ключзаглушки = ключ + '.' + поле
        const снимок = JSON.stringify(v)
        if (!заглушки[ключзаглушки]) заглушки[ключзаглушки] = { снимок: снимок, где: e.name + ' / ' + (a.name || '') }
        else if (заглушки[ключзаглушки].снимок !== снимок) {
          warn('«' + e.name + '» / «' + (a.name || '') + '»: ' + имя + ' отличается от той, ' +
            'что стоит в «' + заглушки[ключзаглушки].где + '». В готовом боте она должна быть ОДНА ' +
            'и та же везде: установщик подставляет клиенту одну выбранную')
        }
      }
    }
  }
  ok('действий с интеграциями: ' + интеграций + ', выбор проставлен везде')

  head('9о. ПРИЁМ ПЛАТЕЖА: на этот блок ничего не ведёт')

  // Блок приёма платежа запускает КОЛБЕК платёжной системы, а не переход.
  // Переход или кнопка на него означают, что подписчик попадёт на приём
  // платежа без платежа: сценарий увидит пустой результат и выдаст отказ.
  let приёмов = 0
  for (const m of bot.messages) {
    const arr = blocksOf[m.id]
    const приём = new Set(arr.filter(b => b.acceptpayment).map(b => b.id))
    if (!приём.size) continue
    приёмов += приём.size
    for (const b of arr) {
      if (приём.has(b.id)) continue
      for (const c of b.conditionlist || []) {
        if (c.nextmessage && приём.has(c.nextmessage.value)) {
          err('блок «' + b.name + '» переходом ведёт на блок приёма платежа «' +
            c.nextmessage.label + '». Приём платежа запускает колбек платёжной системы: ' +
            'убери переход, иначе подписчик попадёт туда без оплаты')
        }
      }
      for (const t2 of b.btn || []) {
        if (t2.nextMessage && приём.has(t2.nextMessage.value)) {
          err('кнопка «' + t2.name + '» блока «' + b.name + '» ведёт на блок приёма платежа. ' +
            'Приём платежа запускает колбек платёжной системы, а не кнопка')
        }
      }
    }
    for (const e of bot.external || []) {
      let acts
      try { acts = JSON.parse(e.actions) } catch (err2) { continue }
      for (const a of acts) {
        for (const c of a.conditions || []) {
          for (const t2 of (c.exitbtn || []).concat(c.sendtobtn || [])) {
            if (t2.nextMessage && приём.has(String(t2.nextMessage))) {
              err('кнопка «' + t2.name + '» сценария «' + e.name + '» ведёт на блок приёма платежа. ' +
                'Приём платежа запускает колбек платёжной системы, а не кнопка')
            }
          }
        }
      }
    }
  }
  ok('блоков приёма платежа: ' + приёмов + ', переходов на них нет')

  // Задержка на самом блоке: до минуты движок держит запрос, от минуты
  // уходит в фон. На ней собирают круги попыток — петли это не даёт
  const ждётЛи = (блок) => {
    const п = parseFloat(String(блок.waitinterval || ''))
    return isFinite(п) && п > 0
  }

  // Умеет ли блок выйти молча: у его сценария есть ветка выхода без
  // сообщения и без кнопок. Такой блок не ждёт человека — переход
  // сработает сам
  const молчитЛи = (блок) => {
    if (блок.dontwaitanswer) return true
    const ссылка = блок.externalbefore
    if (!ссылка) return false
    const сцен = (bot.external || []).find(x => String(x.id) === String(ссылка.value) || x.name === ссылка.label)
    if (!сцен) return false
    let действия
    try { действия = JSON.parse(сцен.actions) } catch (e2) { return false }
    for (const д of действия) {
      for (const у of д.conditions || []) {
        if (!у.exit) continue
        if (у.exittype === 'startmes') continue
        const текст = String(у.exitmes || (у.exitmes === 0 ? 0 : '')).trim()
        const кнопки = (у.exitbtn || []).length
        if (!текст && !кнопки) return true
      }
    }
    return false
  }

  head('9с. КРУГ НАПОМИНАНИЙ: уход на блок без задержки замыкается петлёй')

  // Круг напоминаний собирают так: блок «Напоминание» переходом ведёт
  // на блок «Поставить напоминание», а сценарий этого блока уходит
  // ОБРАТНО на «Напоминание» через startmes с отложенным запуском.
  // Задержка здесь несущая: без неё уход срабатывает сразу, блоки начинают
  // звать друг друга и движок гоняет петлю, пока не упрётся в предел
  // блоков подряд. Снаружи это выглядит как молчащий бот.
  let кругов = 0
  for (const e of bot.external || []) {
    let acts
    try { acts = JSON.parse(e.actions) } catch (err) { continue }
    // на каком блоке стоит этот сценарий
    const хозяева = []
    for (const m of bot.messages) {
      for (const b of blocksOf[m.id]) {
        const ссылки = [b.externalbefore, b.externalafter]
        for (const с of ссылки) {
          if (с && (String(с.value) === String(e.id) || с.label === e.name)) хозяева.push(b)
        }
      }
    }
    if (!хозяева.length) continue
    for (const a of acts) {
      for (const c of a.conditions || []) {
        if (!c.exit || c.exittype !== 'startmes' || !c.startmesnum) continue
        if (c.startmestime && c.startmestimedata) { кругов++; continue }
        // ушли сразу: куда ведёт целевой блок своими переходами
        for (const хозяин of хозяева) {
          for (const m of bot.messages) {
            const цель = blocksOf[m.id].find(b => b.id === String(c.startmesnum))
            if (!цель) continue
            // Петля выходит только если целевой блок умеет выйти МОЛЧА:
            // тогда его переход срабатывает сам. Блок, который спрашивает
            // человека, круг разрывает — это обычная навигация
            if (!молчитЛи(цель)) continue
            // круг, где задержка стоит на блоке, а не в уходе, — законный
            if (ждётЛи(хозяин) || ждётЛи(цель)) continue
            for (const усл of цель.conditionlist || []) {
              if (!усл.nextmessage || String(усл.nextmessage.value) !== String(хозяин.id)) continue
              err('сценарий «' + e.name + '» уходит на блок «' + цель.name + '» без задержки, а тот переходом возвращается на «' + хозяин.name + '» — блоки будут звать друг друга без остановки. Кругу напоминаний нужен отложенный запуск (startmestime), иначе петля замкнётся сразу')
            }
          }
        }
      }
    }
  }
  ok('кругов с отложенным запуском: ' + кругов + ', мгновенных петель нет')

  // Ручная кнопка с data не должна попадать в проходной блок таймерного
  // круга: в MAX нажатие может уйти дальше как ответ текущего блока.
  const таймерныеБезОжидания = new Set()
  for (const e of bot.external || []) {
    let acts
    try { acts = JSON.parse(e.actions) } catch (e2) { continue }
    for (const a of acts) for (const c of a.conditions || []) {
      const id = String(c.startmesnum || '')
      if (c.exittype === 'startmes' && c.startmestime && c.startmestimedata && allBlocks[id] && allBlocks[id].block.dontwaitanswer) таймерныеБезОжидания.add(id)
    }
  }
  let ручныхВТаймер = 0
  for (const e of bot.external || []) {
    let acts
    try { acts = JSON.parse(e.actions) } catch (e2) { continue }
    let динамические = false
    const коды = []
    for (const a of acts) {
      if (a.jscode) коды.push(typeof a.jscode === 'string' ? a.jscode : String(a.jscode.data || ''))
      for (const c of a.conditions || []) {
        for (const btn of (c.exitbtn || []).concat(c.sendtobtn || [])) {
          const to = String(btn.nextMessage || ''), data = String(btn.data || '')
          if (btn.action !== 'nextmessage' || !data) continue
          if (таймерныеБезОжидания.has(to)) {
            ручныхВТаймер++
            err('сценарий «' + e.name + '»: кнопка «' + (btn.name || '') + '» с data ведёт прямо в блок таймерного круга «' + to + '» без ожидания ответа. В MAX нажатие может уйти в разбор текста; ручную команду ведите в обычный блок')
          }
          if (/^#\{[^}]+_блоки\}$/.test(to)) динамические = true
        }
      }
    }
    if (!динамические) continue
    const код = коды.join('\n')
    for (const id of таймерныеБезОжидания) {
      const пункт = new RegExp("\\[[^\\]]*'" + id + "'[^\\]]*'[^']*'[^\\]]*\\]")
      if (!пункт.test(код)) continue
      ручныхВТаймер++
      err('сценарий «' + e.name + '»: набор кнопок с data ведёт в блок таймерного круга «' + id + '» без ожидания ответа. Ручную команду ведите в обычный блок, а этот блок оставьте таймеру')
    }
  }
  if (!ручныхВТаймер) ok('кнопки с data не ведут в блоки таймерного круга без ожидания ответа')

  head('9р. РАСКЛАДКА: блоки не лежат друг на друге')

  // Карточка блока на доске занимает около 200×150, и точный размер считает
  // браузер по содержимому. Два блока ближе 220×180 перекрываются, и старший
  // ложится поверх младшего. Читается это как чужой переход: стрелка приходит
  // в точку, где лежат ДВА блока, и кажется ведущей не туда. Именно так
  // «Дата занятости» выглядела ведущей на приём платежа.
  //
  // Набор сборки разводит блоки сам (kit.spread), проверка нужна на случай
  // правки координат руками
  let наложений = 0
  for (const m of bot.messages) {
    const arr = blocksOf[m.id]
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const dx = Math.abs((+arr[i].x || 0) - (+arr[j].x || 0))
        const dy = Math.abs((+arr[i].y || 0) - (+arr[j].y || 0))
        if (dx < 220 && dy < 180) {
          наложений++
          warn('блоки «' + arr[i].name + '» (' + arr[i].x + ',' + arr[i].y + ') и «' +
            arr[j].name + '» (' + arr[j].x + ',' + arr[j].y + ') лежат друг на друге. ' +
            'Стрелки перехода будут читаться как ведущие не туда: разведи блоки ' +
            'хотя бы на 260 по горизонтали или 200 по вертикали')
        }
      }
    }
  }
  if (!наложений) ok('блоки разведены, наложений нет')

  head('9м. ПЕРЕРИСОВКА ЭКРАНА: замена предыдущего сообщения')

  // Мультисписок, чек-лист, переключатели опций: нажатие возвращает
  // подписчика на тот же блок, и без отметки «Заменить предыдущее сообщение»
  // в переписке копится по копии экрана на каждое нажатие. Старые копии
  // остаются рабочими — человек отмечает галочки в позапрошлом сообщении
  // и не понимает, почему ничего не меняется.
  //
  // Постраничный вывод списка сюда не относится: он шлёт по сообщению
  // на строку и убирает предыдущую страницу сам
  let redraw = 0
  for (const m of bot.messages) {
    for (const b of blocksOf[m.id]) {
      // Экран — это блок с кнопками: технический блок без них тоже бывает
      // с возвратом на себя, но заменять там нечего
      if (!(b.btn || []).length) continue
      const self = (b.conditionlist || []).some(c => c.nextmessage && c.nextmessage.value === b.id)
      if (!self) continue
      // экран со страничным выводом списка убирает себя сам
      const scen = scenOf(b.externalbefore)
      let paged = false
      if (scen) {
        for (const a of JSON.parse(scen.actions)) {
          for (const op of a.operations || []) if (op.oplistsavesend) paged = true
        }
      }
      if (paged) continue
      redraw++
      const s = b.btnsettings || {}
      const tg = (s.tg || {}).replace
      const max = (s.max || {}).replace
      if (!tg || !max) {
        warn('блок «' + (b.name || b.id) + '» перерисовывает сам себя (кнопка ведёт на него же), ' +
          'но «Заменить предыдущее сообщение» стоит не везде: tg=' + !!tg + ', max=' + !!max + '. ' +
          'Без него на каждое нажатие в переписке остаётся ещё одна копия экрана')
      }
    }
  }
  ok('экранов, перерисовывающих себя: ' + redraw)

  // ── 9и. Ветка, которая не сработает никогда ──────────────────────────────
  head('9к. ПЕРЕХОД НА БЛОК: чьё сообщение увидит подписчик')

  // С «Выход → перейти к блоку» движок сначала подставляет своё сообщение
  // в текст целевого блока и только потом запускает сценарий этого блока
  // (bcontrolup.js: mtext = ExternalReturn(...), ниже «Повторяем запуск
  // в.сценария»). Свой ответ целевой сценарий подставит, ТОЛЬКО если текст
  // остался пустым: `if (opt.exittype === 'back' && (!mtext || mtext.length === 0))`.
  // Значит сообщение при переходе перекрывает ответ целевого блока — вместе
  // с кнопками, которые тот собирает из переменных. Экран выбора приходит
  // без единой кнопки, и ошибки нигде не видно
  const buildsButtons = (sc) => {
    for (const a of JSON.parse(sc.actions)) {
      for (const c of a.conditions || []) {
        for (const t of c.exitbtn || []) {
          if (String(t.name || '').indexOf('#{') === 0) return true
        }
      }
    }
    return false
  }
  let jumpsmes = 0
  for (const e of bot.external) {
    for (const a of JSON.parse(e.actions)) {
      for (const c of a.conditions || []) {
        if (c.exittype !== 'startmes' || !c.startmesnum) continue
        if (!c.exitmes || !String(c.exitmes).trim()) continue
        const target = allBlocks[String(c.startmesnum)]
        if (!target) continue
        const sc = scenBefore(target.block)
        if (!sc || !buildsButtons(sc)) continue
        jumpsmes++
        err('«' + e.name + '» / «' + a.name + '»: переход на блок «' + target.block.name +
          '» несёт своё сообщение, а сценарий этого блока собирает кнопки из переменных. ' +
          'Движок подставит сообщение перехода, и кнопки не появятся вовсе. ' +
          'Переходи без своего текста — отвечает сценарий целевого блока')
      }
    }
  }
  ok('переходов на блок с собственным сообщением: ' + jumpsmes + ' — экраны с кнопками не перекрыты')

  // Сценарий, назначенный на ПЕРЕХОД блока (externalafter), СВОИМ сообщением
  // отвечать не умеет. Движок читает у него только «перейти к блоку»
  // (BotsController.js: у ветки разбирается exittype 'startmes'
  // и 'exitparent'), а сообщение выхода не отправляется вовсе: блок уже
  // показан, ответ получен, возвращать текст некуда.
  //
  // «Запустить блок» у него работает целиком — блок-цель показывается
  // со своим сценарием «до запуска» и общим сценарием цепочки
  // (bcontrolup.js: runBlockBefore, с 04.09.2026), поэтому ответить через
  // целевой блок такой сценарий может, и переход на блок с [Actions]
  // ошибкой больше не считается
  let afters = 0
  for (const id of Object.keys(allBlocks)) {
    const b = allBlocks[id].block
    for (const c of b.conditionlist || []) {
      if (!c.externalafter) continue
      const sc = scenOf(c.externalafter)
      if (!sc) continue
      afters++
      for (const a of JSON.parse(sc.actions)) {
        for (const cc of a.conditions || []) {
          if (cc.exit && cc.exitmes && String(cc.exitmes).trim() && cc.exittype !== 'startmes') {
            err('«' + sc.name + '» / «' + a.name + '»: сценарий назначен на переход блока «' + b.name +
              '», а такой сценарий ответить не может — движок его сообщение не отправляет. ' +
              'Перенеси разбор в сценарий «до отправки» следующего блока')
          }
        }
      }
    }
  }
  ok('сценариев на переходе блока: ' + afters + ', сообщений от них не ждём')

  // ── 9т. Отбор по значению с «|» или «&» ──────────────────────────────────
  head('9т. ОТБОР СПИСКА: своё — по автополям, а не по склейке с «|»')

  // Условия отбора движок склеивает строкой, где «|» — это ИЛИ, а «&» — И,
  // и режет её по этим знакам, НЕ ГЛЯДЯ НА КАВЫЧКИ (substitution.js:
  // testExpression → externalhelpers.replaceEquals). Сравнение
  // '555|telegram|9' = '777|telegram|9' превращается в «555 ИЛИ … ИЛИ 9» —
  // истину для ЛЮБОЙ строки. Отбор «своего» по связке
  // [ClientID]|[Messenger]|[BotID] находит чужие строки (посторонний видит
  // кабинет менеджера, как только менеджер вошёл), правка «своей» строки
  // переписывает все. Значение с «&» не совпадает никогда. Проверено
  // на движке 24.09.2026; стенд с одним подписчиком этого не видит.
  //
  // С 24.09.2026 движок прячет «|», «&», «=» внутри кавычек на время разбора
  // (externalhelpers.quoteProtect) — склейка работает. Поэтому здесь
  // ЗАМЕЧАНИЕ, а не ошибка: на сервере без этой правки бот течёт, а автополя
  // работают везде и не требуют своей колонки
  //
  // Склеивать ClientID, Messenger и BotID в одно поле и не нужно: строку,
  // которую добавил сам подписчик, движок подписывает автополями ClientID,
  // Messenger, BotID — по ним «своё» и ищется. Строку, заведённую ЗА другого,
  // адресуют три отдельные колонки
  let безЧерты = 0
  for (const e of bot.external) {
    for (const a of JSON.parse(e.actions)) {
      for (const op of a.operations || []) {
        for (const c of op.oplistcond || []) {
          const val = String(c.oplistvalue || '')
          const pole = String(c.oplistpole || '')
          if (!val.trim()) continue
          const черта = /[|&]/.test(val)
          const связь = /связь/i.test(pole) && /#\{|\[ClientID\]/.test(val)
          if (черта || связь) {
            warn('«' + e.name + '» / «' + a.name + '»: отбор по полю «' + pole + '» = «' + val + '». ' +
              (черта ? 'В значении «|» или «&»' : 'Поле «Связь» хранит связку с «|»') +
              ' — движок до 24.09.2026 резал условие по этим знакам, и сравнение было истинно для любой строки: ' +
              'на старом сервере отбор найдёт чужие строки, правка перепишет все. Своё ищи по автополям ClientID, Messenger, BotID ' +
              '(добавь их в заголовки списка — движок заполнит сам); за другого — по трём отдельным колонкам')
          } else безЧерты++
        }
      }
    }
  }
  ok('условий отбора без «|» и «&»: ' + безЧерты)

  // ── 9у. Кнопки сообщения в группу или канал — массивом ──────────────────
  head('9у. КНОПКИ В ГРУППУ ИЛИ КАНАЛ: массив кнопок, а не строка')
  // Кнопки, собранные кодом, кладут НАБОРОМ: одна кнопка, у которой имя
  // «#{имена}», а переход, значение или ссылка — «#{…}» с JSON-массивами.
  // Строка «#{кнопки}» с JSON объектов в поле btn до 24.09.2026 давала
  // сообщение без кнопок (карточка «Такси в группе» — без «Беру заказ»).
  // Движок её теперь разворачивает (external.groupButtons), но редактор
  // сценария ждёт в поле массив, и на сервере без правки кнопок не будет
  let кнопокМассивом = 0
  for (const e of bot.external) {
    for (const a of JSON.parse(e.actions)) {
      for (const key of ['tgchannel', 'maxchannel']) {
        const c = a[key]
        if (!c || c.btn === undefined || c.btn === null) continue
        if (Array.isArray(c.btn)) { кнопокМассивом++; continue }
        warn('«' + e.name + '» / «' + a.name + '»: кнопки сообщения в группу заданы строкой «' + String(c.btn).slice(0, 40) + '». ' +
          'Собери их набором: одна кнопка с name «#{имена}» и nextData, nextMessage или url — JSON-массивами. ' +
          'Строку движок разворачивает только с 24.09.2026, а редактор сценария её не покажет')
      }
    }
  }
  ok('действий групп и каналов с кнопками массивом: ' + кнопокМассивом)

  // ── 9и. Ветка, которая не сработает никогда ──────────────────────────────
  head('9л. ЧИСЛОВОЙ ОТБОР: сравнение работает только интервалом')

  // Условия отбора движок собирает строкой и кавычки снимает ТОЛЬКО тогда,
  // когда в выражении есть и «больше», и «меньше» (substitution.js:
  // testExpression). С одной границей сравнение идёт как со строками:
  // '13500000' >= '6000000' — ложь, потому что '1' < '6'. Отбор молча
  // выбрасывает половину строк, и ошибку видно только по пустой выдаче.
  //
  // Поэтому у числового поля всегда ДВЕ границы в одной операции.
  // «Без верхнего предела» — это не отсутствие условия, а большое число
  let intervals = 0
  for (const e of bot.external) {
    for (const a of JSON.parse(e.actions)) {
      for (const op of a.operations || []) {
        const byPole = {}
        const ДАТА = /^\s*(\[CurrentDate\]|\d{1,2}[.\-/]\d{1,2}[.\-/]\d{2,4})/
        // Поле-дата узнаётся и по имени. Кроме русских слов сюда входит
        // системное CreationDate: конструктор проставляет его сам и кладёт
        // туда дату дд.мм.гггг (externalhelpers.js: getCreationDate),
        // поэтому одна граница по нему работает так же верно, как «Оплачено до»
        const ПОЛЕДАТА = /дат|срок|до$|период|creationdate|date/i
        // Значение-переменная с датой в имени: #{creationdate}, #{дата_начала}
        const ЗНАЧДАТА = /#\{[^}]*(дат|date|срок)[^}]*\}/i
        for (const c of op.oplistcond || []) {
          const v = c.oplistcomparision && c.oplistcomparision.value
          if (['>', '>=', '<', '<='].indexOf(v) === -1) continue
          const val = String(c.oplistvalue || '')
          ;(byPole[c.oplistpole] = byPole[c.oplistpole] || []).push({
            sign: v,
            date: ДАТА.test(val) || ЗНАЧДАТА.test(val) || ПОЛЕДАТА.test(String(c.oplistpole || ''))
          })
        }
        for (const pole of Object.keys(byPole)) {
          const signs = byPole[pole].map(x => x.sign).join(',')
          if (signs.indexOf('>') > -1 && signs.indexOf('<') > -1) { intervals++; continue }
          // ДАТА — исключение. Движок заменяет дату в выражении на миллисекунды
          // (replaceDates), а у всех дат нашего века это 13 знаков. Строки
          // одинаковой длины сравниваются как числа, поэтому «Оплачено до»
          // >= [CurrentDate] с одной границей работает верно. Проверено
          // на движке: '04.10.2026' >= '04.09.2026' → true
          if (byPole[pole].every(x => x.date)) { intervals++; continue }
          err('«' + e.name + '» / «' + a.name + '»: у поля «' + pole + '» задана только одна ' +
            'граница (' + signs + '). Движок сравнит значения как строки — «13500000» окажется ' +
            'меньше «6000000». Ставь обе границы: «без предела» — это большое число')
        }
      }
    }
  }
  ok('отборов по числовому полю: ' + intervals + ', у каждого обе границы')

  // ── 9я. Повторный разбор одних полей без нового чтения ──────────────────
  head('9я. ЧТЕНИЕ СПИСКА: не разбирать повторно очищенные поля')
  let повторныйРазбор = 0
  for (const e of bot.external) {
    const разобрано = {}
    for (const a of JSON.parse(e.actions)) {
      const естьЧтение = (a.operations || []).some(op => op.type === 'list' && (op.oplistaction || {}).value === 'readrow')
      if (естьЧтение) Object.keys(разобрано).forEach(к => { разобрано[к].чтение = true })
      const j = a.jscode, код = typeof j === 'string' ? j : String((j && j.data) || '')
      const образец = /\bvar\s+([^\s=]+)\s*=\s*скСтроки\s*\(/g
      let найдено
      while ((найдено = образец.exec(код))) {
        const имя = найдено[1]
        if (разобрано[имя] && !разобрано[имя].чтение) {
          повторныйРазбор++
          err('«' + e.name + '» / «' + a.name + '»: переменная «' + имя + '» повторно разбирает поля списка без нового чтения. ' +
            'После очистки сырых полей используй сохранённый JSON либо сначала повтори listRead')
        }
        разобрано[имя] = { чтение: false }
      }
    }
  }
  ok('повторных разборов без нового чтения: ' + повторныйРазбор)

  // ── 9и. Ветка, которая не сработает никогда ──────────────────────────────
  head('9и. ВЕТВЛЕНИЯ: сравнение с тем, что код кладёт в переменную')

  // Частая и невидимая ошибка: JS кладёт в переменную '1' или '0', а условие
  // сравнивает её с чем-то другим. Компилятор доволен, ветка на месте, схема
  // выглядит правильной — и не срабатывает никогда. Смотрим только те
  // переменные, которым код присваивает ТОЛЬКО строковые литералы: там набор
  // значений известен точно, и сравнение с чужим значением — заведомо мёртвая
  // ветка. Считанное из списка или посчитанное числом сюда не попадает
  const litone = /^\s*(['"])([^'"]*)\1\s*$/
  const litternary = /\?\s*(['"])([^'"]*)\1\s*:\s*(['"])([^'"]*)\3\s*$/

  // Переменная, в которую пишет САМО ДЕЙСТВИЕ (resultvar проверки подписки,
  // filtervar отбора в Google Таблице, adminlistvar, commentsvar и прочие
  // поля с «var» на конце), известна коду только по имени: её значение
  // приходит от движка. Код перед действием обычно обнуляет её — и если
  // считать, что код и есть единственный источник, любая ветка «= 1»
  // выглядит мёртвой, хотя единицу кладёт действие. Такие имена в разбор
  // не берём
  function изДействия (узел, куда) {
    if (!узел || typeof узел !== 'object') return куда
    if (Array.isArray(узел)) { for (const э of узел) изДействия(э, куда); return куда }
    for (const к of Object.keys(узел)) {
      const з = узел[к]
      if (typeof з === 'string' && з && (/var$/i.test(к) || к === 'varname' || к === 'vlink')) куда.add(з)
      else if (з && typeof з === 'object') изДействия(з, куда)
    }
    return куда
  }
  let branchchecked = 0
  for (const e of bot.external) {
    const actions = JSON.parse(e.actions)
    const known = {}
    const dirty = new Set()
    for (const a of actions) изДействия(a, dirty)
    for (const a of actions) {
      if (!a.jscode || !a.jscode.data) continue
      for (const m of a.jscode.data.matchAll(/varstore\s*\[\s*['"]([^'"]+)['"]\s*\]\s*=\s*([^\n]*)/g)) {
        const name = m[1]
        const rhs = m[2].trim()
        const one = litone.exec(rhs)
        const tern = litternary.exec(rhs)
        if (one) (known[name] = known[name] || new Set()).add(one[2])
        else if (tern) { (known[name] = known[name] || new Set()).add(tern[2]); known[name].add(tern[4]) } else dirty.add(name)
      }
    }
    for (const a of actions) {
      for (const c of a.conditions || []) {
        const cond = String(c.cond || '').trim()
        if (!cond) continue
        const m = /^#\{([^}]+)\}\s*(=|==)\s*(.+)$/.exec(cond)
        if (!m) continue
        const name = m[1]
        if (dirty.has(name) || !known[name]) continue
        branchchecked++
        const want = m[3].trim().replace(/^['"]|['"]$/g, '')
        if (!known[name].has(want)) {
          err('«' + e.name + '» / «' + a.name + '»: ветка «' + cond + '» не сработает никогда — ' +
            'код кладёт в «' + name + '» только ' + Array.from(known[name]).map(v => '«' + v + '»').join(' или ') +
            '. Сравни с тем, что действительно записывается')
        }
      }
    }
  }
  ok('ветвлений по переменным с известным набором значений: ' + branchchecked + ', мёртвых нет')

  // ── 12. Путь клиента ─────────────────────────────────────────────────────
  // ── 8д. Команда, доступная с нескольких экранов ──────────────────────────
  //
  // Нажатие разбирает ТОТ блок, на котором стоит подписчик, — то есть экран,
  // который он видит. Если команда прописана в переходах одного блока, а
  // кнопка с этой командой показана на другом, с того экрана нажатие уходит
  // по ветке «иначе» и не делает ничего: подписчик жмёт — и тишина.
  //
  // Проверка родилась на боте операторов: пульт разбирал только блок
  // «Разговор», а кнопки пульта показывались на каждом экране
  head('8д. КОМАНДЫ С НЕСКОЛЬКИХ ЭКРАНОВ: разбирает ли их сам экран')

  const литералы = (cond) => (String(cond || '').match(/'([^']+)'/g) || []).map(s => s.slice(1, -1))
  // Значение приходит от нажатия, поэтому разбором считается только сравнение
  // с ответом подписчика: '[Answer]' = 'o~12', [Answer] = 5, '[Data1]' = 'take'.
  // Раньше в разбор попадал любой литерал условия, и '#{_ismedia}' = '1' на
  // чужом блоке «объяснял» кнопку со значением 1 — блок с настоящим разбором
  // при этом объявлялся сломанным. Поймано на боте биржи мастеров
  const ОТВЕТ = /\[(Answer|Data)\d*(\([^)]*\))?\]/i
  const своиЛитералы = (cond) => {
    const части = String(cond || '').split(/[&|]/)
    const итог = []
    for (const часть of части) {
      if (!ОТВЕТ.test(часть)) continue
      for (const л of литералы(часть)) итог.push(л)
      // значение без кавычек: [Answer] = 5, [Answer] = final
      const голое = часть.split(/!=|=/)
      if (голое.length === 2) {
        const правая = голое[1].trim()
        if (правая && правая.indexOf("'") === -1 && правая.indexOf('#{') === -1 && правая.indexOf('[') === -1) итог.push(правая)
      }
    }
    return итог
  }
  const узнаёт = (cond, знач) => своиЛитералы(cond).some(л => л === знач ||
    (/include/i.test(String(cond)) && знач.indexOf(л) > -1))

  const всеБлоки = []
  for (const m of bot.messages) for (const b of blocksOf[m.id]) всеБлоки.push(b)
  const целыйБот = JSON.stringify(bot)

  const действияСценария = {}
  for (const e of bot.external) {
    try { действияСценария[e.name] = JSON.parse(e.actions) } catch (err) { действияСценария[e.name] = [] }
  }
  const свойСценарий = (b) => {
    if (!b.externalbefore) return null
    const s = scenOf(b.externalbefore)
    return s ? (действияСценария[s.name] || null) : null
  }

  // кто вообще разбирает какое значение переходами блока
  const разбирают = {}
  for (const b of всеБлоки) {
    for (const c of b.conditionlist || []) {
      if (!String(c.cond || '').trim() || !c.nextmessage) continue
      for (const л of своиЛитералы(c.cond)) {
        if (!л || л.indexOf('#{') > -1 || л.indexOf('[') > -1) continue
        if (!разбирают[л]) разбирают[л] = new Set()
        разбирают[л].add(b.name)
      }
    }
  }

  let команд = 0
  for (const b of всеБлоки) {
    const acts = свойСценарий(b)
    // кнопки, которые видит подписчик именно на этом экране: свои кнопки
    // блока и кнопки сообщения выхода его сценария
    const кнопки = new Map()
    for (const tb of b.btn || []) {
      if (tb.action === 'nextdata' && tb.nextData) кнопки.set(String(tb.nextData), tb.name)
    }
    for (const a of acts || []) {
      for (const c of a.conditions || []) {
        for (const tb of c.exitbtn || []) {
          if (tb.action === 'nextdata' && tb.nextData) кнопки.set(String(tb.nextData), tb.name)
        }
      }
    }
    // ответ этого блока где-то читают — значит нажатие не потеряно
    const ответЧитают = целыйБот.indexOf('AnswerID(' + b.id + ')') > -1 || !!b.answervar ||
      (b.conditionlist || []).some(c => {
        if (String(c.cond || '').trim() || !c.nextmessage) return false
        const дальше = allBlocks[c.nextmessage.value]
        if (!дальше) return false
        const сц = scenOf(дальше.block.externalbefore)
        return !!сц && (сц.actions.indexOf('[Answer]') > -1 || сц.actions.indexOf('AnswerID(' + b.id + ')') > -1)
      })
    for (const [знач, имя] of кнопки) {
      if (!знач || знач.indexOf('#{') > -1 || знач.indexOf('[') > -1 || знач === '/start') continue
      if (ответЧитают) continue
      if (!разбирают[знач] || разбирают[знач].has(b.name)) continue
      if ((b.conditionlist || []).some(c => c.nextmessage && узнаёт(c.cond, знач))) continue
      if ((acts || []).some(a => (a.conditions || []).some(c => узнаёт(c.cond, знач)))) continue
      команд++
      err('блок «' + b.name + '»: кнопка «' + имя + '» присылает значение ' + знач +
        ', но переходы этого блока его не разбирают — нажатие уйдёт по ветке «иначе» и ничего не сделает. ' +
        'Это значение разбирают ' + Array.from(разбирают[знач]).map(x => '«' + x + '»').join(', ') +
        '. Нажатие разбирает тот блок, на котором стоит подписчик: добавь то же условие сюда')
    }
  }
  ok('команд, доступных с нескольких экранов: ' + команд + ' без разбора на своём экране')

  head('12. ПУТЬ КЛИЕНТА: куда ведёт каждый шаг и откуда там данные')

  // Осмысленный тупик законен: «заявка принята» — нормальное завершение.
  // Ломается не тупик, а цепочка: бот собрал ответ и никуда его не понёс;
  // проверка требует данных, которых на этом пути никто не заполнял;
  // ветка отвечает сообщением, после которого идти некуда.
  //
  // Поэтому путь строится графом: рёбра — переходы блока, кнопки блока,
  // запуск блока из сценария (startmesnum) и кнопки сообщения выхода
  // (exitbtn). Кнопки sendtobtn/notifybtn/messengerbtn ведут ДРУГОГО
  // подписчика — сотрудника, поэтому это отдельные точки входа, а не
  // продолжение пути клиента.

  // 12а. Собранный ответ, который никуда не ведёт.
  // Блок с answervar задаёт вопрос и кладёт ответ в переменную. Если у него
  // нет ни перехода, ни кнопки, ни запуска блока из сценария — подписчик
  // ответил и остался стоять: бот молчит, ошибки нигде нет
  // Ответ бывает нужен и без answervar: следующий сценарий берёт его
  // шаблоном [Answer]. Поэтому вопрос узнаём и по самому блоку — проверке
  // ответа (число, телефон, почта, свой шаблон) и по тексту-просьбе
  // Граница слова \b считается по латинице, поэтому после кириллицы
  // она не срабатывает: явно требуем пробел или знак после слова
  const ASKS = /^\s*(укажите|напишите|введите|пришлите|отправьте|назовите|сообщите)[\s,:.—-]/im
  const asksSomething = (b) => {
    if (b.answervar) return true
    if (b.number || b.email || b.phone || b.regex) return true
    const text = String(b.text || '').trim()
    if (/\?\s*$/.test(text)) return true
    return ASKS.test(text)
  }

  let asked = 0
  for (const id of Object.keys(allBlocks)) {
    const b = allBlocks[id].block
    if (b.dontwaitanswer || !asksSomething(b)) continue
    asked++
    if (!(nextOf[id] || new Set()).size) {
      err('блок «' + b.name + '» ждёт ответа' + (b.answervar ? ' и сохраняет его в #{' + b.answervar + '}' : '') +
        ', но дальше пути нет: ни перехода, ни кнопки, ни запуска блока из сценария. ' +
        'Подписчик ответит — и останется стоять здесь')
    }
  }
  ok('блоков с вопросом: ' + asked + ', у каждого есть продолжение')

  // Кнопка «Значение» (nextdata) не ведёт никуда сама: она присылает текст
  // как ответ на блок, и дальше решает условие перехода. Если переходов
  // у блока нет вовсе, нажатие не делает ничего: ни сообщения, ни движения.
  // Кнопки «Завершить», «Назад», «Ссылка» и «Теги» работают сами по себе
  let datakeys = 0
  for (const id of Object.keys(allBlocks)) {
    const b = allBlocks[id].block
    // Значение «/start» разбирает сам движок: он обнуляет очередь отправок
    // и бот запускается заново (BotsController.js: nd === '/start' →
    // botmessage, дальше сброс nextsend). Это рабочий возврат в начало
    const data = (b.btn || []).filter(t => t.action === 'nextdata' && String(t.nextData || '').trim() !== '/start')
    if (!data.length) continue
    datakeys += data.length
    // значение разбирают условия самого блока и сценарий, который на них
    // навешен: кнопка соседа тут ни при чём — у неё свой переход
    let handled = false
    for (const c of b.conditionlist || []) {
      if (c.nextmessage) handled = true
      if (c.externalafter && scenOf(c.externalafter)) {
        if (jumpsOf(scenOf(c.externalafter)).client.length) handled = true
      }
    }
    if (handled) continue
    err('блок «' + b.name + '»: кнопки ' + data.map(t => '«' + t.name + '»').join(', ') +
      ' присылают значение, но у блока нет перехода, который его разберёт — нажатие не сделает ничего. ' +
      'Дай блоку переход по условию или поставь кнопке действие «Блок»')
  }
  ok('кнопок-значений: ' + datakeys + ', нажатие каждой к чему-то приводит')

  // Значение кнопки приходит на ТЕКУЩИЙ блок, а кнопки прошлых сообщений
  // остаются рабочими: подписчик, стоящий на втором экране выбора, легко
  // нажмёт кнопку с первого. Если экранов с кнопками-значениями несколько,
  // каждый принимающий сценарий обязан узнавать чужие значения и уводить
  // туда, куда человек метил, — иначе он получит «не найдено» на любую кнопку
  const valuescreens = []
  for (const id of Object.keys(allBlocks)) {
    const b = allBlocks[id].block
    const sc = scenBefore(b)
    if (!sc) continue
    let bulk = false
    for (const a of JSON.parse(sc.actions)) {
      for (const c of a.conditions || []) {
        for (const t of c.exitbtn || []) {
          if (t.action === 'nextdata' && String(t.name || '').indexOf('#{') === 0) bulk = true
        }
      }
    }
    if (!bulk) continue
    // список, из которого экран берёт свои кнопки: именно его значения
    // и должен узнавать чужой разбирающий сценарий
    const own = new Set()
    for (const a of JSON.parse(sc.actions)) {
      for (const op of a.operations || []) if (op.namelist && op.namelist.value) own.add(op.namelist.value)
    }
    valuescreens.push({ id: id, lists: own })
  }
  // Блок, в который ведут ТОЛЬКО переходы по условию, чужого нажатия
  // не получит: его отсечёт само условие. Требовать с такого сценария
  // знания чужих значений нечего — ни одно из них до него не доедет
  const onlyByValue = (cid) => {
    let routes = 0
    for (const bid of Object.keys(allBlocks)) {
      for (const c of allBlocks[bid].block.conditionlist || []) {
        if (!c.nextmessage || String(c.nextmessage.value) !== String(cid)) continue
        routes++
        if (!String(c.cond || '').trim()) return false
      }
    }
    // запуск блока из сценария и кнопка «Блок» условие не проверяют
    for (const e of bot.external) {
      const j = jumpsOf(e)
      if (j.client.indexOf(String(cid)) > -1 || j.staff.indexOf(String(cid)) > -1) return false
    }
    for (const bid of Object.keys(allBlocks)) {
      for (const tb of allBlocks[bid].block.btn || []) {
        if (tb.action === 'nextmessage' && String(tb.nextMessage) === String(cid)) return false
      }
    }
    return routes > 0
  }

  if (valuescreens.length > 1) {
    for (const screen of valuescreens) {
      const id = screen.id
      // списки чужих экранов: их значения и надо узнавать
      const foreign = new Set()
      for (const other of valuescreens) {
        if (other.id === id) continue
        for (const l of other.lists) foreign.add(l)
      }
      // куда уходит ответ с этого экрана — там его и разбирают
      const consumers = Array.from(nextOf[id] || [])
      for (const cid of consumers) {
        const sc = scenBefore(allBlocks[cid].block)
        if (!sc) continue
        if (onlyByValue(cid)) continue
        // разбирающим считаем только тот сценарий, который кладёт ответ
        // в переменную и ищет по ней в списке: меню и соседний экран
        // выбора значение не разбирают, и требовать с них нечего
        const answervars = new Set()
        for (const a of JSON.parse(sc.actions)) {
          for (const op of a.operations || []) {
            for (const v of op.varsave || []) {
              if (String(v.value || '').indexOf('[Answer]') > -1 && v.varname) answervars.add(v.varname)
            }
          }
        }
        if (!answervars.size) continue
        // Узнать чужое значение можно только одним способом: поискать его
        // в чужом списке. Переход на соседний экран сам по себе не считается
        const searched = new Set()
        for (const a of JSON.parse(sc.actions)) {
          for (const op of a.operations || []) {
            if (!op.namelist || !op.namelist.value) continue
            for (const c of op.oplistcond || []) {
              for (const v of answervars) {
                if (String(c.oplistvalue || '').indexOf('#{' + v + '}') > -1) searched.add(op.namelist.value)
              }
            }
          }
        }
        // Узнать чужое значение можно двумя честными способами: поискать
        // его в чужом списке или разобрать по приставке значения кнопки
        // (z — занятие, t: — тариф) и увести на чужой экран
        const knowsForeign = Array.from(searched).some(l => foreign.has(l))
        const jsvars = new Set()
        for (const a of JSON.parse(sc.actions)) {
          if (!a.jscode || !a.jscode.data) continue
          const re = /varstore\s*\[\s*['"]([^'"]+)['"]\s*\]\s*=/g
          let mm
          while ((mm = re.exec(a.jscode.data))) jsvars.add(mm[1])
        }
        const targets = new Set()
        for (const other of valuescreens) {
          if (other.id === id) continue
          targets.add(other.id)
          for (const to of nextOf[other.id] || []) targets.add(to)
        }
        // Уход на чужой экран редко стоит прямо в ветке: сначала значение
        // запоминают, читают строку списка, включают режим — и только потом
        // уводят. Поэтому от ветки идём по переходам вперёд, пока не найдём
        // «Выход → перейти к блоку». Ветвление внутри разбора — это тот же
        // разбор, а не другая дорога
        const own = JSON.parse(sc.actions)
        const byId = {}
        for (const a of own) byId[a.id] = a
        const leadsTo = (startid) => {
          const seen = new Set()
          const stack = [startid]
          while (stack.length) {
            const id = stack.pop()
            if (!id || seen.has(id) || !byId[id]) continue
            seen.add(id)
            for (const cc of byId[id].conditions || []) {
              if (cc.exittype === 'startmes' && targets.has(String(cc.startmesnum))) return true
              if (cc.nextaction && cc.nextaction.value) stack.push(cc.nextaction.value)
            }
          }
          return false
        }
        let knowsByPrefix = false
        for (const a of own) {
          for (const c of a.conditions || []) {
            if (!String(c.cond || "").trim()) continue
            const usesparsed = Array.from(jsvars).some(v => String(c.cond).indexOf("#{" + v + "}") > -1)
            if (!usesparsed) continue
            const goes = (c.exittype === "startmes" && targets.has(String(c.startmesnum)))
            if (goes || (c.nextaction && leadsTo(c.nextaction.value))) knowsByPrefix = true
          }
        }
        if (!knowsForeign && !knowsByPrefix) {
          warn('«' + sc.name + '» разбирает значение кнопки, но не узнаёт значения другого экрана выбора. ' +
            'Кнопки прошлых сообщений остаются рабочими: нажатие уйдёт сюда и получит «не найдено». ' +
            'Добавь проверку по чужому списку и переход на его шаг')
        }
      }
    }
    ok('экранов с кнопками-значениями: ' + valuescreens.length + ', чужие значения узнаются')
  }

  // 12б. Данные к моменту чтения.
  // Проверка 4 смотрит порядок ВНУТРИ сценария. Здесь — порядок по пути:
  // добрался подписчик до блока с проверкой, а заполняет нужную переменную
  // шаг из другой ветки, куда этот путь не заходит
  const skipvar = new Set(o.journeyskipvars || [])
  // блоки, на которые попадают не переходом: кнопкой из сообщения бота
  // или выходом «Запустить блок» из сценария
  const приходятСоСтороны = new Set()
  for (const e of bot.external) {
    for (const a of JSON.parse(e.actions)) {
      for (const c of a.conditions || []) {
        if (c.exit && c.exittype === 'startmes' && c.startmesnum) приходятСоСтороны.add(String(c.startmesnum))
        if (c.startmesnotify && c.startmesnotifynum) приходятСоСтороны.add(String(c.startmesnotifynum))
        for (const кн of (c.sendtobtn || []).concat(c.messengerbtn || [], c.exitbtn || [])) {
          const цель = кн.nextMessage && (кн.nextMessage.value || кн.nextMessage)
          if (цель) приходятСоСтороны.add(String(цель))
        }
      }
    }
  }
  let pathvars = 0
  for (const id of Object.keys(allBlocks)) {
    if (!reach.has(id)) continue
    const b = allBlocks[id].block
    // Сообщение блока подставляется после сценария «до», поэтому ему
    // доступно всё, что тот записал. Сценарий «после» запускается уже
    // с ответом подписчика — ему доступен ещё и ответ
    const has = new Set(mayIn[id])
    const sure = new Set(mustIn[id])
    for (const v of genBefore[id]) { has.add(v); sure.add(v) }

    const need = new Set()
    for (const v of reads(b.text)) need.add(v)
    for (const t of b.btn || []) for (const v of reads(t.url || '')) need.add(v)
    const bf = scenBefore(b)
    if (bf) for (const v of scenarioNeeds[bf.name] || []) need.add(v)
    const afterNeed = new Set()
    for (const e of scenAfter(b)) for (const v of scenarioNeeds[e.name] || []) afterNeed.add(v)
    for (const v of afterNeed) {
      if (genAnswer[id].has(v) || has.has(v)) continue
      need.add(v)
    }
    for (const v of need) {
      if (SYSVAR.test(v) || KNOWNVAR.has(v) || skipvar.has(v)) continue
      if (!produced.has(v)) continue // «не заполняет никто» — это проверка 4
      pathvars++
      if (!has.has(v) && !declared.has(v)) {
        const откуда = приходятСоСтороны.has(id)
          ? 'Сюда приходят не переходом, поэтому значение возьмётся из прошлых шагов подписчика'
          : 'Заполняют её в другой ветке, куда этот путь не заходит'
        warn('блок «' + b.name + '»: читается #{' + v + '}, а на пути сюда её никто не заполняет. ' +
          откуда + ' — переменные живут у подписчика всю сессию, так что значение может и найтись. ' +
          'Убедись, что тот шаг он точно проходит, иначе проверка сработает на пустом')
      } else if (!sure.has(v)) {
        warn('блок «' + b.name + '»: #{' + v + '} заполняется не на всех путях сюда — ' +
          'подписчик, пришедший другой дорогой, попадёт на проверку без данных')
      }
    }
  }
  ok('обращений к переменным по пути: ' + pathvars + ', данные есть')

  // Защита работает, только если данные и правда где-то появляются.
  // Проверка «пусто — вернись на шаг N», куда бы она ни вела, зацикливает
  // подписчика, если заполнять переменную больше некому: он ходит
  // по кругу «проверка → шаг → проверка» и никогда не проходит дальше
  let guards = 0
  for (const e of bot.external) {
    for (const v of guardedBy[e.name] || []) {
      if (SYSVAR.test(v) || KNOWNVAR.has(v) || declared.has(v)) continue
      guards++
      if (!produced.has(v)) {
        err('«' + e.name + '»: есть проверка «#{' + v + '} пусто» с возвратом на шаг, ' +
          'но заполнить эту переменную негде — подписчик будет ходить по кругу')
      }
    }
  }
  ok('проверок «данных нет — вернуть на шаг»: ' + guards + ', у каждой есть чем заполниться')

  // 12в. Сообщение, после которого идти некуда.
  // Ветка сценария отвечает подписчику и на этом путь кончается: ни кнопок
  // в самом сообщении, ни перехода на блок, а у блока-хозяина своих кнопок
  // нет. Подписчик прочитал ответ и полез листать историю
  // В каналах без кнопок (Avito, маркетплейсы, WhatsApp) навигации не бывает
  // вовсе: там разговор идёт текстом, и требовать кнопку не с кого
  const withbtn = {}
  for (const m of bot.messages) withbtn[m.id] = blocksOf[m.id].some(b => (b.btn || []).length > 0)
  const msgOf = (id) => allBlocks[id].message.id

  let branches = 0
  for (const e of bot.external) {
    const owners = ownersOf[e.name] || []
    if (!owners.length) continue // вебхук или мини-приложение: у него нет блока
    if (!owners.some(own => withbtn[msgOf(own.id)])) continue
    const ownbtn = owners.some(own => (allBlocks[own.id].block.btn || []).length > 0)
    if (ownbtn) continue
    // Проходной блок ответа не ждёт: он говорит своё и тут же передаёт
    // управление следующему — навигация придёт оттуда
    if (owners.every(own => allBlocks[own.id].block.dontwaitanswer && (nextOf[own.id] || new Set()).size)) continue
    for (const a of JSON.parse(e.actions)) {
      for (const c of a.conditions || []) {
        if (!c.exit || !String(c.exitmes || '').trim()) continue
        branches++
        const goes = (c.exittype === 'startmes' && c.startmesnum) || (c.exitbtn || []).length
        if (!goes) {
          warn('«' + e.name + '» / «' + a.name + '»: ветка отвечает сообщением, но дальше идти некуда — ' +
            'ни кнопок в сообщении выхода, ни перехода на блок, и у блока своих кнопок нет')
        }
      }
    }
  }
  ok('веток сценариев с ответом подписчику: ' + branches)

  // 12г. Возврат в меню.
  // Если в боте есть меню, до него должно быть доступно из любой точки:
  // иначе подписчик, свернувший не туда, уже не вернётся
  // Меню ищем внутри своей цепочки: у рассылки-догрева и у кабинета сотрудника
  // своё начало, и требовать от них дорогу в клиентское меню нечестно
  const menus = new Set()
  const addMenu = (to, name) => {
    if (to && allBlocks[to] && /меню|главн|начал/i.test(String(name || ''))) menus.add(String(to))
  }
  for (const id of Object.keys(allBlocks)) {
    const b = allBlocks[id].block
    for (const t of b.btn || []) addMenu(t.nextMessage && t.nextMessage.value, t.name)
    for (const e of scenariosOn(b)) {
      for (const a of JSON.parse(e.actions)) {
        for (const c of a.conditions || []) {
          for (const t of c.exitbtn || []) addMenu(t.nextMessage, t.name)
        }
      }
    }
  }
  // Дом — это не только блок с названием «меню». Кабинет сотрудника, куда
  // ведёт кнопка «В кабинет», и первый блок цепочки — тоже начало пути:
  // вернувшись туда, подписчик может начать заново
  const homesIn = {}
  const addHome = (id) => { if (allBlocks[id]) (homesIn[msgOf(id)] = homesIn[msgOf(id)] || new Set()).add(String(id)) }
  for (const id of menus) addHome(id)
  for (const id of entries) addHome(id)

  const restarts = (id) => (allBlocks[id].block.btn || [])
    .some(t => t.action === 'nextdata' && String(t.nextData || '').trim() === '/start')

  const ends = []
  let menuchecked = 0
  for (const id of Object.keys(allBlocks)) {
    const mine = homesIn[msgOf(id)]
    if (!mine || !reach.has(id) || mine.has(id)) continue
    if (!withbtn[msgOf(id)]) continue
    if (restarts(id)) continue // кнопка «/start» перезапускает бота — это возврат в начало
    menuchecked++
    const seen = new Set()
    const st = [id]
    let found = false
    while (st.length && !found) {
      const cur = st.pop()
      if (seen.has(cur)) continue
      seen.add(cur)
      for (const to of nextOf[cur] || []) { if (mine.has(to)) { found = true; break } st.push(to) }
    }
    if (!found) ends.push(allBlocks[id].block.name)
  }
  if (!menus.size) ok('меню в боте нет — возврат проверять не с чем')
  else if (ends.length) {
    warn('из этих шагов в меню уже не вернуться: ' + ends.join(', ') +
      '. Если это завершение пути — добавь кнопку «В меню», чтобы подписчик мог начать заново')
  } else ok('меню доступно с любого шага пути (проверено шагов: ' + menuchecked + ')')

  console.log('    точек входа: ' + entries.length + ', достижимо блоков: ' + reach.size +
    ' из ' + Object.keys(allBlocks).length)

  // ── 10. Требования задания ───────────────────────────────────────────────
  if (o.need && o.need.length) {
    head('10. ЗАДАНИЕ: что просили — что есть')
    const whole = JSON.stringify(bot)
    for (const [what, re] of o.need) {
      if (re.test(whole)) ok(what)
      else err('в боте нет: ' + what)
    }
  }

  // ── 11. Проверки конкретного бота ────────────────────────────────────────
  if (typeof o.custom === 'function') {
    head('11. ОСОБЕННОСТИ ЭТОГО БОТА')
    o.custom(bot, { err: err, warn: warn, ok: ok, blocks: allBlocks, blocksOf: blocksOf })
  }

  console.log('\n' + '─'.repeat(70))
  console.log(errors === 0
    ? 'ПРОГОН ПРОЙДЕН. Ошибок нет' + (warns ? ', замечаний: ' + warns : '')
    : 'ОШИБОК: ' + errors + ', замечаний: ' + warns)
  return { errors: errors, warns: warns }
}

module.exports = { run: run }
