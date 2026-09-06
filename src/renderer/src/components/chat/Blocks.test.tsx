import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Blocks } from './Blocks'

describe('Blocks', () => {
  it('渲染可点击的引用来源区块', () => {
    const html = renderToStaticMarkup(
      <Blocks
        status="done"
        blocks={[
          {
            kind: 'sources',
            sources: [{ title: 'Kimi 文档', url: 'https://platform.kimi.com/docs' }]
          }
        ]}
      />
    )
    expect(html).toContain('引用来源')
    expect(html).toContain('https://platform.kimi.com/docs')
  })

  it('流式思考展示思考中状态', () => {
    const html = renderToStaticMarkup(
      <Blocks status="streaming" blocks={[{ kind: 'thinking', content: '分析问题' }]} />
    )
    expect(html).toContain('思考中')
    expect(html).toContain('thinking-dots')
    expect(html).not.toContain('分析问题')
  })

  it('渲染逐文件 diff、统计、哈希和拒绝操作', () => {
    const html = renderToStaticMarkup(
      <Blocks status="streaming" blocks={[{
        kind: 'diff', taskId: 'task', patchHash: 'a'.repeat(64), linesAdded: 1, linesDeleted: 1,
        files: [{ path: 'src/a.ts', status: 'modified', linesAdded: 1, linesDeleted: 1,
          diff: '--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,1 +1,1 @@\n-old\n+new' }]
      }]} />
    )
    expect(html).toContain('待写回变更')
    expect(html).toContain('src/a.ts')
    expect(html).toContain('拒绝此文件')
    expect(html).toContain('bg-emerald-500/10')
    expect(html).toContain('bg-red-500/10')
    expect(html).toContain('SHA-256')
  })

  it('渲染结构化任务完成报告', () => {
    const html = renderToStaticMarkup(<Blocks status="done" blocks={[{
      kind: 'report', files: [{ path: 'a.ts', status: 'modified' }],
      commands: [{ command: 'npm test', exitCode: 0, durationMs: 20 }],
      tests: [{ command: 'npm test', passed: true }], approvals: [{ toolName: 'process.run', target: 'npm test' }],
      unresolved: []
    }]} />)
    expect(html).toContain('任务报告')
    expect(html).toContain('1/1 通过')
    expect(html).toContain('用户批准')
  })
})
