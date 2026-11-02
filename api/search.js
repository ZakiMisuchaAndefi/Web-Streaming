const { search } = require("./_innertube");

const TTL = 5 * 60 * 1000;
const MAX_ENTRIES = 100;
const cache = new Map();

module.exports = async (req, res) => {
  const query = String(req.query.q || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  if (!query) {
    return res.status(400).json({ error: "Kata kunci pencarian kosong" });
  }

  const key = query.toLowerCase();
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expires > now) {
    res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
    return res.json(hit.payload);
  }

  try {
    const payload = await search(query, { limit: 40 });
    cache.set(key, { payload, expires: now + TTL });
    if (cache.size > MAX_ENTRIES) {
      const first = cache.keys().next();
      if (!first.done) cache.delete(first.value);
    }
    res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
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
