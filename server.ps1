# ==========================================================================
# server.ps1 - server statis kecil + resolver audio lokal (InnerTube).
# Jalankan dari PowerShell:  .\server.ps1
# Lalu buka:                 http://127.0.0.1:4173/
#
# Endpoint tambahan:
#   GET /api/health              -> { "INNER_TUBE": true|false, "ffmpeg": true|false, "mp3": true|false }
#   GET /api/search?q=KATA       -> { "items": [...], "alternates": [...] } (InnerTube)
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
$script:INNER_TUBEPath = Join-Path $rootDir "scripts\innertube-cli.js"
$script:nodePath = ""
try {
  $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
  if ($nodeCommand) { $script:nodePath = [string]$nodeCommand.Source }
} catch { }
$script:audioCache = @{}
$script:audioFileCache = [ordered]@{}
$script:radioCache = @{}
$script:searchCache = @{}
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch { }
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

# Proxy byte-range audio dari Google Video ke browser (sama seperti api/stream.js).
function Send-AudioStream($stream, $url, $clientRange, $headOnly, $userAgent) {
  # Satu respons dibatasi 1 MB agar setiap permintaan tetap singkat, sama
  # seperti api/stream.js di Vercel.
  $maxBytes = 1 * 1024 * 1024
  $start = 0
  $end = $maxBytes - 1
  $suffixLength = 0
  if ($clientRange -match '^bytes=(\d*)-(\d*)$') {
    if ($Matches[1] -eq "" -and $Matches[2] -ne "") {
      $suffixLength = [Math]::Min([int64]$Matches[2], [int64]$maxBytes)
    } elseif ($Matches[1] -ne "") {
      $start = [int64]$Matches[1]
      if ($Matches[2] -ne "") { $end = [int64]$Matches[2] }
      else { $end = $start + $maxBytes - 1 }
      if ($end -lt $start) { throw "Rentang audio tidak valid" }
      if (($end - $start + 1) -gt $maxBytes) { $end = $start + $maxBytes - 1 }
    }
  }

  $initialUri = $null
  if (-not [Uri]::TryCreate([string]$url, [UriKind]::Absolute, [ref]$initialUri) -or
      $initialUri.Scheme -ne "https" -or
      ($initialUri.Host -ne "googlevideo.com" -and
       -not $initialUri.Host.EndsWith(".googlevideo.com", [StringComparison]::OrdinalIgnoreCase))) {
    throw "URL audio bukan host Google Video yang diizinkan"
  }
  $total = 0L
  if ($initialUri.Query -match '(?:\?|&)clen=(\d+)') {
    $total = [int64]$Matches[1]
    if ($total -gt 0) {
      if ($suffixLength -gt 0) {
        $suffixLength = [Math]::Min([Math]::Min([int64]$suffixLength, [int64]$maxBytes), $total)
        $start = $total - $suffixLength
        $end = $total - 1
        $suffixLength = 0
      } elseif ($start -ge $total) {
        $header = "HTTP/1.1 416 Range Not Satisfiable`r`n" +
          "Content-Range: bytes */$total`r`n" +
          "Accept-Ranges: bytes`r`n" +
          "Content-Length: 0`r`n" +
          "Connection: close`r`n`r`n"
        $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($header)
        $stream.Write($headerBytes, 0, $headerBytes.Length)
        $stream.Flush()
        return
      } else {
        $end = [Math]::Min([Math]::Min([int64]$end, [int64]($start + $maxBytes - 1)), [int64]($total - 1))
      }
    }
  }

  $target = $url
  $response = $null
  for ($attempt = 0; $attempt -lt 6; $attempt++) {
    $request = [System.Net.HttpWebRequest]::Create($target)
    $request.Method = "GET"
    $request.UserAgent = if ([string]::IsNullOrWhiteSpace($userAgent)) {
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    } else {
      [string]$userAgent
    }
    $request.Accept = "*/*"
    $request.AllowAutoRedirect = $false
    $request.Timeout = 30000
    $request.ReadWriteTimeout = 30000
    if ($suffixLength -gt 0) {
      $request.AddRange("bytes", [int64](-$suffixLength))
    } else {
      $request.AddRange("bytes", [int64]$start, [int64]$end)
    }

    try {
      $response = $request.GetResponse()
    } catch [System.Net.WebException] {
      $failure = $_.Exception.Response
      if ($failure) {
        $statusCode = [int]$failure.StatusCode
        if ($statusCode -ge 300 -and $statusCode -lt 400) {
          $location = $failure.Headers["Location"]
          $failure.Close()
          if ([string]::IsNullOrEmpty($location)) { throw "Redirect audio tanpa Location" }
          $target = (New-Object System.Uri((New-Object System.Uri($target)), $location)).AbsoluteUri
          $redirectUri = $null
          if (-not [Uri]::TryCreate([string]$target, [UriKind]::Absolute, [ref]$redirectUri) -or
              $redirectUri.Scheme -ne "https" -or
              ($redirectUri.Host -ne "googlevideo.com" -and
               -not $redirectUri.Host.EndsWith(".googlevideo.com", [StringComparison]::OrdinalIgnoreCase))) {
            throw "URL redirect audio bukan host Google Video yang diizinkan"
          }
          continue
        }
      }
      throw
    }

    if ([int]$response.StatusCode -ge 300 -and [int]$response.StatusCode -lt 400) {
      $location = $response.Headers["Location"]
      $response.Close()
      if ([string]::IsNullOrEmpty($location)) { throw "Redirect tanpa Location" }
      $target = (New-Object System.Uri((New-Object System.Uri($target)), $location)).AbsoluteUri
      $redirectUri = $null
      if (-not [Uri]::TryCreate([string]$target, [UriKind]::Absolute, [ref]$redirectUri) -or
          $redirectUri.Scheme -ne "https" -or
          ($redirectUri.Host -ne "googlevideo.com" -and
           -not $redirectUri.Host.EndsWith(".googlevideo.com", [StringComparison]::OrdinalIgnoreCase))) {
        throw "URL redirect audio bukan host Google Video yang diizinkan"
      }
      continue
    }
    break
  }

  if (-not $response) { throw "Gagal mengambil audio" }

  try {
    $upstream = $response.GetResponseStream()
    $memory = New-Object System.IO.MemoryStream
    $buffer = New-Object byte[] 65536
    $total = 0
    while ($total -lt $maxBytes) {
      $want = [Math]::Min($buffer.Length, $maxBytes - $total)
      $read = $upstream.Read($buffer, 0, $want)
      if ($read -le 0) { break }
      $memory.Write($buffer, 0, $read)
      $total += $read
    }
    $bytes = $memory.ToArray()
    $memory.Dispose()
    $contentType = if ($response.ContentType) { $response.ContentType } else { "audio/mp4" }
    $contentRange = $response.Headers["Content-Range"]
    $status = 206
    $reason = "Partial Content"
    if ([string]::IsNullOrEmpty($contentRange)) {
      $status = 200
      $reason = "OK"
    }

    $header = "HTTP/1.1 $status $reason`r`n" +
      "Content-Type: $contentType`r`n" +
      "Content-Length: $($bytes.Length)`r`n" +
      "Accept-Ranges: bytes`r`n" +
      $(if ($contentRange) { "Content-Range: $contentRange`r`n" } else { "" }) +
      "Cache-Control: no-store`r`n" +
      "Connection: close`r`n`r`n"
    $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($header)
    $stream.Write($headerBytes, 0, $headerBytes.Length)
    if (-not $headOnly -and $bytes.Length -gt 0) {
      $stream.Write($bytes, 0, $bytes.Length)
    }
    $stream.Flush()
  } finally {
    $response.Close()
  }
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

# Kualitas VBR MP3 untuk unduhan: 0 = terbaik, 9 = paling hemat.
function Get-Mp3Quality($quality) {
  switch ($quality) {
    "low" { return "7" }
    "medium" { return "5" }
    "high" { return "2" }
    default { return "0" }
  }
}

# --------------------------------------------------------------------------
# InnerTube untuk pencarian, audio, dan radio.
# Semua proses Node dijalankan lewat scripts/innertube-cli.js.
# --------------------------------------------------------------------------

function Test-InnerTubeResolver {
  return (-not [string]::IsNullOrEmpty($script:nodePath)) -and
    (Test-Path -LiteralPath $script:INNER_TUBEPath -PathType Leaf)
}

function Invoke-InnertubeCli([string[]]$CliArgs, [int]$TimeoutMs) {
  if ([string]::IsNullOrEmpty($script:nodePath) -or
      -not (Test-Path -LiteralPath $script:INNER_TUBEPath -PathType Leaf)) {
    return @{ Status = 503; Error = "Node.js atau scripts/innertube-cli.js tidak ditemukan" }
  }

  $process = $null
  try {
    $quoted = @()
    foreach ($arg in $CliArgs) {
      $quoted += '"' + ([string]$arg).Replace('"', ' ') + '"'
    }
    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $script:nodePath
    $startInfo.Arguments = '"' + $script:INNER_TUBEPath + '" ' + ($quoted -join ' ')
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

    if (-not $process.WaitForExit($TimeoutMs)) {
      try { $process.Kill() } catch { }
      return @{ Status = 504; Error = "Resolver audio melebihi batas waktu" }
    }

    $stdout = $stdoutTask.Result
    $stderr = $stderrTask.Result

    if ($process.ExitCode -ne 0 -or [string]::IsNullOrWhiteSpace($stdout)) {
      $lines = @($stderr -split "`r?`n" | Where-Object { $_.Trim() -ne "" })
      $last = if ($lines.Count -gt 0) { $lines[$lines.Count - 1].Trim() } else { "Resolver gagal (kode $($process.ExitCode))" }
      return @{ Status = 502; Error = $last }
    }

    return @{ Status = 200; Output = $stdout.Trim() }
  } catch {
    return @{ Status = 502; Error = $_.Exception.Message }
  } finally {
    if ($process) { $process.Dispose() }
  }
}

function Invoke-InnerTubeSearch($query) {
  # Memakai resolver Node yang sama dengan fungsi /api/search di Vercel,
  # sehingga hasil lokal (lagu YouTube Music) identik dengan produksi.
  $result = Invoke-InnertubeCli @("search", $query) 20000
  if ($result.Status -ne 200) {
    throw "Pencarian InnerTube gagal: $($result.Error)"
  }
  $payload = $result.Output | ConvertFrom-Json
  return @{
    items = @($payload.items)
    alternates = @($payload.alternates)
  }
}

function Invoke-INNER_TUBE($videoId, $quality) {
  $result = Invoke-InnertubeCli @("audio", $videoId, $quality) 20000
  if ($result.Status -ne 200) {
    return @{ Status = $result.Status; Error = $result.Error }
  }

  try {
    $entry = $result.Output | ConvertFrom-Json
  } catch {
    return @{ Status = 502; Error = "Resolver audio mengembalikan data yang tidak valid" }
  }

  $url = [string]$entry.url
  if ($url -notmatch '^https://') {
    return @{ Status = 502; Error = "InnerTube tidak mengembalikan URL audio" }
  }

  $userAgent = ""
  if ($entry.headers -and $entry.headers.PSObject.Properties["User-Agent"]) {
    $userAgent = [string]$entry.headers."User-Agent"
  }

  $now = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
  $expires = [int64]$entry.expires
  if ($expires -le 0) { $expires = $now + 3600 }
  if ($url -match '[?&]expire=(\d+)') {
    $expires = [int64]$Matches[1]
  }

  return @{ Status = 200; Url = $url; UserAgent = $userAgent; Expires = $expires }
}

function Invoke-INNER_TUBERadio($videoId) {
  $result = Invoke-InnertubeCli @("radio", $videoId) 30000
  if ($result.Status -ne 200) {
    return @{ Status = $result.Status; Error = $result.Error }
  }

  $tracks = @()
  $seen = @{}
  foreach ($line in ($result.Output -split "`r?`n")) {
    if ($tracks.Count -ge 40) { break }
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    $cols = $line -split "`t"
    if ($cols.Count -lt 3) { continue }

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

    $artist = if ($cols.Count -ge 4) { $cols[3].Trim() } else { "" }
    $seen[$vid] = $true
    $tracks += @{
      id = $vid
      title = $title
      artist = $artist
      duration = $duration
    }
  }

  if ($tracks.Count -eq 0) {
    return @{ Status = 502; Error = "Radio YouTube tidak mengembalikan lagu" }
  }
  return @{ Status = 200; Tracks = $tracks }
}

# --------------------------------------------------------------------------
# Unduhan audio (job latar)
# InnerTube dijalankan tanpa ditunggu agar server tetap melayani pemutaran.
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
    $last = if ($lines.Count -gt 0) { $lines[$lines.Count - 1].Trim() } else { "InnerTube gagal (kode $exitCode)" }
    $job.Status = "error"
    $job.Error = $last
  }
  return $job
}

