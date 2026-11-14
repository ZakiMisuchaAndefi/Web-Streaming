const { search, searchMore } = require("./_innertube");

const TTL = 5 * 60 * 1000;
const MAX_ENTRIES = 100;
const cache = new Map();

function remember(key, payload, ttl) {
  cache.set(key, { payload, expires: Date.now() + ttl });
  if (cache.size > MAX_ENTRIES) {
    const first = cache.keys().next();
    if (!first.done) cache.delete(first.value);
  }
}

module.exports = async (req, res) => {
  const query = String(req.query.q || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  const cursor = String(req.query.cursor || "").trim();
  const page = req.query.page === "video" ? "video" : "music";

  if (!query && !cursor) {
    return res.status(400).json({ error: "Kata kunci pencarian kosong" });
  }

  const key = (cursor ? "more|" + page + "|" + cursor : query.toLowerCase()).slice(0, 500);
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expires > now) {
    res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
    return res.json(hit.payload);
  }

  try {
    const payload = cursor
      ? await searchMore(cursor, { page, limit: 40 })
      : await search(query, { limit: 40 });
    // Hasil cadangan (video biasa) hanya disimpan sebentar supaya pencarian
    // musik yang sempat gagal bisa pulih cepat.
    const ttl = payload && payload.degraded ? 30 * 1000 : TTL;
    remember(key, payload, ttl);
    res.setHeader(
      "Cache-Control",
      payload && payload.degraded
        ? "public, s-maxage=30, stale-while-revalidate=60"
        : "public, s-maxage=300, stale-while-revalidate=600"
    );
    res.json(payload);
  } catch (error) {
    res.setHeader("Cache-Control", "no-store");
    res.status(502).json({
      error:
        "Pencarian InnerTube gagal: " +
        (error && error.message ? error.message : "tidak diketahui")
    });
  }
};
