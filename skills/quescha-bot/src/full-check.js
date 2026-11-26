'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const { validateExport } = require('./validate')

async function fullCheck (bot, options = {}) {
  const validation = validateExport(bot)
  if (!validation.ok) return validation
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'quescha-dryrun-'))
  const source = path.join(temporary, 'bot.json')
  const report = []
  const originalLog = console.log
  try {
    fs.writeFileSync(source, JSON.stringify(bot), 'utf8')
    console.log = (...args) => report.push(args.map(String).join(' '))
    let dryrun
    try {
      dryrun = require('../checks/dryrun').run(source, options)
    } catch (error) {
      validation.issues.push({
        severity: 'error', code: 'E_DRYRUN_CRASH', path: '$',
        message: 'Полный dry-run не завершён: ' + (error && error.message ? error.message : String(error))
      })
      return finish(validation, { errors: 1, warnings: 0, report })
    }
    for (const line of report) {
      if (/^\s*ОШИБКА:/.test(line)) {
        validation.issues.push({ severity: 'error', code: 'E_DRYRUN', path: '$', message: line.replace(/^\s*ОШИБКА:\s*/, '') })
      } else if (/^\s*замечание:/.test(line)) {
        validation.issues.push({ severity: 'warning', code: 'W_DRYRUN', path: '$', message: line.replace(/^\s*замечание:\s*/, '') })
      }
    }
    return finish(validation, { errors: dryrun.errors, warnings: dryrun.warns, report })
  } finally {
    console.log = originalLog
    fs.rmSync(temporary, { recursive: true, force: true })
  }
}

function finish (validation, dryrun) {
  validation.ok = !validation.issues.some(issue => issue.severity === 'error')
  validation.errors = validation.issues.filter(issue => issue.severity === 'error').length
  validation.warnings = validation.issues.filter(issue => issue.severity === 'warning').length
  validation.dryrun = dryrun
  return validation
}

module.exports = { fullCheck }