function Start-DownloadJob($videoId, $quality, $title) {
  if (-not (Test-InnerTubeResolver)) {
    return @{ Status = 503; Error = "Node.js atau scripts/innertube-cli.js tidak ditemukan" }
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

  $resolved = Invoke-INNER_TUBE $videoId $quality
  if ($resolved.Status -ne 200) {
    return @{ Status = $resolved.Status; Error = $resolved.Error }
  }

  $outFile = Join-Path $script:downloadDir ($videoId + "-" + $quality + ".mp3")
  $mp3Quality = Get-Mp3Quality $quality
  $safeTitle = ([string]$title).Replace('"', "'").Replace("`r", " ").Replace("`n", " ")
  $audioUserAgent = if ([string]::IsNullOrWhiteSpace([string]$resolved.UserAgent)) {
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
  } else {
    ([string]$resolved.UserAgent).Replace('"', "")
  }
  $arguments = '-y -hide_banner -loglevel error -nostdin' +
    ' -user_agent "' + $audioUserAgent + '"' +
    ' -i "' + $resolved.Url + '"' +
    ' -vn -map 0:a:0 -c:a libmp3lame -q:a ' + $mp3Quality +
    ' -id3v2_version 3 -metadata title="' + $safeTitle + '" -metadata comment="YouTube"' +
    ' -f mp3 "' + $outFile + '"'

  try {
    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $script:ffmpegPath
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
if (Test-InnerTubeResolver) {
  Write-Host "  Audio resolver: InnerTube (Node) siap" -ForegroundColor Green
} else {
  Write-Host "  Audio resolver: Node.js/scripts/innertube-cli.js tidak ditemukan (lagu YouTube nonaktif)" -ForegroundColor Yellow
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
      $clientRange = ""
      while ($true) {
        $line = $reader.ReadLine()
        if ($null -eq $line -or $line -eq "") { break }
        if ($line -match '^Range:\s*(.+)$') { $clientRange = $Matches[1].Trim() }
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
        $available = Test-InnerTubeResolver
        $hasFfmpeg = -not [string]::IsNullOrEmpty($script:ffmpegPath)
        Send-Json $stream 200 "OK" @{ INNER_TUBE = $available; ffmpeg = $hasFfmpeg; mp3 = ($available -and $hasFfmpeg); downloads = $available } $headOnly
      } elseif ($path -eq "/api/search" -and ($method -eq "GET" -or $headOnly)) {
        $query = Get-QueryValue $rawQuery "q"
        if ([string]::IsNullOrWhiteSpace($query)) {
          Send-Json $stream 400 "Bad Request" @{ error = "Kata kunci pencarian kosong" } $headOnly
        } else {
          $query = $query.Trim()
          if ($query.Length -gt 80) { $query = $query.Substring(0, 80) }
          $cacheKey = $query.ToLowerInvariant()
          $now = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
          $cached = $script:searchCache[$cacheKey]
          if ($cached -and [int64]$cached.Expires -gt $now) {
            Send-Json $stream 200 "OK" $cached.Payload $headOnly
          } else {
            try {
              $result = Invoke-InnerTubeSearch $query
              $payload = @{ items = $result.items; alternates = $result.alternates }
              if ($script:searchCache.Count -gt 100) { $script:searchCache.Clear() }
              $script:searchCache[$cacheKey] = @{ Payload = $payload; Expires = ($now + 300) }
              Send-Json $stream 200 "OK" $payload $headOnly
            } catch {
              Send-Json $stream 502 "Bad Gateway" @{ error = $_.Exception.Message } $headOnly
            }
          }
        }
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
          $force = (Get-QueryValue $rawQuery "force") -eq "1"
          $cached = $script:audioCache[$cacheKey]
          if ($force -or -not ($cached -and [int64]$cached.Expires -gt ($now + 300))) {
            $resolved = Invoke-INNER_TUBE $videoId $quality
            if ($resolved.Status -eq 200) {
              $cached = @{ Url = $resolved.Url; UserAgent = $resolved.UserAgent; Expires = [int64]$resolved.Expires }
              $script:audioCache[$cacheKey] = $cached
            } else {
              $status = if ($resolved.Status -eq 503) { 503 } else { 502 }
              $reason = if ($status -eq 503) { "Service Unavailable" } else { "Bad Gateway" }
              Send-Json $stream $status $reason @{ error = $resolved.Error } $headOnly
              $cached = $null
            }
          }
          if ($cached) {
            try {
              Send-AudioStream $stream $cached.Url $clientRange $headOnly $cached.UserAgent
            } catch {
              Write-Host "[stream] gagal meneruskan audio: $($_.Exception.Message)" -ForegroundColor Yellow
              if (-not $headOnly) {
                Send-Json $stream 502 "Bad Gateway" @{ error = "Layanan audio tidak tersedia saat ini." } $false
              }
            }
          }
        }
      } elseif ($path -eq "/api/stream" -and ( $method -eq "GET" -or $headOnly) -and (Get-QueryValue $rawQuery "u")) {
        $target = Get-QueryValue $rawQuery "u"
        if ([string]::IsNullOrEmpty($target)) {
          Send-Json $stream 400 "Bad Request" @{ error = "URL tidak valid" } $headOnly
        } else {
          try {
            Send-AudioStream $stream $target $clientRange $headOnly
          } catch {
            if (-not $headOnly) {
              Send-Json $stream 502 "Bad Gateway" @{ error = "Layanan audio tidak tersedia saat ini." } $false
            }
          }
        }
      } elseif ($path -eq "/api/resolve" -and $method -eq "GET") {
        $videoId = Get-QueryValue $rawQuery "id"
        $quality = Get-QueryValue $rawQuery "quality"
        $force = (Get-QueryValue $rawQuery "force") -eq "1"
        if ([string]::IsNullOrEmpty($quality) -or $quality -notin @("low", "medium", "high", "best")) {
          $quality = "best"
        }
        if ([string]::IsNullOrEmpty($videoId) -or $videoId -notmatch '^[A-Za-z0-9_-]{11}$') {
          Send-Json $stream 400 "Bad Request" @{ error = "ID video tidak valid" } $false
        } else {
          $now = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
          $cacheKey = $videoId + "|" + $quality
          $proxyUrl = "/api/stream?id=" + [System.Uri]::EscapeDataString($videoId) + "&quality=" + [System.Uri]::EscapeDataString($quality)
          $cached = $script:audioCache[$cacheKey]
          if (-not $force -and $cached -and [int64]$cached.Expires -gt ($now + 300)) {
            Send-Json $stream 200 "OK" @{ url = $proxyUrl; expires = [int64]$cached.Expires; quality = $quality } $false
          } else {
            $result = Invoke-INNER_TUBE $videoId $quality
            if ($result.Status -eq 200) {
              $script:audioCache[$cacheKey] = @{ Url = $result.Url; UserAgent = $result.UserAgent; Expires = [int64]$result.Expires }
              Send-Json $stream 200 "OK" @{ url = $proxyUrl; expires = [int64]$result.Expires; quality = $quality } $false
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
            $result = Invoke-INNER_TUBERadio $videoId
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
