'use strict'

const vm = require('vm')
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads')
const { builders, defaults, enums, randomId, clone, ref, noteFix, takeFixes } = require('./builders')
const emptyCondition = require('./schema/condition.json')

const JS_KEYS = ['then', 'catch', 'finally', 'constructor', 'valueOf', 'toString', 'toJSON', 'inspect', 'length', 'name', 'nodeType', 'prototype']
const DATA_KEYS = ['length', 'map', 'forEach', 'filter', 'find', 'findIndex', 'reduce', 'some', 'every', 'slice', 'splice', 'push', 'pop', 'shift', 'join', 'sort', 'reverse', 'concat', 'indexOf', 'includes', 'rows', 'items', 'list', 'result', 'results', 'count', 'total', 'first', 'last', 'entries', 'keys', 'values']
const FINISH_WORDS = ['done', 'end', 'finish', 'exit', 'stop', 'return', 'конец', 'выход', 'готово', 'стоп']
const SPEC_KEYS = ['type', 'name', 'label', 'config', 'done', 'next', 'branches']
const BRANCH_KEYS = ['cond', 'next', 'done']
const ARG_MAP = {
  listRead: [['listid', 'list', 'listId', 'list_id', 'название', 'список', 'id'], ['save', 'fields', 'поля', 'map', 'columns', 'cols', 'vars'], ['where', 'cond', 'conds', 'отбор', 'filter', 'query'], ['opts', 'options']],
  listAdd: [['listid', 'list', 'listId', 'list_id', 'название', 'список', 'id'], ['fields', 'data', 'row', 'поля', 'values', 'значения'], ['opts', 'options']],
  listEdit: [['listid', 'list', 'listId', 'list_id', 'название', 'список', 'id'], ['where', 'cond', 'conds', 'отбор', 'filter', 'query'], ['changes', 'set', 'updates', 'data', 'fields', 'правки'], ['opts', 'options']],
  listDelete: [['listid', 'list', 'listId', 'list_id', 'название', 'список', 'id'], ['where', 'cond', 'conds', 'отбор', 'filter', 'query'], ['opts', 'options']],
  listFind: [['listid', 'list', 'listId', 'list_id', 'название', 'список', 'id'], ['where', 'cond', 'conds', 'отбор', 'filter', 'query'], ['opts', 'options']],
  setVar: [['name', 'имя', 'var', 'variable', 'key'], ['value', 'значение', 'val']],
  setGlobal: [['globalref', 'global', 'name', 'имя', 'key'], ['value', 'значение', 'val']]
}
const SIMPLE = {
  setvariable: 'setVar', setvar: 'setVar', variable: 'setVar', setvalue: 'setVar',
  setvariables: 'setVars', setvars: 'setVars', setglobalvariable: 'setGlobal',
  setglobalvar: 'setGlobal', global: 'setGlobal', jscode: 'js', code: 'js',
  script: 'js', runjs: 'js', request: 'http', httprequest: 'http', api: 'http',
  fetchurl: 'http', gpt: 'ai', neuro: 'ai', chatgpt: 'ai', neural: 'ai',
  noop: 'ops', empty: 'ops', nothing: 'ops', operations: 'ops'
}
const LIST_VERBS = {
  read: 'Read', get: 'Read', load: 'Read', fetch: 'Read', select: 'Read',
  find: 'Find', search: 'Find', add: 'Add', create: 'Add', new: 'Add',
  insert: 'Add', append: 'Add', push: 'Add', edit: 'Edit', update: 'Edit',
  change: 'Edit', modify: 'Edit', save: 'Edit', delete: 'Delete',
  remove: 'Delete', del: 'Delete', drop: 'Delete'
}
const LIST_NOUNS = ['list', 'row', 'record', 'rows', 'records', 'table', 'item', 'items', 'lists']

class Ref {
  constructor (value, label, index) {
    this.value = value
    this.label = label
    if (index !== undefined && index !== null) this.index = index
  }
  toString () { return String(this.value) }
  valueOf () { return this.value }
  toJSON () { return this.value }
}

function namesFrom (bot) {
  const out = { lists: {}, webapps: {}, rubrics: {}, blocks: {}, chains: {}, groups: {}, globals: {} }
  const put = (target, rows) => {
    for (const row of Array.isArray(rows) ? rows : []) {
      if (!row || row.name === undefined || row.name === null || row.id === undefined || target[row.name] !== undefined) continue
      target[row.name] = row.ordernumber === undefined || row.ordernumber === null ? row.id : { id: row.id, index: row.ordernumber }
    }
  }
  put(out.lists, bot.lists)
  put(out.webapps, bot.webapp)
  put(out.rubrics, bot.webapprubric)
  put(out.blocks, bot.messages)
  put(out.chains, bot.chains)
  put(out.groups, bot.groups)
  put(out.globals, bot.global)
  return out
}

