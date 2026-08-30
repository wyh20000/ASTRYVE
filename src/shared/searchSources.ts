import type { SourceCitation } from './types'

const MARKDOWN_LINK = /\[([^\]]+)]\((https?:\/\/[^\s)]+)\)/gi
const BARE_URL = /https?:\/\/[^\s<>()\]，。；：！？]+/gi
const TRAILING_PUNCTUATION = /[.,;:!?，。；：！？]+$/

function cleanUrl(raw: string): string {
  return raw.replace(TRAILING_PUNCTUATION, '')
}

function fallbackTitle(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/** 从联网回答中的 Markdown 链接和裸 URL 提取去重后的引用来源。 */
export function extractSourceCitations(markdown: string): SourceCitation[] {
  const seen = new Map<string, SourceCitation>()
  for (const match of markdown.matchAll(MARKDOWN_LINK)) {
    const url = cleanUrl(match[2])
    if (!seen.has(url)) seen.set(url, { title: match[1].trim() || fallbackTitle(url), url })
  }
  for (const match of markdown.matchAll(BARE_URL)) {
    const url = cleanUrl(match[0])
    if (!seen.has(url)) seen.set(url, { title: fallbackTitle(url), url })
  }
  return [...seen.values()].slice(0, 12)
}
