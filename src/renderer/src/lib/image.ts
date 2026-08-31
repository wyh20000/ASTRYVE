import type { Attachment } from '@shared/types'

/** 长边超过该值则等比缩小，控制图片体积 */
const MAX_DIM = 1568

export function isImageFile(f: File): boolean {
  return f.type.startsWith('image/')
}

/** 可解析的文档/表格扩展名（与主进程 document.ts 保持一致） */
const DOC_EXT = new Set(['pdf', 'docx', 'xlsx', 'csv', 'txt', 'md', 'markdown', 'json', 'log'])

/** 文档文件大小上限（避免 IPC / 解析过载） */
export const MAX_FILE_BYTES = 20 * 1024 * 1024

/** 在读取前同步拒绝超大文档，避免把大文件完整载入内存后才报错。 */
export function assertDocumentSize(size: number, name: string): void {
  if (size > MAX_FILE_BYTES) {
    throw new Error(`文件过大（>${Math.round(MAX_FILE_BYTES / 1024 / 1024)}MB）：${name}`)
  }
}

export function isDocumentFile(f: File): boolean {
  const ext = f.name.split('.').pop()?.toLowerCase() ?? ''
  return DOC_EXT.has(ext)
}

function readAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(fr.result as string)
    fr.onerror = () => reject(new Error('读取文件失败'))
    fr.readAsDataURL(file)
  })
}

/** 将文档文件读取为附件（base64 dataURL，交由主进程解析） */
export async function fileToDocumentAttachment(file: File): Promise<Attachment> {
  assertDocumentSize(file.size, file.name)
  const dataRef = await readAsDataURL(file)
  return {
    id: crypto.randomUUID(),
    kind: 'file',
    name: file.name,
    contentType: file.type || 'application/octet-stream',
    dataRef,
    meta: { sizeBytes: file.size }
  }
}

/**
 * 将图片文件转成附件：加载 → 等比缩放 → 编码为 dataURL（PNG 保持 PNG，其余转 JPEG）。
 * 返回的 dataRef 直接作为多模态 image_url.url 使用。
 */
export function fileToImageAttachment(file: File): Promise<Attachment> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, MAX_DIM / Math.max(img.naturalWidth, img.naturalHeight))
      const w = Math.max(1, Math.round(img.naturalWidth * scale))
      const h = Math.max(1, Math.round(img.naturalHeight * scale))
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      URL.revokeObjectURL(url)
      if (!ctx) {
        reject(new Error('无法创建画布'))
        return
      }
      ctx.drawImage(img, 0, 0, w, h)
      const isPng = file.type === 'image/png'
      const dataRef = canvas.toDataURL(isPng ? 'image/png' : 'image/jpeg', 0.9)
      resolve({
        id: crypto.randomUUID(),
        kind: 'image',
        name: file.name,
        contentType: file.type || 'image/png',
        dataRef,
        meta: { sizeBytes: file.size, width: img.naturalWidth, height: img.naturalHeight }
      })
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('图片加载失败'))
    }
    img.src = url
  })
}
