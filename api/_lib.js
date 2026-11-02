// Audio Vercel memakai yt-dlp; InnerTube tetap dipakai untuk radio.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");

const ID = /^[A-Za-z0-9_-]{11}$/;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const MAX_AUDIO_CACHE = 12;
const MAX_AUDIO_CACHE_BYTES = 180 * 1024 * 1024;
const MAX_AUDIO_URL_CACHE = 200;
const audioFiles = new Map();
const audioFileTasks = new Map();
const audioUrls = new Map();
const FORMATS = {
  low: "bestaudio[abr<=96]/bestaudio[ext=m4a][abr<=128]/bestaudio",
  medium: "bestaudio[abr<=128]/bestaudio[ext=m4a]/bestaudio",
  high: "bestaudio[abr<=192]/bestaudio[ext=m4a]/bestaudio",
  best: "bestaudio/bestaudio[ext=m4a]"
};
const BIN = process.env.YTDLP_PATH || path.join(os.tmpdir(), process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp");
const BIN_URL =
  "https://github.com/yt-dlp/yt-dlp/releases/latest/download/" +
  (process.platform === "win32"
    ? "yt-dlp.exe"
    : process.platform === "darwin"
      ? "yt-dlp_macos"
      : "yt-dlp_linux");
let binTask = null;

// Klien InnerTube untuk radio; resolver audio Vercel menggunakan yt-dlp.
const INNER_TUBE_CLIENTS = [
  {
    id: "ANDROID",
    clientName: "ANDROID",
    clientVersion: "20.10.38",
    clientId: 3,
    platform: "MOBILE",
    hl: "en",
    gl: "US"
  },
  {
    id: "IOS",
    clientName: "IOS",
    clientVersion: "20.10.4",
    clientId: 5,
    platform: "MOBILE",
    hl: "en",
    gl: "US"
  }
];

const qualityOf = (q) => (FORMATS[q] ? q : "best");

async function ensureBinary() {
  if (process.env.YTDLP_PATH) return BIN;
  if (binTask) return binTask;
  binTask = (async () => {
    if (fs.existsSync(BIN) && fs.statSync(BIN).size > 1e6) return BIN;
    const response = await fetch(BIN_URL, { redirect: "follow" });
    if (!response.ok) throw new Error("Gagal mengunduh yt-dlp (HTTP " + response.status + ")");
    const binary = Buffer.from(await response.arrayBuffer());
    if (binary.length < 1e6) throw new Error("Unduhan binary yt-dlp tidak lengkap");

    const temporary = BIN + "." + process.pid + "." + Date.now() + ".part";
    try {
      fs.writeFileSync(temporary, binary, { mode: 0o755 });
      try {
        fs.renameSync(temporary, BIN);
      } catch (error) {
        if (!fs.existsSync(BIN)) throw error;
      }
      if (process.platform !== "win32") fs.chmodSync(BIN, 0o755);
      return BIN;
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
  })().catch((error) => {
    binTask = null;
    throw error;
  });
  return binTask;
}

async function run(args, timeout) {
  const binary = await ensureBinary();
  const base = ["--no-cache-dir", "--no-warnings"];
  const execute = (extra) =>
    new Promise((resolve, reject) => {
      execFile(
        binary,
        extra.concat(base, args),
        {
          timeout: timeout || 45000,
          maxBuffer: 10 * 1024 * 1024,
          env: Object.assign({}, process.env, { TMPDIR: os.tmpdir(), HOME: os.tmpdir() })
        },
        (error, stdout, stderr) => {
          if (error) {
            const text = String(stderr || "");
            const failure = new Error(text.trim().split("\n").pop() || error.message);
            failure.stderr = text;
            return reject(failure);
          }
          resolve(stdout);
        }
      );
    });

  if (process.env.YTDLP_NO_JS_RUNTIME) return execute([]);
  try {
    return await execute(["--js-runtimes", "node:" + process.execPath]);
  } catch (error) {
    if (/js-runtimes|no such option|unrecognized/i.test(error.stderr || "")) return execute([]);
    throw error;
  }
}

function removeAudioFile(entry) {
  try {
    if (entry && entry.path && fs.existsSync(entry.path)) fs.unlinkSync(entry.path);
  } catch (error) {
    console.warn("[yt-dlp] gagal membersihkan cache audio:", error);
  }
}

function cleanupAudioPrefix(prefix) {
  try {
    const base = path.basename(prefix);
    for (const name of fs.readdirSync(os.tmpdir())) {
      if (name.startsWith(base + ".")) removeAudioFile({ path: path.join(os.tmpdir(), name) });
    }
  } catch (error) {
    console.warn("[yt-dlp] gagal membersihkan file sementara:", error);
  }
}

function trimAudioCache() {
  let totalBytes = Array.from(audioFiles.values()).reduce((sum, entry) => sum + entry.size, 0);
  while (audioFiles.size > MAX_AUDIO_CACHE || (totalBytes > MAX_AUDIO_CACHE_BYTES && audioFiles.size > 1)) {
    const first = audioFiles.entries().next();
    if (first.done) break;
    audioFiles.delete(first.value[0]);
    totalBytes -= first.value[1].size;
    removeAudioFile(first.value[1]);
  }
}

function expiresFromUrl(rawUrl) {
  const parsed = new URL(rawUrl);
  const value = Number(parsed.searchParams.get("expire") || "0");
  return Number.isFinite(value) && value > 0 ? value : Math.floor(Date.now() / 1000) + 3600;
}

function trimAudioUrlCache() {
  while (audioUrls.size > MAX_AUDIO_URL_CACHE) {
    const first = audioUrls.keys().next();
    if (first.done) break;
    audioUrls.delete(first.value);
  }
}

function makeClientPayload(client) {
  return {
    context: {
      client: {
        clientName: client.clientName,
        clientVersion: client.clientVersion,
        clientScreen: "WATCH",
        platform: client.platform,
        hl: client.hl,
        gl: client.gl
      }
    }
  };
}

async function innertube(endpoint, body, client) {
  const cfg = client || INNER_TUBE_CLIENTS[0];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(
      "https://youtubei.googleapis.com/youtubei/v1/" + endpoint + "?prettyPrint=false",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "User-Agent": UA,
          "X-YouTube-Client-Name": String(cfg.clientId),
          "X-YouTube-Client-Version": cfg.clientVersion,
          Referer: "https://www.youtube.com/",
          "Accept-Language": "en-US,en;q=0.9"
        },
        signal: controller.signal,
        body: JSON.stringify(Object.assign(makeClientPayload(cfg), body || {}))
      }
    );

    const text = await response.text();
    if (!response.ok) {
      const message = text ? String(text).slice(0, 200) : "HTTP " + response.status;
      throw new Error("InnerTube " + endpoint + " gagal (" + response.status + "): " + message);
    }

    try {
      return JSON.parse(text);
    } catch (error) {
      return { raw: text };
    }
  } finally {
    clearTimeout(timer);
  }
}

