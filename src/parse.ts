/**
 * Extract readable text from the formats a proposal actually arrives in.
 *
 * A `.docx` is a ZIP whose `word/document.xml` holds the body text. A `.pdf` is
 * deliberately not parsed here: page-accurate PDF text extraction is a different
 * problem with a different failure mode, and guessing at it would put unverified
 * page numbers into findings. So:
 *
 *   - `.docx` / `.docm`: text and document properties are extracted here;
 *   - `.txt` / `.md`: taken as text;
 *   - `.pdf`: the caller extracts the text and passes it in, and a warning records
 *     that the extraction did not happen here;
 *   - JSON: `{ text | lines, metadata }`.
 *
 * The ZIP reader is deliberately minimal: a proposal is a document, not an
 * archive, so it understands only stored and deflated entries and refuses
 * everything else loudly rather than producing a half-read document.
 */

import { inflateRawSync } from 'node:zlib'
import { YamlSubsetError, parseYaml } from './shared/yaml.ts'
import type { DocumentMetadata, ProposalInput, TextLine } from './model.ts'

/** Raised when a material cannot be read at all. */
export class MaterialError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MaterialError'
  }
}

const EOCD_SIGNATURE = 0x06054b50
const CENTRAL_SIGNATURE = 0x02014b50
const LOCAL_SIGNATURE = 0x04034b50

/**
 * Read the entries of a ZIP archive.
 * @param buffer - the whole archive.
 * @returns entry path to bytes.
 * @throws MaterialError when the archive is not a ZIP, or uses an unsupported method.
 */
export function readZipEntries(buffer: Buffer): Map<string, Buffer> {
  const eocd = findEndOfCentralDirectory(buffer)
  if (eocd < 0) throw new MaterialError('不是有效的 ZIP 包（未找到中央目录）')
  const entryCount = buffer.readUInt16LE(eocd + 10)
  let offset = buffer.readUInt32LE(eocd + 16)
  const out = new Map<string, Buffer>()
  for (let index = 0; index < entryCount; index++) {
    if (offset + 46 > buffer.length) throw new MaterialError('ZIP 中央目录被截断')
    if (buffer.readUInt32LE(offset) !== CENTRAL_SIGNATURE) throw new MaterialError('ZIP 中央目录项签名不符')
    const method = buffer.readUInt16LE(offset + 10)
    const compressedSize = buffer.readUInt32LE(offset + 20)
    const nameLength = buffer.readUInt16LE(offset + 28)
    const extraLength = buffer.readUInt16LE(offset + 30)
    const commentLength = buffer.readUInt16LE(offset + 32)
    const localOffset = buffer.readUInt32LE(offset + 42)
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength)
    offset += 46 + nameLength + extraLength + commentLength
    if (name.endsWith('/')) continue
    if (buffer.readUInt32LE(localOffset) !== LOCAL_SIGNATURE) throw new MaterialError(`ZIP 本地头签名不符：${name}`)
    const localNameLength = buffer.readUInt16LE(localOffset + 26)
    const localExtraLength = buffer.readUInt16LE(localOffset + 28)
    const start = localOffset + 30 + localNameLength + localExtraLength
    const raw = buffer.subarray(start, start + compressedSize)
    if (method === 0) out.set(name, Buffer.from(raw))
    else if (method === 8) out.set(name, inflateRawSync(raw))
    else throw new MaterialError(`ZIP 压缩方法 ${method} 不受支持：${name}`)
  }
  return out
}

/** Offset of the end-of-central-directory record, or -1. */
function findEndOfCentralDirectory(buffer: Buffer): number {
  const earliest = Math.max(0, buffer.length - 66_000)
  for (let offset = buffer.length - 22; offset >= earliest; offset--) {
    if (buffer.readUInt32LE(offset) === EOCD_SIGNATURE) return offset
  }
  return -1
}

/** Decode the XML entities that appear in document bodies. */
export function decodeXmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&amp;/g, '&')
}

/**
 * Turn `word/document.xml` into line-per-paragraph text.
 * @param xml - the document part.
 * @returns one entry per non-empty paragraph.
 */
export function textFromDocumentXml(xml: string): string[] {
  const paragraphs = xml.split(/<w:p[\s>]/).slice(1)
  const lines: string[] = []
  for (const paragraph of paragraphs) {
    const pieces: string[] = []
    const runs = paragraph.split(/<w:t(?:\s[^>]*)?>/).slice(1)
    for (const run of runs) {
      const end = run.indexOf('</w:t>')
      pieces.push(decodeXmlEntities(end < 0 ? run : run.slice(0, end)))
    }
    const line = pieces.join('').replace(/\s+/g, ' ').trim()
    if (line !== '') lines.push(line)
  }
  return lines
}

/** Read one property element out of a docx properties part. */
function readCoreProperty(xml: string, tag: string): string | undefined {
  const pattern = new RegExp(`<(?:[\\w-]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${tag}>`, 'i')
  const match = pattern.exec(xml)
  if (match === null) return undefined
  const value = decodeXmlEntities(match[1] ?? '').trim()
  return value === '' ? undefined : value
}

/**
 * Extract text and document properties from a `.docx` package.
 * @param buffer - the whole file.
 * @returns extracted paragraph lines and the properties a reader never sees.
 */
