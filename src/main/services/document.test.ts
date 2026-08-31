import { describe, it, expect, vi } from 'vitest'

// 只测分派逻辑与文本提取，不加载真实的重型解析库
vi.mock('pdf-parse', () => ({
  PDFParse: class {
    async getText(): Promise<{ text: string }> {
      return { text: 'pdf 文本内容' }
    }
  }
}))
vi.mock('mammoth/lib/index.js', () => ({
  default: { extractRawText: async (): Promise<{ value: string }> => ({ value: 'docx 文本内容' }) }
}))
vi.mock('exceljs', () => ({
  default: {
    Workbook: class {
      worksheets = [
        {
          name: 'Sheet1',
          eachRow: (_opts: unknown, callback: (row: { values: unknown[] }) => void) =>
            callback({ values: [undefined, 'a', 'b'] })
        }
      ]
      xlsx = { load: async () => undefined }
    }
  }
}))

import { extractDocumentText, isSupportedDocName } from './document'

const dataUrl = (s: string): string => `data:text/plain;base64,${Buffer.from(s, 'utf-8').toString('base64')}`

describe('isSupportedDocName', () => {
  it('识别支持的扩展名', () => {
    for (const name of ['a.pdf', 'a.docx', 'a.xlsx', 'a.csv', 'a.txt', 'a.md', 'a.json']) {
      expect(isSupportedDocName(name)).toBe(true)
    }
  })

  it('拒绝不支持的扩展名', () => {
    expect(isSupportedDocName('a.exe')).toBe(false)
    expect(isSupportedDocName('a.png')).toBe(false)
    expect(isSupportedDocName('a.xls')).toBe(false)
  })
})

describe('extractDocumentText', () => {
  it('CSV 直接按 UTF-8 提取', async () => {
    const r = await extractDocumentText('d.csv', dataUrl('name,age\nTom,3'))
    expect(r.text).toContain('name,age')
    expect(r.charCount).toBeGreaterThan(0)
  })

  it('TXT 直接按 UTF-8 提取并 trim', async () => {
    const r = await extractDocumentText('d.txt', dataUrl('  纯文本内容  '))
    expect(r.text).toBe('纯文本内容')
  })

  it('PDF 走 pdf-parse（mock）', async () => {
    const r = await extractDocumentText('d.pdf', dataUrl('ignored'))
    expect(r.text).toBe('pdf 文本内容')
  })

  it('DOCX 走 mammoth（mock）', async () => {
    const r = await extractDocumentText('d.docx', dataUrl('ignored'))
    expect(r.text).toBe('docx 文本内容')
  })

  it('XLSX 走 exceljs（mock）并保留 sheet 标题', async () => {
    const r = await extractDocumentText('d.xlsx', dataUrl('ignored'))
    expect(r.text).toContain('a,b')
  })

  it('不支持的扩展名抛错', async () => {
    await expect(extractDocumentText('d.exe', dataUrl('x'))).rejects.toThrow()
  })
})
