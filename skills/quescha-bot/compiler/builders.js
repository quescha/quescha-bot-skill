'use strict'

const crypto = require('crypto')
const defaults = require('./schema/defaults.json')
const enums = require('./schema/enums.json')

const CFGKEY = {
  payment: 'payment', crm: 'crm', gsheets: 'gsheets', getdata: 'getdata',
  links: 'links', sendmedia: 'acceptmedia', tgchannel: 'tgchannel',
  maxchannel: 'maxchannel', checktags: 'checktags', chatgpt: 'chatgpt',
  webapp: 'webapp', jscode: 'jscode', gcalendar: 'gcalendar', gdrive: 'gdrive',
  yadisk: 'yadisk', referal: 'referal'
}
const COMPARISONS = {
  neq: '!=', ne: '!=', '<>': '!=', not: '!=', noteq: '!=', not_eq: '!=',
  isnot: '!=', notequal: '!=', notequals: '!=', '!==': '!=', '≠': '!=',
  eq: '=', equal: '=', equals: '=', '==': '=', '===': '=', is: '=',
  gt: '>', gte: '>=', ge: '>=', lt: '<', lte: '<=', le: '<=',
  contains: 'include', contain: 'include', like: 'include', in: 'include',
  has: 'include', includes: 'include', notcontains: 'notinclude',
  notcontain: 'notinclude', nin: 'notinclude', notlike: 'notinclude',
  notin: 'notinclude', excludes: 'notinclude'
}
const SORTS = {
  desc: false, descending: false, 'по убыванию': false, '-1': false, '0': false,
  asc: true, ascending: true, 'по возрастанию': true, '1': true,
  rand: 'random', 'случайно': 'random', 'случайное': 'random', shuffle: 'random'
}
const PAY_SYNONYMS = {
  action: 'type', operation: 'type', kind: 'type', op: 'type', amount: 'sum',
  price: 'sum', cost: 'sum', total: 'sum', summa: 'sum', comment: 'description',
  title: 'description', purpose: 'description', system: 'name', provider: 'name',
  paysystem: 'name', paymentsystem: 'name', link: 'vlink', save: 'vlink',
  saveto: 'vlink', payment: 'name', paymentname: 'name', linkvar: 'vlink',
  urlvar: 'vlink', sumvar: 'vsum', redirect: 'returnurl', successurl: 'returnurl',
  currencycode: 'currency'
}
const AI_SYNONYMS = {
  prompt: 'question', text: 'question', query: 'question', 'вопрос': 'question',
  'запрос': 'question', input: 'question', system: 'instructions',
  systemprompt: 'instructions', answer: 'answervar', save: 'answervar',
  saveto: 'answervar', into: 'answervar', output: 'answervar',
  answervariable: 'answervar', result: 'resultvar', resultvariable: 'resultvar',
  response: 'responsevar', maxtoken: 'maxtokens', max_tokens: 'maxtokens',
  apikey: 'token', key: 'token'
}
const DOC_TYPES = { variable: 'Переменная', cycle: 'Цикл', cond: 'Условие', pic: 'Изображение', link: 'Ссылка' }

