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
  })
})
