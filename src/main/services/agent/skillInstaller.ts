import { randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path'
import type { SkillCatalogItem } from '../../../shared/types'

const MAX_REPOSITORY_FILES = 500
const MAX_TOTAL_BYTES = 5 * 1024 * 1024
const MAX_FILE_BYTES = 512 * 1024
const CATALOG_CACHE_TTL_MS = 10 * 60 * 1000
const SAFE_NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/
const ALLOWED_EXTENSIONS = new Set([
  '.md', '.txt', '.json', '.yaml', '.yml', '.py', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx',
  '.sh', '.ps1', '.css', '.html', '.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp',
  '.pdf', '.docx', '.xlsx', '.pptx', '.csv', '.tsv'
])

const FEATURED: SkillCatalogItem[] = [{
  id: 'github:obra/superpowers', name: 'superpowers', displayName: 'Superpowers',
  description: '完整的软件开发方法论 Skill Pack，包含头脑风暴、计划、TDD、调试与验证流程。',
  repository: 'obra/superpowers', installUrl: 'https://github.com/obra/superpowers/tree/main/skills',
  publisher: 'obra', featured: true, installed: false
}, {
  id: 'github:mattpocock/skills:grill-me', name: 'grill-me', displayName: 'Grill Me',
  description: '通过逐轮追问打磨计划或设计；同时安装其 grilling 依赖。',
  repository: 'mattpocock/skills', installUrl: 'https://github.com/mattpocock/skills/tree/main/skills/productivity/grill-me',
  publisher: 'mattpocock', featured: true, installed: false
}]

interface GitHubTreeEntry { path: string; type: 'blob' | 'tree'; mode?: string; size?: number }
interface GitHubLocation { owner: string; repo: string; ref?: string; path: string }

let catalogCache: { loadedAt: number; items: SkillCatalogItem[] } | undefined

export async function listSkillCatalog(query = ''): Promise<SkillCatalogItem[]> {
  const curated = await loadCuratedCatalog()
  const normalized = query.trim().toLowerCase()
  return [...FEATURED, ...curated].filter((item, index, all) =>
    all.findIndex((candidate) => candidate.id === item.id) === index &&
    (!normalized || `${item.name} ${item.displayName} ${item.description} ${item.publisher}`.toLowerCase().includes(normalized)))
}

async function loadCuratedCatalog(): Promise<SkillCatalogItem[]> {
  if (catalogCache && Date.now() - catalogCache.loadedAt < CATALOG_CACHE_TTL_MS) return catalogCache.items
  const items = await fetchOpenAiCurated().catch(() => [])
  // 失败时仍允许使用精选兜底，但不缓存失败，后续打开页面可以自动重试。
  if (items.length) catalogCache = { loadedAt: Date.now(), items }
  return items
}

export async function installSkillFromGitHub(installedRoot: string, url: string): Promise<string[]> {
  const location = parseGitHubUrl(url)
  const repository = `${location.owner}/${location.repo}`
  const repositoryInfo = await githubJson<{ default_branch?: string; license?: { spdx_id?: string } }>(
    `https://api.github.com/repos/${location.owner}/${location.repo}`
  )
  const ref = location.ref || repositoryInfo.default_branch
  if (!ref) throw new Error('无法确定 GitHub 默认分支')
  const commit = await githubJson<{ sha?: string }>(`https://api.github.com/repos/${location.owner}/${location.repo}/commits/${encodeURIComponent(ref)}`)
  if (!commit.sha || !/^[a-f0-9]{40}$/i.test(commit.sha)) throw new Error('无法解析 GitHub 精确版本')
  const version = commit.sha.toLowerCase()
  const tree = await githubJson<{ tree?: GitHubTreeEntry[]; truncated?: boolean }>(
    `https://api.github.com/repos/${location.owner}/${location.repo}/git/trees/${version}?recursive=1`
  )
  if (tree.truncated || !Array.isArray(tree.tree)) throw new Error('GitHub 仓库文件过多，无法安全安装')
  const blobs = tree.tree.filter((entry) => entry.type === 'blob')
  const allRoots = blobs.filter((entry) => /(^|\/)SKILL\.md$/i.test(entry.path)).map((entry) => dirname(entry.path).replace(/\\/g, '/'))
  let roots = allRoots.filter((root) => isInsideRequestedPath(root, location.path))
  if (!roots.length) throw new Error('该 GitHub 地址下没有找到 SKILL.md')
  if (location.path && roots.length > 1) {
    const exact = roots.filter((root) => root === location.path)
    if (exact.length) roots = exact
  }
  roots = await includeDependencies(location, version, blobs, allRoots, roots)
  if (roots.length > 100) throw new Error('Skill Pack 包含过多技能')
  if (new Set(roots.map((root) => basename(root).toLowerCase())).size !== roots.length) throw new Error('Skill Pack 存在重名目录')

  await mkdir(installedRoot, { recursive: true })
  const staging = join(installedRoot, `.staging-${randomUUID()}`)
  await mkdir(staging)
  let total = 0
  try {
    for (const root of roots) {
      const skillName = basename(root).toLowerCase()
      if (!SAFE_NAME.test(skillName)) throw new Error(`Skill 目录名无效：${skillName}`)
      const files = blobs.filter((entry) => isWithin(entry.path, root) && isAllowedRepositoryFile(entry))
      if (!files.some((entry) => entry.path === `${root}/SKILL.md` || (root === '.' && entry.path === 'SKILL.md'))) {
        throw new Error(`Skill ${skillName} 缺少入口`)
      }
      for (const file of files) {
        if ((file.size ?? 0) > MAX_FILE_BYTES) throw new Error(`文件过大：${file.path}`)
        const content = await githubBytes(location, version, file.path)
        total += content.byteLength
        if (total > MAX_TOTAL_BYTES) throw new Error('Skill 安装内容超过 5MB')
        const rel = relative(root, file.path).replace(/\\/g, '/')
        if (!rel || rel.startsWith('../') || rel.includes('/../')) throw new Error('GitHub 文件路径越界')
        const target = join(staging, skillName, rel)
        await mkdir(dirname(target), { recursive: true })
        await writeFile(target, content)
      }
      await writeFile(join(staging, skillName, '.aiagent-origin.json'), JSON.stringify({
        installKind: 'github', repository, version, sourceUrl: url,
        license: repositoryInfo.license?.spdx_id && repositoryInfo.license.spdx_id !== 'NOASSERTION'
          ? repositoryInfo.license.spdx_id : undefined
      }, null, 2))
    }
    await commitStaging(installedRoot, staging, roots.map((root) => basename(root).toLowerCase()))
    return roots.map((root) => basename(root).toLowerCase())
  } catch (error) {
    await rm(staging, { recursive: true, force: true })
    throw error
  }
}

export async function importSkillDirectory(installedRoot: string, selectedPath: string): Promise<string[]> {
  const sourceRoot = resolve(selectedPath)
  const roots = await discoverLocalRoots(sourceRoot)
  if (!roots.length) throw new Error('所选目录中没有找到 SKILL.md')
  if (new Set(roots.map((root) => basename(root).toLowerCase())).size !== roots.length) throw new Error('Skill Pack 存在重名目录')
  await mkdir(installedRoot, { recursive: true })
  const staging = join(installedRoot, `.staging-${randomUUID()}`)
  await mkdir(staging)
  let total = 0
  try {
    for (const root of roots) {
      const skillName = basename(root).toLowerCase()
      if (!SAFE_NAME.test(skillName)) throw new Error(`Skill 目录名无效：${skillName}`)
      const files = await collectLocalFiles(root)
      for (const file of files) {
        const info = await stat(file)
        total += info.size
        if (info.size > MAX_FILE_BYTES || total > MAX_TOTAL_BYTES) throw new Error('本机 Skill 超过安全大小限制')
        const rel = relative(root, file)
        const target = join(staging, skillName, rel)
        await mkdir(dirname(target), { recursive: true })
        await writeFile(target, await readFile(file))
      }
      await writeFile(join(staging, skillName, '.aiagent-origin.json'), JSON.stringify({ installKind: 'local' }, null, 2))
    }
    const names = roots.map((root) => basename(root).toLowerCase())
    await commitStaging(installedRoot, staging, names)
    return names
  } catch (error) {
    await rm(staging, { recursive: true, force: true })
    throw error
  }
}

export async function uninstallSkill(installedRoot: string, name: string): Promise<void> {
  if (!SAFE_NAME.test(name)) throw new Error('Skill 名称无效')
  const target = join(installedRoot, name)
  const rel = relative(resolve(installedRoot), resolve(target))
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`)) throw new Error('Skill 卸载路径越界')
  await mkdir(join(installedRoot, '.trash'), { recursive: true })
  try { await rename(target, join(installedRoot, '.trash', `${name}-${randomUUID()}`)) } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

async function commitStaging(installedRoot: string, staging: string, names: string[]): Promise<void> {
  const backups: Array<{ from: string; to: string }> = []
  const committed: string[] = []
  try {
    for (const name of names) {
      const destination = join(installedRoot, name)
      const backup = join(installedRoot, `.backup-${randomUUID()}-${name}`)
      try { await rename(destination, backup); backups.push({ from: backup, to: destination }) } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      await rename(join(staging, name), destination)
      committed.push(destination)
    }
    for (const backup of backups) await rm(backup.from, { recursive: true, force: true })
    await rm(staging, { recursive: true, force: true })
  } catch (error) {
    for (const destination of committed) await rm(destination, { recursive: true, force: true })
    for (const backup of backups.reverse()) {
      await rename(backup.from, backup.to).catch(() => undefined)
    }
    throw error
  }
}

async function includeDependencies(location: GitHubLocation, ref: string, blobs: GitHubTreeEntry[], allRoots: string[], initial: string[]): Promise<string[]> {
  const selected = [...initial]
  for (let index = 0; index < selected.length && selected.length < 100; index += 1) {
    const root = selected[index]
    const skillPath = root === '.' ? 'SKILL.md' : `${root}/SKILL.md`
    const body = Buffer.from(await githubBytes(location, ref, skillPath)).toString('utf8')
    const dependencies = [...body.matchAll(/(?:Call|Run) (?:the )?Skill tool with ["']([a-z0-9][a-z0-9_-]{0,63})["']/gi)].map((match) => match[1])
    for (const dependency of dependencies) {
      const dependencyRoot = allRoots.find((candidate) => basename(candidate).toLowerCase() === dependency.toLowerCase())
      if (!dependencyRoot) throw new Error(`Skill ${basename(root)} 依赖仓库中不存在的 ${dependency}`)
      if (!selected.includes(dependencyRoot)) selected.push(dependencyRoot)
    }
  }
  return selected
}

function isAllowedRepositoryFile(entry: GitHubTreeEntry): boolean {
  if (entry.mode === '120000') throw new Error(`Skill 包含链接：${entry.path}`)
  return ALLOWED_EXTENSIONS.has(extname(entry.path).toLowerCase()) && !entry.path.split('/').includes('.git')
}

async function discoverLocalRoots(root: string): Promise<string[]> {
  const result: string[] = []
  const walk = async (directory: string, depth: number): Promise<void> => {
    if (depth > 6 || result.length >= 100) return
    const entries = await readdir(directory, { withFileTypes: true })
    if (entries.some((entry) => entry.isFile() && entry.name.toLowerCase() === 'skill.md')) { result.push(directory); return }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) throw new Error('本机 Skill 不能包含符号链接或联接点')
      if (entry.isDirectory() && entry.name !== '.git' && entry.name !== 'node_modules') await walk(join(directory, entry.name), depth + 1)
    }
  }
  await walk(root, 0)
  return result
}

async function collectLocalFiles(root: string): Promise<string[]> {
  const files: string[] = []
  const walk = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error('本机 Skill 不能包含符号链接或联接点')
      const target = join(directory, entry.name)
      if (entry.isDirectory()) await walk(target)
      else if (entry.isFile() && ALLOWED_EXTENSIONS.has(extname(entry.name).toLowerCase())) files.push(target)
      if (files.length > MAX_REPOSITORY_FILES) throw new Error('本机 Skill 文件数量超过限制')
    }
  }
  await walk(root)
  return files
}

function parseGitHubUrl(input: string): GitHubLocation {
  let url: URL
  try { url = new URL(input) } catch { throw new Error('请输入有效的 GitHub 地址') }
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com' || url.username || url.password || url.port) {
    throw new Error('仅支持 https://github.com 的公开仓库地址')
  }
  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
  if (parts.length < 2 || parts.some((part) => part === '.' || part === '..' || part.includes('\\'))) throw new Error('GitHub 地址格式无效')
  const owner = parts[0]
  const repo = parts[1].replace(/\.git$/i, '')
  if (!/^[a-zA-Z0-9_.-]+$/.test(owner) || !/^[a-zA-Z0-9_.-]+$/.test(repo)) throw new Error('GitHub 仓库名称无效')
  if (parts[2] && parts[2] !== 'tree') throw new Error('请使用仓库首页或 /tree/<分支>/<目录> 地址')
  return { owner, repo, ref: parts[2] === 'tree' ? parts[3] : undefined, path: parts.slice(4).join('/') }
}

async function githubBytes(location: GitHubLocation, ref: string, path: string): Promise<Uint8Array> {
  const encoded = path.split('/').map(encodeURIComponent).join('/')
  const response = await fetch(`https://raw.githubusercontent.com/${location.owner}/${location.repo}/${encodeURIComponent(ref)}/${encoded}`, {
    headers: { 'User-Agent': 'AI-Agent-Skills/1.0' }, redirect: 'error', signal: AbortSignal.timeout(20_000)
  })
  if (!response.ok) throw new Error(`下载 Skill 文件失败（HTTP ${response.status}）`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength > MAX_FILE_BYTES) throw new Error(`Skill 文件过大：${path}`)
  return bytes
}

async function githubJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'AI-Agent-Skills/1.0' },
    redirect: 'error', signal: AbortSignal.timeout(15_000) })
  if (!response.ok) throw new Error(`GitHub 请求失败（HTTP ${response.status}）`)
  return await response.json() as T
}

async function fetchOpenAiCurated(): Promise<SkillCatalogItem[]> {
  const entries = await githubJson<Array<{ name: string; type: string; html_url?: string }>>(
    'https://api.github.com/repos/openai/skills/contents/skills/.curated?ref=main'
  )
  return entries.filter((entry) => entry.type === 'dir').slice(0, 100).map((entry) => ({
    id: `github:openai/skills:${entry.name}`, name: entry.name, displayName: entry.name,
    description: 'OpenAI curated Skill', repository: 'openai/skills',
    installUrl: entry.html_url || `https://github.com/openai/skills/tree/main/skills/.curated/${entry.name}`,
    publisher: 'OpenAI', featured: false, installed: false
  }))
}

function isWithin(path: string, root: string): boolean { return root === '.' || path === root || path.startsWith(`${root}/`) }
function isInsideRequestedPath(root: string, requested: string): boolean { return !requested || root === requested || root.startsWith(`${requested}/`) }