function makeContext (data, missing) {
  const wrap = (kind, rows) => new Proxy(rows || {}, {
    get (target, key) {
      if (typeof key !== 'string') return target[key]
      if (Object.prototype.hasOwnProperty.call(target, key)) {
        const value = target[key]
        if (value && typeof value === 'object') return new Ref(value.id, key, value.index)
        return new Ref(value, key)
      }
      missing.push(kind + ' не найден: ' + key)
      return new Proxy({}, {
        get (_, property) {
          if (typeof property !== 'string' || JS_KEYS.includes(property)) return undefined
          throw new Error(`Нет такого имени: ${kind} «${key}». Доступно: ${Object.keys(target).join(', ') || 'ничего'}`)
        }
      })
    }
  })
  const ctx = {
    lists: wrap('список', data.lists), webapps: wrap('приложение', data.webapps),
    rubrics: wrap('рубрика', data.rubrics), blocks: wrap('блок', data.blocks),
    chains: wrap('цепочка', data.chains), groups: wrap('группа', data.groups),
    globals: wrap('глобальная переменная', data.globals)
  }
  ctx.list = ctx.lists
  ctx.webapp = ctx.webapps
  ctx.rubric = ctx.rubrics
  ctx.block = ctx.blocks
  ctx.chain = ctx.chains
  ctx.group = ctx.groups
  ctx.global = ctx.globals
  ctx.variables = ctx.globals
  return ctx
}

function canonicalName (name) {
  const low = String(name).toLowerCase().replace(/[_\-\s]/g, '')
  if (Object.prototype.hasOwnProperty.call(builders, name)) return name
  if (SIMPLE[low]) return SIMPLE[low]
  const exact = Object.keys(builders).find(key => key.toLowerCase() === low)
  if (exact) return exact
  for (const [verb, mapped] of Object.entries(LIST_VERBS)) {
    for (const noun of LIST_NOUNS) {
      if (low !== verb + noun && low !== noun + verb) continue
      const real = 'list' + mapped
      if (typeof builders[real] === 'function') return real
    }
  }
  return ''
}

function listRef (value, data) {
  if (value && typeof value === 'object') return value
  const lists = data.lists || {}
  const text = String(value === undefined || value === null ? '' : value).trim()
  if (!text) return null
  if (Object.prototype.hasOwnProperty.call(lists, text)) return { value: lists[text], label: text }
  const name = Object.keys(lists).find(key => String(lists[key]) === text)
  if (name) return { value: lists[name], label: name }
  throw new Error(`Списка «${text}» нет. Используй ctx.lists["Название"]`)
}

function spreadArgs (name, object, data) {
  const map = ARG_MAP[name]
  if (!map || !object || typeof object !== 'object' || Array.isArray(object)) return null
  const keys = Object.keys(object)
  if (!keys.length) return null
  const used = new Set()
  const args = []
  let found = 0
  for (const synonyms of map) {
    const key = synonyms.find(candidate => Object.prototype.hasOwnProperty.call(object, candidate))
    if (key) {
      args.push(object[key])
      used.add(key)
      found++
    } else args.push(undefined)
  }
  if (!found) return null
  const where = {}
  let hasWhere = false
  for (const key of keys) {
    if (used.has(key)) continue
    if (!['last', 'tolast', 'from', 'to', 'sort', 'unique', 'filtervar', 'limit'].includes(key)) return null
    where[key] = object[key]
    used.add(key)
    hasWhere = true
  }
  if (name.startsWith('list')) {
    args[0] = listRef(args[0], data)
    let index = name === 'listRead' || name === 'listAdd' ? 2 : 1
    if (name === 'listAdd') index = -1
    if (hasWhere && index > -1) args[index] = Object.assign(Array.isArray(args[index]) ? { conds: args[index] } : {}, args[index] || {}, where)
    if (index > -1 && Array.isArray(args[index])) args[index] = { conds: args[index] }
  }
  return args
}

function inertConfig (config, name) {
  return new Proxy(config, {
    get (target, key) {
      if (typeof key !== 'string') return target[key]
      if (Object.prototype.hasOwnProperty.call(target, key)) return target[key]
      if (DATA_KEYS.includes(key) || /^\d+$/.test(key)) {
        throw new Error(`qb.cfg.${name}(...) возвращает настройку, а не данные. Ветвление задаётся через branches`)
      }
      if (JS_KEYS.includes(key)) return target[key]
      return target[key]
    }
  })
}

