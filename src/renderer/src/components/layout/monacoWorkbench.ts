import * as monaco from 'monaco-editor/esm/vs/editor/editor.api'
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import 'monaco-editor/min/vs/editor/editor.main.css'
import 'monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution'
import 'monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution'
import 'monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution'
import 'monaco-editor/esm/vs/basic-languages/python/python.contribution'
import 'monaco-editor/esm/vs/basic-languages/css/css.contribution'
import 'monaco-editor/esm/vs/basic-languages/html/html.contribution'
import 'monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution'
import 'monaco-editor/esm/vs/basic-languages/shell/shell.contribution'
import 'monaco-editor/esm/vs/basic-languages/powershell/powershell.contribution'
import 'monaco-editor/esm/vs/basic-languages/sql/sql.contribution'
import 'monaco-editor/esm/vs/basic-languages/xml/xml.contribution'
import 'monaco-editor/esm/vs/basic-languages/rust/rust.contribution'
import 'monaco-editor/esm/vs/basic-languages/go/go.contribution'
import 'monaco-editor/esm/vs/basic-languages/java/java.contribution'

const globalWorker = self as typeof self & { MonacoEnvironment?: { getWorker: () => Worker } }
globalWorker.MonacoEnvironment = { getWorker: () => new EditorWorker() }

export function configureMonacoTheme(): void {
  const css = getComputedStyle(document.documentElement)
  const color = (name: string, fallback: string): string => css.getPropertyValue(name).trim() || fallback
  monaco.editor.defineTheme('ai-agent-workbench', {
    base: 'vs-dark',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': color('--surface-app', '#0d1117'),
      'editor.foreground': color('--text-primary', '#d7deea'),
      'editorLineNumber.foreground': color('--text-muted', '#667085'),
      'editorLineNumber.activeForeground': color('--text-secondary', '#aab4c3'),
      'editor.lineHighlightBackground': color('--surface-raised', '#141a24'),
      'editor.selectionBackground': '#33427f66',
      'editor.inactiveSelectionBackground': '#33427f33',
      'editorGutter.background': color('--surface-app', '#0d1117'),
      'diffEditor.insertedTextBackground': '#1f6f3d44',
      'diffEditor.removedTextBackground': '#8b2c3a44',
      'diffEditor.insertedLineBackground': '#163d2b55',
      'diffEditor.removedLineBackground': '#4a202855',
      'scrollbarSlider.background': '#66708533',
      'scrollbarSlider.hoverBackground': '#66708566'
    }
  })
}

export const editorOptions: monaco.editor.IStandaloneEditorConstructionOptions = {
  automaticLayout: true,
  minimap: { enabled: false },
  fontFamily: '"JetBrains Mono", Consolas, "SF Mono", monospace',
  /*
   * 编辑器正文与全局正文同级（文档 4.2：不允许 9~13px 业务文字）。
   * 12px 是改造前的遗留值，会与文档 8.3「代码 14px / 1.5」冲突；
   * 行高按 1.5 折算为 21px，取 22px 与全局行高令牌对齐。
   */
  fontSize: 14,
  lineHeight: 22,
  lineNumbersMinChars: 3,
  padding: { top: 8, bottom: 16 },
  scrollBeyondLastLine: false,
  smoothScrolling: true,
  renderWhitespace: 'selection',
  renderLineHighlight: 'all',
  overviewRulerBorder: false,
  overviewRulerLanes: 0,
  folding: true,
  glyphMargin: false,
  wordWrap: 'off'
}

export function languageForPath(path: string): string {
  const extension = path.split('.').pop()?.toLowerCase()
  return ({ ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript', json: 'json', css: 'css',
    html: 'html', md: 'markdown', py: 'python', rs: 'rust', go: 'go', java: 'java', yml: 'yaml', yaml: 'yaml',
    sh: 'shell', ps1: 'powershell', sql: 'sql', xml: 'xml' } as Record<string, string>)[extension ?? ''] ?? 'plaintext'
}

export { monaco }
