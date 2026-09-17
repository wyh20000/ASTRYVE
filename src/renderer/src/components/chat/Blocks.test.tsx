import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Blocks } from './Blocks'

describe('Blocks', () => {
  it('隐藏内部 Skill 元数据但继续渲染回答内容', () => {
    const html = renderToStaticMarkup(<Blocks status="done" blocks={[
      {
        kind: 'skills', trigger: '/frontend-app-builder',
        skills: [{ name: 'frontend-app-builder', displayName: 'Frontend App Builder', source: 'plugin', version: '0.1.2' }]
      },
      { kind: 'text', content: '分析完成' }
    ]} />)
    expect(html).toContain('分析完成')
    expect(html).not.toContain('本轮已加载')
    expect(html).not.toContain('frontend-app-builder')
  })

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

  it('流式思考展示思考中状态，且只有一个动效（前置图标旋转）', () => {
    const html = renderToStaticMarkup(
      <Blocks status="streaming" blocks={[{ kind: 'thinking', content: '分析问题' }]} />
    )
    expect(html).toContain('思考中')
    // 旋转动画挂在根节点类上，由 global.css 选中 Think 的前置图标
    expect(html).toContain('thinking-streaming')
    // 点点点与 loading 圈都已移除（用户反馈两个指示器太繁琐）
    expect(html).not.toContain('thinking-dots')
    expect(html).not.toContain('anticon-loading')
    expect(html).not.toContain('ant-think-motion-blink')
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
