import http from 'node:http'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { Client } from '@modelcontextprotocol/client'
import {
  StdioClientTransport,
  getDefaultEnvironment
} from '@modelcontextprotocol/client/stdio'

const require = createRequire(import.meta.url)
const packageRoot = dirname(require.resolve('chrome-devtools-mcp/package.json'))
const entrypoint = join(packageRoot, 'build', 'src', 'bin', 'chrome-devtools-mcp.js')
const server = http.createServer((request, response) => {
  if (request.url === '/missing') {
    response.writeHead(503, { 'content-type': 'text/plain', connection: 'close' })
    response.end('expected test failure')
    return
  }
  response.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    connection: 'close'
  })
  response.end(`<!doctype html><html><head><title>ASTRYVE MCP E2E</title></head>
    <body><label>Name <input aria-label="Name"></label>
    <button onclick="document.querySelector('#result').textContent = document.querySelector('input').value; console.error('expected-e2e-console'); fetch('/missing')">Submit</button>
    <p id="result"></p></body></html>`)
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const address = server.address()
const url = `http://127.0.0.1:${address.port}/`

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [
    entrypoint,
    '--auto-connect',
    '--experimental-page-id-routing=true',
    '--no-usage-statistics',
    '--no-performance-crux',
    '--redact-network-headers',
    '--category-emulation=false',
    '--category-performance=false',
    '--experimental-structured-content=true'
  ],
  env: {
    ...getDefaultEnvironment(),
    CHROME_DEVTOOLS_MCP_NO_USAGE_STATISTICS: '1',
    CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS: '1'
  },
  stderr: 'ignore'
})
const client = new Client(
  { name: 'astryve-real-e2e', version: '0.1.0' },
  { versionNegotiation: { mode: 'legacy' }, enforceStrictCapabilities: true }
)
const hardTimeout = setTimeout(() => {
  console.error('E2E hard timeout')
  process.exit(2)
}, 120_000)
let pageId
let fallbackPageId
const checks = []

function assert(value, message) {
  if (!value) throw new Error(message)
  checks.push(message)
}

function findNode(node, predicate) {
  if (!node || typeof node !== 'object') return undefined
  if (predicate(node)) return node
  for (const child of node.children ?? []) {
    const found = findNode(child, predicate)
    if (found) return found
  }
  return undefined
}

async function call(name, args) {
  console.error(`CALL ${name}`)
  const result = await client.callTool(
    { name, arguments: args },
    { timeout: 60_000, maxTotalTimeout: 60_000 }
  )
  if (result.isError) {
    const text = result.content?.find((item) => item.type === 'text')?.text
    throw new Error(`${name}: ${text ?? 'official tool returned an error'}`)
  }
  console.error(`DONE ${name}`)
  return result
}

try {
  console.error('CONNECT')
  await client.connect(transport, { timeout: 15_000 })
  console.error('CONNECTED')
  const tools = await client.listTools(undefined, { timeout: 10_000 })
  console.error('TOOLS LISTED')
  assert(tools.tools.length >= 24, 'official tool list is available')

  const before = await call('list_pages', {})
  fallbackPageId = before.structuredContent.pages[0]?.id
  const previousIds = new Set(before.structuredContent.pages.map((page) => page.id))
  const created = await call('new_page', { url, background: true })
  const page = created.structuredContent.pages.find((item) => !previousIds.has(item.id))
  assert(page, 'new_page created an isolated test tab')
  pageId = page.id

  const snapshot = await call('take_snapshot', { pageId, verbose: false })
  const input = findNode(snapshot.structuredContent.snapshot, (node) => node.role === 'textbox' && node.name === 'Name')
  const button = findNode(snapshot.structuredContent.snapshot, (node) => node.role === 'button' && node.name === 'Submit')
  assert(input?.id && button?.id, 'take_snapshot returned actionable UIDs')

  await call('fill', { pageId, uid: input.id, value: 'official-mcp' })
  await call('click', { pageId, uid: button.id })
  const evaluated = await call('evaluate_script', {
    pageId,
    function: "() => document.querySelector('#result').textContent"
  })
  const evaluatedText = evaluated.content.find((item) => item.type === 'text')?.text ?? ''
  assert(evaluatedText.includes('official-mcp'), 'fill, click, and evaluate_script completed')

  const screenshot = await call('take_screenshot', { pageId, format: 'jpeg', quality: 70 })
  assert(screenshot.content.some((item) => item.type === 'image' && item.data.length > 100), 'take_screenshot returned image data')

  const consoleMessages = await call('list_console_messages', { pageId, pageSize: 100 })
  assert(consoleMessages.structuredContent.consoleMessages.some((item) => JSON.stringify(item).includes('expected-e2e-console')), 'console diagnostics captured the expected message')
  const networkRequests = await call('list_network_requests', { pageId, pageSize: 100 })
  assert(networkRequests.structuredContent.networkRequests.some((item) => JSON.stringify(item).includes('/missing')), 'network diagnostics captured the expected request')

  await call('navigate_page', { pageId, type: 'reload' })
  assert(true, 'navigate_page reloaded the test tab')
  if (fallbackPageId !== undefined) {
    await call('select_page', { pageId: fallbackPageId, bringToFront: false })
  }
  await call('close_page', { pageId })
  pageId = undefined
  assert(true, 'close_page removed the isolated test tab')

  console.log(JSON.stringify({ ok: true, checks }))
} finally {
  if (pageId !== undefined) {
    if (fallbackPageId !== undefined) {
      await call('select_page', { pageId: fallbackPageId, bringToFront: false }).catch(() => undefined)
    }
    await call('close_page', { pageId }).catch(() => undefined)
  }
  await client.close().catch(() => undefined)
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
  clearTimeout(hardTimeout)
}