function configProxy (data) {
  return new Proxy(builders, {
    get (target, key) {
      if (typeof key !== 'string') return target[key]
      const real = canonicalName(key)
      if (!real) {
        if (JS_KEYS.includes(key)) return undefined
        throw new Error(`Нет сборщика qb.cfg.${String(key)}. Действие задаётся через qb.step`)
      }
      return (...input) => {
        let args = input
        if (args.length === 1) {
          const spread = spreadArgs(real, args[0], data)
          if (spread) {
            args = spread
            noteFix(`qb.cfg.${String(key)}: аргументы объектом разложены по местам`)
          }
        }
        if (String(key) !== real) noteFix(`qb.cfg.${String(key)} собран как qb.cfg.${real}`)
        const result = builders[real](...args)
        return result && typeof result === 'object' && !Array.isArray(result) ? inertConfig(result, real) : result
      }
    }
  })
}

function unknownKeys (object, allowed, where, problems) {
  for (const key of Object.keys(object || {})) {
    if (!allowed.includes(key)) problems.push(`Неизвестное поле «${key}» ${where}. Допустимые: ${allowed.join(', ')}`)
  }
}

function actionLabel (type) {
  const item = enums.action.find(x => x.value === type)
  return item ? item.label : type
}

function fillCondition (done, expression, nextid, problems, where) {
  const condition = clone(emptyCondition)
  for (const key of Object.keys(done || {})) {
    if (key === 'cond' || key === 'nextaction') continue
    if (!Object.prototype.hasOwnProperty.call(condition, key)) {
      problems.push(`Неизвестное поле «${key}» в done ${where}`)
      continue
    }
    condition[key] = done[key]
  }
  condition.cond = expression || ''
  condition.nextaction = nextid ? { label: 'Далее', value: nextid } : null
  return condition
}

function linkSteps (items) {
  const actions = []
  const labels = new Map()
  const problems = []
  const jump = (label, where) => {
    if (label === undefined || label === null || label === '') return null
    if (labels.has(label)) return labels.get(label)
    if (FINISH_WORDS.includes(String(label).toLowerCase())) {
      noteFix(`Переход «${label}» понят как конец сценария`)
      return null
    }
    problems.push(`Переход на несуществующий шаг «${label}» (${where})`)
    return null
  }
  for (const [index, item] of items.entries()) {
    const spec = item.spec || {}
    unknownKeys(spec, SPEC_KEYS, `у шага «${item.label}»`, problems)
    const config = spec.config || {}
    const type = spec.type || config._qbtype || 'data'
    const action = {
      id: randomId(), name: spec.name === undefined || spec.name === null ? item.label : spec.name,
      order: index, action: { label: spec.label || actionLabel(type), value: type }, conditions: []
    }
    Object.assign(action, config)
    if (labels.has(item.label)) problems.push(`Метка «${item.label}» встречается дважды`)
    labels.set(item.label, action.id)
    actions.push(action)
  }
  for (const [index, item] of items.entries()) {
    const spec = item.spec || {}
    const action = actions[index]
    const branches = Array.isArray(spec.branches) ? spec.branches : []
    const base = fillCondition(spec.done, '', jump(spec.next, `шаг «${item.label}»`), problems, `шага «${item.label}»`)
    action.conditions.push(base)
    for (const branch of branches) {
      unknownKeys(branch, BRANCH_KEYS, `у условия шага «${item.label}»`, problems)
      const next = jump(branch.next, `шаг «${item.label}», условие «${branch.cond || ''}»`)
      action.conditions.push(fillCondition(branch.done, branch.cond || '', next, problems, `шага «${item.label}»`))
    }
    if (branches.length) base.elsefull = true
  }
  return { actions, problems }
}

function longestPath (actions) {
  const byId = new Map(actions.filter(x => x && x.id).map(x => [x.id, x]))
  const memo = new Map()
  const active = new Set()
  function walk (id) {
    if (memo.has(id)) return memo.get(id)
    const action = byId.get(id)
    if (!action) return 0
    active.add(id)
    let best = 0
    for (const condition of action.conditions || []) {
      const next = condition.nextaction
      if (!next || !next.value || active.has(next.value)) continue
      best = Math.max(best, walk(next.value))
    }
    active.delete(id)
    memo.set(id, best + 1)
    return best + 1
  }
  return actions.length && actions[0] ? walk(actions[0].id) : 0
}

