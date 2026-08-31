import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import ExcelJS from 'exceljs'
import { extractDocumentText } from './document'

const dataRef = (mime: string, bytes: Buffer): string =>
  `data:${mime};base64,${bytes.toString('base64')}`

function buildTextPdf(text: string): Buffer {
  const escaped = text.replace(/([()\\])/g, '\\$1')
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${escaped.length + 35} >>\nstream\nBT /F1 18 Tf 30 80 Td (${escaped}) Tj ET\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ]
  let pdf = '%PDF-1.4\n'
  const offsets = [0]
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf))
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xref = Buffer.byteLength(pdf)
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  pdf += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  return Buffer.from(pdf, 'ascii')
}

async function buildDocx(text: string): Promise<Buffer> {
  const zip = new JSZip()
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
  )
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
  )
  zip.file(
    'word/document.xml',
    `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`
  )
  return zip.generateAsync({ type: 'nodebuffer' })
}

describe('真实文档解析器', () => {
  it('从真实 PDF 字节提取文本', async () => {
    const result = await extractDocumentText(
      'fixture.pdf',
      dataRef('application/pdf', buildTextPdf('Phase Two PDF'))
    )
    expect(result.text).toContain('Phase Two PDF')
  })

  it('从真实 DOCX 压缩包提取文本', async () => {
    const result = await extractDocumentText(
      'fixture.docx',
      dataRef(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        await buildDocx('Phase Two DOCX')
      )
    )
    expect(result.text).toContain('Phase Two DOCX')
  })

  it('从真实 XLSX 工作簿提取表格和工作表名', async () => {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('Results')
    sheet.addRows([['name', 'score'], ['Luna', 100]])
    const bytes = Buffer.from(await workbook.xlsx.writeBuffer())
    const result = await extractDocumentText(
      'fixture.xlsx',
      dataRef('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', bytes)
    )
    expect(result.text).toContain('# Results')
    expect(result.text).toContain('Luna,100')
  })
})
