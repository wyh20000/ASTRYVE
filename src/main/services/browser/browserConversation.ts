/** UX-only hint for models that cannot make native tool calls. Never starts MCP or changes tool visibility. */
export function isExplicitChromeRequestForUnsupportedModel(request: string): boolean {
  return /(?:chrome|浏览器)/i.test(request) &&
    /(?:打开|访问|查看|检查|读取|操作|点击|截|刷新|标签页|网页)/i.test(request)
}