async function getAudioUrl(id, quality, force) {
  if (!ID.test(String(id || ""))) throw new Error("ID video tidak valid");
  const mode = qualityOf(quality);
  const key = String(id) + "|" + mode;
  const now = Math.floor(Date.now() / 1000);
  if (force) audioUrls.delete(key);
  const cached = audioUrls.get(key);
  if (cached && cached.expires > now + 300) return cached;

  const output = await run(
    [
      "-f",
      FORMATS[mode],
      "--dump-single-json",
      "--skip-download",
      "--no-playlist",
      "https://www.youtube.com/watch?v=" + id
    ],
    45000
  );
  const result = JSON.parse(String(output));
  const url = String((result && result.url) || "").trim();
  if (!url || !isAllowed(url)) throw new Error("yt-dlp tidak mengembalikan URL audio yang valid");
  const rawUserAgent = result && result.http_headers && result.http_headers["User-Agent"];
  const entry = {
    url,
    headers: typeof rawUserAgent === "string" ? { "User-Agent": rawUserAgent } : {},
    expires: expiresFromUrl(url)
  };
  audioUrls.set(key, entry);
  trimAudioUrlCache();
  return entry;
}

async function getAudioFile(id, quality, force) {
  if (!ID.test(String(id || ""))) {
    throw new Error("ID video tidak valid");
  }

  const mode = qualityOf(quality);
  const key = String(id) + "|" + mode;
  if (force) {
    const cached = audioFiles.get(key);
    audioFiles.delete(key);
    removeAudioFile(cached);
  }
  const cached = audioFiles.get(key);
  if (cached && fs.existsSync(cached.path)) {
    audioFiles.delete(key);
    audioFiles.set(key, cached);
    return cached;
  }
  if (cached) audioFiles.delete(key);
  if (audioFileTasks.has(key)) return audioFileTasks.get(key);

  const task = (async () => {
    const prefix = path.join(os.tmpdir(), "yt-audio-" + id + "-" + mode + "-" + process.pid + "-" + Date.now());
    try {
      const output = await run(
        [
          "-f",
          FORMATS[mode],
          "--no-playlist",
          "--print",
          "after_move:filepath",
          "-o",
          prefix + ".%(ext)s",
          "https://www.youtube.com/watch?v=" + id
        ],
        45000
      );
      const outputPath = String(output)
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line.startsWith(prefix + ".") && fs.existsSync(line));
      if (!outputPath) throw new Error("yt-dlp tidak menghasilkan file audio");

      const stat = fs.statSync(outputPath);
      if (!stat.isFile() || stat.size <= 0) throw new Error("File audio hasil yt-dlp kosong");

      const entry = {
        path: outputPath,
        size: stat.size,
        contentType: contentTypeFor(outputPath),
        expires: Math.floor(Date.now() / 1000) + 86400
      };
      audioFiles.set(key, entry);
      trimAudioCache();
      return entry;
    } catch (error) {
      cleanupAudioPrefix(prefix);
      throw error;
    }
  })().finally(() => {
    audioFileTasks.delete(key);
  });
  audioFileTasks.set(key, task);
  return task;
}

function contentTypeFor(filePath) {
  switch (path.extname(filePath).toLowerCase()) {
    case ".m4a":
    case ".mp4":
      return "audio/mp4";
    case ".mp3":
      return "audio/mpeg";
    case ".ogg":
    case ".opus":
      return "audio/ogg";
    case ".wav":
      return "audio/wav";
    case ".webm":
      return "audio/webm";
    default:
      return "application/octet-stream";
  }
}

function isAllowed(raw) {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && (u.hostname === "googlevideo.com" || u.hostname.endsWith(".googlevideo.com"));
  } catch (error) {
    return false;
  }
}

const lib = {
  ID,
  UA,
  qualityOf,
  run,
  innertube,
  getAudioUrl,
  getAudioFile,
  isAllowed
};

module.exports = lib;
