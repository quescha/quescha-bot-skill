'use strict'

const fs = require('fs')
const path = require('path')
const root = path.resolve(__dirname, '..')
const problems = []
const allowed = new Set(['.js', '.json', '.md', '.txt'])

function walk (dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', 'dist'].includes(entry.name)) continue
    const full = path.join(dir, entry.name)
    const relative = path.relative(root, full).split(path.sep).join('/')
    if (entry.isSymbolicLink()) problems.push(`${relative}: символическая ссылка`)
    else if (entry.isDirectory()) walk(full)
    else {
      const base = entry.name
      if (base === '.gitignore') continue
      if (!allowed.has(path.extname(base))) problems.push(`${relative}: непубличный тип файла`)
      if (/^\.env(?:\.|$)/i.test(base) || /\.zip$/i.test(base)) problems.push(`${relative}: секреты и архивы не публикуются`)
      const text = fs.readFileSync(full, 'utf8')
      const forbidden = [
        ['локальный путь разработчика', /C:\/Users\/AK|C:\/node\/|\/home\/[A-Za-z0-9._-]+\/QueschaNeuroDev/],
        ['внутренний путь платформы', /backend\/src\/|middleware\/qbcompile|sequelize\.sync|static\/upload\/bot/],
        ['чтение серверного окружения', /process\.env\.[A-Z][A-Z0-9_]+/],
        ['приватный ключ', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
        ['токен Telegram', /\b\d{6,12}:[A-Za-z0-9_-]{30,}\b/],
        ['реальный API-ключ', /\b(?:sk-[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{20,}|AKIA[A-Z0-9]{16})\b/],
        ['JWT', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/]
      ]
      for (const [label, pattern] of forbidden) {
        if (pattern.test(text) && !isPatternDefinition(relative)) problems.push(`${relative}: ${label}`)
      }
    }
  }
}

function isPatternDefinition (file) {
  return file === 'scripts/audit-public.js' || file === 'skills/quescha-bot/src/validate.js' || file === 'test/validate.test.js'
}

walk(root)
if (problems.length) {
  console.error(problems.join('\n'))
  process.exitCode = 1
} else {
  console.log('Аудит публичных файлов: секретов, локальных путей и серверных импортов не найдено')
}
