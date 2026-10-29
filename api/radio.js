const lib = require("./_lib");
const cache = new Map();
const SKIP = /full album|compilation|kompilasi|podcast|medley|nonstop|non-stop|greatest hits|mega hits|dj mix|megamix/i;

module.exports = async (req, res) => {
  const id = String(req.query.id || "");
  if (!lib.ID.test(id)) return res.status(400).json({ error: "ID video tidak valid" });
  const now = Date.now();
  const hit = cache.get(id);
  if (hit && hit.expires > now) return res.json({ tracks: hit.tracks });
  try {
    const out = await lib.run(
      [
        "--flat-playlist",
        "--playlist-end", "50",
        "--print", "%(id)s\t%(title)s\t%(duration)s\t%(uploader)s",
        "https://www.youtube.com/watch?v=" + id + "&list=RD" + id
      ],
      50000
    );
    const seen = new Set();
    const tracks = [];
    for (const line of out.split(/\r?\n/)) {
      const parts = line.split("\t");
      const vid = parts[0], title = parts[1], duration = parseInt(parts[2], 10) || 0, artist = parts[3];
      if (!lib.ID.test(vid || "") || vid === id || seen.has(vid)) continue;
      if (!title || SKIP.test(title) || duration < 60 || duration > 600) continue;
      seen.add(vid);
      tracks.push({ id: vid, title: title.trim(), artist: (artist || "").trim(), duration });
      if (tracks.length >= 40) break;
    }
    if (!tracks.length) throw new Error("Radio YouTube tidak mengembalikan lagu");
    cache.set(id, { tracks, expires: now + 30 * 60 * 1000 });
    res.json({ tracks });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
};
