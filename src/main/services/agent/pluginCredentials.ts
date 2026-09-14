/** Credential storage is introduced with M14-D. This boundary prevents uninstall code from assuming plaintext storage. */
export async function clearPluginCredentials(_pluginId: string): Promise<void> {
  // No plugin credential backend exists yet.
}
