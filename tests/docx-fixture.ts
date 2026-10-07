/**
 * Minimal `.docx` writer for tests.
 *
 * Building the archive here means the docx path is exercised for real — the
 * reader has to walk a genuine ZIP and pull text out of `w:document` XML — while
 * the fixtures stay reviewable text files instead of opaque binaries.
 */

import { deflateRawSync } from 'node:zlib'

interface Entry {
  name: string
  data: Buffer
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index++) {
    let value = index
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    table[index] = value >>> 0
  }
  return table
})()

/** CRC-32 as required by the ZIP format. */
function crc32(buffer: Buffer): number {
  let crc = 0xffffffff
  for (const byte of buffer) crc = (CRC_TABLE[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

/** Assemble a ZIP archive from in-memory entries, deflating each one. */
function buildZip(entries: Entry[]): Buffer {
  const chunks: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.name, 'utf8')
    const compressed = deflateRawSync(entry.data)
    const crc = crc32(entry.data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(8, 8)
    local.writeUInt16LE(0, 10)
    local.writeUInt16LE(0, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(compressed.length, 18)
    local.writeUInt32LE(entry.data.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    local.writeUInt16LE(0, 28)
    chunks.push(local, nameBytes, compressed)

    const header = Buffer.alloc(46)
    header.writeUInt32LE(0x02014b50, 0)
    header.writeUInt16LE(20, 4)
    header.writeUInt16LE(20, 6)
    header.writeUInt16LE(0, 8)
    header.writeUInt16LE(8, 10)
    header.writeUInt16LE(0, 12)
    header.writeUInt16LE(0, 14)
    header.writeUInt32LE(crc, 16)
    header.writeUInt32LE(compressed.length, 20)
    header.writeUInt32LE(entry.data.length, 24)
    header.writeUInt16LE(nameBytes.length, 28)
    header.writeUInt16LE(0, 30)
    header.writeUInt16LE(0, 32)
    header.writeUInt16LE(0, 34)
    header.writeUInt16LE(0, 36)
    header.writeUInt32LE(0, 38)
    header.writeUInt32LE(offset, 42)
    central.push(header, nameBytes)
    offset += local.length + nameBytes.length + compressed.length
  }
  const centralBuffer = Buffer.concat(central)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralBuffer.length, 12)
  eocd.writeUInt32LE(offset, 16)
  eocd.writeUInt16LE(0, 20)
  return Buffer.concat([...chunks, centralBuffer, eocd])
}

/** Escape text for inclusion in XML. */
function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Render paragraphs as a WordprocessingML body. */
function documentXml(paragraphs: readonly string[]): string {
  const body = paragraphs
    .map((paragraph) => `<w:p><w:r><w:t xml:space="preserve">${escapeXml(paragraph)}</w:t></w:r></w:p>`)
    .join('')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`
}

/** Document properties, including the fields an anonymity check cares about. */
export function coreXml(properties: {
  title?: string
  creator?: string
  lastModifiedBy?: string
}): string {
  const parts = [
    properties.title === undefined ? '' : `<dc:title>${escapeXml(properties.title)}</dc:title>`,
    properties.creator === undefined ? '' : `<dc:creator>${escapeXml(properties.creator)}</dc:creator>`,
    properties.lastModifiedBy === undefined ? '' : `<cp:lastModifiedBy>${escapeXml(properties.lastModifiedBy)}</cp:lastModifiedBy>`,
  ].join('')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">${parts}</cp:coreProperties>`
}

/** Application properties, including the company field. */
export function appXml(properties: { company?: string }): string {
  const company = properties.company === undefined ? '' : `<Company>${escapeXml(properties.company)}</Company>`
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">${company}</Properties>`
}

/** Build a `.docx` buffer from paragraphs and document properties. */
export function buildDocx(
  paragraphs: readonly string[],
  properties: { title?: string; creator?: string; lastModifiedBy?: string; company?: string } = {},
): Buffer {
  const entries: Entry[] = [
    { name: '[Content_Types].xml', data: Buffer.from('<?xml version="1.0"?><Types/>', 'utf8') },
    { name: 'word/document.xml', data: Buffer.from(documentXml(paragraphs), 'utf8') },
    { name: 'docProps/core.xml', data: Buffer.from(coreXml(properties), 'utf8') },
  ]
  if (properties.company !== undefined) {
    entries.push({ name: 'docProps/app.xml', data: Buffer.from(appXml(properties), 'utf8') })
  }
  return buildZip(entries)
}
