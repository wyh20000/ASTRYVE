const failures = new Map<string, number>()
const quarantined = new Set<string>()

export function recordPluginFailure(id: string): boolean {
  const count = (failures.get(id) ?? 0) + 1
  failures.set(id, count)
  if (count >= 3) quarantined.add(id)
  return quarantined.has(id)
}

export function clearPluginFailure(id: string): void {
  failures.delete(id)
}

export function isPluginQuarantined(id: string): boolean {
  return quarantined.has(id)
}

export function recoverPluginHealth(id: string): void {
  failures.delete(id)
  quarantined.delete(id)
}

export function resetPluginHealth(): void {
  failures.clear()
  quarantined.clear()
}
