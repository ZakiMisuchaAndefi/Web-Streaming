# ==========================================================================
# server.ps1 - server statis kecil + resolver audio lokal (yt-dlp).
# Jalankan dari PowerShell:  .\server.ps1
# Lalu buka:                 http://127.0.0.1:4173/
#
# Endpoint tambahan:
#   GET /api/health              -> { "ytdlp": true|false, "ffmpeg": true|false, "mp3": true|false }
#   GET /api/resolve?id=VIDEO_ID&quality=high -> { "url": "...", "expires": <unix> }
#   GET /api/radio?id=VIDEO_ID   -> { "tracks": [ { id, title, artist, duration } ] }
#   GET /api/download?id=VIDEO_ID&quality=high&title=... -> { "jobId": "...", "status": "running" }
#   GET /api/download-status?job=JOB_ID -> { "status": "running|done|error", ... }
#   GET /api/download-file?job=JOB_ID   -> file audio (attachment)
# ==========================================================================

param(
  [int]$Port = 4173,
  [string]$Root = $PSScriptRoot
)

$rootFull = [System.IO.Path]::GetFullPath($Root).TrimEnd('\') + '\'
$rootDir = [System.IO.Path]::GetFullPath($Root)
$script:ytdlpPath = Join-Path $rootDir "yt-dlp.exe"
$script:audioCache = @{}
$script:radioCache = @{}
$script:downloadDir = Join-Path $rootDir "downloads"
$script:downloadRoot = [System.IO.Path]::GetFullPath($script:downloadDir).TrimEnd('\') + '\'
$script:downloadJobs = @{}
$script:downloadIndex = @{}
$script:ffmpegPath = ""

if (-not (Test-Path -LiteralPath $script:downloadDir -PathType Container)) {
  try { New-Item -ItemType Directory -Path $script:downloadDir -Force | Out-Null } catch { }
}

$localFfmpeg = Join-Path $rootDir "ffmpeg.exe"
$toolsFfmpeg = Join-Path $rootDir "tools\ffmpeg\bin\ffmpeg.exe"
if (Test-Path -LiteralPath $localFfmpeg -PathType Leaf) {
  $script:ffmpegPath = $localFfmpeg
} elseif (Test-Path -LiteralPath $toolsFfmpeg -PathType Leaf) {
  $script:ffmpegPath = $toolsFfmpeg
} else {
  $ffmpegCommand = Get-Command ffmpeg -ErrorAction SilentlyContinue
  if ($ffmpegCommand) { $script:ffmpegPath = $ffmpegCommand.Source }
}

$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
$listener.Start()

$mime = @{
  ".html" = "text/html; charset=utf-8"
  ".css"  = "text/css; charset=utf-8"
  ".js"   = "text/javascript; charset=utf-8"
  ".json" = "application/json; charset=utf-8"
  ".svg"  = "image/svg+xml"
  ".png"  = "image/png"
  ".jpg"  = "image/jpeg"
  ".jpeg" = "image/jpeg"
  ".webp" = "image/webp"
  ".gif"  = "image/gif"
  ".ico"  = "image/x-icon"
  ".mp3"  = "audio/mpeg"
  ".m4a"  = "audio/mp4"
  ".flac" = "audio/flac"
  ".wav"  = "audio/wav"
  ".ogg"  = "audio/ogg"
  ".opus" = "audio/ogg"
  ".webm" = "audio/webm"
  ".txt"  = "text/plain; charset=utf-8"
  ".md"   = "text/plain; charset=utf-8"
}

function Send-Response($stream, $status, $reason, $contentType, $body, $headOnly) {
  $length = if ($null -ne $body) { $body.Length } else { 0 }
  $header = "HTTP/1.1 $status $reason`r`n" +
    "Content-Type: $contentType`r`n" +
    "Content-Length: $length`r`n" +
    "Cache-Control: no-cache`r`n" +
    "X-Content-Type-Options: nosniff`r`n" +
    "Connection: close`r`n`r`n"
  $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($header)
  $stream.Write($headerBytes, 0, $headerBytes.Length)
  if (-not $headOnly -and $null -ne $body -and $length -gt 0) {
    $stream.Write($body, 0, $body.Length)
  }
  $stream.Flush()
}

function Send-Json($stream, $status, $reason, $payload, $headOnly) {
  $json = $payload | ConvertTo-Json -Compress -Depth 5
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
  Send-Response $stream $status $reason "application/json; charset=utf-8" $bytes $headOnly
}

function Send-Redirect($stream, $url) {
  $header = "HTTP/1.1 302 Found`r`n" +
    "Location: $url`r`n" +
    "Content-Length: 0`r`n" +
    "Cache-Control: no-store`r`n" +
    "Connection: close`r`n`r`n"
  $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($header)
  $stream.Write($headerBytes, 0, $headerBytes.Length)
  $stream.Flush()
}

function Get-QueryValue($query, $name) {
  if ([string]::IsNullOrEmpty($query)) { return $null }
  foreach ($pair in $query.Split("&")) {
    if ([string]::IsNullOrEmpty($pair)) { continue }
    $eq = $pair.IndexOf("=")
    if ($eq -lt 0) { continue }
    $key = $pair.Substring(0, $eq)
    if ($key -eq $name) {
      $value = $pair.Substring($eq + 1).Replace("+", " ")
      return [System.Uri]::UnescapeDataString($value)
    }
  }
  return $null
}

function Get-AudioFormat($quality) {
  switch ($quality) {
    "low" { return "bestaudio[abr<=96]/bestaudio[ext=m4a][abr<=128]/bestaudio" }
    "medium" { return "bestaudio[abr<=128]/bestaudio[ext=m4a]/bestaudio" }
    "high" { return "bestaudio[abr<=192]/bestaudio[ext=m4a]/bestaudio" }
    "lossless" { return "bestaudio/bestaudio[ext=m4a]" }
    default { return "bestaudio/bestaudio[ext=m4a]" }
  }
}

# Kualitas VBR MP3 untuk yt-dlp: 0 = terbaik, 9 = paling hemat.
function Get-Mp3Quality($quality) {
  switch ($quality) {
    "low" { return "7" }
    "medium" { return "5" }
    "high" { return "2" }
    default { return "0" }
  }
}

function Invoke-YtDlp($videoId, $quality) {
  if (-not (Test-Path -LiteralPath $script:ytdlpPath -PathType Leaf)) {
    return @{ Status = 503; Error = "yt-dlp tidak ditemukan" }
  }

  $process = $null
  try {
    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $script:ytdlpPath
    $format = Get-AudioFormat $quality
    $startInfo.Arguments = '-f "' + $format + '" -g --no-playlist --no-warnings "https://www.youtube.com/watch?v=' + $videoId + '"'
    $startInfo.UseShellExecute = $false
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.CreateNoWindow = $true
    $startInfo.WorkingDirectory = $rootDir

    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $startInfo
    [void]$process.Start()

    # Baca kedua stream secara asinkron agar tidak deadlock.
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()

    if (-not $process.WaitForExit(20000)) {
      try { $process.Kill() } catch { }
      return @{ Status = 502; Error = "yt-dlp melebihi batas waktu 20 detik" }
    }

    $stdout = $stdoutTask.Result
    $stderr = $stderrTask.Result

    if ($process.ExitCode -ne 0 -or [string]::IsNullOrWhiteSpace($stdout)) {
      $lines = @($stderr -split "`r?`n" | Where-Object { $_.Trim() -ne "" })
      $last = if ($lines.Count -gt 0) { $lines[$lines.Count - 1].Trim() } else { "yt-dlp gagal (kode $($process.ExitCode))" }
      return @{ Status = 502; Error = $last }
    }

    $lines = @($stdout -split "`r?`n" | Where-Object { $_.Trim() -ne "" })
    $url = if ($lines.Count -gt 0) { $lines[0].Trim() } else { "" }
    if ($url -notmatch '^https?://') {
      return @{ Status = 502; Error = "yt-dlp tidak mengembalikan URL audio" }
    }

    $now = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    $expires = $now + 3600
    if ($url -match '[?&]expire=(\d+)') {
      $expires = [int64]$Matches[1]
    }

    return @{ Status = 200; Url = $url; Expires = [int64]$expires }
  } catch {
    return @{ Status = 502; Error = $_.Exception.Message }
  } finally {
    if ($process) { $process.Dispose() }
  }
}

function Invoke-YtDlpRadio($videoId) {
  if (-not (Test-Path -LiteralPath $script:ytdlpPath -PathType Leaf)) {
    return @{ Status = 503; Error = "yt-dlp tidak ditemukan" }
  }

  $process = $null
  try {
    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $script:ytdlpPath
    $format = "%(id)s`t%(title)s`t%(duration)s`t%(uploader)s"
    $startInfo.Arguments = '--flat-playlist --no-warnings --playlist-end 50 --print "' + $format + '" "https://www.youtube.com/watch?v=' + $videoId + '&list=RD' + $videoId + '"'
    $startInfo.UseShellExecute = $false
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.CreateNoWindow = $true
    $startInfo.WorkingDirectory = $rootDir

    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $startInfo
    [void]$process.Start()

    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()

    if (-not $process.WaitForExit(30000)) {
      try { $process.Kill() } catch { }
      return @{ Status = 502; Error = "Radio YouTube melebihi batas waktu 30 detik" }
    }

    $stdout = $stdoutTask.Result
    $stderr = $stderrTask.Result

    if ($process.ExitCode -ne 0 -or [string]::IsNullOrWhiteSpace($stdout)) {
      $lines = @($stderr -split "`r?`n" | Where-Object { $_.Trim() -ne "" })
      $last = if ($lines.Count -gt 0) { $lines[$lines.Count - 1].Trim() } else { "yt-dlp gagal (kode $($process.ExitCode))" }
      return @{ Status = 502; Error = $last }
    }

    $tracks = @()
    $seen = @{}
    foreach ($line in ($stdout -split "`r?`n")) {
      if ($tracks.Count -ge 40) { break }
      if ([string]::IsNullOrWhiteSpace($line)) { continue }
      $cols = $line -split "`t"
      if ($cols.Count -lt 4) { continue }

      $vid = $cols[0].Trim()
      if ($vid -notmatch '^[A-Za-z0-9_-]{11}$') { continue }
      if ($vid -eq $videoId -or $seen.ContainsKey($vid)) { continue }

      $title = $cols[1].Trim()
      if ([string]::IsNullOrWhiteSpace($title)) { continue }
      $lowerTitle = $title.ToLowerInvariant()
      if ($lowerTitle -match 'full album|compilation|kompilasi|podcast|medley|nonstop|non-stop|greatest hits|mega hits|dj mix|megamix') { continue }

      $duration = 0
      [void][int]::TryParse($cols[2].Trim(), [ref]$duration)
      # Hanya lagu: lewati Shorts, live panjang, kompilasi, dan podcast.
      if ($duration -lt 60 -or $duration -gt 600) { continue }

      $seen[$vid] = $true
      $tracks += @{
        id = $vid
        title = $title
        artist = $cols[3].Trim()
        duration = $duration
      }
    }

    if ($tracks.Count -eq 0) {
      return @{ Status = 502; Error = "Radio YouTube tidak mengembalikan lagu" }
    }
    return @{ Status = 200; Tracks = $tracks }
  } catch {
    return @{ Status = 502; Error = $_.Exception.Message }
  } finally {
    if ($process) { $process.Dispose() }
  }
}

# --------------------------------------------------------------------------
# Unduhan audio (job latar)
# yt-dlp dijalankan tanpa ditunggu agar server tetap melayani pemutaran.
# --------------------------------------------------------------------------

function Find-DownloadFile($videoId, $quality) {
  $prefix = $videoId + "-" + $quality + "."
  $found = @(Get-ChildItem -LiteralPath $script:downloadDir -File -ErrorAction SilentlyContinue |
    Where-Object {
      $_.Name.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase) -and
      $_.Extension -ieq ".mp3"
    } |
    Sort-Object LastWriteTime -Descending)
  if ($found.Count -gt 0) { return $found[0] }
  return $null
}

function Get-DownloadName($title, $videoId, $extension) {
  $clean = [System.Text.RegularExpressions.Regex]::Replace([string]$title, '[\\/:*?"<>|\x00-\x1F]', ' ')
  $clean = [System.Text.RegularExpressions.Regex]::Replace($clean, '\s+', ' ').Trim()
  if ([string]::IsNullOrWhiteSpace($clean)) { $clean = "audio" }
  if ($clean.Length -gt 80) { $clean = $clean.Substring(0, 80).Trim() }
  return $clean + " [" + $videoId + "]" + $extension
}

function Refresh-DownloadJob($job) {
  if (-not $job -or $job.Status -ne "running") { return $job }
  $process = $job.Process
  if (-not $process) {
    $job.Status = "error"
    $job.Error = "Proses unduhan tidak ditemukan"
    return $job
  }

  $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  if (-not $process.HasExited -and ($now - $job.StartedAt) -gt 600000) {
    try { $process.Kill() } catch { }
  }
  if (-not $process.HasExited) { return $job }

  try { $process.WaitForExit() } catch { }
  $stdout = ""
  $stderr = ""
  try { $stdout = $job.Stdout.Result } catch { }
  try { $stderr = $job.Stderr.Result } catch { }
  $exitCode = $process.ExitCode
  try { $process.Dispose() } catch { }
  $job.Process = $null

  if ($exitCode -eq 0) {
    $file = Find-DownloadFile $job.VideoId $job.Quality
    if ($file) {
      $extension = $file.Extension.ToLowerInvariant()
      $job.File = $file.FullName
      $job.Name = Get-DownloadName $job.Title $job.VideoId $extension
      $job.Status = "done"
      $job.Error = ""
    } else {
      $job.Status = "error"
      $job.Error = "File hasil unduhan tidak ditemukan"
    }
  } else {
    $lines = @($stderr -split "`r?`n" | Where-Object { $_.Trim() -ne "" })
    $last = if ($lines.Count -gt 0) { $lines[$lines.Count - 1].Trim() } else { "yt-dlp gagal (kode $exitCode)" }
    $job.Status = "error"
    $job.Error = $last
  }
  return $job
}

function Start-DownloadJob($videoId, $quality, $title) {
  if (-not (Test-Path -LiteralPath $script:ytdlpPath -PathType Leaf)) {
    return @{ Status = 503; Error = "yt-dlp tidak ditemukan" }
  }
  if ([string]::IsNullOrEmpty($script:ffmpegPath)) {
    return @{
      Status = 400
      Error = "Unduhan MP3 membutuhkan ffmpeg.exe. Letakkan ffmpeg.exe di folder aplikasi (atau tools\ffmpeg\bin), lalu jalankan ulang server."
    }
  }

  $key = $videoId + "|" + $quality
  $existingId = $script:downloadIndex[$key]
  if ($existingId) {
    $existing = $script:downloadJobs[$existingId]
    if ($existing) {
      $existing = Refresh-DownloadJob $existing
      if ($existing.Status -eq "running" -or ($existing.Status -eq "done" -and $existing.File)) {
        $existing.Title = $title
        return @{ Status = 200; Job = $existing }
      }
    }
    $script:downloadJobs.Remove($existingId)
    $script:downloadIndex.Remove($key)
  }

  $file = Find-DownloadFile $videoId $quality
  if ($file) {
    $jobId = [guid]::NewGuid().ToString("N").Substring(0, 12)
    $extension = $file.Extension.ToLowerInvariant()
    $job = @{
      Id = $jobId
      VideoId = $videoId
      Quality = $quality
      Title = $title
      File = $file.FullName
      Name = (Get-DownloadName $title $videoId $extension)
      Status = "done"
      Error = ""
      Process = $null
      Stdout = $null
      Stderr = $null
      StartedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    }
    $script:downloadJobs[$jobId] = $job
    $script:downloadIndex[$key] = $jobId
    return @{ Status = 200; Job = $job }
  }

  # Bersihkan file unduhan lama agar folder tidak terus menumpuk.
  try {
    $cutoff = (Get-Date).AddDays(-7)
    Get-ChildItem -LiteralPath $script:downloadDir -File -ErrorAction SilentlyContinue |
      Where-Object { $_.LastWriteTime -lt $cutoff } |
      ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue }
  } catch { }

  # Batasi jumlah riwayat job di memori.
  if ($script:downloadJobs.Count -gt 80) {
    $old = @($script:downloadJobs.Values |
      Where-Object { $_.Status -ne "running" } |
      Sort-Object { $_.StartedAt } |
      Select-Object -First 30)
    foreach ($item in $old) {
      $script:downloadJobs.Remove($item.Id)
      $script:downloadIndex.Remove($item.VideoId + "|" + $item.Quality)
    }
  }

  $outTemplate = Join-Path $script:downloadDir ("%(id)s-" + $quality + ".%(ext)s")
  $format = Get-AudioFormat $quality
  $mp3Quality = Get-Mp3Quality $quality
  $arguments = '-f "' + $format + '" --no-playlist --no-warnings --no-progress --no-part --newline' +
    ' --extract-audio --audio-format mp3 --audio-quality ' + $mp3Quality +
    ' --embed-metadata --embed-thumbnail --convert-thumbnails jpg' +
    ' --ffmpeg-location "' + $script:ffmpegPath + '"' +
    ' -o "' + $outTemplate + '" "https://www.youtube.com/watch?v=' + $videoId + '"'

  try {
    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $script:ytdlpPath
    $startInfo.Arguments = $arguments
    $startInfo.UseShellExecute = $false
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.CreateNoWindow = $true
    $startInfo.WorkingDirectory = $rootDir

    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $startInfo
    [void]$process.Start()

    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()

    $jobId = [guid]::NewGuid().ToString("N").Substring(0, 12)
    $job = @{
      Id = $jobId
      VideoId = $videoId
      Quality = $quality
      Title = $title
      File = ""
      Name = ""
      Status = "running"
      Error = ""
      Process = $process
      Stdout = $stdoutTask
      Stderr = $stderrTask
      StartedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    }
    $script:downloadJobs[$jobId] = $job
    $script:downloadIndex[$key] = $jobId
    return @{ Status = 200; Job = $job }
  } catch {
    return @{ Status = 502; Error = $_.Exception.Message }
  }
}

