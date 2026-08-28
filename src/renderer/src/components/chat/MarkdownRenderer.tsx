import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'

export default function MarkdownRenderer({ children }: { children: string }): JSX.Element {
  return (
    <div className="selectable text-[13px] leading-relaxed [&_p]:my-2 [&_pre]:my-2 [&_code]:text-[12px]">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
        {children}
      </ReactMarkdown>
    </div>
  )
}
