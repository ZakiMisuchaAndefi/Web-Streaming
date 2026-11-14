// Klien InnerTube (API internal YouTube) untuk pencarian.
// Referensi: https://github.com/tombulled/innertube
// Tidak butuh API key resmi; memakai API key publik milik klien web YouTube.
const BASE = "https://youtubei.googleapis.com/youtubei/v1/";
const TIMEOUT = 12000;
const VIDEO_PARAMS = "EgIQAQ%3D%3D";
// Filter "Songs" untuk YouTube Music (sama seperti music_songs di Piped).
const MUSIC_SONGS_PARAMS = "EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D";

const CLIENTS = {
  web: {
    apiKey: "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8",
    clientName: "WEB",
    clientVersion: "2.20250626.01.00",
    clientId: "1",
    referer: "https://www.youtube.com/",
    origin: ""
  },
  music: {
    apiKey: "AIzaSyC9XL3ZjWddXya6X74dJoCTL-WEYFDNX30",
    clientName: "WEB_REMIX",
    clientVersion: "1.20230724.00.00",
    clientId: "67",
    referer: "https://music.youtube.com/",
    origin: "https://music.youtube.com"
  }
};

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const visitors = new Map();

function timedSignal(ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, done: () => clearTimeout(timer) };
}

async function post(endpoint, body, clientKey) {
  const client = CLIENTS[clientKey || "web"] || CLIENTS.web;
  const timer = timedSignal(TIMEOUT);
  try {
    const headers = {
      "Content-Type": "application/json",
      "X-Goog-Api-Format-Version": "1",
      "X-YouTube-Client-Name": client.clientId,
      "X-YouTube-Client-Version": client.clientVersion,
      "User-Agent": USER_AGENT,
      Referer: client.referer,
      "Accept-Language": "en-US,en;q=0.9"
    };
    if (client.origin) headers.Origin = client.origin;
    const visitor = visitors.get(client.clientName);
    if (visitor) headers["X-Goog-Visitor-Id"] = visitor;

    const response = await fetch(
      BASE + endpoint + "?key=" + client.apiKey + "&alt=json&prettyPrint=false",
      {
        method: "POST",
        headers,
        signal: timer.signal,
        body: JSON.stringify(
          Object.assign(
            {
              context: {
                client: {
                  clientName: client.clientName,
                  clientVersion: client.clientVersion,
                  gl: "US",
                  hl: "en"
                }
              }
            },
            body
          )
        )
      }
    );

    const text = await response.text();
    if (!response.ok) {
      throw new Error("InnerTube " + endpoint + " HTTP " + response.status);
    }
    const data = JSON.parse(text);
    const nextVisitor =
      data && data.responseContext && data.responseContext.visitorData;
    if (nextVisitor) visitors.set(client.clientName, String(nextVisitor));
    if (data && data.error) {
      throw new Error(
        "InnerTube " + endpoint + ": " + (data.error.message || "error")
      );
    }
    return data;
  } finally {
    timer.done();
  }
}

/* --------------------------------------------------------------------------
   Parser hasil video biasa
   -------------------------------------------------------------------------- */

function collectRenderers(node, out, depth) {
  if (!node || typeof node !== "object" || depth > 40) return out;
  if (Array.isArray(node)) {
    for (const item of node) collectRenderers(item, out, depth + 1);
    return out;
  }
  if (node.videoRenderer && typeof node.videoRenderer === "object") {
    out.push(node.videoRenderer);
  }
  if (node.compactVideoRenderer && typeof node.compactVideoRenderer === "object") {
    out.push(node.compactVideoRenderer);
  }
  if (
    node.playlistVideoRenderer &&
    typeof node.playlistVideoRenderer === "object"
  ) {
    out.push(node.playlistVideoRenderer);
  }
  if (node.gridVideoRenderer && typeof node.gridVideoRenderer === "object") {
    out.push(node.gridVideoRenderer);
  }
  for (const key of Object.keys(node)) {
    if (
      key === "videoRenderer" ||
      key === "compactVideoRenderer" ||
      key === "playlistVideoRenderer" ||
      key === "gridVideoRenderer"
    ) {
      continue;
    }
    const value = node[key];
    if (value && typeof value === "object") {
      collectRenderers(value, out, depth + 1);
    }
  }
  return out;
}

