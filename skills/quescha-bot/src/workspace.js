'use strict'

const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')

const DEFAULT_CONFIG = {
  name: 'Quescha bot',
  slug: 'quescha-bot',
  source: 'bot.json',
  tests: 'tests.js',
  mutations: 'mutations.js',
  dryrun: 'dryrun.js'
}

function resolveWorkspace (dir = '.') { return path.resolve(dir) }
function configPath (dir) { return path.join(resolveWorkspace(dir), 'bot.config.json') }

function readConfig (dir) {
  const root = resolveWorkspace(dir)
  const file = configPath(root)
  if (!fs.existsSync(file)) throw new Error(`Нет bot.config.json в ${root}`)
  const config = Object.assign({}, DEFAULT_CONFIG, readJson(file))
  for (const key of ['source', 'tests', 'mutations', 'dryrun']) safeRelative(config[key], key)
  if (!/^[a-z0-9][a-z0-9-]*$/.test(config.slug)) throw new Error('slug: только строчные латинские буквы, цифры и дефис')
  return config
}

function readBot (dir) {
  const root = resolveWorkspace(dir)
  const config = readConfig(root)
  return { root, config, bot: readJson(path.join(root, config.source)) }
}

function writeBot (dir, bot) {
  const root = resolveWorkspace(dir)
  const config = readConfig(root)
  fs.writeFileSync(path.join(root, config.source), JSON.stringify(bot, null, 2) + '\n', 'utf8')
}

function initWorkspace (dir, options = {}) {
  const root = resolveWorkspace(dir)
  if (fs.existsSync(root) && fs.readdirSync(root).length && !options.force) throw new Error('Папка не пуста. Выберите другую или используйте --force')
  const assets = path.join(__dirname, '..', 'assets', 'starter')
  fs.mkdirSync(root, { recursive: true })
  fs.cpSync(assets, root, { recursive: true })
  fs.mkdirSync(path.join(root, 'upload'), { recursive: true })
  const file = configPath(root)
  const config = Object.assign({}, DEFAULT_CONFIG, readJson(file))
  if (options.name) config.name = options.name
  if (options.slug) config.slug = options.slug
  else if (options.name) config.slug = slugify(options.name)
  fs.writeFileSync(file, JSON.stringify(config, null, 2) + '\n', 'utf8')
  return { root, config }
}

function importWorkspace (archive, dir, entries, options = {}) {
  const root = resolveWorkspace(dir)
  if (fs.existsSync(root) && fs.readdirSync(root).length && !options.force) throw new Error('Папка не пуста. Выберите другую или используйте --force')
  const data = entries.find(x => x.name === 'data.txt')
  if (!data) throw new Error('В архиве нет data.txt')
  const bot = JSON.parse(data.data.toString('utf8'))
  fs.mkdirSync(root, { recursive: true })
  fs.mkdirSync(path.join(root, 'upload'), { recursive: true })
  for (const entry of entries) {
    if (!entry.name.startsWith('upload/') || entry.name.endsWith('/')) continue
    const relative = entry.name.slice('upload/'.length)
    safeRelative(relative, 'ZIP entry')
    const target = path.join(root, 'upload', relative)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, entry.data)
  }
  const name = bot.groups && bot.groups[0] && bot.groups[0].name ? bot.groups[0].name : 'Imported Quescha bot'
  const config = Object.assign({}, DEFAULT_CONFIG, { name, slug: options.slug || slugify(name) })
  fs.writeFileSync(configPath(root), JSON.stringify(config, null, 2) + '\n', 'utf8')
  fs.writeFileSync(path.join(root, 'bot.json'), JSON.stringify(bot, null, 2) + '\n', 'utf8')
  fs.writeFileSync(path.join(root, 'tests.js'), genericTests(), 'utf8')
  fs.writeFileSync(path.join(root, 'mutations.js'), genericMutations(), 'utf8')
  fs.writeFileSync(path.join(root, '.gitignore'), 'dist/\ndata.txt\n', 'utf8')
  return { root, config, bot }
}

async function loadChecks (file) {
  if (!fs.existsSync(file)) return []
  const loaded = require(file)
  const checks = typeof loaded === 'function' ? await loaded() : loaded
  if (!Array.isArray(checks)) throw new Error(`${file} должен экспортировать массив проверок`)
  return checks
}

async function loadDryRunOptions (root, bot, config) {
  const file = path.join(root, config.dryrun)
  if (!fs.existsSync(file)) return {}
  const loaded = require(file)
  const options = typeof loaded === 'function' ? await loaded(bot) : loaded
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new Error(`${file} должен экспортировать объект настроек dry-run`)
  return options
}

async function checkBot (root, bot) {
  const config = readConfig(root)
  const options = await loadDryRunOptions(root, bot, config)
  return require('./full-check').fullCheck(bot, options)
}

async function runTests (dir, bot) {
  const root = resolveWorkspace(dir)
  const config = readConfig(root)
  const checks = await loadChecks(path.join(root, config.tests))
  const results = []
  for (const check of checks) {
    if (!check || typeof check.name !== 'string' || typeof check.run !== 'function') throw new Error('Каждый тест: {name, run(bot, assert)}')
    try {
      await check.run(bot, require('assert/strict'))
      results.push({ name: check.name, ok: true })
    } catch (e) {
      results.push({ name: check.name, ok: false, message: e.message })
    }
  }
  return { ok: results.every(x => x.ok), total: results.length, failed: results.filter(x => !x.ok).length, results }
}

