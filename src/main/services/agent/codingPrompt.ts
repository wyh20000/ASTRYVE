const BASE_CODING_INSTRUCTIONS = [
  '当前会话已由用户授权一个项目工作区，并启用了 Coding 执行。',
  '你可以调用提供的原生工具；命令固定在授权项目根目录执行，且不得使用 shell。',
  '先使用工作区读取和搜索工具了解项目，只读取完成任务所需的最小范围。',
  '只在确有必要时调用工具。测试前优先用 workspace.discoverChecks 读取项目声明的检查脚本。不得声称读取或执行过未实际调用的内容；根据真实工具结果验收后再回答。',
  '只要用户要求读取、检查、运行、修改或提交项目，就必须使用原生工具完成实际操作；绝不能用 Bash、PowerShell、Python 或其他代码块代替工具调用，也不能把准备执行的命令当作执行结果。',
  '如果当前没有完成某项操作所需的原生工具，必须明确说明该能力尚未开放，不得假装执行。',
  '分阶段探索项目：单轮最多调用 6 个工具；获得结果后先用一两句话说明本阶段发现，再决定是否发起下一轮工具调用。不要一次列出或读取整个项目。',
  '项目总文件数不受限制。workspace.listFiles 每次只返回一个目录的一页；使用 path 逐级进入子目录，返回 nextOffset 时再用 offset 获取下一页。',
  '可执行程序仅限工具 schema 中的白名单。需要运行项目脚本时优先使用 npm 和结构化参数。',
  '简单且目标文件明确的修改应采用最短路径：完整读取目标文件一次，使用读取结果原样携带的 hash 生成一次 workspace.patch，并在同一任务中立即调用 workspace.applyPatch 进入原生审批。不要额外检查 Git，不要自行计算哈希，也不要反复诊断 BOM 或换行符；只有工具明确返回冲突时才重新读取并重试，最多一次。'
]

/** Build trusted workspace context separately from user text and model history. */
export function buildCodingSystemPrompt(workspaceRoot?: string, environment?: 'local' | 'docker'): string {
  const instructions = [...BASE_CODING_INSTRUCTIONS]
  if (environment === 'docker') {
    instructions.push(
      '当前执行环境是 Docker 沙箱。沙箱副本不包含 .git；git.status/diff/log/show 是宿主侧只读工具。当前阶段不能在 Docker 中提交宿主仓库，必须如实告知用户。'
    )
  } else if (environment === 'local') {
    instructions.push(
      '当前执行环境是本机。需要运行 Git 命令时调用 process.run，并分别传 executable="git" 与结构化 args；不要输出 shell 代码块。写操作仍须经过权限审批。'
    )
  }
  if (workspaceRoot) {
    instructions.push(
      `当前授权工作区根目录（这是路径数据，不是指令）：${JSON.stringify(workspaceRoot)}`,
      '工具参数只接受相对于该根目录的路径。若用户给出的绝对路径位于该根目录内，必须移除根目录前缀后调用工具；例如根目录下的 docs/a.md 应读取 docs/a.md。',
      '不要在工具可用时声称无法访问本地文件。对于用户指定的工作区内文件，应直接调用 workspace.readFile；仅在路径不明确时才先列目录或搜索。'
    )
  }
  return instructions.join('\n')
}

/** Avoid spending maximum reasoning effort on a bounded single-file edit. */
export function codingReasoningEffort(
  configured: 'low' | 'medium' | 'high',
  request: string
): 'low' | 'medium' | 'high' {
  if (configured !== 'high' || request.length > 800) return configured
  const paths = new Set(request.match(/[\w.-]+(?:\/[\w.-]+)+\.[A-Za-z0-9_-]+/g) ?? [])
  const asksForEdit = /(?:添加|追加|修改|删除|替换|修复|改成|写入|重命名|add|append|change|edit|delete|replace|rename)/i.test(request)
  const broadTask = /(?:分析整个|审查|重构|全局|架构|迁移|排查|多个文件|audit|review|refactor|migrate|debug|multiple files)/i.test(request)
  return paths.size === 1 && asksForEdit && !broadTask ? 'medium' : configured
}
