param(
  [Parameter(Mandatory = $true)]
  [string]$Source
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$buildDirectory = Join-Path $root 'build'
$rendererDirectory = Join-Path $root 'src/renderer/src/assets'
$serverDirectory = Join-Path $root 'server/auth/web'
New-Item -ItemType Directory -Force -Path $buildDirectory, $rendererDirectory | Out-Null

function New-ResizedPngBytes([System.Drawing.Image]$Image, [int]$Size) {
  $bitmap = New-Object System.Drawing.Bitmap($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $bitmap.SetResolution(96, 96)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.Clear([System.Drawing.Color]::Transparent)
    $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
    $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.DrawImage($Image, (New-Object System.Drawing.Rectangle(0, 0, $Size, $Size)))
    $stream = New-Object System.IO.MemoryStream
    $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
    return $stream.ToArray()
  } finally {
    $graphics.Dispose()
    $bitmap.Dispose()
  }
}

$sourceImage = [System.Drawing.Image]::FromFile((Resolve-Path -LiteralPath $Source))
try {
  if ($sourceImage.Width -ne $sourceImage.Height) {
    throw 'Brand icon source must be square.'
  }

  $png = New-ResizedPngBytes $sourceImage 512
  [System.IO.File]::WriteAllBytes((Join-Path $buildDirectory 'icon.png'), $png)
  [System.IO.File]::WriteAllBytes((Join-Path $rendererDirectory 'astryve-icon.png'), (New-ResizedPngBytes $sourceImage 256))
  [System.IO.File]::WriteAllBytes((Join-Path $serverDirectory 'astryve-icon.png'), (New-ResizedPngBytes $sourceImage 256))

} finally {
  $sourceImage.Dispose()
}
