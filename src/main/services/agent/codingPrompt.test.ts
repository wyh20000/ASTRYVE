import { describe, expect, it } from 'vitest'
import { buildCodingSystemPrompt } from './codingPrompt'

describe('buildCodingSystemPrompt', () => {
  it('provides the trusted root and explains absolute-to-relative path conversion', () => {
    const prompt = buildCodingSystemPrompt('D:\\AIAGENT-New')
    expect(prompt).toContain('D:\\\\AIAGENT-New')
    expect(prompt).toContain('移除根目录前缀')
    expect(prompt).toContain('workspace.readFile')
    expect(prompt).toContain('不要在工具可用时声称无法访问本地文件')
    expect(prompt).toContain('绝不能用 Bash')
    expect(prompt).toContain('项目总文件数不受限制')
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
