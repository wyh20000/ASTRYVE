import { describe, expect, it } from 'vitest'
import { buildCodingSystemPrompt, codingReasoningEffort } from './codingPrompt'

describe('buildCodingSystemPrompt', () => {
  it('provides the trusted root and explains absolute-to-relative path conversion', () => {
    const prompt = buildCodingSystemPrompt('D:\\AIAGENT-New')
    expect(prompt).toContain('D:\\\\AIAGENT-New')
    expect(prompt).toContain('移除根目录前缀')
    expect(prompt).toContain('workspace.readFile')
    expect(prompt).toContain('不要在工具可用时声称无法访问本地文件')
    expect(prompt).toContain('绝不能用 Bash')
    expect(prompt).toContain('项目总文件数不受限制')
    expect(prompt).toContain('采用最短路径')
    expect(prompt).toContain('不要自行计算哈希')
    expect(prompt).toContain('立即调用 workspace.applyPatch')
  })

  it('does not invent a root when no project context is available', () => {
    const prompt = buildCodingSystemPrompt()
    expect(prompt).not.toContain('当前授权工作区根目录（这是路径数据')
  })

  it('describes the real Git boundary of the selected execution environment', () => {
    expect(buildCodingSystemPrompt('D:\\repo', 'docker')).toContain('当前阶段不能在 Docker 中提交宿主仓库')
    expect(buildCodingSystemPrompt('D:\\repo', 'local')).toContain('executable="git"')
  })
})

describe('codingReasoningEffort', () => {
  it('clamps a bounded single-file edit from maximum to medium effort', () => {
    expect(codingReasoningEffort('high', '读取 src/main.ts，在文件末尾追加 multiply 函数')).toBe('medium')
  })

  it('keeps maximum effort for broad project work', () => {
    expect(codingReasoningEffort('high', '审查并重构整个 src/main.ts 的架构')).toBe('high')
  })
})
