const { Readable } = require("stream");
const lib = require("./_lib");

// Setiap respons dibatasi 2 MB (206 Partial Content). Browser otomatis meminta potongan berikutnya,
// jadi fungsi tidak kena batas waktu dan batas ukuran respons Vercel.
const CHUNK = 2 * 1024 * 1024;

async function fetchAllowedRange(target, range) {
  let current = target;
  while (true) {
    const response = await fetch(current, {
      method: "GET",
      redirect: "manual",
      headers: {
        Range: range,
        "User-Agent": lib.UA
      }
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return response;
      current = new URL(location, current).toString();
      if (!lib.isAllowed(current)) {
        throw new Error("URL redirect tidak valid");
      }
      continue;
    }

    return response;
  }
}

module.exports = async (req, res) => {
  let target = String(req.query.u || "");
  const videoId = String(req.query.id || "");
  if (videoId) {
    if (!lib.ID.test(videoId)) return res.status(400).send("ID video tidak valid");
    try {
      const quality = lib.qualityOf(req.query.quality);
      const entry = await lib.getAudioUrl(videoId, quality);
      target = entry.url;
    } catch (error) {
      console.error("[stream] gagal mendapatkan URL audio:", error);
      return res.status(502).json({ error: "Layanan audio tidak tersedia saat ini." });
    }
  }
  if (!lib.isAllowed(target)) return res.status(400).send("URL tidak valid");

  const m = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ""));
  let range;
  if (m && m[1] === "" && m[2] !== "") {
    range = "bytes=-" + m[2]; // suffix range (metadata di akhir file)
  } else {
    const start = m && m[1] ? parseInt(m[1], 10) : 0;
    const asked = m && m[2] ? parseInt(m[2], 10) : Infinity;
    range = "bytes=" + start + "-" + Math.min(asked, start + CHUNK - 1);
  }

  try {
    const upstream = await fetchAllowedRange(target, range);
    res.statusCode = upstream.status;
    ["content-type", "content-length", "content-range"].forEach((h) => {
      const v = upstream.headers.get(h);
      if (v) res.setHeader(h, v);
    });
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "no-store");
    if (!upstream.body) return res.end();
    const body = Readable.fromWeb(upstream.body);
    req.on("close", () => body.destroy());
    body.on("error", () => res.end());
    body.pipe(res);
  } catch (error) {
    console.error("[stream] gagal streaming audio:", error);
    if (!res.headersSent) res.status(502).json({ error: "Layanan audio tidak tersedia saat ini." });
  }
};
