// Klien InnerTube (API internal YouTube) untuk pencarian.
// Referensi: https://github.com/tombulled/innertube
// Tidak butuh API key resmi; memakai API key publik milik klien web YouTube.
const BASE = "https://youtubei.googleapis.com/youtubei/v1/";
const API_KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";
const CLIENT_VERSION = "2.20250626.01.00";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const TIMEOUT = 12000;
const VIDEO_PARAMS = "EgIQAQ%3D%3D";

let visitorData = "";

function timedSignal(ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, done: () => clearTimeout(timer) };
}

async function post(endpoint, body) {
  const timer = timedSignal(TIMEOUT);
  try {
    const headers = {
      "Content-Type": "application/json",
      "X-Goog-Api-Format-Version": "1",
      "X-YouTube-Client-Name": "1",
      "X-YouTube-Client-Version": CLIENT_VERSION,
      "User-Agent": USER_AGENT,
      Referer: "https://www.youtube.com/",
      "Accept-Language": "en-US,en;q=0.9"
    };
    if (visitorData) headers["X-Goog-Visitor-Id"] = visitorData;

    const response = await fetch(
      BASE + endpoint + "?key=" + API_KEY + "&alt=json&prettyPrint=false",
      {
        method: "POST",
        headers,
        signal: timer.signal,
        body: JSON.stringify(
          Object.assign(
            {
              context: {
                client: {
                  clientName: "WEB",
                  clientVersion: CLIENT_VERSION,
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
    const visitor =
      data && data.responseContext && data.responseContext.visitorData;
    if (visitor) visitorData = String(visitor);
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
   Parser hasil
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

function textOf(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value.simpleText === "string") return value.simpleText;
  if (Array.isArray(value.runs)) {
    return value.runs.map((run) => String((run && run.text) || "")).join("");
  }
  return "";
}

function durationOf(renderer) {
  const seconds = Number(renderer && renderer.lengthSeconds);
  if (Number.isFinite(seconds) && seconds > 0) return Math.round(seconds);
  const text = textOf(renderer && renderer.lengthText);
  if (!text) return 0;
  const parts = text.trim().split(":");
  let total = 0;
  for (const part of parts) {
    const value = parseInt(part, 10);
    if (!Number.isFinite(value)) return 0;
    total = total * 60 + value;
  }
  return total;
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

async function searchOnce(query, params, limit) {
  const body = { query };
  if (params) body.params = params;
  const data = await post("search", body);
  return itemsFrom(data, limit);
}

/* --------------------------------------------------------------------------
   Pencarian: hasil utama + alternatif (video biasa) untuk kandidat cadangan
   -------------------------------------------------------------------------- */

async function search(query, options) {
  const opts = options || {};
  const limit = Math.min(Math.max(Number(opts.limit) || 40, 1), 50);
  const text = String(query || "").replace(/\s+/g, " ").trim().slice(0, 80);
  if (!text) return { items: [], alternates: [] };

  const results = await Promise.allSettled([
    searchOnce(text, "", limit),
    searchOnce(text, VIDEO_PARAMS, limit)
  ]);

  let items =
    results[0].status === "fulfilled" ? results[0].value : [];
  const alternates =
    results[1].status === "fulfilled" ? results[1].value : [];

  if (!items.length) items = alternates;
  if (!items.length) {
    const reason =
      results[0].status === "rejected"
        ? results[0].reason
        : results[1].status === "rejected"
          ? results[1].reason
          : null;
    throw reason || new Error("Pencarian InnerTube tidak mengembalikan hasil");
  }

  return { items, alternates };
}

module.exports = { search, searchOnce };
