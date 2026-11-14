const lib = require("./_lossless");

// Mencari versi FLAC dari metadata lagu. URL audio yang dikembalikan diputar
// langsung oleh browser (endpoint katalog mendukung Range + CORS), jadi tidak
// perlu proxy audio di server.
module.exports = async (req, res) => {
  const title = String(req.query.title || "").replace(/\s+/g, " ").trim().slice(0, 120);
  if (!title) return res.status(400).json({ error: "Judul lagu kosong" });

  const query = {
    title,
    artist: String(req.query.artist || "").replace(/\s+/g, " ").trim().slice(0, 120),
    duration: Number(req.query.duration) || 0,
    isrc: String(req.query.isrc || "").trim().slice(0, 32),
    // Judul video asli (masih memuat "(Live)", "(Remix)", dll.).
    rawTitle: String(req.query.rawTitle || "").replace(/\s+/g, " ").trim().slice(0, 240)
  };

  try {
    const result = await lib.resolve(query);
    if (!result) {
      res.setHeader("Cache-Control", "public, s-maxage=600, stale-while-revalidate=1800");
      return res.status(404).json({ error: "Tidak ada versi lossless untuk lagu ini." });
    }
    res.setHeader("Cache-Control", "public, s-maxage=86400, stale-while-revalidate=604800");
    res.json(result);
  } catch (error) {
    console.error("[lossless] gagal mencari audio:", error);
    res.setHeader("Cache-Control", "no-store");
    res.status(502).json({ error: "Katalog lossless tidak dapat diakses saat ini." });
  }
};
