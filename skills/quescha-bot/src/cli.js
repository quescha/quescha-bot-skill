'use strict'

const fs = require('fs')
const path = require('path')
const { readZip, writeBotArchive } = require('./zip')
const {
  loadBot, initWorkspace, importWorkspace, runTests,
  runMutations, checkBot, summarize
} = require('./workspace')

const HELP = `Quescha Bot Skill — создание ZIP для импорта в Quescha

Использование:
  quescha-bot init <папка> [--name "Название"] [--slug id]
  quescha-bot check [папка] [--json]
  quescha-bot test [папка] [--json]
  quescha-bot mutate [папка] [--json]
  quescha-bot pack [папка] [--output файл.zip] [--json]
  quescha-bot build [папка] [--output файл.zip] [--json]
  quescha-bot unpack <архив.zip> <папка> [--force] [--json]
  quescha-bot inspect <архив.zip> [--json]

build = check + test + mutate + pack. Node.js 18+, сеть и API-ключи не нужны.`

async function main (args) {
  const json = args.includes('--json')
  const clean = args.filter(x => x !== '--json')
  const command = clean[0]
  try {
    if (!command || command === '--help' || command === '-h' || command === 'help') {
      if (json) print({ ok: true, help: HELP }, true)
      else console.log(HELP)
      return command ? 0 : 2
    }
    let output
    switch (command) {
      case 'init': {
        const dir = required(clean[1], 'Укажите папку: init <папка>')
        output = { ok: true, command, ...initWorkspace(dir, { name: option(clean, '--name'), slug: option(clean, '--slug'), force: clean.includes('--force') }) }
        break
      }
      case 'check': {
        const { root, bot } = await loadBot(clean[1] || '.')
        output = { command, ...await checkBot(root, bot), summary: summarize(bot) }
        break
      }
      case 'test': {
        const { root, bot } = await loadBot(clean[1] || '.')
        output = { command, ...await runTests(root, bot) }
        break
      }
      case 'mutate': {
        const { root, bot } = await loadBot(clean[1] || '.')
        output = { command, ...await runMutations(root, bot) }
        break
      }
      case 'pack':
      case 'build': {
        const { root, bot } = await loadBot(clean[1] || '.')
        const validation = await checkBot(root, bot)
        if (!validation.ok) {
          output = { command, ok: false, stage: 'check', ...validation }
          break
        }
        if (command === 'build') {
          const tests = await runTests(root, bot)
          if (!tests.ok) { output = { command, ok: false, stage: 'test', ...tests }; break }
          const mutations = await runMutations(root, bot)
          if (!mutations.ok) { output = { command, ok: false, stage: 'mutate', ...mutations }; break }
        }
        const config = require('./workspace').readConfig(root)
        const target = path.resolve(option(clean, '--output') || path.join(root, 'dist', config.slug + '.zip'))
        const text = JSON.stringify(bot)
        fs.writeFileSync(path.join(root, 'data.txt'), text, 'utf8')
        const archive = writeBotArchive(target, bot, path.join(root, 'upload'))
        output = { ok: true, command, archive, validation, summary: summarize(bot) }
        break
      }
      case 'unpack': {
        const archive = required(clean[1], 'Укажите архив: unpack <архив.zip> <папка>')
        const dir = required(clean[2], 'Укажите папку назначения')
        const entries = readZip(archive)
        const result = importWorkspace(archive, dir, entries, { force: clean.includes('--force'), slug: option(clean, '--slug') })
        output = { command, root: result.root, config: result.config, ...await checkBot(result.root, result.bot), summary: summarize(result.bot) }
        break
      }
      case 'inspect': {
        const archive = required(clean[1], 'Укажите архив: inspect <архив.zip>')
        const entries = readZip(archive)
        const data = entries.find(x => x.name === 'data.txt')
        if (!data) throw new Error('В архиве нет data.txt')
        const bot = JSON.parse(data.data.toString('utf8'))
        output = { command, archive: path.resolve(archive), entries: entries.map(x => ({ name: x.name, bytes: x.data.length })), ...await require('./full-check').fullCheck(bot), summary: summarize(bot) }
        break
      }
      default:
        print({ ok: false, message: `Неизвестная команда: ${command}`, help: HELP }, json)
        return 2
    }
    print(output, json)
    return output.ok ? 0 : 1
  } catch (e) {
    print({ ok: false, message: e.message }, json)
    return 2
  }
}

function print (output, json) {
  if (json) { console.log(JSON.stringify(output, null, 2)); return }
  if (output.help) console.log(output.help)
  if (output.message) console.log(output.message)
  if (output.root) console.log(`Папка: ${output.root}`)
  if (output.archive && typeof output.archive === 'object') console.log(`ZIP: ${output.archive.output}\nРазмер: ${output.archive.bytes} байт; вложений: ${output.archive.files}`)
  if (output.summary) console.log(`Состав: ${output.summary.chains} цепочек, ${output.summary.blocks} блоков, ${output.summary.lists} списков, ${output.summary.scenarios} сценариев, ${output.summary.actions} действий`)
  if (Array.isArray(output.issues)) {
    for (const issue of output.issues) console.log(`${issue.severity === 'error' ? 'ОШИБКА' : 'ЗАМЕЧАНИЕ'} ${issue.code} ${issue.path}: ${issue.message}`)
    console.log(`Проверка: ${output.errors} ошибок, ${output.warnings} замечаний`)
  }
  if (Array.isArray(output.results)) {
    for (const item of output.results) {
      console.log(`${item.ok ? 'OK' : 'ОШИБКА'} ${item.name}${item.message ? ': ' + item.message : ''}${item.caughtBy ? ' → ' + item.caughtBy.join(', ') : ''}`)
    }
    if (output.failed !== undefined) console.log(`Тесты: ${output.total - output.failed}/${output.total}`)
    if (output.missed !== undefined) console.log(`Мутации: поймано ${output.caught}/${output.total}, пропущено ${output.missed}`)
  }
  if (output.ok && output.command === 'init') console.log('Шаблон создан. Отредактируйте bot.json, затем запустите build.')
}

function option (args, name) {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
function required (value, message) { if (!value || value.startsWith('--')) throw new Error(message); return value }

module.exports = { main, HELP }
