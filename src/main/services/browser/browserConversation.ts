export const BROWSER_CONVERSATION_PROMPT = [
  '当前请求需要操作用户已授权的 Chrome，请直接调用 browser.* 工具完成，不要让用户去设置页手动连接。',
  '打开网址时 browser.openTab 只调用一次；它会复用相同网址的已有标签页。即使 loaded=false，页面也已经打开，后续只能对返回的 tabId 调用 waitForPage、inspect 或其他工具，禁止再次 openTab。',
  '每次操作使用工具返回的最新 tabId、pageVersion 和元素引用；连接中断后先重新 listTabs，不要重放已经成功的写操作。',
  '截图由宿主作为对话图片保存和展示。工具返回 artifactId 即代表截图成功，不要在正文复述 Base64。',
  '完成用户要求后立即给出结论，不为验证而重复打开、刷新或点击页面。'
].join('\n')

/** Conservative routing for requests that clearly require the user's live browser. */
export function prefersBrowserTools(request: string): boolean {
  const text = request.trim()
  if (!text) return false
  if (/https?:\/\/\S+/i.test(text)) return /(?:打开|访问|进入|浏览|查看|检查|截图|点击|网页|页面|网站|浏览器|chrome)/i.test(text)
  if (/(?:打开|访问|进入)\s*(?:www\.|[a-z0-9-]+\.(?:com|cn|net|org|io|dev)\b)/i.test(text)) return true
  const browser = /(?:浏览器|chrome|网页|网站|页面|标签页)/i
  const action = /(?:打开|访问|进入|查看|检查|读取|总结|操作|点击|输入|填写|选择|滚动|截图|刷新|关闭|后退|前进|调试|控制台|网络请求)/i
  return browser.test(text) && action.test(text)
}
