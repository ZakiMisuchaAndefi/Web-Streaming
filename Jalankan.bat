@echo off
setlocal
cd /d "%~dp0"

echo.
echo   Musik - menyiapkan server lokal...
echo.

if not exist "%~dp0yt-dlp.exe" (
  echo   [INFO] yt-dlp.exe tidak ditemukan.
  echo   Semua lagu YouTube memerlukan file ini untuk diputar sebagai audio.
  echo   Unduh di: https://github.com/yt-dlp/yt-dlp/releases/latest
  echo   Letakkan yt-dlp.exe di folder ini, sejajar dengan server.ps1.
  echo.
)

start "Musik Server" /min powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0server.ps1"

powershell -NoProfile -Command "$ok=$false; $i=0; while(-not $ok -and $i -lt 24){ try { Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:4173/' -TimeoutSec 1 | Out-Null; $ok=$true } catch { Start-Sleep -Milliseconds 250; $i++ } }; if(-not $ok){ exit 1 }"

if errorlevel 1 (
  echo.
  echo   Server tidak dapat dijalankan.
  echo   Pastikan port 4173 tidak dipakai program lain, lalu coba lagi.
  echo.
  pause
  exit /b 1
)

start "" "http://127.0.0.1:4173/"
exit /b 0
