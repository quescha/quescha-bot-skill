'use strict'

const { ARRAY_FIELDS, EXPORT_FIELDS } = require('./constants')

function validateExport (bot) {
  const issues = []
  const add = (severity, code, path, message) => issues.push({ severity, code, path, message })
  const error = (code, path, message) => add('error', code, path, message)
  const warn = (code, path, message) => add('warning', code, path, message)

  if (!bot || typeof bot !== 'object' || Array.isArray(bot)) {
    error('E_ROOT', '$', 'Корень экспорта должен быть JSON-объектом')
    return result(issues)
  }
  for (const field of EXPORT_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(bot, field)) error('E_FIELD_MISSING', field, 'Отсутствует обязательное поле')
  }
  if (typeof bot.groupnull !== 'boolean') error('E_GROUPNULL_TYPE', 'groupnull', 'Поле groupnull должно быть boolean')
  for (const field of ARRAY_FIELDS) {
    if (bot[field] !== undefined && !Array.isArray(bot[field])) error('E_FIELD_TYPE', field, 'Поле должно быть массивом')
  }
  if (issues.some(x => x.severity === 'error')) return result(issues)
  if (!bot.groups.length) error('E_GROUPS_EMPTY', 'groups', 'Добавьте хотя бы один проект')

  const recordFields = ['groups', 'chains', 'messages', 'lists', 'listdata', 'global', 'external', 'webapp', 'webapprubric', 'webappdata']
  let malformed = false
  for (const field of recordFields) {
    for (const [i, row] of bot[field].entries()) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) {
        error('E_RECORD_TYPE', `${field}[${i}]`, 'Запись должна быть объектом')
        malformed = true
      }
    }
  }
  if (malformed) return result(issues)

  const idMaps = {}
  for (const field of recordFields) {
    idMaps[field] = indexIds(bot[field], field, error)
  }

  for (const [i, group] of bot.groups.entries()) {
    if (!text(group.name)) error('E_GROUP_NAME', `groups[${i}].name`, 'У проекта должно быть название')
  }

  const externalNames = new Set()
  for (const [i, scenario] of bot.external.entries()) {
    const p = `external[${i}]`
    if (!text(scenario.name)) error('E_EXTERNAL_NAME', `${p}.name`, 'У сценария должно быть название')
    else if (externalNames.has(scenario.name)) error('E_EXTERNAL_DUPLICATE', `${p}.name`, `Повторяется название «${scenario.name}»`)
    else externalNames.add(scenario.name)
    ref(scenario.BotGroupId, idMaps.groups, `${p}.BotGroupId`, error)
    parseJsonString(scenario.actions, `${p}.actions`, value => Array.isArray(value), 'массивом действий', error)
  }

  const blocksByMessage = new Map()
  const blocksByChain = new Map()
  const referencedExternal = new Set()
  for (const [i, message] of bot.messages.entries()) {
    const p = `messages[${i}]`
    ref(message.BotChainId, idMaps.chains, `${p}.BotChainId`, error)
    const blocks = parseJsonString(message.message, `${p}.message`, Array.isArray, 'массивом блоков', error) || []
    blocksByMessage.set(message, blocks)
    if (message.BotChainId !== undefined) {
      if (!blocksByChain.has(message.BotChainId)) blocksByChain.set(message.BotChainId, [])
      blocksByChain.get(message.BotChainId).push({ message, blocks, index: i })
    }
    validateBlocks(blocks, p, externalNames, referencedExternal, error, warn)
  }

  for (const [i, chain] of bot.chains.entries()) {
    const p = `chains[${i}]`
    if (!text(chain.name)) error('E_CHAIN_NAME', `${p}.name`, 'У цепочки должно быть название')
    ref(chain.BotGroupId, idMaps.groups, `${p}.BotGroupId`, error)
    for (const field of ['channel', 'keywords', 'rangedays', 'email', 'messenger']) {
      if (chain[field] !== null && chain[field] !== undefined && chain[field] !== 'null') {
        parseJsonString(chain[field], `${p}.${field}`, () => true, 'JSON-строкой', error)
      }
    }
    const keywords = safeJson(chain.keywords)
    const hasKeywords = Array.isArray(keywords) ? keywords.length > 0 : text(chain.keywords) && chain.keywords !== 'null'
    const tag = safeJson(chain.addtagstart)
    const hasTag = Array.isArray(tag) ? tag.length > 0 : text(chain.addtagstart) && chain.addtagstart !== 'null'
    if (!(chain.subscription || chain.dialog || chain.nothandled || hasKeywords || hasTag)) {
      error('E_CHAIN_TRIGGER', p, 'Цепочке нужен запуск: subscription, dialog, nothandled, keywords или addtagstart')
    }
    const steps = blocksByChain.get(chain.id) || []
    const scenarioSteps = steps.filter(x => x.message.scenario === true && (x.message.scenariotype || 'common') === 'common')
    if (!scenarioSteps.length) error('E_CHAIN_STEP', p, 'У цепочки нет шага со scenario:true')
    if (scenarioSteps.length > 1) error('E_CHAIN_STEPS', p, 'У сценарной цепочки должен быть ровно один общий шаг с блоками')
    for (const step of scenarioSteps) {
      if (!step.blocks.length) error('E_BLOCKS_EMPTY', `messages[${step.index}].message`, 'Шаг не содержит блоков')
      if (!step.blocks.some(b => Number(b.order) === 0)) error('E_BLOCK_ENTRY', `messages[${step.index}].message`, 'Нужен стартовый блок с order:0')
    }
  }

  const listHeaders = new Map()
  for (const [i, list] of bot.lists.entries()) {
    const p = `lists[${i}]`
    if (!text(list.name)) error('E_LIST_NAME', `${p}.name`, 'У списка должно быть название')
    ref(list.BotGroupId, idMaps.groups, `${p}.BotGroupId`, error)
    const headers = parseJsonString(list.headers, `${p}.headers`, Array.isArray, 'JSON-строкой с массивом колонок', error)
    if (headers) {
      listHeaders.set(list.id, headers)
      if (!headers.length || headers.some(h => !text(h))) error('E_LIST_HEADERS', `${p}.headers`, 'Колонки должны быть непустыми строками')
      if (new Set(headers).size !== headers.length) error('E_LIST_HEADER_DUPLICATE', `${p}.headers`, 'Названия колонок не должны повторяться')
    }
  }
  for (const [i, row] of bot.listdata.entries()) {
    const p = `listdata[${i}]`
    ref(row.ListId, idMaps.lists, `${p}.ListId`, error)
    const values = parseJsonString(row.data, `${p}.data`, Array.isArray, 'JSON-строкой с массивом значений', error)
    const headers = listHeaders.get(row.ListId)
    if (values && headers && values.length !== headers.length) {
      error('E_LIST_ROW_LENGTH', `${p}.data`, `Значений: ${values.length}; колонок: ${headers.length}`)
    }
  }

  const globalNames = new Set()
  for (const [i, variable] of bot.global.entries()) {
    const p = `global[${i}]`
    if (!text(variable.name)) error('E_GLOBAL_NAME', `${p}.name`, 'У глобальной переменной должно быть название')
    else if (globalNames.has(variable.name)) error('E_GLOBAL_DUPLICATE', `${p}.name`, `Повторяется переменная «${variable.name}»`)
    else globalNames.add(variable.name)
    ref(variable.BotGroupId, idMaps.groups, `${p}.BotGroupId`, error)
  }

  for (const [field, target, link] of [
    ['webapp', 'groups', 'BotGroupId'], ['webapprubric', 'webapp', 'WebAppId'],
    ['webappdata', 'webapp', 'WebAppId']
  ]) {
    for (const [i, row] of bot[field].entries()) ref(row[link], idMaps[target], `${field}[${i}].${link}`, error)
  }
  for (const [i, row] of bot.webappdata.entries()) {
    if (row.WebAppRubricId !== null && row.WebAppRubricId !== undefined) ref(row.WebAppRubricId, idMaps.webapprubric, `webappdata[${i}].WebAppRubricId`, error)
  }
  for (const [i, app] of bot.webapp.entries()) {
    if (app.settings !== null && app.settings !== undefined) parseJsonString(app.settings, `webapp[${i}].settings`, value => value && typeof value === 'object', 'JSON-строкой с объектом', error)
  }

  for (const scenario of bot.external) {
    if (!referencedExternal.has(scenario.name)) warn('W_EXTERNAL_UNUSED', `external.${scenario.name}`, 'Сценарий не назначен ни одному блоку; webhook-сценарии можно игнорировать')
  }
  scanSecrets(bot, error)
  return result(issues)
}

