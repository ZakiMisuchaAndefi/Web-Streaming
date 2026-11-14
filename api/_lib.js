// Helper bersama untuk fungsi /api (file berawalan _ tidak dijadikan endpoint).
//
// Audio YouTube diselesaikan lewat klien "visionOS" milik InnerTube. Klien ini
// masih mengembalikan URL googlevideo yang bisa diambil penuh (byte-range di
// atas 1 MB tidak ditolak 403), sehingga lagu bisa diputar sampai habis tanpa
// perlu yt-dlp, Python, atau API key resmi.
//
// Catatan penting: klien ANDROID/IOS/WEB memberi URL yang hanya bisa diambil
// ~1 MB pertama (sisanya 403). Itu penyebab lagu berhenti lalu pindah lagu.
const https = require("https");

const ID = /^[A-Za-z0-9_-]{11}$/;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const MAX_AUDIO_CACHE = 200;
const audioCache = new Map();

// User-Agent & konteks klien visionOS (dipakai YouTube untuk app visionOS).
const VISIONOS_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15";
const VISIONOS_CLIENT = {
  clientName: "VISIONOS",
  clientVersion: "1.02",
  deviceMake: "Apple",
  deviceModel: "RealityDevice17,1",
  userAgent: VISIONOS_UA,
  osName: "visionOS",
  osVersion: "26.5.23O471",
  hl: "en",
  timeZone: "UTC",
  utcOffsetMinutes: 0
};
const INNERTUBE_KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";
const SIGNATURE_TIMESTAMP = 20754;
const BOOTSTRAP_TTL_MS = 30 * 60 * 1000;

let bootstrapCache = null;
let bootstrapTask = null;

// Mode "flac" meminta audio lossless. YouTube tidak menyediakannya, jadi mode
// ini jatuh ke format terbaik yang tersedia dan ditandai `fallback: true`.
const qualityOf = (q) =>
  q === "low" || q === "medium" || q === "high" || q === "best" || q === "flac" ? q : "best";

// Batas bitrate per mode (bps). Standar sengaja di bawah 160k agar Opus 160
// terpilih, bukan AAC 128; Tinggi/Terbaik membiarkan sumber memilih yang terbaik.
const BITRATE_LIMIT = { low: 96000, medium: 170000, high: Infinity, best: Infinity, flac: Infinity };

function trimAudioCache() {
  while (audioCache.size > MAX_AUDIO_CACHE) {
    const first = audioCache.keys().next();
    if (first.done) break;
    audioCache.delete(first.value);
  }
}

function expiresFromUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const value = Number(url.searchParams.get("expire") || "0");
    if (Number.isFinite(value) && value > 0) return value;
  } catch (error) {
    // Abaikan URL yang tidak valid; fallback di bawah.
  }
  return Math.floor(Date.now() / 1000) + 3600;
}

/* --------------------------------------------------------------------------
   Sesi pengunjung (visitorData + cookie) — tanpa ini YouTube menjawab
   "Sign in to confirm you're not a bot".
   -------------------------------------------------------------------------- */

function httpGet(url, headers) {
  return new Promise((resolve, reject) => {
    const request = https.request(
      url,
      {
        method: "GET",
        headers,
        // Halaman YouTube mengirim banyak cookie; batas bawaan Node terlalu kecil.
        maxHeaderSize: 8 * 1024 * 1024
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () =>
          resolve({
            status: response.statusCode || 0,
            headers: response.headers,
            body: Buffer.concat(chunks).toString("utf8")
          })
        );
        response.on("error", reject);
      }
    );
    request.setTimeout(15000, () => request.destroy(new Error("Permintaan ke YouTube timeout")));
    request.on("error", reject);
    request.end();
  });
}

