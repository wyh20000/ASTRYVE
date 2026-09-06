import { useEffect, useRef } from 'react'
import { configureMonacoTheme, editorOptions, languageForPath, monaco } from './monacoWorkbench'

export default function MonacoPreview({ path, content, onChange, onSave }: {
  path: string
  content: string
  onChange?: (content: string) => void
  onSave?: () => void
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const modelRef = useRef<ReturnType<typeof monaco.editor.createModel>>()
  const applyingExternalContent = useRef(false)
  const onChangeRef = useRef(onChange)
  const onSaveRef = useRef(onSave)
  onChangeRef.current = onChange
  onSaveRef.current = onSave
  useEffect(() => {
    if (!ref.current) return
    configureMonacoTheme()
    const model = monaco.editor.createModel(content, languageForPath(path), monaco.Uri.parse(`inmemory://workspace/${encodeURI(path)}`))
    modelRef.current = model
    const editor = monaco.editor.create(ref.current, {
      ...editorOptions, model, readOnly: !onChange, theme: 'ai-agent-workbench'
    })
    const change = onChangeRef.current
      ? editor.onDidChangeModelContent(() => {
          if (!applyingExternalContent.current) onChangeRef.current?.(editor.getValue())
        })
      : undefined
    if (onSaveRef.current) editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => onSaveRef.current?.())
    return () => { change?.dispose(); editor.dispose(); model.dispose(); modelRef.current = undefined }
  }, [path])
  useEffect(() => {
    const model = modelRef.current
    if (!model || model.getValue() === content) return
    applyingExternalContent.current = true
    try { model.setValue(content) } finally { applyingExternalContent.current = false }
  }, [content])
  return <div ref={ref} className="h-full min-h-[220px] w-full" aria-label={`文件预览 ${path}`} />
}
