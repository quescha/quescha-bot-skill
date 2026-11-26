'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const AdmZip = require('adm-zip')
const { createZip, readZip, crc32, safeEntryName } = require('../skills/quescha-bot/src/zip')

test('ZIP round trip preserves UTF-8 names and data', () => {
  const input = [{ name: 'upload/', data: Buffer.alloc(0) }, { name: 'upload/файл.txt', data: Buffer.from('привет') }, { name: 'data.txt', data: Buffer.from('{"ok":true}') }]
  const output = readZip(createZip(input))
  assert.deepEqual(output.map(x => x.name), input.map(x => x.name))
  assert.equal(output[2].data.toString(), '{"ok":true}')
})

test('independent AdmZip reads generated archive', () => {
  const buffer = createZip([{ name: 'upload/', data: Buffer.alloc(0) }, { name: 'data.txt', data: Buffer.from('{"ok":true}') }])
  const zip = new AdmZip(buffer)
  assert.equal(zip.readAsText('data.txt'), '{"ok":true}')
  assert.ok(zip.getEntry('upload/'))
})

test('reader accepts deflated ZIP produced by AdmZip', () => {
  const zip = new AdmZip()
  zip.addFile('data.txt', Buffer.from('x'.repeat(10000)))
  const entries = readZip(zip.toBuffer())
  assert.equal(entries[0].data.length, 10000)
})

test('CRC32 matches standard value', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926)
})

test('unsafe paths are rejected', () => {
  for (const name of ['../secret', '/absolute', 'C:/absolute', 'upload/../../secret']) assert.throws(() => safeEntryName(name))
})

test('damaged ZIP checksum is rejected', () => {
  const buffer = createZip([{ name: 'data.txt', data: Buffer.from('original') }])
  const index = buffer.indexOf(Buffer.from('original'))
  buffer.write('modified', index)
  assert.throws(() => readZip(buffer), /Контрольная сумма/)
})
