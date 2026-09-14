const { createServer } = require('node:http')
const { rm } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { randomUUID } = require('node:crypto')
const esbuild = require('esbuild')

async function main() {
  const server = createServer(async (request, response) => {
    if (request.method === 'GET') { response.writeHead(405).end(); return }
    if (request.method === 'DELETE') { response.writeHead(200).end(); return }
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const message = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (message.method === 'notifications/initialized') { response.writeHead(202).end(); return }
    const result = message.method === 'initialize'
      ? { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'smoke', version: '1.0.0' } }
      : message.method === 'tools/list'
        ? { tools: [{ name: 'ping', description: 'Smoke ping', inputSchema: { type: 'object', additionalProperties: false } }] }
        : { content: [{ type: 'text', text: 'pong' }], isError: false }
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }))
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const port = server.address().port
  const bundle = join(tmpdir(), `ai-agent-mcp-smoke-${randomUUID()}.cjs`)
  try {
    await esbuild.build({
      entryPoints: [join(process.cwd(), 'src/main/services/agent/pluginMcpClient.ts')],
      outfile: bundle, bundle: true, platform: 'node', format: 'cjs', target: 'node20', logLevel: 'silent'
    })
    const { createPluginMcpClient } = require(bundle)
    const controlledFetch = (input, init) => {
      const logical = new URL(input instanceof Request ? input.url : String(input))
      if (logical.origin !== 'https://mcp.example.com') throw new Error('unexpected MCP origin')
      return fetch(`http://127.0.0.1:${port}${logical.pathname}`, init)
    }
    const client = createPluginMcpClient({
      id: 'smoke', url: 'https://mcp.example.com/mcp', transport: 'streamable-http', auth: 'none'
    }, { fetch: controlledFetch, resolveHostname: async () => ['93.184.216.34'] })
    const signal = new AbortController().signal
    await client.connect(signal)
    const tools = await client.listTools(signal)
    if (tools.length !== 1 || tools[0].name !== 'ping') throw new Error('tool discovery failed')
    const result = await client.callTool('ping', {}, signal)
    if (result.content?.[0]?.text !== 'pong') throw new Error('tool call failed')
    await client.close()
  } finally {
    await new Promise((resolve) => server.close(resolve))
    await rm(bundle, { force: true })
  }
  if (server.listening) throw new Error('fixture listener leaked')
  console.log('plugin MCP smoke: PASS')
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
