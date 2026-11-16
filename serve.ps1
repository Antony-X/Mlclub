# Tiny static file server for the stand laptop. Needs nothing installed:
# PowerShell is part of Windows. Serves this folder on http://localhost:8000/
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$port = 8000
$listener = $null
while (-not $listener) {
  try {
    $l = New-Object System.Net.HttpListener
    $l.Prefixes.Add("http://localhost:$port/")
    $l.Start()
    $listener = $l
  } catch {
    $port++
    if ($port -gt 8020) { throw "No free port between 8000 and 8020" }
  }
}
$mime = @{
  '.html' = 'text/html; charset=utf-8'; '.css' = 'text/css; charset=utf-8'
  '.js' = 'text/javascript; charset=utf-8'; '.mjs' = 'text/javascript; charset=utf-8'
  '.wasm' = 'application/wasm'; '.json' = 'application/json'
  '.svg' = 'image/svg+xml'; '.png' = 'image/png'; '.jpg' = 'image/jpeg'
  '.ttf' = 'font/ttf'; '.woff2' = 'font/woff2'
}
Write-Host "Running at http://localhost:$port/  (close this window to stop)"
Start-Process "http://localhost:$port/"
while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  try {
    $rel = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath).TrimStart('/')
    if ($rel -eq '') { $rel = 'index.html' }
    $file = [IO.Path]::GetFullPath((Join-Path $root $rel))
    if ($file.StartsWith($root) -and [IO.File]::Exists($file)) {
      $bytes = [IO.File]::ReadAllBytes($file)
      $ext = [IO.Path]::GetExtension($file).ToLower()
      if ($mime.ContainsKey($ext)) { $ctx.Response.ContentType = $mime[$ext] }
      else { $ctx.Response.ContentType = 'application/octet-stream' }
      $ctx.Response.ContentLength64 = $bytes.Length
      $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
      $ctx.Response.StatusCode = 404
    }
  } catch {
  } finally {
    try { $ctx.Response.Close() } catch {}
  }
}