async function loadBootstrap() {
  const baseHeaders = {
    "User-Agent": VISIONOS_UA,
    "Accept-Language": "en-us,en;q=0.5",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
  };
  const cookies = [];
  let url = "https://www.youtube.com/";
  let response = null;

  // YouTube kadang membalas 302 (mis. ke halaman consent / domain lain).
  // Ikuti redirect sambil mengumpulkan cookie-nya.
  for (let hop = 0; hop < 4; hop += 1) {
    const headers = Object.assign({}, baseHeaders);
    if (cookies.length) headers.Cookie = cookies.join("; ");
    response = await httpGet(url, headers);

    for (const value of response.headers["set-cookie"] || []) {
      const pair = String(value).split(";")[0];
      if (!pair) continue;
      const name = pair.split("=")[0];
      if (!cookies.some((cookie) => cookie.split("=")[0] === name)) cookies.push(pair);
    }

    const location = response.headers.location;
    if (response.status >= 300 && response.status < 400 && location) {
      url = new URL(location, url).toString();
      continue;
    }
    break;
  }

  if (!response || response.status !== 200) {
    throw new Error("YouTube menolak permintaan sesi (HTTP " + (response ? response.status : 0) + ")");
  }

  const match = /"visitorData":"(.*?)"/.exec(response.body);
  let visitorData = null;
  if (match) {
    try {
      visitorData = JSON.parse('"' + match[1] + '"');
    } catch (error) {
      visitorData = match[1];
    }
  }
  if (!visitorData) throw new Error("visitorData tidak ditemukan pada halaman YouTube");

  return { visitorData, cookies, at: Date.now() };
}

async function bootstrap(force) {
  if (!force && bootstrapCache && Date.now() - bootstrapCache.at < BOOTSTRAP_TTL_MS) {
    return bootstrapCache;
  }
  if (bootstrapTask) return bootstrapTask;
  bootstrapTask = loadBootstrap()
    .then((value) => {
      bootstrapCache = value;
      return value;
    })
    .finally(() => {
      bootstrapTask = null;
    });
  return bootstrapTask;
}

/* --------------------------------------------------------------------------
   InnerTube umum (dipakai pencarian lanjutan / radio)
   -------------------------------------------------------------------------- */

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
  const cfg = client || { clientName: "WEB", clientVersion: "2.20250626.01.00", clientId: 1, platform: "DESKTOP", hl: "en", gl: "US" };
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

/* --------------------------------------------------------------------------
   Resolusi audio (visionOS)
   -------------------------------------------------------------------------- */

async function visionosPlayer(videoId, boot) {
  const body = {
    context: {
      client: Object.assign({}, VISIONOS_CLIENT, { visitorData: boot.visitorData })
    },
    videoId,
    playbackContext: {
      contentPlaybackContext: {
        html5Preference: "HTML5_PREF_WANTS",
        signatureTimestamp: SIGNATURE_TIMESTAMP
      }
    },
    contentCheckOk: true,
    racyCheckOk: true
  };

  const headers = {
    "Content-Type": "application/json",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-us,en;q=0.5",
    "User-Agent": VISIONOS_UA,
    "X-Youtube-Client-Name": "101",
    "X-Youtube-Client-Version": VISIONOS_CLIENT.clientVersion,
    "X-Goog-Visitor-Id": boot.visitorData,
    Origin: "https://www.youtube.com"
  };
  if (boot.cookies.length) headers.Cookie = boot.cookies.join("; ");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(
      "https://www.youtube.com/youtubei/v1/player?prettyPrint=false&key=" + INNERTUBE_KEY,
      { method: "POST", headers, body: JSON.stringify(body), signal: controller.signal }
    );
    const text = await response.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch (error) {
      data = null;
    }
    return { status: response.status, data, text };
  } finally {
    clearTimeout(timer);
  }
}