function validateActions (actions) {
  const problems = []
  if (!Array.isArray(actions)) return ['Сценарий не массив']
  if (!actions.length) return ['Сценарий пуст']
  const ids = new Set()
  for (const action of actions) {
    if (!action || !action.id) {
      problems.push('Действие без id')
      continue
    }
    if (ids.has(action.id)) problems.push('Повторяющийся id: ' + action.id)
    ids.add(action.id)
    if (!action.action || !action.action.value) problems.push('Действие без типа: ' + action.id)
    if (!Array.isArray(action.conditions) || !action.conditions.length) problems.push('Действие без блока «Сделать»: ' + action.id)
    for (const operation of action.operations || []) {
      const missing = Object.keys(defaults.ops.operation).filter(key => Array.isArray(defaults.ops.operation[key]) && !Array.isArray(operation[key]))
      if (missing.length) problems.push(`Действие ${action.id}: у операции не хватает ${missing.join(', ')}`)
    }
  }
  for (const action of actions) {
    for (const condition of (action && action.conditions) || []) {
      const next = condition.nextaction
      if (next && !next.value) problems.push('Переход без цели: ' + action.id)
      if (next && next.value && !ids.has(next.value)) problems.push(`Переход в несуществующее действие: ${action.id} → ${next.value}`)
    }
  }
  const longest = longestPath(actions)
  if (longest > 100) problems.push(`Самый длинный путь ${longest} действий, максимум 100`)
  return problems
}

function bareCode (text) {
  const input = String(text || '')
  let out = ''
  let i = 0
  while (i < input.length) {
    const char = input[i]
    const next = input[i + 1]
    if (char === '/' && next === '/') {
      while (i < input.length && input[i] !== '\n') i++
      out += ' '
    } else if (char === '/' && next === '*') {
      i += 2
      while (i < input.length && !(input[i] === '*' && input[i + 1] === '/')) i++
      i += 2
      out += ' '
    } else if (char === '"' || char === "'" || char === '`') {
      const quote = char
      i++
      while (i < input.length) {
        if (input[i] === '\\') { i += 2; continue }
        if (input[i] === quote) { i++; break }
        i++
      }
      out += ' '
    } else out += input[i++]
  }
  return out
}

function bannedCode (code) {
  const clean = bareCode(code)
  const noProps = clean.replace(/\??\s*\.\s*[A-Za-z_$][\w$]*/g, '.').replace(/[A-Za-z_$][\w$]*\s*:/g, ':')
  const rules = [
    [/\bprocess\b/, 'process', true], [/\bglobal(This)?\b/, 'global', true],
    [/\brequire\b/, 'require', true], [/\bconstructor\b/, 'constructor', false],
    [/__proto__/, '__proto__', false], [/\beval\b/, 'eval', true],
    [/\bFunction\b/, 'Function', true], [/\bimport\b/, 'import', false],
    [/\bfetch\b/, 'fetch', true], [/\bXMLHttpRequest\b/, 'XMLHttpRequest', true],
    [/\bWebSocket\b/, 'WebSocket', true]
  ]
  const found = rules.filter(([regex, , property]) => regex.test(property ? noProps : clean)).map(([, name]) => name)
  for (const [regex, name] of [[/process\s*\.\s*env/, 'process.env'], [/__proto__/, '__proto__'], [/\.\s*constructor\b/, '.constructor'], [/child_process/, 'child_process']]) {
    if (regex.test(code) && !found.includes(name)) found.push(name)
  }
  return found
}

