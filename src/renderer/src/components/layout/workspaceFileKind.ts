export type WorkspaceFileKind = {
  label: string
  /** Material Icon Theme asset name (without the .svg suffix). */
  icon: string
}

const kinds: Record<string, WorkspaceFileKind> = {
  typescript: { label: 'TS', icon: 'typescript' },
  typescriptReact: { label: 'TSX', icon: 'react_ts' },
  javascript: { label: 'JS', icon: 'javascript' },
  javascriptReact: { label: 'JSX', icon: 'react' },
  vue: { label: 'V', icon: 'vue' },
  svelte: { label: 'S', icon: 'svelte' },
  astro: { label: 'A', icon: 'astro' },
  python: { label: 'PY', icon: 'python' },
  java: { label: 'JV', icon: 'java' },
  go: { label: 'GO', icon: 'go' },
  rust: { label: 'RS', icon: 'rust' },
  html: { label: '<>', icon: 'html' },
  css: { label: '#', icon: 'css' },
  json: { label: '{}', icon: 'json' },
  yaml: { label: 'YML', icon: 'yaml' },
  markdown: { label: 'M', icon: 'markdown' },
  shell: { label: '>_', icon: 'console' },
  sql: { label: 'SQL', icon: 'database' },
  xml: { label: 'XML', icon: 'xml' },
  media: { label: 'IMG', icon: 'image' },
  font: { label: 'Aa', icon: 'font' },
  binary: { label: 'BIN', icon: 'file' },
  text: { label: 'TXT', icon: 'document' },
  docker: { label: 'DOCKER', icon: 'docker' },
  nodePackage: { label: '{}', icon: 'nodejs' },
  tsconfig: { label: '{}', icon: 'tsconfig' },
  lock: { label: 'LOCK', icon: 'lock' },
  git: { label: 'GIT', icon: 'git' },
  makefile: { label: 'MAKE', icon: 'makefile' }
}

const extensionMap: Record<string, keyof typeof kinds> = {
  ts: 'typescript', mts: 'typescript', cts: 'typescript',
  tsx: 'typescriptReact',
  js: 'javascript', mjs: 'javascript', cjs: 'javascript',
  jsx: 'javascriptReact',
  vue: 'vue', svelte: 'svelte', astro: 'astro',
  py: 'python', pyw: 'python',
  java: 'java', kt: 'java', kts: 'java',
  go: 'go', rs: 'rust',
  html: 'html', htm: 'html', css: 'css', scss: 'css', sass: 'css', less: 'css',
  json: 'json', jsonc: 'json',
  yml: 'yaml', yaml: 'yaml',
  md: 'markdown', markdown: 'markdown', mdx: 'markdown',
  sh: 'shell', bash: 'shell', zsh: 'shell', ps1: 'shell',
  sql: 'sql', xml: 'xml', svg: 'xml',
  png: 'media', jpg: 'media', jpeg: 'media', gif: 'media', webp: 'media', ico: 'media',
  woff: 'font', woff2: 'font', ttf: 'font', otf: 'font',
  txt: 'text', log: 'text'
}

const filenameMap: Record<string, keyof typeof kinds> = {
  dockerfile: 'docker',
  makefile: 'makefile',
  '.env': 'shell', '.env.local': 'shell', '.gitignore': 'git',
  'package.json': 'nodePackage', 'tsconfig.json': 'tsconfig',
  'pnpm-lock.yaml': 'lock', 'yarn.lock': 'lock', 'package-lock.json': 'lock'
}

const folderNameMap: Record<string, string> = {
  app: 'folder-app', apps: 'folder-app',
  src: 'folder-src', source: 'folder-src',
  component: 'folder-components', components: 'folder-components',
  public: 'folder-public', node_modules: 'folder-node',
  config: 'folder-config', configs: 'folder-config', configuration: 'folder-config',
  i18n: 'folder-i18n', locale: 'folder-i18n', locales: 'folder-i18n',
  plugin: 'folder-plugin', plugins: 'folder-plugin',
  route: 'folder-routes', routes: 'folder-routes', router: 'folder-routes', routers: 'folder-routes',
  state: 'folder-store', store: 'folder-store', stores: 'folder-store',
  page: 'folder-views', pages: 'folder-views', view: 'folder-views', views: 'folder-views',
  build: 'folder-dist', dist: 'folder-dist', out: 'folder-dist', output: 'folder-dist',
  api: 'folder-api', apis: 'folder-api',
  asset: 'folder-resource', assets: 'folder-resource', resource: 'folder-resource', resources: 'folder-resource',
  doc: 'folder-docs', docs: 'folder-docs', documentation: 'folder-docs',
  script: 'folder-scripts', scripts: 'folder-scripts',
  __tests__: 'folder-test', spec: 'folder-test', specs: 'folder-test', test: 'folder-test', tests: 'folder-test',
  '.github': 'folder-github', '.gitlab': 'folder-gitlab',
  client: 'folder-client', front: 'folder-client', frontend: 'folder-client',
  back: 'folder-server', backend: 'folder-server', server: 'folder-server',
  controller: 'folder-controller', controllers: 'folder-controller', service: 'folder-controller', services: 'folder-controller',
  font: 'folder-font', fonts: 'folder-font',
  hook: 'folder-hook', hooks: 'folder-hook',
  image: 'folder-images', images: 'folder-images', img: 'folder-images',
  lib: 'folder-lib', libs: 'folder-lib', libraries: 'folder-lib', library: 'folder-lib',
  entity: 'folder-class', entities: 'folder-class', model: 'folder-class', models: 'folder-class',
  css: 'folder-css', style: 'folder-css', styles: 'folder-css',
  type: 'folder-typescript', types: 'folder-typescript', typing: 'folder-typescript', typings: 'folder-typescript',
  helper: 'folder-utils', helpers: 'folder-utils', util: 'folder-utils', utils: 'folder-utils',
  utilities: 'folder-utils', utility: 'folder-utils'
}

export function workspaceFileKind(path: string): WorkspaceFileKind {
  const name = path.split('/').at(-1)?.toLowerCase() ?? path.toLowerCase()
  const exact = filenameMap[name]
  if (exact) return kinds[exact]

  const extension = name.split('.').at(-1) ?? ''
  const mapped = extensionMap[extension]
  return kinds[mapped ?? 'binary']
}

export function isMarkdownPath(path: string): boolean {
  return workspaceFileKind(path).label === 'M'
}

export function workspaceFolderIcon(path: string): string {
  const name = path.split('/').at(-1)?.toLowerCase() ?? path.toLowerCase()
  const exact = folderNameMap[name]
  if (exact) return exact

  const token = name.split(/[._-]+/).find((part) => folderNameMap[part])
  return token ? folderNameMap[token] : 'folder'
}