let fixes = []
function noteFix (text) { fixes.push(String(text)) }
function takeFixes () {
  const counts = new Map()
  for (const item of fixes) counts.set(item, (counts.get(item) || 0) + 1)
  fixes = []
  return [...counts].map(([name, count]) => name + (count > 1 ? ' ×' + count : ''))
}
function clone (value) { return JSON.parse(JSON.stringify(value === undefined ? null : value)) }
function randomId () { return crypto.randomBytes(8).toString('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, 8).padEnd(8, '0') }
function str (value) { return value === undefined || value === null ? '' : String(value) }
function pick (kind, value, what) {
  if (value === null || value === undefined || value === '') return null
  const raw = value && typeof value === 'object' && value.value !== undefined ? value.value : value
  const table = enums[kind] || []
  const exact = table.find(x => String(x.value) === String(raw))
  if (exact) return clone(exact)
  const synonyms = kind === 'comparision' ? COMPARISONS : kind === 'sort' ? SORTS : null
  const mapped = synonyms && synonyms[String(raw).trim().toLowerCase()]
  if (mapped !== undefined) {
    const found = table.find(x => String(x.value) === String(mapped))
    if (found) {
      noteFix(`${raw} → ${mapped}`)
      return clone(found)
    }
  }
  throw new Error(`Неизвестное значение «${raw}» для ${what || kind}. Допустимые: ${table.map(x => x.value).join(', ')}`)
}
function ref (value, name) {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'object') {
    const out = {
      label: value.label === undefined || value.label === null ? (name || '') : value.label,
      value: value.value === undefined ? null : value.value
    }
    if (value.index !== undefined && value.index !== null) out.index = value.index
    return out
  }
  return { label: name || '', value }
}
function fields (templateName, over, what) {
  const template = defaults.actions[templateName] || defaults.ops[templateName]
  if (!template) throw new Error('Нет шаблона полей: ' + templateName)
  const out = clone(template)
  for (const key of Object.keys(over || {})) {
    if (!Object.prototype.hasOwnProperty.call(out, key)) {
      throw new Error(`Неизвестное поле «${key}» у ${what || templateName}. Допустимые: ${Object.keys(out).join(', ')}`)
    }
    out[key] = over[key]
  }
  return out
}
function wrap (type, config) {
  Object.defineProperty(config, '_qbtype', { value: type, enumerable: false })
  return config
}
function fullOperation (operation) {
  const out = clone(defaults.ops.operation)
  for (const key of Object.keys(operation || {})) {
    if (!Object.prototype.hasOwnProperty.call(out, key)) throw new Error(`Неизвестное поле «${key}» у операции`)
    out[key] = operation[key]
  }
  if (!out.id) out.id = randomId()
  return out
}
function listOperation (listid, opts) {
  const o = typeof opts === 'string' ? { listname: opts } : (opts || {})
  const op = clone(defaults.ops.operation)
  op.id = randomId()
  op.type = 'list'
  op.namelist = ref(listid, o.listname)
  const poles = o.poles || (listid && typeof listid === 'object' ? listid.poles : null)
  if (poles) op.oplistpoles = poles.map(pole => ({ pole, value: '' }))
  if (o.active !== undefined) op.listpoleactive = o.active
  return op
}
function condition (value) {
  return {
    oplistlogic: pick('orand', value.logic || 'and', 'логики условия'),
    oplistpole: value.pole,
    oplistcomparision: pick('comparision', value.cmp || '=', 'сравнения'),
    oplistwithcheck: !!value.rightpole,
    oplistvalue: str(value.value),
    oplistrightpole: value.rightpole || null,
    oplistcrosslistcheck: !!value.crosslist,
    oplistcrosslist: ref(value.crosslist),
    oplistcrosspole: value.crosspole || null,
    oplistcrosscomparision: value.crosslist ? pick('comparision', value.crosscmp || '=', 'сравнения') : null,
    oplistcrosspolevalue: str(value.crossvalue),
    oplistcrosspolecomparision: value.crosstake || null,
    oplistreversecheck: !!value.reverse,
    oplistbasis: !!value.basis
  }
}
function select (op, where) {
  if (!where) return op
  const conditions = Array.isArray(where.conds) ? where.conds : (where.pole ? [where] : [])
  if (conditions.length) op.oplistcond = conditions.map(condition)
  if (where.sort && where.sort.pole) {
    op.sortcheck = true
    op.sortlistpole = where.sort.pole
    op.sortlistasc = pick('sort', where.sort.asc === undefined ? true : where.sort.asc, 'сортировки')
  }
  if (where.unique) {
    op.uniquecheck = true
    op.uniquelistpole = where.unique
  }
  if (where.last) {
    op.focuscheck = true
    op.focuslast = true
    op.focusonlylast = true
  } else if (where.tolast) {
    op.focuscheck = true
    op.focusrowmin = where.from || 1
    op.focuslast = true
  } else if (where.from || where.to) {
    op.focuscheck = true
    op.focusrowmin = where.from || 1
    op.focusrowmax = where.to || where.from || 1
  }
  if (where.filtervar) op.oplistfiltervar = where.filtervar
  return op
}
function colValues (input, what) {
  if (!Array.isArray(input)) return input || {}
  const out = {}
  for (const item of input) {
    if (Array.isArray(item)) {
      if (item.length >= 2) out[String(item[0])] = item[1]
      continue
    }
    if (!item || typeof item !== 'object') continue
    const name = item.pole || item.name || item.field || item.column || item.key || item.title
    if (name !== undefined && name !== null && item.value !== undefined) out[String(name)] = item.value
    else for (const key of Object.keys(item)) out[key] = item[key]
  }
  noteFix(`Поля ${what || 'списка'} пришли списком пар — разложены по колонкам`)
  return out
}
function pairs (map) {
  if (!Array.isArray(map)) return Object.keys(map || {}).map(name => ({ name, value: map[name] }))
  return map.map(item => {
    if (Array.isArray(item)) return { name: item[0], value: item[1] }
    const name = Object.keys(item || {})[0]
    return { name, value: (item || {})[name] }
  })
}
function varOperation (type) {
  const op = clone(defaults.ops.operation)
  op.id = randomId()
  op.type = type || 'vars'
  return op
}
function varSave (over, is) {
  const out = clone(defaults.ops.varsave)
  out.is = is === undefined ? 'n' : is
  Object.assign(out, over || {})
  return out
}
function assignValue (value) {
  const out = { target: pick('savetarget', 'var') }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    out.value = str(value.value)
    out.vararraynum = value.num === undefined ? 1 : value.num
    out.vararraylast = !!value.last
    if (value.regex) out.regex = value.regex
    else {
      out.splittype = true
      out.splitline = !!value.line
      out.split = value.by === undefined ? '' : String(value.by)
    }
  } else out.value = str(value)
  return out
}
function assign (name, value, is) { return varSave({ ...assignValue(value), varname: name }, is) }
function applyChecks (op, checks, res) {
  op.varcond = (checks || []).map((item, index) => ({
    cond: item.cond || '',
    type: pick('validation', item.type, 'вида проверки'),
    orand: index === 0 ? null : pick('orand', item.logic || 'and', 'логики условия'),
    regex: item.regex || ''
  }))
  const saved = []
  const put = (map, is) => pairs(map).forEach(item => saved.push(assign(item.name, item.value, is)))
  for (const step of Array.isArray(res) ? res : [res || {}]) {
    put((step || {}).ok, true)
    put((step || {}).fail, false)
  }
  op.varsave = saved
  return op
}
function renameSynonyms (over, map, what) {
  for (const from of Object.keys(over || {})) {
    const to = map[from] || map[from.toLowerCase()]
    if (!to || to === from) continue
    if (over[to] !== undefined) { delete over[from]; continue }
    over[to] = over[from]
    delete over[from]
    noteFix(`Поле «${from}» ${what ? what + ' ' : ''}принято как «${to}»`)
  }
  return over
}
function paymentMarks (over) {
  const out = Array.isArray(over.payloads) ? over.payloads.slice() : []
  if (over.payloads !== undefined && !Array.isArray(over.payloads)) {
    const single = over.payloads
    if (single && typeof single === 'object') {
      for (const key of Object.keys(single)) out.push({ name: key, data: String(single[key]) })
    } else if (single !== null && single !== undefined && single !== '') out.push({ name: 'payload', data: String(single) })
    noteFix('Метка платежа приведена к виду payloads')
  }
  for (const key of ['payload', 'label', 'orderid', 'order', 'invoiceid', 'invoice', 'metadata']) {
    if (!Object.prototype.hasOwnProperty.call(over, key)) continue
    const value = over[key]
    delete over[key]
    if (value === null || value === undefined || value === '') continue
    if (Array.isArray(value)) out.push(...value)
    else if (typeof value === 'object') for (const name of Object.keys(value)) out.push({ name, data: String(value[name]) })
    else out.push({ name: key, data: String(value) })
    noteFix(`Поле «${key}» у платежа положено в payloads`)
  }
  if (out.length) over.payloads = out
  else delete over.payloads
  return over
}
function diskOperations (templateName, enumName, list, what) {
  return (list || []).map(item => {
    const over = {}
    for (const key of Object.keys(item || {})) if (key !== 'type') over[key] = item[key]
    const out = fields(templateName, over, what)
    out.type = pick(enumName, item.type, 'операции ' + what)
    return out
  })
}
function docItem (item) {
  const value = item && item.type && typeof item.type === 'object' ? item.type.value : item && item.type
  if (!DOC_TYPES[value]) throw new Error(`Неизвестный элемент документа «${value}»`)
  const base = {
    variable: { name: '', value: '' }, cycle: { name: '', vars: [] },
    cond: { name: '', cond: [] },
    pic: { name: '', width: '', height: '', imgtype: 'image', image: '', qrdata: '', imageurl: '' },
    link: { name: '', linkname: '', url: '' }
  }[value]
  return { ...base, ...(item || {}), type: { label: DOC_TYPES[value], value } }
}