async function record (code, data) {
  const list = []
  const problems = []
  const declared = []
  let steps = 0
  const scenario = async (name, fn) => {
    declared.push(String(name || 'Сценарий'))
    if (typeof fn !== 'function') {
      problems.push(`«${name}»: сценарий объявлен без кода`)
      return
    }
    const items = []
    const missing = []
    const ctx = makeContext(data, missing)
    const target = {
      cfg: configProxy(data),
      async step (label, spec) {
        steps++
        if (steps > 3000) throw new Error('Слишком много шагов при компиляции')
        items.push({ kind: 'step', label: String(label), spec: spec || {} })
      }
    }
    const qb = new Proxy(target, {
      get (object, key) {
        if (typeof key !== 'string') return object[key]
        if (key in object || JS_KEYS.includes(key)) return object[key]
        throw new Error(`У qb нет «${String(key)}». Используй qb.step и qb.cfg`)
      }
    })
    let actions = []
    const own = []
    try {
      await fn(qb, ctx)
      const linked = linkSteps(items)
      actions = linked.actions
      own.push(...missing, ...linked.problems, ...validateActions(actions))
    } catch (error) {
      own.push(error && error.message ? error.message : String(error))
    }
    if (own.length) problems.push(`«${name}»: ${own.join('; ')}`)
    list.push({ name: String(name || 'Сценарий'), actions: own.length ? [] : actions, problems: own })
  }
  const clean = code.replace(/^\s*```[a-zA-Z]*\s*/m, '').replace(/```\s*$/m, '')
  if (/^[{[]/.test(clean.trim())) {
    problems.push('external должен быть кодом scenario(...), а не JSON')
    return { list, problems, declared, fixes: [] }
  }
  const banned = bannedCode(clean)
  if (banned.length) {
    problems.push('Запрещённые обращения в коде: ' + [...new Set(banned)].join(', '))
    return { list, problems, declared, fixes: [] }
  }
  try {
    const context = vm.createContext(Object.create(null), { codeGeneration: { strings: false, wasm: false } })
    const fn = vm.compileFunction('return (async () => {' + clean + '\n})()', ['scenario'], { filename: 'external.code.js', context })
    await fn(scenario)
  } catch (error) {
    problems.push('Код не выполнился: ' + (error && error.message ? error.message : String(error)))
  }
  if (!declared.length && !clean.includes('scenario')) problems.push('Нет ни одного вызова scenario(...)')
  if (declared.length > list.length) problems.push(`Собралось сценариев ${list.length} из ${declared.length}`)
  return { list, problems, declared, fixes: takeFixes() }
}

async function compileScenarios (code, names, options = {}) {
  if (typeof code !== 'string' || !code.trim()) return { list: [], problems: ['Пустой external.code.js'], declared: [], fixes: [] }
  if (Buffer.byteLength(code, 'utf8') > 2 * 1024 * 1024) throw new Error('external.code.js больше 2 МБ')
  if (isMainThread) {
    return new Promise((resolve, reject) => {
      const worker = new Worker(__filename, { workerData: { code, names } })
      const timer = setTimeout(() => {
        worker.terminate()
        reject(new Error('Компиляция external.code.js превысила 30 секунд'))
      }, options.timeout || 30000)
      worker.once('message', result => { clearTimeout(timer); resolve(result) })
      worker.once('error', error => { clearTimeout(timer); reject(error) })
      worker.once('exit', code => {
        clearTimeout(timer)
        if (code !== 0) reject(new Error('Компилятор остановлен с кодом ' + code))
      })
    })
  }
  return record(code, names)
}

function asRef (value) {
  if (typeof value === 'string') {
    const name = value.trim()
    return name ? { label: name, value: 0 } : null
  }
  return value === undefined ? null : value
}

function linkScenarioRefs (bot) {
  const out = { fixed: 0, missing: [] }
  const whole = bot || {}
  const byName = new Map()
  for (const scenario of whole.external || []) {
    if (!scenario || scenario.name === undefined || scenario.name === null) continue
    const key = String(scenario.name).trim().toLowerCase()
    if (!byName.has(key)) byName.set(key, scenario.id)
  }
  if (!byName.size) return out
  const fix = value => {
    if (!value || typeof value !== 'object') return
    const key = String(value.label === undefined || value.label === null ? '' : value.label).trim().toLowerCase()
    if (!byName.has(key)) {
      if (key || value.value !== undefined && value.value !== null) out.missing.push(String(value.label || value.value))
      return
    }
    const id = byName.get(key)
    if (value.value !== id) { value.value = id; out.fixed++ }
  }
  for (const message of whole.messages || []) {
    if (!message) continue
    const asstring = typeof message.message === 'string'
    let blocks = message.message
    if (asstring) {
      try { blocks = JSON.parse(message.message) } catch (error) { blocks = null }
    }
    if (Array.isArray(blocks)) {
      for (const block of blocks) {
        if (!block) continue
        block.externalbefore = asRef(block.externalbefore)
        fix(block.externalbefore)
        for (const condition of block.conditionlist || []) {
          if (!condition) continue
          condition.externalafter = asRef(condition.externalafter)
          fix(condition.externalafter)
        }
      }
      if (asstring) message.message = JSON.stringify(blocks)
    }
    if (message.actionseveryone && message.actionseveryone !== 'null') {
      let reference = message.actionseveryone
      const serialized = typeof reference === 'string'
      if (serialized) {
        try { reference = JSON.parse(reference) } catch (error) { reference = null }
      }
      if (reference && typeof reference === 'object') {
        fix(reference)
        message.actionseveryone = serialized ? JSON.stringify(reference) : reference
      }
    }
  }
  return out
}

module.exports = { compileScenarios, namesFrom, linkScenarioRefs, validateActions }

if (!isMainThread) {
  record(workerData.code, workerData.names).then(result => parentPort.postMessage(result), error => {
    parentPort.postMessage({ list: [], problems: [error.message], declared: [], fixes: [] })
  })
}
