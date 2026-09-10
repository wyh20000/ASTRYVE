export interface PluginRuntimeHandle {
  stop(reason: string): Promise<void>
}

export class PluginRuntimeRegistry {
  private readonly runtimes = new Map<string, Set<PluginRuntimeHandle>>()

  add(pluginId: string, runtime: PluginRuntimeHandle): () => void {
    const items = this.runtimes.get(pluginId) ?? new Set<PluginRuntimeHandle>()
    items.add(runtime)
    this.runtimes.set(pluginId, items)
    return () => {
      items.delete(runtime)
      if (!items.size) this.runtimes.delete(pluginId)
    }
  }

  async stopAll(pluginId: string, reason: string): Promise<void> {
    const items = [...(this.runtimes.get(pluginId) ?? [])]
    this.runtimes.delete(pluginId)
    await Promise.all(items.map((runtime) => runtime.stop(reason)))
  }
}
