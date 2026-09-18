const modules = import.meta.glob<string>('../../assets/file-icons/folder*.svg', {
  eager: true,
  query: '?url',
  import: 'default'
})

const sources = Object.fromEntries(Object.entries(modules).map(([path, source]) => [
  path.split('/').at(-1)?.replace(/\.svg$/, '') ?? path,
  source
]))

export function folderIconSource(icon: string, expanded: boolean): string {
  const requested = `${icon}${expanded ? '-open' : ''}`
  return sources[requested] ?? sources[expanded ? 'folder-open' : 'folder']
}