/* --------------------------------------------------------------------------
   Parser hasil YouTube Music (musicResponsiveListItemRenderer)
   -------------------------------------------------------------------------- */

function collectMusicRenderers(node, out, depth) {
  if (!node || typeof node !== "object" || depth > 40) return out;
  if (Array.isArray(node)) {
    for (const item of node) collectMusicRenderers(item, out, depth + 1);
    return out;
  }
  if (
    node.musicResponsiveListItemRenderer &&
    typeof node.musicResponsiveListItemRenderer === "object"
  ) {
    out.push(node.musicResponsiveListItemRenderer);
  }
  for (const key of Object.keys(node)) {
    if (key === "musicResponsiveListItemRenderer") continue;
    const value = node[key];
    if (value && typeof value === "object") {
      collectMusicRenderers(value, out, depth + 1);
    }
  }
  return out;
}

function textOf(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value.simpleText === "string") return value.simpleText;
  if (Array.isArray(value.runs)) {
    return value.runs.map((run) => String((run && run.text) || "")).join("");
  }
  return "";
}

function parseDuration(text) {
  if (!text) return 0;
  const parts = String(text).trim().split(":");
  let total = 0;
  for (const part of parts) {
    const value = parseInt(part, 10);
    if (!Number.isFinite(value)) return 0;
    total = total * 60 + value;
  }
  return total;
}

function durationOf(renderer) {
  const seconds = Number(renderer && renderer.lengthSeconds);
  if (Number.isFinite(seconds) && seconds > 0) return Math.round(seconds);
  return parseDuration(textOf(renderer && renderer.lengthText));
}

function toItem(renderer) {
  if (!renderer) return null;
  const id = String(renderer.videoId || "").trim();
  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return null;
  const title = textOf(renderer.title).trim();
  if (!title) return null;
  const owner =
    textOf(renderer.ownerText).trim() ||
    textOf(renderer.longBylineText).trim() ||
    textOf(renderer.shortBylineText).trim();
  return {
    id,
    url: "https://www.youtube.com/watch?v=" + id,
    title,
    uploaderName: owner,
    duration: durationOf(renderer)
  };
}

function itemsFrom(data, limit) {
  const renderers = collectRenderers(data, [], 0);
  const seen = new Set();
  const list = [];
  for (const renderer of renderers) {
    const item = toItem(renderer);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    list.push(item);
    if (list.length >= limit) break;
  }
  return list;
}

// Token halaman berikutnya disimpan di struktur yang berbeda-beda
// (continuationCommand untuk pencarian video, nextContinuationData untuk
// YouTube Music). Ambil token pertama yang ditemukan.
function findContinuation(node, depth) {
  if (!node || typeof node !== "object" || depth > 40) return "";
  if (Array.isArray(node)) {
    for (const item of node) {
      const token = findContinuation(item, depth + 1);
      if (token) return token;
    }
    return "";
  }
  const command = node.continuationCommand && node.continuationCommand.token;
  if (command) return String(command);
  const next = node.nextContinuationData && node.nextContinuationData.continuation;
  if (next) return String(next);
  const reload =
    node.reloadContinuationData && node.reloadContinuationData.continuation;
  if (reload) return String(reload);

  for (const key of Object.keys(node)) {
    if (
      key === "continuationCommand" ||
      key === "nextContinuationData" ||
      key === "reloadContinuationData"
    ) {
      continue;
    }
    const token = findContinuation(node[key], depth + 1);
    if (token) return token;
  }
  return "";
}

