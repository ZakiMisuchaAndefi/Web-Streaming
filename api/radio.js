const lib = require("./_lib");
const cache = new Map();
const SKIP = /full album|compilation|kompilasi|podcast|medley|nonstop|non-stop|greatest hits|mega hits|dj mix|megamix/i;

function textOf(node) {
  if (!node) return "";
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(textOf).join(" ");
  if (typeof node === "object") {
    if (typeof node.simpleText === "string") return node.simpleText;
    if (Array.isArray(node.runs)) return node.runs.map((run) => textOf(run)).join("");
    if (Array.isArray(node.segments)) return node.segments.map((segment) => textOf(segment)).join("");
    if (node.accessibility && node.accessibility.accessibilityData && typeof node.accessibility.accessibilityData.label === "string") {
      return node.accessibility.accessibilityData.label;
    }
  }
  return "";
}

function durationOf(node) {
  if (!node) return 0;
  if (typeof node === "number") return Math.max(0, Math.round(node));
  if (typeof node === "string") {
    const raw = node.trim();
    if (!raw) return 0;
    const parts = raw.split(":").map((value) => Number(value));
    if (parts.some((value) => !Number.isFinite(value))) return 0;
    let total = 0;
    for (const value of parts) total = total * 60 + value;
    return total;
  }
  if (typeof node === "object") {
    if (Number.isFinite(Number(node.seconds))) return Number(node.seconds);
    return durationOf(textOf(node));
  }
  return 0;
}

function collectPlaylistRenderers(node, out) {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const item of node) collectPlaylistRenderers(item, out);
    return out;
  }
  if (node.playlistPanelVideoRenderer) out.push(node.playlistPanelVideoRenderer);
  for (const key of Object.keys(node)) {
    if (key === "playlistPanelVideoRenderer") continue;
    collectPlaylistRenderers(node[key], out);
  }
  return out;
}

function parseRenderer(renderer) {
  if (!renderer) return null;
  const videoId = String(renderer.videoId || renderer.navigationEndpoint?.watchEndpoint?.videoId || "").trim();
  if (!lib.ID.test(videoId)) return null;
  const title = textOf(renderer.title || renderer.shortBylineText || renderer.longBylineText || "").trim();
  const artist = textOf(renderer.shortBylineText || renderer.longBylineText || renderer.ownerText || "").trim();
  const duration = durationOf(renderer.lengthSeconds || renderer.lengthText || 0);
  if (!title || duration < 60 || duration > 600) return null;
  if (SKIP.test(title) || SKIP.test(artist)) return null;
  return { id: videoId, title, artist, duration };
}

module.exports = async (req, res) => {
  const id = String(req.query.id || "");
  if (!lib.ID.test(id)) return res.status(400).json({ error: "ID video tidak valid" });

  const now = Date.now();
  const hit = cache.get(id);
  if (hit && hit.expires > now) return res.json({ tracks: hit.tracks });

  try {
    const payload = await lib.innertube(
      "next",
      {
        videoId: id,
        playlistId: "RD" + id
      },
      {
        id: "WEB",
        clientName: "WEB",
        clientVersion: "2.20250626.01.00",
        clientId: 1,
        platform: "DESKTOP",
        hl: "en",
        gl: "US"
      }
    );

    const seen = new Set();
    const tracks = [];
    const renderers = collectPlaylistRenderers(payload, []);

    for (const renderer of renderers) {
      const parsed = parseRenderer(renderer);
      if (!parsed || seen.has(parsed.id) || parsed.id === id) continue;
      seen.add(parsed.id);
      tracks.push(parsed);
      if (tracks.length >= 40) break;
    }

    if (!tracks.length) {
      throw new Error("Radio YouTube tidak menghasilkan daftar lagu");
    }

    cache.set(id, { tracks, expires: now + 30 * 60 * 1000 });
    res.json({ tracks });
  } catch (error) {
    console.error("[radio] gagal memuat playlist RD:", error);
    res.status(502).json({ error: "Layanan radio tidak tersedia saat ini." });
  }
};