export function extractDocx(buffer: Buffer): { lines: string[]; metadata: DocumentMetadata; warnings: string[] } {
  const entries = readZipEntries(buffer)
  const document = entries.get('word/document.xml')
  if (document === undefined) throw new MaterialError('docx 包中缺少 word/document.xml，可能不是 Word 文档')
  const warnings: string[] = []
  const lines = textFromDocumentXml(document.toString('utf8'))
  const metadata: DocumentMetadata = {}
  const core = entries.get('docProps/core.xml')
  if (core !== undefined) {
    const xml = core.toString('utf8')
    const title = readCoreProperty(xml, 'title')
    if (title !== undefined) metadata.title = title
    const author = readCoreProperty(xml, 'creator')
    if (author !== undefined) metadata.author = author
    const lastModifiedBy = readCoreProperty(xml, 'lastModifiedBy')
    if (lastModifiedBy !== undefined) metadata.lastModifiedBy = lastModifiedBy
  } else {
    warnings.push('docx 包中缺少 docProps/core.xml，无法读取文档属性中的作者等字段')
  }
  const app = entries.get('docProps/app.xml')
  if (app !== undefined) {
    const company = readCoreProperty(app.toString('utf8'), 'Company')
    if (company !== undefined) metadata.company = company
  }
  if (entries.has('word/comments.xml')) warnings.push('文档包含批注（word/comments.xml），批注文本未纳入本次检查')
  if (entries.has('word/header1.xml') || entries.has('word/footer1.xml')) {
    warnings.push('文档包含页眉或页脚，其文本未纳入本次检查')
  }
  return { lines, metadata, warnings }
}

/** Split plain text into non-empty, whitespace-collapsed lines. */
export function linesFromText(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line !== '')
}

/** What the caller hands to {@link parseMaterial}. */
export interface MaterialSource {
  /** File name or description, used as the report target. */
  target: string
  /** Raw file bytes, when the material came from a file. */
  bytes?: Buffer
  /** Already-extracted text, when the caller read the file itself. */
  text?: string
  /** Document metadata the caller already knows (a PDF's author field, for example). */
  metadata?: DocumentMetadata
}

function padLines(lines: string[]): TextLine[] {
  return lines.map((text, index) => ({ line: index + 1, text }))
}

/**
 * Normalize a material source into the input contract.
 * @param source - bytes, text, or both, plus any metadata the caller knows.
 * @returns the normalized input.
 */
export function parseMaterial(source: MaterialSource): ProposalInput {
  const warnings: string[] = []
  const extension = (source.target.split('.').pop() ?? '').toLowerCase()
  let lines: string[] = []
  let metadata: DocumentMetadata = { ...(source.metadata ?? {}) }

  if (source.bytes !== undefined) {
    if (extension === 'docx' || extension === 'docm' || extension === 'dotx') {
      const extracted = extractDocx(source.bytes)
      lines = extracted.lines
      metadata = { ...extracted.metadata, ...metadata }
      warnings.push(...extracted.warnings)
    } else if (extension === 'pdf') {
      if (source.text === undefined || source.text.trim() === '') {
        throw new MaterialError(
          '本插件不解析 PDF 正文；请先用你信任的工具抽取文本，再通过 text 字段传入（PDF 元数据可放在 metadata）',
        )
      }
      lines = linesFromText(source.text)
      warnings.push('材料为 PDF：正文由调用方抽取，本插件未产生页级定位')
    } else {
      lines = linesFromText(source.bytes.toString('utf8'))
    }
  } else if (source.text !== undefined && source.text.trim() !== '') {
    const trimmed = source.text.trim()
    if (trimmed.startsWith('{')) {
      let parsed: unknown
      try {
        parsed = JSON.parse(trimmed)
      } catch (error) {
        throw new MaterialError(`JSON 无法解析：${error instanceof Error ? error.message : String(error)}`)
      }
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new MaterialError('JSON 材料的根节点必须是对象')
      }
      const record = parsed as Record<string, unknown>
      if (Array.isArray(record.lines)) {
        lines = record.lines.map((entry) => String(entry).replace(/\s+/g, ' ').trim()).filter((entry) => entry !== '')
      } else if (typeof record.text === 'string') {
        lines = linesFromText(record.text)
      }
      if (typeof record.metadata === 'object' && record.metadata !== null) {
        const raw = record.metadata as Record<string, unknown>
        for (const key of ['title', 'author', 'company', 'lastModifiedBy'] as const) {
          const value = raw[key]
          if (typeof value === 'string' && value.trim() !== '') metadata[key] = value.trim()
        }
      }
    } else {
      lines = linesFromText(source.text)
    }
  }

  if (lines.length === 0) throw new MaterialError('未能从材料中读取到任何正文行')

  return {
    target: source.target,
    lines: padLines(lines),
    metadata,
    sourceFormat: extension === '' ? 'text' : extension,
    warnings,
  }
}

/** Parse a YAML roster document; used by fixtures and by CLI-style callers. */
export function parseRosterYaml(source: string): Record<string, unknown> {
  try {
    const parsed = parseYaml(source)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new MaterialError('名单根节点必须是映射')
    }
    return parsed as Record<string, unknown>
  } catch (error) {
    if (error instanceof YamlSubsetError) throw new MaterialError(`名单 YAML 无法解析：${error.message}`)
    throw error
  }
}
