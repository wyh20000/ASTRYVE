[CmdletBinding(DefaultParameterSetName = 'Register')]
param(
  [Parameter(Mandatory = $true, ParameterSetName = 'Register')]
  [string]$ExecutablePath,

  [Parameter(Mandatory = $true, ParameterSetName = 'Unregister')]
  [switch]$Unregister
)

$ErrorActionPreference = 'Stop'
$hostName = 'com.astryve.browser'
$registrationRoot = Join-Path $env:LOCALAPPDATA 'ASTRYVE\NativeMessaging'
$manifestPath = Join-Path $registrationRoot "$hostName.json"
$registryPath = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$hostName"

if ($Unregister) {
  if (Test-Path -LiteralPath $registryPath) {
    Remove-Item -LiteralPath $registryPath -Force
  }
  if (Test-Path -LiteralPath $manifestPath) {
    Remove-Item -LiteralPath $manifestPath -Force
  }
  Write-Host "Unregistered $hostName for the current Windows user."
  exit 0
}

$resolvedExecutable = (Resolve-Path -LiteralPath $ExecutablePath).Path
if ([IO.Path]::GetExtension($resolvedExecutable) -ne '.exe') {
  throw 'ExecutablePath must point to the packaged ASTRYVE .exe file.'
}

$templatePath = Join-Path $PSScriptRoot '..\build\native-messaging\com.astryve.browser.json'
$template = Get-Content -Raw -LiteralPath $templatePath
$quotedExecutable = ConvertTo-Json $resolvedExecutable -Compress
$manifest = $template.Replace('"__ASTRYVE_EXECUTABLE_PATH__"', $quotedExecutable)
$parsed = $manifest | ConvertFrom-Json
if ($parsed.name -ne $hostName -or $parsed.allowed_origins.Count -ne 1 -or
    $parsed.allowed_origins[0] -ne 'chrome-extension://lcjaalloempdgnhjjcpnckiniccpnacm/') {
  throw 'Native Messaging manifest template failed validation.'
}

New-Item -ItemType Directory -Path $registrationRoot -Force | Out-Null
[IO.File]::WriteAllText($manifestPath, $manifest, [Text.UTF8Encoding]::new($false))
New-Item -Path $registryPath -Force | Out-Null
Set-Item -LiteralPath $registryPath -Value $manifestPath
Write-Host "Registered $hostName for the current Windows user."
Write-Host "Manifest: $manifestPath"