async function runMutations (dir, original) {
  const root = resolveWorkspace(dir)
  const config = readConfig(root)
  const mutations = await loadChecks(path.join(root, config.mutations))
  if (!mutations.length) throw new Error('mutations.js пуст: добавьте хотя бы одну контрольную поломку')
  const results = []
  for (const mutation of mutations) {
    if (!mutation || typeof mutation.name !== 'string' || typeof mutation.mutate !== 'function') throw new Error('Каждая мутация: {name, mutate(bot)}')
    const bot = JSON.parse(JSON.stringify(original))
    const caughtBy = []
    let setupError = null
    try {
      await mutation.mutate(bot)
      const validation = await checkBot(root, bot)
      if (!validation.ok) {
        const codes = validation.issues.filter(x => x.severity === 'error').map(x => x.code)
        caughtBy.push(...new Set(codes))
        if (mutation.expect && !codes.includes(mutation.expect)) {
          results.push({ name: mutation.name, ok: false, message: `Ожидалась ${mutation.expect}, получены ${codes.join(', ')}` })
          continue
        }
      }
      const tests = await runTests(root, bot)
      for (const test of tests.results.filter(x => !x.ok)) caughtBy.push(`test:${test.name}`)
      if (!caughtBy.length) results.push({ name: mutation.name, ok: false, message: 'Поломка не поймана ни валидатором, ни тестами' })
      else results.push({ name: mutation.name, ok: true, caughtBy })
    } catch (e) {
      setupError = e.message
      results.push({ name: mutation.name, ok: false, message: `Ошибка мутации: ${setupError}` })
    }
  }
  return { ok: results.every(x => x.ok), total: results.length, caught: results.filter(x => x.ok).length, missed: results.filter(x => !x.ok).length, results }
}

async function loadBot (dir) {
  const loaded = readBot(dir)
  const codeFile = path.join(loaded.root, 'external.code.js')
  if (fs.existsSync(codeFile)) {
    const code = fs.readFileSync(codeFile, 'utf8')
    const compiler = require('../compiler')
    const result = await compiler.compileScenarios(code, compiler.namesFrom(loaded.bot))
    if (result.problems.length) throw new Error('Ошибки external.code.js:\n' + result.problems.join('\n'))
    for (const scenario of result.list) {
      const actions = JSON.stringify(scenario.actions)
      const index = loaded.bot.external.findIndex(item => item.name === scenario.name)
      if (index >= 0) loaded.bot.external[index].actions = actions
      else {
        const nextId = loaded.bot.external.reduce((max, item) => Math.max(max, Number(item.id) || 0), 96000) + 1
        loaded.bot.external.push({
          id: nextId, name: scenario.name, ordernumber: loaded.bot.external.length,
          actions, BotGroupId: loaded.bot.groups[0] && loaded.bot.groups[0].id, CrmId: null
        })
      }
    }
  }
  const linked = require('../compiler').linkScenarioRefs(loaded.bot)
  if (linked.missing.length) throw new Error('Блоки ссылаются на несуществующие сценарии: ' + linked.missing.join(', '))
  return loaded
}

function summarize (bot) {
  let blocks = 0
  let actions = 0
  for (const message of bot.messages || []) {
    try { blocks += JSON.parse(message.message).length } catch (e) {}
  }
  for (const scenario of bot.external || []) {
    try { actions += JSON.parse(scenario.actions).length } catch (e) {}
  }
  return {
    groups: (bot.groups || []).length,
    chains: (bot.chains || []).length,
    blocks,
    lists: (bot.lists || []).length,
    globals: (bot.global || []).length,
    scenarios: (bot.external || []).length,
    actions,
    webapps: (bot.webapp || []).length
  }
}

function readJson (file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')) } catch (e) { throw new Error(`${file}: ${e.message}`) }
}

function safeRelative (value, label) {
  if (typeof value !== 'string' || !value || path.isAbsolute(value) || value.split(/[\\/]/).includes('..')) throw new Error(`${label}: нужен относительный путь без ..`)
}

function slugify (value) {
  const translit = { а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'y',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'h',ц:'c',ч:'ch',ш:'sh',щ:'sch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya' }
  const slug = String(value).toLowerCase().split('').map(c => translit[c] === undefined ? c : translit[c]).join('').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64)
  return slug || 'quescha-bot'
}

function genericTests () {
  return `'use strict'\n\nmodule.exports = [\n  {\n    name: 'В экспорте есть проект и цепочка',\n    run (bot, assert) {\n      assert.ok(bot.groups.length > 0)\n      assert.ok(bot.chains.length > 0)\n    }\n  }\n]\n`
}

function genericMutations () {
  return `'use strict'\n\nmodule.exports = [\n  {\n    name: 'Проект удалён',\n    expect: 'E_GROUPS_EMPTY',\n    mutate (bot) { bot.groups = [] }\n  }\n]\n`
}

module.exports = {
  DEFAULT_CONFIG, resolveWorkspace, readConfig, readBot, loadBot, writeBot, initWorkspace,
  importWorkspace, runTests, runMutations, checkBot, summarize, readJson, safeRelative,
  slugify, pathToFileURL
}