const builders = {
  ops (...configs) {
    const operations = []
    for (const config of configs) {
      if (!config) continue
      if (Array.isArray(config.operations)) operations.push(...config.operations)
      else {
        if (config._qbtype && config._qbtype !== 'data') throw new Error(`«${config._qbtype}» — отдельное действие, а не операция`)
        operations.push(fullOperation(config))
      }
    }
    return wrap('data', { operations })
  },
  listAdd (listid, input, opts) {
    const op = listOperation(listid, opts)
    op.oplistaction = pick('oplistaction', 'addrow')
    const values = colValues(input, 'записи в список')
    op.oplistpoles = Object.keys(values).map(pole => ({ pole, value: str(values[pole]) }))
    const o = typeof opts === 'string' ? { listname: opts } : (opts || {})
    if (o.arraytostr) op.arraytostr = true
    return wrap('data', { operations: [op] })
  },
  listRead (listid, save, where, opts) {
    const op = listOperation(listid, opts)
    op.oplistaction = pick('oplistaction', 'readrow')
    op.oplistiterate = pick('iterate', 'saveinvar')
    op.oplistsaveinvar = pairs(save).map(item => ({ pole: item.name, string: item.value }))
    const o = typeof opts === 'string' ? { listname: opts } : (opts || {})
    if (o.clear === false) op.oplistsaveclearvar = false
    if (o.send) {
      const allowed = ['mes', 'btn', 'len']
      for (const key of Object.keys(o.send)) if (!allowed.includes(key)) throw new Error(`Неизвестное поле «${key}» у построчной отправки списка`)
      op.oplistsavesend = true
      op.oplistsavesendmes = o.send.mes || ''
      op.oplistsavesendbtn = o.send.btn || []
      op.oplistsavesendlen = str(o.send.len === undefined ? 5 : o.send.len)
    }
    return wrap('data', { operations: [select(op, where)] })
  },
  listString (listid, resultvar, parts, where, opts) {
    const op = listOperation(listid, opts)
    op.oplistaction = pick('oplistaction', 'readrow')
    op.oplistiterate = pick('iterate', 'getstring')
    op.oplistreadvar = resultvar || ''
    op.oplistgetstring = (parts || []).map(item => item && typeof item === 'object' && item.pole
      ? { type: pick('getstring', 'pole'), pole: item.pole, string: '' }
      : { type: pick('getstring', 'string'), pole: null, string: str(item && item.value !== undefined ? item.value : item) })
    const last = op.oplistgetstring[op.oplistgetstring.length - 1]
    op.oplistgetstringtype = last ? clone(last.type) : null
    return wrap('data', { operations: [select(op, where)] })
  },
  listToGlobal (listid, save, where, opts) {
    const op = listOperation(listid, opts)
    op.oplistaction = pick('oplistaction', 'readrow')
    op.oplistiterate = pick('iterate', 'saveinglobal')
    op.oplistsaveinglobal = Object.keys(save || {}).map(pole => ({ pole, global: ref(save[pole]) }))
    return wrap('data', { operations: [select(op, where)] })
  },
  listCopy (listid, targetid, map, where, opts) {
    const o = typeof opts === 'string' ? { listname: opts } : (opts || {})
    const op = listOperation(listid, o)
    op.oplistaction = pick('oplistaction', 'readrow')
    op.oplistiterate = pick('iterate', 'addtolist')
    op.oplisttarget = ref(targetid, o.targetname)
    op.oplistaddtoone = !!o.one
    op.oplistaddtolist = (map || []).map(item => {
      const fromPole = item.pole !== undefined && item.pole !== null
      return {
        targettype: pick('getstring', fromPole ? 'pole' : 'string'),
        targetpole: item.to, pole: fromPole ? item.pole : null,
        string: fromPole ? '' : str(item.value)
      }
    })
    return wrap('data', { operations: [select(op, where)] })
  },
  listSync (listid, target, changes, where, opts) {
    const t = target || {}
    const op = listOperation(listid, opts)
    op.oplistaction = pick('oplistaction', 'readrow')
    op.oplistiterate = pick('iterate', 'editlist')
    op.oplisttarget = ref(t.id, t.name)
    const tw = t.where || {}
    const list = Array.isArray(tw.conds) ? tw.conds : (tw.pole ? [tw] : [])
    op.oplistchangelistcond = list.map(item => ({
      oplistchangelogic: pick('orand', item.logic || 'and'),
      oplisttargetpole: item.pole,
      oplistchangecomparision: pick('comparision', item.cmp || '='),
      oplistchangewithcheck: !!item.rightpole,
      oplistchangevalue: str(item.value),
      oplisttargetrightpole: item.rightpole || null,
      oplistchangecrosslistcheck: !!item.crosslist,
      oplistchangecrosslist: ref(item.crosslist),
      oplistchangecrosslistpole: item.crosspole || null,
      oplistchangecrosslistcomparision: item.crosslist ? pick('comparision', item.crosscmp || '=') : null,
      oplistchangecrosslistpolevalue: str(item.crossvalue),
      oplistchangecrosslistcomparisionpole: item.crosstake || null,
      oplistreversecheck: !!item.reverse,
      oplistbasis: !!item.basis
    }))
    if (tw.last) {
      op.oplistchangefocuscheck = true
      op.oplistchangeonlylast = true
    } else if (tw.from || tw.to) {
      op.oplistchangefocuscheck = true
      op.oplistchangerowmin = tw.from || 1
      op.oplistchangerowmax = tw.to || tw.from || 1
    }
    if (tw.filtervar) op.oplistchangefiltervar = tw.filtervar
    const update = []
    const remove = []
    for (const item of changes || []) {
      if (item.op === 'del') {
        remove.push({
          changepole: item.pole, changeop: pick('cellaction', 'del'),
          logic: pick('orand', item.logic || 'and'),
          delcomparision: pick('comparision', item.cmp || '='), delvalue: str(item.value),
          crosslistcheck: false, crosslist: null, crosslistpole: null,
          crosslistcomparision: null, crosslistpolevalue: '', crosslistcomparisionpole: null,
          oplistreversecheck: !!item.reverse, oplistbasis: !!item.basis
        })
      } else {
        const fromPole = item.from !== undefined && item.from !== null
        update.push({
          targetpole: item.pole, changeop: pick('cellaction', item.op || 'set'),
          type: pick('getstring', fromPole ? 'pole' : 'string'), pole: fromPole ? item.from : null,
          string: fromPole ? '' : str(item.value), oplistreversecheck: false, oplistbasis: false
        })
      }
    }
    op.oplistchangeaddtolist = update
    op.oplistchangepoledelcond = remove
    return wrap('data', { operations: [select(op, where)] })
  },
  listEdit (listid, where, changes, opts) {
    const op = listOperation(listid, opts)
    op.oplistaction = pick('oplistaction', 'editrow')
    const update = []
    const remove = []
    for (const item of changes || []) {
      if (item.op === 'del') {
        remove.push({
          editdellogic: pick('orand', item.logic || 'and'), editpole: item.pole,
          editop: pick('cellaction', 'del'), editdelcomparision: pick('comparision', item.cmp || '='),
          editdelvalue: str(item.value), editdelcrosslistcheck: !!item.crosslist,
          editdelcrosslist: ref(item.crosslist), editdelcrosslistpole: item.crosspole || null,
          editdelcrosslistcomparision: item.crosslist ? pick('comparision', item.crosscmp || '=') : null,
          editdelcrosslistpolevalue: str(item.crossvalue),
          editdelcrosslistcomparisionpole: item.crosstake || null,
          oplistreversecheck: !!item.reverse, oplistbasis: !!item.basis
        })
      } else {
        update.push({
          editpole: item.pole, editop: pick('cellaction', item.op || 'set'), editpolevalue: str(item.value),
          editcrosslistcheck: !!item.crosslist, editcrosslist: ref(item.crosslist),
          editcrosslistpole: item.crosspole || null,
          editcrosslistcomparision: item.crosslist ? pick('comparision', item.crosscmp || '=') : null,
          editcrosslistpolevalue: str(item.crossvalue),
          editcrosslistcomparisionpole: item.crosstake || null
        })
      }
    }
    op.oplisteditpoles = update
    op.oplisteditdelcond = remove
    return wrap('data', { operations: [select(op, where)] })
  },
  listFind (listid, where, opts) {
    const op = listOperation(listid, opts)
    op.oplistaction = pick('oplistaction', 'readrow')
    return wrap('data', { operations: [select(op, where)] })
  },
  listDelete (listid, where, opts) {
    const op = listOperation(listid, opts)
    op.oplistaction = pick('oplistaction', 'delrow')
    return wrap('data', { operations: [select(op, where)] })
  },
  setVar (name, value) {
    const op = varOperation('vars')
    op.varsave = [assign(name, value)]
    return wrap('data', { operations: [op] })
  },
  setVars (map) {
    const op = varOperation('vars')
    op.varsave = pairs(map).map(item => assign(item.name, item.value))
    return wrap('data', { operations: [op] })
  },
  setGlobal (globalref, value) {
    const op = varOperation('vars')
    op.varsave = [varSave({ target: pick('savetarget', 'globalvar'), globaltarget: ref(globalref), value: str(value) })]
    return wrap('data', { operations: [op] })
  },
  splitVar (name, value, opts) {
    const op = varOperation('vars')
    const o = opts || {}
    op.varsave = [assign(name, { value, by: o.by, line: o.line, regex: o.regex, num: o.num, last: o.last })]
    return wrap('data', { operations: [op] })
  },
  checkVar (varname, checks, res) {
    const op = varOperation('vars')
    op.name = varname
    return wrap('data', { operations: [applyChecks(op, checks, res)] })
  },
  checkAnswer (blockref, checks, res) {
    const op = varOperation('answers')
    const reference = ref(blockref)
    op.nameansw = reference ? reference.value : ''
    return wrap('data', { operations: [applyChecks(op, checks, res)] })
  },
  set (type, partial) {
    const key = CFGKEY[type]
    if (!key) throw new Error('Нет такого действия: ' + type)
    return wrap(type, { [key]: fields(key, partial, type) })
  },
  http (params) {
    const p = params || {}
    const method = String(p.method || 'post-json').toLowerCase()
    const config = fields('getdata', {
      type: pick('getdata', 'get'), url: p.url || '', sendmethod: pick('method', method),
      headings: p.headers ? Object.keys(p.headers).map(key => ({ key, value: str(p.headers[key]) })) : [],
      headingspayloads: p.headers ? pick('payloads', 'data') : null,
      sendpayloads: (p.body || p.json) ? pick('payloads', method.includes('json') ? 'json' : 'data') : null,
      senddata: p.body ? Object.keys(p.body).map(key => ({ key, value: str(p.body[key]) })) : [],
      sendjson: p.json || '',
      acceptdata: p.save ? Object.keys(p.save).map(param => ({ param, tovar: p.save[param] })) : [],
      addtolist: p.tolist ? ref(p.tolist.id, p.tolist.name) : null,
      addtolistpoles: p.tolist && p.tolist.fields ? Object.keys(p.tolist.fields).map(pole => ({ pole, value: str(p.tolist.fields[pole]) })) : [],
      resultvar: p.resultvar || ''
    }, 'HTTP-запроса')
    return wrap('getdata', { getdata: config })
  },
  waitData (params) {
    const p = params || {}
    const config = fields('getdata', {
      type: pick('getdata', 'waiting'),
      acceptdata: p.save ? Object.keys(p.save).map(param => ({ param, tovar: p.save[param] })) : [],
      addtolist: p.tolist ? ref(p.tolist.id, p.tolist.name) : null,
      addtolistpoles: p.tolist && p.tolist.fields ? Object.keys(p.tolist.fields).map(pole => ({ pole, value: str(p.tolist.fields[pole]) })) : [],
      resultvar: p.resultvar || ''
    }, 'ожидания данных')
    return wrap('getdata', { getdata: config })
  },
  js (code) { return wrap('jscode', { jscode: fields('jscode', { data: code || '' }, 'JS-кода') }) },
  payment (type, params) {
    let p = params || {}
    if (type && typeof type === 'object' && !Array.isArray(type) && params === undefined) {
      p = { ...type }
      type = p.type || p.action || p.operation || p.kind || p.op || null
      for (const key of ['type', 'action', 'operation', 'kind', 'op']) delete p[key]
      noteFix('Платёж собран из одного объекта')
    }
    const over = { ...p }
    renameSynonyms(over, PAY_SYNONYMS, 'у платежа')
    paymentMarks(over)
    if (type === null || type === undefined || type === '') {
      type = 'getlink'
      noteFix('У платежа не названа операция — собран как getlink')
    }
    over.type = pick('payment', type, 'операции с платежами')
    if (over.type && over.type.value === 'getlink') {
      if (!over.vlink) {
        over.vlink = 'pay_link'
        noteFix('У платежа не было vlink — добавлен pay_link')
      }
      if (!over.name) {
        over.name = { label: 'ВЫБЕРИТЕ ПЛАТЁЖНУЮ СИСТЕМУ', value: 0 }
        noteFix('У платежа не указана платёжная система')
      }
    }
    return wrap('payment', { payment: fields('payment', over, 'платежа') })
  },
  ai (params) {
    const over = { ...(params || {}) }
    renameSynonyms(over, AI_SYNONYMS, 'у нейросети')
    if (over.answervar === undefined) over.answervar = 'ai_answer'
    return wrap('chatgpt', { chatgpt: fields('chatgpt', over, 'нейросети') })
  },
  webapp (type, params) {
    return wrap('webapp', { webapp: fields('webapp', { ...(params || {}), type: pick('webapp', type) }, 'WebApp') })
  },
  referal (type, params) {
    const operations = [Object.assign({ type }, params || {})].map(item => {
      const over = {}
      for (const key of Object.keys(item)) if (key !== 'type') over[key] = item[key]
      return { ...fields('referalop', over, 'реферальной системы'), type: pick('referal', item.type) }
    })
    return wrap('referal', { referal: { op: operations } })
  },
  media (type, subscribers, extra) {
    const over = { type: pick('media', type), subscribers: [] }
    if (subscribers === 'employee') {
      over.to = 'employee'
      over.messengerall = true
    } else if (subscribers && !Array.isArray(subscribers) && typeof subscribers === 'object' && subscribers.employees) {
      over.to = 'employee'
      over.messengerall = false
      over.messenger = subscribers.employees
    } else over.subscribers = subscribers || []
    const config = fields('acceptmedia', over, 'медиа')
    for (const key of Object.keys(extra || {})) if (key !== 'keep') throw new Error('Неизвестное поле у медиа: ' + key)
    if (extra && extra.keep === true) config.keep = true
    return wrap('sendmedia', { acceptmedia: config })
  },
  gsheets (params) {
    const p = params || {}
    const operations = (p.ops || []).map(item => {
      const out = clone(defaults.ops.gsheetsop)
      out.id = randomId()
      out.type = pick('gsheets', item.type).value
      out.cond = (item.where || []).map(value => ({
        logic: pick('orand', value.logic || 'and'), colname: value.col,
        comparision: pick('comparision', value.cmp || '='), value: str(value.value),
        basis: !!value.basis, reverse: !!value.reverse
      }))
      out.save = Object.keys(item.save || {}).map(colname => ({ colname, varname: item.save[colname] }))
      out.edit = Object.keys(item.edit || {}).map(colname => ({ colname, value: str(item.edit[colname]) }))
      out.add = Object.keys(item.add || {}).map(colname => ({ colname, value: str(item.add[colname]) }))
      if (item.sort && item.sort.col) {
        out.sortcheck = true
        out.sortlistpole = item.sort.col
        out.sortlistasc = pick('sort', item.sort.asc === undefined ? true : item.sort.asc)
      }
      if (item.unique) {
        out.uniquecheck = true
        out.uniquelistpole = item.unique
      }
      if (item.last) {
        out.focuscheck = true
        out.focusonlylast = true
      } else if (item.from || item.to) {
        out.focuscheck = true
        out.focusrowmin = str(item.from || 1)
        out.focusrowmax = str(item.to || item.from || 1)
      }
      if (item.filtervar) out.filtervar = item.filtervar
      if (item.send) {
        out.gslistsavesend = true
        out.gslistsavesendmes = item.send.mes || ''
        out.gslistsavesendbtn = item.send.btn || []
        out.gslistsavesendlen = str(item.send.len === undefined ? 5 : item.send.len)
      }
      return out
    })
    return wrap('gsheets', {
      gsheets: fields('gsheets', {
        name: ref(p.account), servicejson: p.servicejson || '', sheetid: p.sheetid || '',
        listIndex: p.listindex === undefined ? 0 : p.listindex, op: operations
      }, 'Google Таблиц')
    })
  },
  crm (type, params) {
    const p = params || {}
    return wrap('crm', {
      crm: fields('crm', {
        type: pick('crmtype', type), name: p.account === undefined ? '' : p.account,
        accept: p.accept || [], send: p.send || []
      }, 'CRM')
    })
  },
  gcalendar (params) {
    const p = params || {}
    return wrap('gcalendar', {
      gcalendar: fields('gcalendar', {
        servicejson: p.servicejson || '',
        op: diskOperations('gcalendarop', 'gcalendar', p.ops, 'Google Календаря')
      }, 'Google Календаря')
    })
  },
  gdrive (params) {
    const p = params || {}
    return wrap('gdrive', {
      gdrive: fields('gdrive', {
        name: ref(p.account), servicejson: p.servicejson || '',
        op: diskOperations('gdriveop', 'gdrive', p.ops, 'Google Диска')
      }, 'Google Диска')
    })
  },
  yadisk (params) {
    const p = params || {}
    return wrap('yadisk', {
      yadisk: fields('yadisk', {
        name: ref(p.account), op: diskOperations('yadiskop', 'yadisk', p.ops, 'Яндекс Диска')
      }, 'Яндекс Диска')
    })
  },
  link (type, params) {
    const over = { ...(params || {}) }
    over.type = pick('links', type)
    if (over.visible !== undefined) over.visible = pick('linksvisible', over.visible)
    return wrap('links', { links: fields('links', over, 'ссылки') })
  },
  doc (items, params) {
    return wrap('createdoc', {
      createdoc: (items || []).map(docItem),
      doc: fields('doc', params || {}, 'документа')
    })
  },
  tgchannel (type, params) {
    const p = params || {}
    const config = fields('tgchannel', { ...p, type: pick('tgchannel', type) }, 'канала Telegram')
    if (p.restrict) config.restrict = Object.assign(clone(defaults.actions.tgchannel.restrict), p.restrict)
    if (p.promote) config.promote = Object.assign(clone(defaults.actions.tgchannel.promote), p.promote)
    return wrap('tgchannel', { tgchannel: config })
  },
  maxchannel (type, params) {
    return wrap('maxchannel', { maxchannel: fields('maxchannel', { ...(params || {}), type: pick('maxchannel', type) }, 'канала МАКС') })
  },
  checktags (tags, params) {
    const p = params || {}
    return wrap('checktags', {
      checktags: fields('checktags', {
        tags: Array.isArray(tags) ? tags : (tags ? [tags] : null),
        delete: !!p.deleted, one: !!p.one, resultvar: p.resultvar || ''
      }, 'проверки тегов')
    })
  }
}

module.exports = {
  builders, defaults, enums, randomId, clone, pick, ref, noteFix, takeFixes
}
