/* ==========================================================================
   _lossless.js — pencari audio lossless (FLAC) untuk streaming.

   Sumber katalog: Tracks (https://tracks.monochrome.st), API publik yang
   dipakai Monochrome Music. Endpoint /track/<id> mengalirkan berkas FLAC dan
   mendukung HTTP Range, jadi audio bisa langsung diputar browser tanpa
   proxy. Modul ini hanya mencari versi yang cocok dan membaca header FLAC
   untuk mengisi chip format + Stats for nerds.

   Bisa diarahkan ke instance lain lewat env LOSSLESS_API.
   ========================================================================== */

const DEFAULT_BASE = "https://tracks.monochrome.st";
const BASE = String(process.env.LOSSLESS_API || DEFAULT_BASE).replace(/\/+$/, "");
const SEARCH_TIMEOUT = 8000;
const PROBE_TIMEOUT = 8000;
const CACHE_TTL = 24 * 60 * 60 * 1000;
const NEGATIVE_TTL = 10 * 60 * 1000;
const MAX_CACHE = 300;

const cache = new Map();

const VERSION_WORDS = new Set([
  "live",
  "acoustic",
  "unplugged",
  "remix",
  "instrumental",
  "karaoke",
  "cover",
  "demo",
  "session",
  "rehearsal",
  "sped",
  "slowed",
  "nightcore",
  "orchestral",
  "piano",
  "8d",
  "extended"
]);

function slug(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\((?:[^)]*)\)|\[[^\]]*\]/g, " ")
    .replace(/\b(feat|featuring|ft)\.?\s+.*$/i, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function words(value) {
  return slug(value).split(" ").filter(Boolean);
}

function extraVersion(candidateTitle, targetTitle) {
  const targetWords = new Set(words(targetTitle));
  return words(candidateTitle).filter(
    (word) => VERSION_WORDS.has(word) && !targetWords.has(word)
  ).length;
}

function isrcOf(value) {
  return String(value || "")
    .replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase();
}

function artistNames(candidate) {
  if (Array.isArray(candidate.artistNames) && candidate.artistNames.length) {
    return candidate.artistNames;
  }
  if (Array.isArray(candidate.artists) && candidate.artists.length) {
    return candidate.artists.map((artist) => artist.name || artist.displayName || "");
  }
  return [candidate.artist?.name || candidate.artist || ""].filter(Boolean);
}

function artistMatches(candidate, targetArtist) {
  const target = slug(targetArtist);
  if (!target) return false;
  return artistNames(candidate).some((name) => {
    const clean = slug(name);
    return (
      clean === target ||
      clean.startsWith(target + " ") ||
      target.startsWith(clean + " ")
    );
  });
}

// Durasi dari klien sudah dalam detik; katalog Tracks memakai milidetik.
function targetSeconds(value) {
  return Math.max(0, Math.round(Number(value) || 0));
}

function candidateSeconds(value) {
  const number = Number(value) || 0;
  return number > 0 ? Math.round(number / 1000) : 0;
}

function scoreCandidate(candidate, target) {
  if (!candidate) return -Infinity;

  const targetIsrc = isrcOf(target.isrc);
  const candidateIsrc = isrcOf(candidate.isrc);
  if (targetIsrc && candidateIsrc && targetIsrc === candidateIsrc) return 400;

  const targetTitle = slug(target.title);
  const candidateTitle = slug(candidate.title);
  if (!targetTitle || !candidateTitle) return -Infinity;

  let score = 0;
  if (targetTitle === candidateTitle) score += 100;
  else if (
    candidateTitle.startsWith(targetTitle + " ") ||
    targetTitle.startsWith(candidateTitle + " ")
  ) {
    score += 60;
  } else {
    return -Infinity;
  }

  if (artistMatches(candidate, target.artist)) score += 50;

  const targetDuration = targetSeconds(target.duration);
  const candidateDuration = candidateSeconds(candidate.duration);
  if (targetDuration > 0 && candidateDuration > 0) {
    const diff = Math.abs(targetDuration - candidateDuration);
    if (diff <= 2) score += 30;
    else if (diff <= 5) score += 20;
    else if (diff <= 10) score += 5;
    else score -= 30;
  }

  // Jangan pilih versi live/acoustic/remix/karaoke bila lagunya bukan versi itu.
  score -= extraVersion(candidate.title, target.title) * 200;

  // Judul sama tapi artis tidak cocok = kemungkinan cover/versi lain.
  if (slug(target.artist) && !artistMatches(candidate, target.artist)) score -= 50;

  return score;
}

async function fetchWithTimeout(url, options = {}, timeout = SEARCH_TIMEOUT) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, Object.assign({}, options, { signal: controller.signal }));
  } finally {
    clearTimeout(timer);
  }
}

async function search(query) {
  const url = BASE + "/search/tracks?q=" + encodeURIComponent(query) + "&limit=8";
  const response = await fetchWithTimeout(url);
  if (!response.ok) throw new Error("Pencarian lossless gagal: HTTP " + response.status);
  const data = await response.json();
  const tracks = Array.isArray(data && data.tracks) ? data.tracks : [];
  return tracks.filter((track) => track && (track.trackId || track.id) && track.playable !== false);
}

