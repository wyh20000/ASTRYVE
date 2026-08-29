import { PDFParse } from 'pdf-parse'
import mammoth from 'mammoth/lib/index.js'
import * as XLSX from 'xlsx'

/** 文档纯文本提取结果 */
export interface ExtractedText {
  text: string
  charCount: number
}

/** 单文档注入上限，防止超大文档撑爆上下文 */
const MAX_CHARS = 200000

function limit(text: string): string {
  const t = text.trim()
  return t.length > MAX_CHARS ? t.slice(0, MAX_CHARS) : t
}

/** dataRef 形如 "data:<mime>;base64,<payload>"，解出原始字节 */
function decode(dataRef: string): Buffer {
  const idx = dataRef.indexOf(',')
  const b64 = idx >= 0 ? dataRef.slice(idx + 1) : dataRef
  return Buffer.from(b64, 'base64')
}

async function extractPdf(buf: Buffer): Promise<string> {
  const parser = new PDFParse({ data: buf })
  const r = await parser.getText()
  return r.text ?? ''
}

async function extractDocx(buf: Buffer): Promise<string> {
  const r = await mammoth.extractRawText({ buffer: buf })
  return r.value ?? ''
}

function extractXlsx(buf: Buffer): string {
  const wb = XLSX.read(buf, { type: 'buffer' })
  return wb.SheetNames.map((name) => `# ${name}\n` + XLSX.utils.sheet_to_csv(wb.Sheets[name])).join(
    '\n\n'
  )
}

const TEXT_EXTS = new Set(['csv', 'txt', 'md', 'markdown', 'json', 'log'])

/** 按文件名解析文档为纯文本；不支持的扩展名抛错 */
export async function extractDocumentText(name: string, dataRef: string): Promise<ExtractedText> {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  const buf = decode(dataRef)
  let text: string
  switch (ext) {
    case 'pdf':
      text = await extractPdf(buf)
      break
    case 'docx':
      text = await extractDocx(buf)
      break
    case 'xlsx':
    case 'xls':
      text = extractXlsx(buf)
      break
    case 'csv':
    case 'txt':
    case 'md':
    case 'markdown':
    case 'json':
    case 'log':
      text = buf.toString('utf-8')
      break
    default:
      throw new Error(`不支持的文档类型：.${ext || '未知'}`)
  }
  const limited = limit(text)
  if (!limited) throw new Error('未能从文档中提取到文本')
  return { text: limited, charCount: limited.length }
}

/** 判断扩展名是否为可解析的文档/表格类型（与 renderer 端一致） */
export function isSupportedDocName(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  return (
    ext === 'pdf' ||
    ext === 'docx' ||
    ext === 'xlsx' ||
    ext === 'xls' ||
    TEXT_EXTS.has(ext)
  )
}

export { TEXT_EXTS }