function validateBlocks (blocks, base, externalNames, referencedExternal, error, warn) {
  const byId = new Map()
  const positions = []
  for (const [i, block] of blocks.entries()) {
    const p = `${base}[${i}]`
    if (!text(block.id) || !/^[A-Za-z0-9]{8}$/.test(block.id)) error('E_BLOCK_ID', `${p}.id`, 'ID блока — 8 латинских букв или цифр')
    else if (byId.has(block.id)) error('E_BLOCK_DUPLICATE', `${p}.id`, `Повторяется ID «${block.id}»`)
    else byId.set(block.id, block)
    if (!text(block.name)) error('E_BLOCK_NAME', `${p}.name`, 'У блока должно быть название')
    if (!Array.isArray(block.conditionlist) || !block.conditionlist.length) error('E_BLOCK_CONDITIONS', `${p}.conditionlist`, 'Нужен хотя бы один элемент conditionlist')
    if (!Array.isArray(block.btn || [])) error('E_BLOCK_BUTTONS', `${p}.btn`, 'Кнопки должны быть массивом')
    if (block.btnsettings && block.btnsettings.tg && !Array.isArray(block.btnsettings.tg.inrow)) {
      error('E_BUTTON_SETTINGS', `${p}.btnsettings.tg.inrow`, 'Полный блок настроек Telegram должен содержать массив inrow')
    }
    positions.push({ block, p })
  }

  const incoming = new Map()
  const edges = new Map()
  const link = (from, target, p, kind) => {
    if (target === null || target === undefined || target === '') return
    const value = target && typeof target === 'object' ? target.value : target
    if (value === null || value === undefined || value === '') return
    if (kind === 'block' && target && typeof target !== 'object') error('E_BLOCK_REF_SHAPE', p, 'Переход блока должен быть объектом {label,value}')
    if (kind === 'action' && typeof target !== 'string') error('E_ACTION_REF_SHAPE', p, 'nextMessage кнопки сценария должен быть строкой')
    const id = String(value)
    if (!byId.has(id)) error('E_BLOCK_TARGET', p, `Блок «${id}» не найден в этом шаге`)
    else {
      if (!edges.has(from)) edges.set(from, new Set())
      edges.get(from).add(id)
      if (!incoming.has(id)) incoming.set(id, [])
      incoming.get(id).push({ from, p })
    }
  }

  for (const [i, block] of blocks.entries()) {
    const p = `${base}[${i}]`
    for (const [j, condition] of (block.conditionlist || []).entries()) {
      link(block.id, condition.nextmessage, `${p}.conditionlist[${j}].nextmessage`, 'block')
      scenarioRef(condition.externalafter, `${p}.conditionlist[${j}].externalafter`, externalNames, referencedExternal, error)
    }
    for (const [j, button] of (block.btn || []).entries()) {
      if (button.action === 'nextmessage') link(block.id, button.nextMessage, `${p}.btn[${j}].nextMessage`, 'block')
    }
    if (block.wronganswer) link(block.id, block.wronganswer, `${p}.wronganswer`, 'block')
    scenarioRef(block.externalbefore, `${p}.externalbefore`, externalNames, referencedExternal, error)
    if (String(block.text || '').includes('[Actions]') && !block.externalbefore) {
      error('E_ACTIONS_PLACEHOLDER', `${p}.text`, '[Actions] требует externalbefore')
    }
  }

  for (const block of blocks) {
    if (!block.acceptpayment) continue
    for (const source of incoming.get(block.id) || []) error('E_PAYMENT_INCOMING', source.p, `На блок приёма платежа «${block.name}» ничего не должно вести`)
  }
  for (let i = 0; i < positions.length; i++) {
    for (let j = i + 1; j < positions.length; j++) {
      const a = positions[i]
      const b = positions[j]
      if (Math.abs((+a.block.x || 0) - (+b.block.x || 0)) < 220 && Math.abs((+a.block.y || 0) - (+b.block.y || 0)) < 180) {
        error('E_BLOCK_OVERLAP', `${a.p},${b.p}`, `Блоки «${a.block.name}» и «${b.block.name}» перекрываются`)
      }
    }
  }

  const entries = blocks.filter(b => Number(b.order) === 0 || b.acceptpayment).map(b => b.id)
  const seen = new Set()
  const queue = entries.slice()
  while (queue.length) {
    const id = queue.shift()
    if (seen.has(id)) continue
    seen.add(id)
    for (const next of edges.get(id) || []) if (!seen.has(next)) queue.push(next)
  }
  for (const block of blocks) {
    if (!seen.has(block.id)) warn('W_BLOCK_UNREACHABLE', `${base}.${block.id}`, `Блок «${block.name}» недостижим из точек входа`)
  }
}