function parseFlacHeader(bytes) {
  if (!bytes || bytes.length < 42) return null;
  if (bytes.toString("latin1", 0, 4) !== "fLaC") return null;

  const type = bytes[4] & 0x7f;
  const length = (bytes[5] << 16) | (bytes[6] << 8) | bytes[7];
  if (type !== 0 || length < 34) return null;

  const p = 8 + 10;
  const sampleRate = (bytes[p] << 12) | (bytes[p + 1] << 4) | (bytes[p + 2] >> 4);
  const channels = ((bytes[p + 2] >> 1) & 0x07) + 1;
  const bitDepth = (((bytes[p + 2] & 0x01) << 4) | (bytes[p + 3] >> 4)) + 1;
  const totalSamples =
    (bytes[p + 3] & 0x0f) * 4294967296 +
    bytes[p + 4] * 16777216 +
    bytes[p + 5] * 65536 +
    bytes[p + 6] * 256 +
    bytes[p + 7];

  if (!sampleRate || !channels || bitDepth < 4) return null;

  return {
    sampleRate,
    channels,
    bitDepth,
    duration: totalSamples > 0 ? totalSamples / sampleRate : 0
  };
}

async function probe(id, durationHint) {
  const url = BASE + "/track/" + encodeURIComponent(id);
  let size = 0;
  let header = null;

  // Satu permintaan Range cukup: header FLAC ada di awal berkas dan
  // Content-Range sudah memberi ukuran total untuk menghitung bitrate.
  try {
    const response = await fetchWithTimeout(
      url,
      { headers: { Range: "bytes=0-65535" } },
      PROBE_TIMEOUT
    );
    if (!response.ok && response.status !== 206) return null;

    const length = Number(response.headers.get("content-length")) || 0;
    if (response.status === 200 && length > 2 * 1024 * 1024) {
      // Katalog mengabaikan Range. Jangan unduh seluruh berkas hanya untuk
      // membaca header.
      try {
        await response.body?.cancel();
      } catch (error) {
        /* Abaikan. */
      }
      return null;
    }

    const range = String(response.headers.get("content-range") || "");
    const total = Number(range.split("/")[1]) || 0;
    if (total > 0) size = total;
    else if (response.status === 200) size = length;

    header = parseFlacHeader(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    return null;
  }

  if (!header) return null;

  // Sebagian cermin tidak mengirim Content-Range; ambil ukuran lewat HEAD.
  if (!size) {
    try {
      const head = await fetchWithTimeout(url, { method: "HEAD" }, PROBE_TIMEOUT);
      if (head.ok) size = Number(head.headers.get("content-length")) || 0;
    } catch (error) {
      /* Bitrate opsional. */
    }
  }

  const duration = header.duration || candidateSeconds(durationHint);
  const bitrate = size > 0 && duration > 0 ? Math.round((size * 8) / duration) : 0;

  return {
    codec: "FLAC",
    container: "FLAC",
    mimeType: "audio/flac",
    itag: 0,
    bitrate,
    sampleRate: header.sampleRate,
    channels: header.channels,
    bitDepth: header.bitDepth,
    lossless: true,
    requested: "flac",
    fallback: false,
    losslessSource: "Tracks"
  };
}

function cacheKey(query) {
  return [
    slug(query.title),
    slug(query.artist),
    targetSeconds(query.duration),
    isrcOf(query.isrc)
  ].join("|");
}

function putCache(key, value, ttl) {
  if (cache.size >= MAX_CACHE) {
    const first = cache.keys().next();
    if (!first.done) cache.delete(first.value);
  }
  cache.set(key, { value, expires: Date.now() + ttl });
}

async function resolve(query) {
  const title = String((query && query.title) || "").trim().slice(0, 120);
  if (!title) return null;
  const target = {
    title,
    artist: String((query && query.artist) || "").trim().slice(0, 120),
    duration: targetSeconds(query && query.duration),
    isrc: isrcOf(query && query.isrc)
  };

  const key = cacheKey(target);
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;

  const searchQuery = [target.artist, target.title].filter(Boolean).join(" ").slice(0, 140);
  let candidates = [];
  try {
    candidates = await search(searchQuery);
  } catch (error) {
    putCache(key, null, NEGATIVE_TTL);
    throw error;
  }

  let best = null;
  let bestScore = -Infinity;
  for (const candidate of candidates) {
    const score = scoreCandidate(candidate, target);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  const threshold = target.artist ? 95 : 125;
  if (!best || bestScore < threshold) {
    putCache(key, null, NEGATIVE_TTL);
    return null;
  }

  const id = String(best.trackId || best.id);
  const format = await probe(id, best.duration);
  if (!format) {
    putCache(key, null, NEGATIVE_TTL);
    return null;
  }

  const result = {
    id,
    url: BASE + "/track/" + encodeURIComponent(id),
    requested: "flac",
    match: {
      title: best.title || "",
      artist: artistNames(best)[0] || "",
      duration: candidateSeconds(best.duration),
      isrc: best.isrc || ""
    },
    format
  };
  putCache(key, result, CACHE_TTL);
  return result;
}

module.exports = {
  BASE,
  resolve,
  parseFlacHeader,
  scoreCandidate,
  slug
};