function findMusicVideoId(renderer) {
  const overlay =
    renderer &&
    renderer.overlay &&
    renderer.overlay.musicItemThumbnailOverlayRenderer &&
    renderer.overlay.musicItemThumbnailOverlayRenderer.content &&
    renderer.overlay.musicItemThumbnailOverlayRenderer.content
      .musicPlayButtonRenderer &&
    renderer.overlay.musicItemThumbnailOverlayRenderer.content
      .musicPlayButtonRenderer.playNavigationEndpoint &&
    renderer.overlay.musicItemThumbnailOverlayRenderer.content
      .musicPlayButtonRenderer.playNavigationEndpoint.watchEndpoint;
  const fromOverlay = overlay && overlay.videoId;
  if (fromOverlay) return String(fromOverlay);

  const fromPlaylist =
    renderer && renderer.playlistItemData && renderer.playlistItemData.videoId;
  if (fromPlaylist) return String(fromPlaylist);

  const columns = Array.isArray(renderer && renderer.flexColumns)
    ? renderer.flexColumns
    : [];
  for (const column of columns) {
    const flex =
      column && column.musicResponsiveListItemFlexColumnRenderer;
    const runs = flex && flex.text && flex.text.runs;
    if (!Array.isArray(runs)) continue;
    for (const run of runs) {
      const watch =
        run &&
        run.navigationEndpoint &&
        run.navigationEndpoint.watchEndpoint;
      if (watch && watch.videoId) return String(watch.videoId);
    }
  }
  return "";
}

function musicColumnText(renderer, index) {
  const column =
    Array.isArray(renderer && renderer.flexColumns)
      ? renderer.flexColumns[index]
      : null;
  const flex = column && column.musicResponsiveListItemFlexColumnRenderer;
  return flex && flex.text ? flex.text : null;
}

function toMusicItem(renderer) {
  if (!renderer) return null;
  const id = findMusicVideoId(renderer);
  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return null;

  const title = textOf(musicColumnText(renderer, 0)).trim();
  if (!title) return null;

  const byline = musicColumnText(renderer, 1);
  const runs = byline && Array.isArray(byline.runs) ? byline.runs : [];
  let artist = "";
  let duration = 0;
  if (runs.length) {
    artist = String((runs[0] && runs[0].text) || "").trim();
    for (let i = runs.length - 1; i >= 0; i -= 1) {
      const text = String((runs[i] && runs[i].text) || "").trim();
      if (/^\d{1,2}:\d{2}(?::\d{2})?$/.test(text)) {
        duration = parseDuration(text);
        break;
      }
    }
  }
  if (!artist) {
    artist =
      textOf(renderer.longBylineText).trim() ||
      textOf(renderer.shortBylineText).trim();
  }

  return {
    id,
    url: "https://www.youtube.com/watch?v=" + id,
    title,
    uploaderName: artist,
    duration
  };
}

function musicItemsFrom(data, limit) {
  const renderers = collectMusicRenderers(data, [], 0);
  const seen = new Set();
  const list = [];
  for (const renderer of renderers) {
    const item = toMusicItem(renderer);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    list.push(item);
    if (list.length >= limit) break;
  }
  return list;
}

/* --------------------------------------------------------------------------
   Pencarian
   -------------------------------------------------------------------------- */

async function searchVideoResult(query, params, limit, continuation) {
  const body = continuation ? { continuation } : { query };
  if (!continuation && params) body.params = params;
  const data = await post("search", body, "web");
  return {
    items: itemsFrom(data, limit),
    continuation: findContinuation(data, 0)
  };
}

async function searchVideoOnce(query, params, limit) {
  const result = await searchVideoResult(query, params, limit);
  return result.items;
}

async function searchMusicResult(query, limit, continuation) {
  const body = continuation ? { continuation } : { query, params: MUSIC_SONGS_PARAMS };
  const data = await post("search", body, "music");
  return {
    items: musicItemsFrom(data, limit),
    continuation: findContinuation(data, 0)
  };
}