function scenarioRef (value, path, names, used, error) {
  if (!value) return
  if (typeof value !== 'object' || !text(value.label)) {
    error('E_SCENARIO_REF_SHAPE', path, 'Ссылка на сценарий должна быть объектом {label,value}')
    return
  }
  if (!names.has(value.label)) error('E_SCENARIO_TARGET', path, `Сценарий «${value.label}» не найден`)
  else used.add(value.label)
}

function indexIds (rows, field, error) {
  const map = new Map()
  for (const [i, row] of rows.entries()) {
    if (!Number.isInteger(row.id) || row.id <= 0) error('E_RECORD_ID', `${field}[${i}].id`, 'ID записи должен быть положительным целым числом')
    else if (map.has(row.id)) error('E_RECORD_DUPLICATE', `${field}[${i}].id`, `Повторяется ID ${row.id}`)
    else map.set(row.id, row)
  }
  return map
}

function ref (value, map, path, error) {
  if (!map.has(value)) error('E_RECORD_REF', path, `Ссылка ${JSON.stringify(value)} не найдена`)
}

function parseJsonString (value, path, predicate, expected, error) {
  if (typeof value !== 'string') {
    error('E_NESTED_JSON_TYPE', path, `Значение должно быть ${expected}, сохранённым в JSON-строке`)
    return null
  }
  try {
    const parsed = JSON.parse(value)
    if (!predicate(parsed)) error('E_NESTED_JSON_SHAPE', path, `Внутри строки должен быть ${expected}`)
    return parsed
  } catch (e) {
    error('E_NESTED_JSON_PARSE', path, `Некорректная вложенная JSON-строка: ${e.message}`)
    return null
  }
}