// Nama codec dari mimeType InnerTube, untuk ditampilkan di pemutar.
function codecOf(format) {
  const mime = String((format && format.mimeType) || "").toLowerCase();
  if (mime.includes("audio/flac")) return "FLAC";
  if (mime.includes("audio/opus") || /codecs="?opus/.test(mime)) return "OPUS";
  if (mime.includes("audio/aac") || /mp4a/.test(mime)) return "AAC";
  if (mime.includes("audio/mp4")) return "AAC";
  if (mime.includes("audio/webm")) return "OPUS"; // WebM audio YouTube selalu Opus
  if (mime.includes("audio/mpeg")) return "MP3";
  if (mime.includes("audio/ogg")) return "VORBIS";
  return "AUDIO";
}

// Ringkasan format yang benar-benar dipakai, dikirim ke pemutar.
function formatInfo(format, mode) {
  const codec = codecOf(format);
  const lossless = codec === "FLAC";
  return {
    codec,
    itag: Number(format && format.itag) || 0,
    bitrate: Number(format && format.bitrate) || 0,
    sampleRate: Number(format && format.audioSampleRate) || 0,
    channels: Number(format && format.audioChannels) || 0,
    lossless,
    requested: mode,
    fallback: mode === "flac" && !lossless
  };
}

function pickAudioFormat(formats, mode) {
  const limit = BITRATE_LIMIT[mode] || Infinity;
  const candidates = (Array.isArray(formats) ? formats : []).filter((format) => {
    if (!format || typeof format.mimeType !== "string") return false;
    if (!format.mimeType.startsWith("audio/")) return false;
    if (typeof format.url !== "string" || !format.url) return false;
    return isAllowed(format.url);
  });
  if (!candidates.length) return null;

  const sorted = candidates.slice().sort((left, right) => {
    // Utamakan WebM/Opus: didukung Chrome, Edge, Firefox, dan Safari modern.
    const leftWebm = /audio\/webm/i.test(String(left.mimeType));
    const rightWebm = /audio\/webm/i.test(String(right.mimeType));
    if (leftWebm !== rightWebm) return leftWebm ? -1 : 1;
    return (Number(right.bitrate) || 0) - (Number(left.bitrate) || 0);
  });

  if (mode === "flac") {
    // Sumber lokal/berkas bisa saja FLAC, tetapi YouTube hanya AAC/Opus.
    const lossless = sorted.filter((format) => /audio\/flac/i.test(String(format.mimeType)));
    return lossless.length ? lossless[0] : sorted[0];
  }

  const allowed = sorted.filter((format) => (Number(format.bitrate) || 0) <= limit);
  return allowed.length ? allowed[0] : sorted[0];
}

// Pastikan URL benar-benar bisa diambil sebelum dikirim ke browser.
async function probe(url, userAgent) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url, {
      headers: { Range: "bytes=0-1", "User-Agent": userAgent },
      signal: controller.signal
    });
    await response.body?.cancel();
    return response.status === 200 || response.status === 206;
  } catch (error) {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function resolveWithVisionOs(videoId, mode) {
  const failures = [];

  for (let attempt = 0; attempt < 2; attempt += 1) {
    let boot = null;
    try {
      boot = await bootstrap(attempt > 0);
    } catch (error) {
      failures.push("sesi: " + (error && error.message ? error.message : error));
      continue;
    }

    let result = null;
    try {
      result = await visionosPlayer(videoId, boot);
    } catch (error) {
      failures.push("player: " + (error && error.message ? error.message : error));
      continue;
    }

    const data = result.data;
    if (!data) {
      failures.push("player: respons tidak valid (HTTP " + result.status + ")");
      continue;
    }

    const play = data.playabilityStatus || {};
    if (play.status && play.status !== "OK") {
      failures.push(play.status + ": " + String(play.reason || "").slice(0, 120));
      // Sesi kedaluwarsa/dianggap bot: ambil sesi baru lalu coba sekali lagi.
      if (play.status === "LOGIN_REQUIRED" || play.status === "ERROR") continue;
      break;
    }

    const chosen = pickAudioFormat(data.streamingData && data.streamingData.adaptiveFormats, mode);
    if (!chosen) {
      failures.push("tidak ada format audio langsung");
      break;
    }

    if (!(await probe(chosen.url, VISIONOS_UA))) {
      failures.push("URL audio ditolak Google Video");
      continue;
    }

    return {
      url: chosen.url,
      headers: { "User-Agent": VISIONOS_UA },
      expires: expiresFromUrl(chosen.url),
      format: formatInfo(chosen, mode)
    };
  }

  throw new Error("visionOS gagal: " + failures.join(" | "));
}

async function getAudioUrl(id, quality, force) {
  if (!ID.test(String(id || ""))) {
    throw new Error("ID video tidak valid");
  }

  const mode = qualityOf(quality);
  const key = id + "|" + mode;
  const now = Math.floor(Date.now() / 1000);
  if (force) audioCache.delete(key);
  const cached = audioCache.get(key);
  // Entri lama (sebelum metadata format ada) diabaikan agar format ikut terisi.
  if (cached && cached.format && Number(cached.expires) > now + 300) return cached;

  const entry = await resolveWithVisionOs(id, mode);
  audioCache.set(key, entry);
  trimAudioCache();
  return entry;
}

function isAllowed(raw) {
  try {
    const u = new URL(raw);
    return (
      u.protocol === "https:" &&
      (u.hostname === "googlevideo.com" || u.hostname.endsWith(".googlevideo.com"))
    );
  } catch (error) {
    return false;
  }
}

const lib = {
  ID,
  UA,
  VISIONOS_UA,
  qualityOf,
  innertube,
  getAudioUrl,
  isAllowed,
  codecOf,
  formatInfo
};

module.exports = lib;