async function searchMusicOnce(query, limit) {
  const result = await searchMusicResult(query, limit);
  return result.items;
}

// Jaringan ke YouTube sesekali gagal sesaat (fetch failed). Coba lagi sebelum
// menyerah, karena bila pencarian musik gagal hasil video biasa yang dipakai
// dan metadata lagunya jadi tidak rapi.
async function searchMusicWithRetry(query, limit, attempts) {
  const total = Math.max(1, Number(attempts) || 2);
  let lastError = null;
  for (let i = 0; i < total; i += 1) {
    try {
      const result = await searchMusicResult(query, limit);
      if (result.items.length) return result;
    } catch (error) {
      lastError = error;
    }
    if (i < total - 1) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  if (lastError) throw lastError;
  return { items: [], continuation: "" };
}

// Halaman berikutnya. Token terikat ke klien pembuatnya, jadi "page"
// menentukan klien yang dipakai (music untuk hasil lagu, video untuk
// pencarian video biasa).
async function searchMore(token, options) {
  const opts = options || {};
  const cursor = String(token || "").trim();
  if (!cursor) return { items: [], continuation: "" };
  const limit = Math.min(Math.max(Number(opts.limit) || 40, 1), 50);
  const page = opts.page === "video" ? "video" : "music";

  if (page === "video") {
    const result = await searchVideoResult("", "", limit, cursor);
    return { items: result.items, continuation: result.continuation, page: "video" };
  }

  try {
    const result = await searchMusicResult("", limit, cursor);
    if (result.items.length) {
      return { items: result.items, continuation: result.continuation, page: "music" };
    }
  } catch (error) {
    /* Token musik bisa kedaluwarsa; coba klien video di bawah. */
  }
  const fallback = await searchVideoResult("", "", limit, cursor);
  return { items: fallback.items, continuation: fallback.continuation, page: "video" };
}

async function search(query, options) {
  const opts = options || {};
  const limit = Math.min(Math.max(Number(opts.limit) || 40, 1), 50);
  const text = String(query || "").replace(/\s+/g, " ").trim().slice(0, 80);
  if (!text) {
    return { items: [], alternates: [], continuation: "", page: "music", degraded: false };
  }

  // Utama: katalog lagu YouTube Music (bersih, audio-only/Topic).
  // Alternatif: pencarian video biasa untuk kandidat cadangan.
  const results = await Promise.allSettled([
    searchMusicWithRetry(text, limit, 2),
    searchVideoResult(text, VIDEO_PARAMS, limit)
  ]);

  const music =
    results[0].status === "fulfilled"
      ? results[0].value
      : { items: [], continuation: "" };
  const video =
    results[1].status === "fulfilled"
      ? results[1].value
      : { items: [], continuation: "" };

  let items = music.items;
  let continuation = music.continuation;
  let page = "music";
  let degraded = music.items.length === 0;

  if (!items.length) {
    // Cadangan: hasil video biasa bila katalog musik kosong/gagal.
    page = "video";
    if (video.items.length) {
      items = video.items;
      continuation = video.continuation;
    } else {
      try {
        const fallback = await searchVideoResult(text, "", limit);
        items = fallback.items;
        continuation = fallback.continuation;
      } catch (error) {
        items = [];
        continuation = "";
      }
    }
  }

  const alternates = video.items.length ? video.items : items;

  if (!items.length) {
    const reason = [results[0], results[1]]
      .filter((result) => result.status === "rejected")
      .map((result) => result.reason)
      .find(Boolean);
    throw reason || new Error("Pencarian InnerTube tidak mengembalikan hasil");
  }

  return { items, alternates, continuation, page, degraded };
}

module.exports = { search, searchMore, searchMusic: searchMusicOnce, searchVideo: searchVideoOnce };
