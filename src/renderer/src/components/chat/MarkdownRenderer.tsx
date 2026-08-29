import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'

export default function MarkdownRenderer({ children }: { children: string }): JSX.Element {
  return (
    <div className="markdown selectable">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer" />
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}