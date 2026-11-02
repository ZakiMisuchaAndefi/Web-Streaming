const lib = require("./_lib");

// Mengembalikan URL proxy (/api/stream) karena URL googlevideo terikat ke IP yang me-resolve-nya.
module.exports = async (req, res) => {
  const id = String(req.query.id || "");
  if (!lib.ID.test(id)) return res.status(400).json({ error: "ID video tidak valid" });
  const quality = lib.qualityOf(req.query.quality);
  try {
    const entry = await lib.getAudioFile(id, quality, req.query.force === "1");
    res.setHeader("Cache-Control", "no-store");
    res.json({
      url:
        "/api/stream?id=" +
        encodeURIComponent(id) +
        "&quality=" +
        encodeURIComponent(quality),
      expires: entry.expires,
      quality
    });
  } catch (error) {
    console.error("[resolve] gagal menyiapkan audio:", error);
    res.status(502).json({ error: "Layanan audio tidak tersedia saat ini." });
  }
};
