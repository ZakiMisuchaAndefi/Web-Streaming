// Helper bersama untuk fungsi /api (file berawalan _ tidak dijadikan endpoint).
const ID = /^[A-Za-z0-9_-]{11}$/;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const MAX_AUDIO_CACHE = 200;
const audioCache = new Map();

// Klien yang saat ini masih memberi URL audio langsung (tanpa PO token).
// Catatan: context.client.platform harus nama hardware yang valid
// ("MOBILE"/"DESKTOP"), bukan nama klien seperti "IOS" — nilai itu ditolak
// API dengan HTTP 400 sehingga resolusi audio selalu gagal.
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

const qualityOf = (q) => (q === "low" || q === "medium" || q === "high" || q === "best" ? q : "best");

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
  if (!ID.test(String(id || ""))) {
    throw new Error("ID video tidak valid");
  }

  const mode = qualityOf(quality);
  const key = id + "|" + mode;
  const now = Math.floor(Date.now() / 1000);
  if (force) audioCache.delete(key);
  const cached = audioCache.get(key);
  if (cached && Number(cached.expires) > now + 300) return cached;

  const limits = { low: 96000, medium: 128000, high: 192000, best: Infinity };
  const limit = limits[mode] || Infinity;
  const failures = [];

  for (const client of INNER_TUBE_CLIENTS) {
    try {
      const data = await innertube(
        "player",
        {
          videoId: id,
          contentCheckOk: true,
          racyCheckOk: true
        },
        client
      );

      const play = (data && data.playabilityStatus) || {};
      if (play.status && play.status !== "OK") {
        failures.push(client.clientName + ": " + play.status + " " + (play.reason || ""));
        continue;
      }

      const formats = Array.isArray(data && data.streamingData && data.streamingData.adaptiveFormats)
        ? data.streamingData.adaptiveFormats
        : [];
      const candidates = formats.filter((format) => {
        if (!format || typeof format.mimeType !== "string") return false;
        if (!format.mimeType.startsWith("audio/")) return false;
        if (typeof format.url !== "string" || !format.url) return false;
        try {
          const url = new URL(format.url);
          return url.protocol === "https:";
        } catch (error) {
          return false;
        }
      });

      if (!candidates.length) continue;

      const sorted = candidates.slice().sort((left, right) => {
        // Utamakan WebM/Opus: didukung Chrome, Edge, Firefox, dan Safari
        // modern, termasuk Chromium tanpa codec AAC. MP4/AAC tetap dipakai
        // bila tidak ada pilihan WebM.
        const leftWebm = /audio\/webm/i.test(String(left.mimeType));
        const rightWebm = /audio\/webm/i.test(String(right.mimeType));
        if (leftWebm !== rightWebm) return leftWebm ? -1 : 1;
        return (Number(right.bitrate) || 0) - (Number(left.bitrate) || 0);
      });
      const allowed = sorted.filter((format) => (Number(format.bitrate) || 0) <= limit);
      const chosen = allowed.length ? allowed[0] : sorted[0];
      if (!chosen || typeof chosen.url !== "string") continue;

      const entry = {
        url: chosen.url,
        expires: expiresFromUrl(chosen.url)
      };
      audioCache.set(key, entry);
      trimAudioCache();
      return entry;
    } catch (error) {
      // Coba client berikutnya bila satu klien gagal.
      failures.push(client.clientName + ": " + (error && error.message ? error.message : error));
    }
  }

  throw new Error(
    "Audio YouTube tidak tersedia saat ini." +
      (failures.length ? " (" + failures.join(" | ") + ")" : "")
  );
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
  innertube,
  getAudioUrl,
  isAllowed
};

module.exports = lib;
