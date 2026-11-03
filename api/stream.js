const { Readable } = require("stream");
const lib = require("./_lib");

// Setiap respons dibatasi 1 MB (206 Partial Content). Browser otomatis meminta
// potongan berikutnya. Penting: Google Video menolak (403) permintaan byte-range
// yang lebih besar dari ~1 MB untuk URL InnerTube, jadi jangan dinaikkan.
const CHUNK = 1024 * 1024;

async function fetchAllowedRange(target, range, headers) {
  let current = target;
  let redirects = 0;
  while (true) {
    const response = await fetch(current, {
      method: "GET",
      redirect: "manual",
      headers: Object.assign({ Range: range }, headers || {})
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return response;
      if (redirects >= 5) {
        await response.body?.cancel();
        throw new Error("Terlalu banyak redirect saat mengambil audio");
      }
      current = new URL(location, current).toString();
      if (!lib.isAllowed(current)) {
        await response.body?.cancel();
        throw new Error("URL redirect tidak valid");
      }
      await response.body?.cancel();
      redirects += 1;
      continue;
    }

    return response;
  }
}

module.exports = async (req, res) => {
  const target = String(req.query.u || "");
  const videoId = String(req.query.id || "");
  let entry = null;

  if (videoId) {
    if (!lib.ID.test(videoId)) return res.status(400).send("ID video tidak valid");
    try {
      const quality = lib.qualityOf(req.query.quality);
      entry = await lib.getAudioUrl(videoId, quality, req.query.force === "1");
    } catch (error) {
      console.error("[stream] gagal menyiapkan audio:", error);
      return res.status(502).json({ error: "Layanan audio tidak tersedia saat ini." });
    }
  } else {
    if (!lib.isAllowed(target)) return res.status(400).send("URL tidak valid");
    entry = { url: target, headers: { "User-Agent": lib.VISIONOS_UA } };
  }

  const m = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ""));
  const total = Number(new URL(entry.url).searchParams.get("clen"));
  const hasTotal = Number.isSafeInteger(total) && total > 0;
  let range;
  if (m && m[1] === "" && m[2] !== "") {
    const requested = Number(m[2]);
    if (hasTotal && Number.isSafeInteger(requested) && requested > 0) {
      const length = Math.min(requested, CHUNK, total);
      range = "bytes=" + (total - length) + "-" + (total - 1);
    } else {
      range = "bytes=-" + m[2];
    }
  } else {
    const start = m && m[1] ? parseInt(m[1], 10) : 0;
    const asked = m && m[2] ? parseInt(m[2], 10) : Infinity;
    if (hasTotal && start >= total) {
      res.statusCode = 416;
      res.setHeader("Content-Range", "bytes */" + total);
      res.setHeader("Accept-Ranges", "bytes");
      return res.end();
    }
    const end = Math.min(asked, start + CHUNK - 1, hasTotal ? total - 1 : Infinity);
    range = "bytes=" + start + "-" + end;
  }

  try {
    const upstream = await fetchAllowedRange(entry.url, range, entry.headers);
    if (!upstream.ok && upstream.status !== 416) {
      console.error("[stream] Google Video menolak permintaan audio:", upstream.status);
      await upstream.body?.cancel();
      return res.status(502).json({ error: "Layanan audio tidak tersedia saat ini." });
    }
    res.statusCode = upstream.status;
    ["content-type", "content-length", "content-range"].forEach((h) => {
      const v = upstream.headers.get(h);
      if (v) res.setHeader(h, v);
    });
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "no-store");
    if (!upstream.body) return res.end();
    const body = Readable.fromWeb(upstream.body);
    res.on("close", () => {
      if (!res.writableEnded) body.destroy();
    });
    body.on("error", (error) => {
      console.error("[stream] gagal meneruskan audio:", error);
      if (!res.destroyed) res.destroy();
    });
    body.pipe(res);
  } catch (error) {
    console.error("[stream] gagal streaming audio:", error);
    if (!res.headersSent) res.status(502).json({ error: "Layanan audio tidak tersedia saat ini." });
  }
};