function Send-DownloadFile($stream, $filePath, $downloadName, $headOnly) {
  $bytes = [System.IO.File]::ReadAllBytes($filePath)
  $ext = [System.IO.Path]::GetExtension($filePath).ToLowerInvariant()
  $type = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { "application/octet-stream" }
  $ascii = [System.Text.RegularExpressions.Regex]::Replace([string]$downloadName, '[^\x20-\x7E]', '_').Replace('"', '_')
  $encoded = [System.Uri]::EscapeDataString([string]$downloadName)
  $header = "HTTP/1.1 200 OK`r`n" +
    "Content-Type: $type`r`n" +
    "Content-Length: $($bytes.Length)`r`n" +
    "Content-Disposition: attachment; filename=`"$ascii`"; filename*=UTF-8''$encoded`r`n" +
    "Cache-Control: no-store`r`n" +
    "X-Content-Type-Options: nosniff`r`n" +
    "Connection: close`r`n`r`n"
  $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($header)
  $stream.Write($headerBytes, 0, $headerBytes.Length)
  if (-not $headOnly -and $bytes.Length -gt 0) {
    $stream.Write($bytes, 0, $bytes.Length)
  }
  $stream.Flush()
}

Write-Host ""
Write-Host "  Musik - server lokal" -ForegroundColor Red
Write-Host "  http://127.0.0.1:$Port/" -ForegroundColor White
if (Test-Path -LiteralPath $script:ytdlpPath -PathType Leaf) {
  Write-Host "  Audio resolver: yt-dlp.exe siap" -ForegroundColor Green
} else {
  Write-Host "  Audio resolver: yt-dlp.exe tidak ditemukan (lagu YouTube nonaktif)" -ForegroundColor Yellow
}
if (-not [string]::IsNullOrEmpty($script:ffmpegPath)) {
  Write-Host "  ffmpeg: siap (unduhan MP3 + metadata aktif)" -ForegroundColor Green
} else {
  Write-Host "  ffmpeg: tidak ditemukan (unduhan MP3 nonaktif)" -ForegroundColor DarkGray
}
Write-Host "  Folder unduhan: $script:downloadDir" -ForegroundColor DarkGray
Write-Host "  Tekan Ctrl+C untuk berhenti." -ForegroundColor DarkGray
Write-Host ""

try {
  while ($true) {
    $client = $listener.AcceptTcpClient()
    try {
      $stream = $client.GetStream()
      $reader = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::ASCII, $false, 4096, $true)
      $requestLine = $reader.ReadLine()
      if ([string]::IsNullOrWhiteSpace($requestLine)) { continue }
      while ($true) {
        $line = $reader.ReadLine()
        if ($null -eq $line -or $line -eq "") { break }
      }

      $parts = $requestLine.Split(" ")
      $method = $parts[0]
      $rawPath = if ($parts.Length -gt 1) { $parts[1] } else { "/" }
      $queryAt = $rawPath.IndexOf("?")
      $rawQuery = if ($queryAt -ge 0) { $rawPath.Substring($queryAt + 1) } else { "" }
      $path = [System.Uri]::UnescapeDataString(($rawPath -split "\?")[0])
      if ($path -eq "/") { $path = "/index.html" }

      $relative = $path.TrimStart("/").Replace("/", "\")
      $full = [System.IO.Path]::GetFullPath((Join-Path $rootFull $relative))
      $headOnly = $method -eq "HEAD"

      if ($path -eq "/api/health" -and ($method -eq "GET" -or $headOnly)) {
        $available = Test-Path -LiteralPath $script:ytdlpPath -PathType Leaf
        $hasFfmpeg = -not [string]::IsNullOrEmpty($script:ffmpegPath)
        Send-Json $stream 200 "OK" @{ ytdlp = $available; ffmpeg = $hasFfmpeg; mp3 = ($available -and $hasFfmpeg); downloads = $available } $headOnly
      } elseif ($path -eq "/api/stream" -and ( $method -eq "GET" -or $headOnly) -and (Get-QueryValue $rawQuery "id")) {
        $videoId = Get-QueryValue $rawQuery "id"
        $quality = Get-QueryValue $rawQuery "quality"
        if ([string]::IsNullOrEmpty($quality) -or $quality -notin @("low", "medium", "high", "best")) {
          $quality = "best"
        }
        if ($videoId -notmatch '^[A-Za-z0-9_-]{11}$') {
          Send-Json $stream 400 "Bad Request" @{ error = "ID video tidak valid" } $headOnly
        } else {
          $now = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
          $cacheKey = $videoId + "|" + $quality
          $cached = $script:audioCache[$cacheKey]
          if (-not ($cached -and [int64]$cached.Expires -gt ($now + 300))) {
            $resolved = Invoke-YtDlp $videoId $quality
            if ($resolved.Status -eq 200) {
              $cached = @{ Url = $resolved.Url; Expires = [int64]$resolved.Expires }
              $script:audioCache[$cacheKey] = $cached
            } else {
              $status = if ($resolved.Status -eq 503) { 503 } else { 502 }
              $reason = if ($status -eq 503) { "Service Unavailable" } else { "Bad Gateway" }
              Send-Json $stream $status $reason @{ error = $resolved.Error } $headOnly
              $cached = $null
            }
          }
          if ($cached) {
            $audioUri = $null
            if ([Uri]::TryCreate([string]$cached.Url, [UriKind]::Absolute, [ref]$audioUri) -and
                $audioUri.Scheme -eq "https" -and
                ($audioUri.Host -eq "googlevideo.com" -or $audioUri.Host.EndsWith(".googlevideo.com", [StringComparison]::OrdinalIgnoreCase))) {
              Send-Redirect $stream $cached.Url
            } else {
              Send-Json $stream 502 "Bad Gateway" @{ error = "yt-dlp mengembalikan URL audio yang tidak valid" } $headOnly
            }
          }
        }
      } elseif ($path -eq "/api/resolve" -and $method -eq "GET") {
        $videoId = Get-QueryValue $rawQuery "id"
        $quality = Get-QueryValue $rawQuery "quality"
        if ([string]::IsNullOrEmpty($quality) -or $quality -notin @("low", "medium", "high", "best")) {
          $quality = "best"
        }
        if ([string]::IsNullOrEmpty($videoId) -or $videoId -notmatch '^[A-Za-z0-9_-]{11}$') {
          Send-Json $stream 400 "Bad Request" @{ error = "ID video tidak valid" } $false
        } else {
          $now = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
          $cacheKey = $videoId + "|" + $quality
          $cached = $script:audioCache[$cacheKey]
          if ($cached -and [int64]$cached.Expires -gt ($now + 300)) {
            Send-Json $stream 200 "OK" @{ url = $cached.Url; expires = [int64]$cached.Expires; quality = $quality } $false
          } else {
            $result = Invoke-YtDlp $videoId $quality
            if ($result.Status -eq 200) {
              $script:audioCache[$cacheKey] = @{ Url = $result.Url; Expires = [int64]$result.Expires }
              Send-Json $stream 200 "OK" @{ url = $result.Url; expires = [int64]$result.Expires; quality = $quality } $false
            } elseif ($result.Status -eq 503) {
              Send-Json $stream 503 "Service Unavailable" @{ error = $result.Error } $false
            } else {
              Send-Json $stream 502 "Bad Gateway" @{ error = $result.Error } $false
            }
          }
        }
      } elseif ($path -eq "/api/radio" -and $method -eq "GET") {
        $videoId = Get-QueryValue $rawQuery "id"
        if ([string]::IsNullOrEmpty($videoId) -or $videoId -notmatch '^[A-Za-z0-9_-]{11}$') {
          Send-Json $stream 400 "Bad Request" @{ error = "ID video tidak valid" } $false
        } else {
          $now = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
          $cached = $script:radioCache[$videoId]
          if ($cached -and [int64]$cached.Expires -gt $now) {
            Send-Json $stream 200 "OK" @{ tracks = $cached.Tracks } $false
          } else {
            $result = Invoke-YtDlpRadio $videoId
            if ($result.Status -eq 200) {
              $script:radioCache[$videoId] = @{ Tracks = $result.Tracks; Expires = ($now + 1800) }
              Send-Json $stream 200 "OK" @{ tracks = $result.Tracks } $false
            } elseif ($result.Status -eq 503) {
              Send-Json $stream 503 "Service Unavailable" @{ error = $result.Error } $false
            } else {
              Send-Json $stream 502 "Bad Gateway" @{ error = $result.Error } $false
            }
          }
        }
      } elseif ($path -eq "/api/download" -and $method -eq "GET") {
        $videoId = Get-QueryValue $rawQuery "id"
        if ([string]::IsNullOrEmpty($videoId) -or $videoId -notmatch '^[A-Za-z0-9_-]{11}$') {
          Send-Json $stream 400 "Bad Request" @{ error = "ID video tidak valid" } $false
        } else {
          $quality = Get-QueryValue $rawQuery "quality"
          if ([string]::IsNullOrEmpty($quality) -or $quality -notin @("low", "medium", "high", "best", "lossless")) {
            $quality = "best"
          }
          $title = Get-QueryValue $rawQuery "title"
          if ([string]::IsNullOrEmpty($title)) { $title = "audio" }
          $result = Start-DownloadJob $videoId $quality $title
          if ($result.Status -eq 200) {
            Send-Json $stream 200 "OK" @{ jobId = $result.Job.Id; status = $result.Job.Status; quality = $quality } $false
          } elseif ($result.Status -eq 503) {
            Send-Json $stream 503 "Service Unavailable" @{ error = $result.Error } $false
          } elseif ($result.Status -eq 400) {
            Send-Json $stream 400 "Bad Request" @{ error = $result.Error } $false
          } else {
            Send-Json $stream 502 "Bad Gateway" @{ error = $result.Error } $false
          }
        }
      } elseif ($path -eq "/api/download-status" -and $method -eq "GET") {
        $jobId = Get-QueryValue $rawQuery "job"
        if ([string]::IsNullOrEmpty($jobId) -or $jobId -notmatch '^[a-f0-9]{12}$') {
          Send-Json $stream 400 "Bad Request" @{ error = "ID unduhan tidak valid" } $false
        } else {
          $job = $script:downloadJobs[$jobId]
          if (-not $job) {
            Send-Json $stream 404 "Not Found" @{ error = "Unduhan tidak ditemukan" } $false
          } else {
            $job = Refresh-DownloadJob $job
            $payload = @{
              jobId = $job.Id
              status = $job.Status
              quality = $job.Quality
              name = $job.Name
              url = if ($job.Status -eq "done") { "/api/download-file?job=" + $job.Id } else { "" }
              error = $job.Error
              size = 0
            }
            if ($job.Status -eq "done" -and -not [string]::IsNullOrEmpty($job.File)) {
              try { $payload.size = (Get-Item -LiteralPath $job.File).Length } catch { $payload.size = 0 }
            }
            Send-Json $stream 200 "OK" $payload $false
          }
        }
      } elseif ($path -eq "/api/download-file" -and ($method -eq "GET" -or $headOnly)) {
        $jobId = Get-QueryValue $rawQuery "job"
        if ([string]::IsNullOrEmpty($jobId) -or $jobId -notmatch '^[a-f0-9]{12}$') {
          Send-Response $stream 400 "Bad Request" "text/plain; charset=utf-8" ([System.Text.Encoding]::UTF8.GetBytes("ID unduhan tidak valid.")) $headOnly
        } else {
          $job = $script:downloadJobs[$jobId]
          if (-not $job) {
            Send-Response $stream 404 "Not Found" "text/plain; charset=utf-8" ([System.Text.Encoding]::UTF8.GetBytes("Unduhan tidak ditemukan.")) $headOnly
          } else {
            $job = Refresh-DownloadJob $job
            if ($job.Status -eq "running") {
              Send-Response $stream 409 "Conflict" "text/plain; charset=utf-8" ([System.Text.Encoding]::UTF8.GetBytes("Unduhan masih berjalan.")) $headOnly
            } elseif ($job.Status -ne "done" -or [string]::IsNullOrEmpty($job.File) -or -not (Test-Path -LiteralPath $job.File -PathType Leaf)) {
              Send-Response $stream 404 "Not Found" "text/plain; charset=utf-8" ([System.Text.Encoding]::UTF8.GetBytes("File unduhan tidak tersedia.")) $headOnly
            } else {
              $jobFile = [System.IO.Path]::GetFullPath($job.File)
              if (-not $jobFile.StartsWith($script:downloadRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
                Send-Response $stream 403 "Forbidden" "text/plain; charset=utf-8" ([System.Text.Encoding]::UTF8.GetBytes("Akses ditolak.")) $headOnly
              } else {
                Send-DownloadFile $stream $jobFile $job.Name $headOnly
              }
            }
          }
        }
      } elseif ($method -ne "GET" -and -not $headOnly) {
        Send-Response $stream 405 "Method Not Allowed" "text/plain; charset=utf-8" ([System.Text.Encoding]::UTF8.GetBytes("Metode tidak didukung.")) $false
      } elseif (-not $full.StartsWith($rootFull, [System.StringComparison]::OrdinalIgnoreCase)) {
        Send-Response $stream 403 "Forbidden" "text/plain; charset=utf-8" ([System.Text.Encoding]::UTF8.GetBytes("Akses ditolak.")) $headOnly
      } elseif (-not (Test-Path -LiteralPath $full -PathType Leaf)) {
        Send-Response $stream 404 "Not Found" "text/plain; charset=utf-8" ([System.Text.Encoding]::UTF8.GetBytes("File tidak ditemukan.")) $headOnly
      } else {
        $ext = [System.IO.Path]::GetExtension($full).ToLowerInvariant()
        $type = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { "application/octet-stream" }
        $bytes = [System.IO.File]::ReadAllBytes($full)
        Send-Response $stream 200 "OK" $type $bytes $headOnly
      }
    } catch {
      # Koneksi yang diputus browser bukan masalah.
    } finally {
      if ($client) { $client.Close() }
    }
  }
} finally {
  $listener.Stop()
}
