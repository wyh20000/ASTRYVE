/** Parameters ASTRYVE actually sends to the pinned Google 1.7.0 MCP server. */
const USED_TOOL_CONTRACT = {
  click: { required: ['pageId', 'uid'], parameters: { pageId: 'number', uid: 'string', dblClick: 'boolean' } },
  close_page: { required: ['pageId'], parameters: { pageId: 'number' } },
  drag: { required: ['pageId', 'from_uid', 'to_uid'], parameters: { pageId: 'number', from_uid: 'string', to_uid: 'string' } },
  evaluate_script: { required: ['pageId', 'function'], parameters: { pageId: 'number', function: 'string' } },
  fill: { required: ['pageId', 'uid', 'value'], parameters: { pageId: 'number', uid: 'string', value: 'string' } },
  hover: { required: ['pageId', 'uid'], parameters: { pageId: 'number', uid: 'string' } },
  list_console_messages: { required: ['pageId'], parameters: { pageId: 'number', pageSize: 'integer', types: 'array' } },
  list_network_requests: { required: ['pageId'], parameters: { pageId: 'number', pageSize: 'integer' } },
  list_pages: { required: [], parameters: {} },
  navigate_page: { required: ['pageId'], parameters: { pageId: 'number', type: 'string', url: 'string' } },
  new_page: { required: ['url'], parameters: { url: 'string', background: 'boolean' } },
  press_key: { required: ['pageId', 'key'], parameters: { pageId: 'number', key: 'string' } },
  select_page: { required: ['pageId'], parameters: { pageId: 'number', bringToFront: 'boolean' } },
  take_screenshot: { required: ['pageId'], parameters: { pageId: 'number', format: 'string', quality: 'number', uid: 'string', fullPage: 'boolean' } },
  take_snapshot: { required: ['pageId'], parameters: { pageId: 'number', verbose: 'boolean' } }
} as const

export const REQUIRED_OFFICIAL_TOOLS = new Set(Object.keys(USED_TOOL_CONTRACT))

/** Fail at connection time if the installed official server no longer matches the reviewed adapter. */
export function assertOfficialToolContract(tools: readonly { name: string; inputSchema: unknown }[]): void {
  const available = new Map(tools.map((tool) => [tool.name, tool.inputSchema]))
  for (const [name, expected] of Object.entries(USED_TOOL_CONTRACT)) {
    const schema = available.get(name)
    if (!record(schema) || !record(schema.properties)) {
      throw new Error(`Chrome DevTools MCP 缺少必需工具或 schema 无效: ${name}`)
    }
    const required = Array.isArray(schema.required) ? schema.required : []
    if (required.length !== expected.required.length ||
        expected.required.some((key) => !required.includes(key))) {
      throw new Error(`Chrome DevTools MCP 必填参数已变化: ${name}`)
    }
    for (const [key, type] of Object.entries(expected.parameters)) {
      const property = schema.properties[key]
      if (!record(property) || property.type !== type) {
        throw new Error(`Chrome DevTools MCP 参数 schema 已变化: ${name}.${key}`)
      }
    }
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
