'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8')

test('public skill requires the shared traps journal and early smoke checks', () => {
  const skill = read('skills/quescha-bot/SKILL.md')
  assert.match(skill, /references\/traps\.md/)
  assert.match(skill, /пополняй этот единый журнал каждой новой ошибкой/)
  assert.match(skill, /Перед полными мутациями сделай раннюю smoke-проверку/)
  assert.match(skill, /В публичном CLI runtime нет/)
  assert.match(skill, /first: true/)
  assert.match(skill, /metrikafirst: true/)
  const guide = read('skills/quescha-bot/references/generation-guide.md')
  assert.match(guide, /ранняя smoke-проверка/)
  assert.match(guide, /повторное чтение/)
  assert.match(guide, /CLI не содержит runtime/)
  const checks = read('skills/quescha-bot/references/checks.md')
  assert.match(checks, /U\+2060/)
  assert.match(checks, /диалог после импорта/)
})

test('traps journal contains regressions and a public runtime boundary', () => {
  const traps = read('skills/quescha-bot/references/traps.md')
  for (const pattern of [/U\+2060/, /2026-11-28/, /1987/, /stend-smoke\.js/, /391\/391/, /10\/10 за 66 секунд/]) assert.match(traps, pattern)
  assert.match(traps, /Публичный CLI не содержит настоящий runtime Quescha/)
  assert.match(traps, /диалог после импорта обязателен/)
})
