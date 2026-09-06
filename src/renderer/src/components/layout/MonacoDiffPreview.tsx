import { useEffect, useRef } from 'react'
import { configureMonacoTheme, editorOptions, languageForPath, monaco } from './monacoWorkbench'

export default function MonacoDiffPreview({ path, original, modified }: {
  path: string
  original: string
  modified: string
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!ref.current) return
    configureMonacoTheme()
    const language = languageForPath(path)
    const nonce = crypto.randomUUID()
    const originalModel = monaco.editor.createModel(original, language, monaco.Uri.parse(`inmemory://diff/${nonce}/original/${encodeURI(path)}`))
    const modifiedModel = monaco.editor.createModel(modified, language, monaco.Uri.parse(`inmemory://diff/${nonce}/modified/${encodeURI(path)}`))
    const editor = monaco.editor.createDiffEditor(ref.current, {
      ...editorOptions,
      theme: 'ai-agent-workbench',
      readOnly: true,
      originalEditable: false,
      renderSideBySide: true,
      useInlineViewWhenSpaceIsLimited: true,
      enableSplitViewResizing: true,
      renderMarginRevertIcon: false,
      diffCodeLens: false,
      diffAlgorithm: 'advanced',
      maxComputationTime: 2_000,
      maxFileSize: 4,
      renderIndicators: true,
      ignoreTrimWhitespace: false,
      hideUnchangedRegions: { enabled: false }
    })
    editor.setModel({ original: originalModel, modified: modifiedModel })
    return () => {
      editor.dispose()
      originalModel.dispose()
      modifiedModel.dispose()
    }
  }, [path, original, modified])
  return <div ref={ref} className="h-full min-h-[260px] w-full" aria-label={`Diff ${path}`} />
}
