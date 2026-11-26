'use strict'

const fs = require('fs')
const path = require('path')
const zlib = require('zlib')
const { MAX_ARCHIVE_BYTES } = require('./constants')

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
  return c >>> 0
})

function crc32 (buffer) {
  let c = 0xffffffff
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function createZip (entries) {
  const local = []
  const central = []
  let offset = 0
  let count = 0
  for (const entry of entries) {
    const name = safeEntryName(entry.name)
    const isDirectory = name.endsWith('/')
    const data = isDirectory ? Buffer.alloc(0) : Buffer.from(entry.data || '')
    const nameBuffer = Buffer.from(name, 'utf8')
    const crc = crc32(data)
    const head = Buffer.alloc(30)
    head.writeUInt32LE(0x04034b50, 0)
    head.writeUInt16LE(20, 4)
    head.writeUInt16LE(0x0800, 6)
    head.writeUInt16LE(0, 8)
    head.writeUInt16LE(0, 10)
    head.writeUInt16LE(0x0021, 12)
    head.writeUInt32LE(crc, 14)
    head.writeUInt32LE(data.length, 18)
    head.writeUInt32LE(data.length, 22)
    head.writeUInt16LE(nameBuffer.length, 26)
    head.writeUInt16LE(0, 28)
    local.push(head, nameBuffer, data)

    const row = Buffer.alloc(46)
    row.writeUInt32LE(0x02014b50, 0)
    row.writeUInt16LE(20, 4)
    row.writeUInt16LE(20, 6)
    row.writeUInt16LE(0x0800, 8)
    row.writeUInt16LE(0, 10)
    row.writeUInt16LE(0, 12)
    row.writeUInt16LE(0x0021, 14)
    row.writeUInt32LE(crc, 16)
    row.writeUInt32LE(data.length, 20)
    row.writeUInt32LE(data.length, 24)
    row.writeUInt16LE(nameBuffer.length, 28)
    row.writeUInt16LE(0, 30)
    row.writeUInt16LE(0, 32)
    row.writeUInt16LE(0, 34)
    row.writeUInt16LE(0, 36)
    row.writeUInt32LE(isDirectory ? 0x10 : 0, 38)
    row.writeUInt32LE(offset, 42)
    central.push(row, nameBuffer)
    offset += head.length + nameBuffer.length + data.length
    count++
  }
  const centralSize = central.reduce((n, b) => n + b.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(count, 8)
  end.writeUInt16LE(count, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20)
  return Buffer.concat([...local, ...central, end])
}

function readZip (input) {
  const buffer = Buffer.isBuffer(input) ? input : fs.readFileSync(input)
  if (buffer.length > MAX_ARCHIVE_BYTES) throw new Error('Архив больше 100 МБ')
  let eocd = -1
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('Это не ZIP-архив')
  if (buffer.readUInt16LE(eocd + 4) !== 0 || buffer.readUInt16LE(eocd + 6) !== 0) throw new Error('Многотомные ZIP не поддерживаются')
  const count = buffer.readUInt16LE(eocd + 10)
  if (count > 1000) throw new Error('Слишком много файлов в архиве')
  let cursor = buffer.readUInt32LE(eocd + 16)
  const entries = []
  const names = new Set()
  let total = 0
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== 0x02014b50) throw new Error('Повреждён каталог ZIP')
    const flags = buffer.readUInt16LE(cursor + 8)
    const method = buffer.readUInt16LE(cursor + 10)
    const expectedCrc = buffer.readUInt32LE(cursor + 16)
    const compressedSize = buffer.readUInt32LE(cursor + 20)
    const size = buffer.readUInt32LE(cursor + 24)
    const nameLength = buffer.readUInt16LE(cursor + 28)
    const extraLength = buffer.readUInt16LE(cursor + 30)
    const commentLength = buffer.readUInt16LE(cursor + 32)
    const localOffset = buffer.readUInt32LE(cursor + 42)
    const name = safeEntryName(buffer.toString('utf8', cursor + 46, cursor + 46 + nameLength))
    if (names.has(name)) throw new Error(`Дубликат файла в ZIP: ${name}`)
    names.add(name)
    if (flags & 1) throw new Error(`Зашифрованный файл не поддерживается: ${name}`)
    if (method !== 0 && method !== 8) throw new Error(`Метод сжатия ${method} не поддерживается: ${name}`)
    total += size
    if (total > MAX_ARCHIVE_BYTES) throw new Error('Распакованный архив больше 100 МБ')
    if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error(`Повреждён локальный заголовок: ${name}`)
    const localNameLength = buffer.readUInt16LE(localOffset + 26)
    const localExtraLength = buffer.readUInt16LE(localOffset + 28)
    const start = localOffset + 30 + localNameLength + localExtraLength
    if (start + compressedSize > buffer.length) throw new Error(`Повреждены данные: ${name}`)
    const compressed = buffer.subarray(start, start + compressedSize)
    const data = name.endsWith('/') ? Buffer.alloc(0) : (method === 8 ? zlib.inflateRawSync(compressed) : compressed)
    if (data.length !== size || crc32(data) !== expectedCrc) throw new Error(`Контрольная сумма не совпала: ${name}`)
    entries.push({ name, data })
    cursor += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

function safeEntryName (name) {
  const normalized = String(name).replace(/\\/g, '/')
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized) || normalized.split('/').includes('..')) {
    throw new Error(`Небезопасный путь в ZIP: ${name}`)
  }
  return normalized
}

function writeBotArchive (output, bot, uploadDir) {
  const entries = [{ name: 'upload/', data: Buffer.alloc(0) }]
  if (uploadDir && fs.existsSync(uploadDir)) {
    const files = filesBelow(uploadDir)
    for (const file of files) {
      const stat = fs.lstatSync(file)
      if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`В upload разрешены только обычные файлы: ${file}`)
      entries.push({ name: 'upload/' + path.relative(uploadDir, file).split(path.sep).join('/'), data: fs.readFileSync(file) })
    }
  }
  entries.push({ name: 'data.txt', data: Buffer.from(JSON.stringify(bot), 'utf8') })
  const archive = createZip(entries)
  if (archive.length > MAX_ARCHIVE_BYTES) throw new Error('Архив больше 100 МБ')
  fs.mkdirSync(path.dirname(output), { recursive: true })
  fs.writeFileSync(output, archive)
  return { output, files: entries.length - 2, bytes: archive.length }
}

function filesBelow (dir) {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isSymbolicLink()) throw new Error(`Символические ссылки запрещены: ${full}`)
    if (entry.isDirectory()) out.push(...filesBelow(full))
    else out.push(full)
  }
  return out.sort()
}

module.exports = { createZip, readZip, writeBotArchive, crc32, safeEntryName }
