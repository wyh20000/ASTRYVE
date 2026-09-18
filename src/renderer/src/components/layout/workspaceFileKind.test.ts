import { describe, expect, it } from 'vitest'
import { isMarkdownPath, workspaceFileKind, workspaceFolderIcon } from './workspaceFileKind'

describe('workspaceFileKind', () => {
  it('maps common languages to branded local file glyphs', () => {
    expect(workspaceFileKind('src/App.ts')).toMatchObject({ label: 'TS', icon: 'typescript' })
    expect(workspaceFileKind('src/App.tsx')).toMatchObject({ label: 'TSX', icon: 'react_ts' })
    expect(workspaceFileKind('src/App.vue')).toMatchObject({ label: 'V', icon: 'vue' })
    expect(workspaceFileKind('scripts/build.py')).toMatchObject({ label: 'PY', icon: 'python' })
    expect(workspaceFileKind('README.md')).toMatchObject({ label: 'M', icon: 'markdown' })
    expect(workspaceFileKind('package.json')).toMatchObject({ label: '{}', icon: 'nodejs' })
  })

  it('uses dedicated branded icons for common project files', () => {
    expect(workspaceFileKind('Dockerfile')).toMatchObject({ icon: 'docker' })
    expect(workspaceFileKind('tsconfig.json')).toMatchObject({ icon: 'tsconfig' })
    expect(workspaceFileKind('pnpm-lock.yaml')).toMatchObject({ icon: 'lock' })
    expect(workspaceFileKind('.gitignore')).toMatchObject({ icon: 'git' })
    expect(workspaceFileKind('Makefile')).toMatchObject({ icon: 'makefile' })
  })

  it('recognizes markdown paths without relying on editor state', () => {
    expect(isMarkdownPath('docs/design.markdown')).toBe(true)
    expect(isMarkdownPath('src/index.ts')).toBe(false)
  })

  it('maps semantic and suffixed folder names to Material folder icons', () => {
    expect(workspaceFolderIcon('src/components')).toBe('folder-components')
    expect(workspaceFolderIcon('apps/docs_front')).toBe('folder-docs')
    expect(workspaceFolderIcon('node_modules')).toBe('folder-node')
    expect(workspaceFolderIcon('src/unknown-area')).toBe('folder')
  })
})