function safeJson (value) {
  if (typeof value !== 'string') return value
  try { return JSON.parse(value) } catch (e) { return null }
}

function scanSecrets (value, error, path = '$') {
  if (typeof value === 'string') {
    const patterns = [
      ['E_SECRET_PRIVATE_KEY', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
      ['E_SECRET_TELEGRAM', /\b\d{6,12}:[A-Za-z0-9_-]{30,}\b/],
      ['E_SECRET_API_KEY', /\b(?:sk-[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{20,}|AKIA[A-Z0-9]{16})\b/],
      ['E_SECRET_JWT', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/]
    ]
    for (const [code, pattern] of patterns) if (pattern.test(value)) error(code, path, 'Похоже на секрет. Оставьте placeholder и настройте значение в аккаунте')
    return
  }
  if (Array.isArray(value)) value.forEach((v, i) => scanSecrets(v, error, `${path}[${i}]`))
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) scanSecrets(v, error, `${path}.${k}`)
}

function text (value) { return typeof value === 'string' && value.trim().length > 0 }
function result (issues) {
  return {
    ok: !issues.some(x => x.severity === 'error'),
    errors: issues.filter(x => x.severity === 'error').length,
    warnings: issues.filter(x => x.severity === 'warning').length,
    issues
  }
}

module.exports = { validateExport }
