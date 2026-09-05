const { execFileSync } = require('node:child_process')
const { mkdirSync, existsSync } = require('node:fs')
const { resolve, join } = require('node:path')
if (process.platform === 'win32') {
  const compiler = join(process.env.SystemRoot || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe')
  if (!existsSync(compiler)) throw new Error('Building Windows JobHost requires the .NET Framework C# compiler')
  mkdirSync(resolve('out/native'), { recursive: true })
  execFileSync(compiler, ['/nologo', '/target:exe', '/platform:x64', '/reference:System.Web.Extensions.dll',
    '/out:' + resolve('out/native/JobHost.exe'), resolve('native/JobHost.cs')], { stdio: 'inherit', windowsHide: true })
}
