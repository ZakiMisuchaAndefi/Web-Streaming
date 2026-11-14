/* ==========================================================================
   lossless.js — jembatan ke katalog FLAC (Tracks / Monochrome).

   Saat format streaming disetel ke FLAC, pemutar mencoba mencari versi
   lossless dari lagu online lewat /api/lossless. Bila ketemu, audio diputar
   langsung dari katalog (mendukung Range, tanpa proxy); bila tidak, pemutar
   kembali ke audio YouTube seperti biasa.
   ========================================================================== */

(function (AM) {
  "use strict";

  const CACHE_TTL = 6 * 60 * 60 * 1000;
  const NEGATIVE_TTL = 60 * 1000;
  const ERROR_TTL = 30 * 1000;
  const TIMEOUT = 10000;

  const cache = new Map();
  const inflight = new Map();
  let warmed = false;

  function quality() {
    if (!AM.Library || typeof AM.Library.getSetting !== "function") return "high";
    return AM.Library.getSetting("streamQuality", "high");
  }

  // Hanya dipakai saat pengguna memilih FLAC.
  function shouldUse() {
    return quality() === "flac";
  }

  // Ambil judul/artis yang bersih dari metadata YouTube.
  function parseInfo(track) {
    const YT = AM.Youtube || {};
    let song = String(track.songTitle || "").trim();
    let artist = String(track.artist || "").trim();
    if (artist.toLowerCase() === "youtube") artist = "";

    if ((!song || !artist) && typeof YT.parseTrackInfo === "function") {
      const parsed = YT.parseTrackInfo(track.title || "", artist || track.artist || "") || {};
      if (!song) song = String(parsed.song || "").trim();
      if (!artist) artist = String(parsed.artist || "").trim();
    }

    if (!song) song = String(track.title || "").trim();
    if (artist.toLowerCase() === "youtube") artist = "";
    return { song, artist };
  }

  function keyFor(track, info) {
    return [
      info.song.toLowerCase(),
      info.artist.toLowerCase(),
      Math.round(Number(track.duration) || 0),
      String(track.title || "").toLowerCase()
    ].join("|");
  }

  async function fetchJSON(url) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), TIMEOUT);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: "application/json" }
      });
      // 404 = lagu memang tidak ada di katalog. Status lain = gangguan
      // sementara, jadi jangan dianggap "tidak tersedia".
      if (response.status === 404) return null;
      if (!response.ok) throw new Error("HTTP " + response.status);
      return await response.json();
    } finally {
      window.clearTimeout(timer);
    }
  }

  async function resolve(track) {
    if (!track || track.provider !== "youtube") return null;
    if (track.losslessUnavailable) return null;
    if (!shouldUse()) return null;

    const info = parseInfo(track);
    if (!info.song) return null;

    const key = keyFor(track, info);
    const hit = cache.get(key);
    if (hit && hit.expires > Date.now()) return hit.value;
    if (inflight.has(key)) return inflight.get(key);

    let failed = false;
    const task = (async () => {
      try {
        const params = new URLSearchParams();
        params.set("title", info.song);
        if (info.artist) params.set("artist", info.artist);
        if (track.duration) params.set("duration", String(Math.round(Number(track.duration) || 0)));
        if (track.isrc) params.set("isrc", track.isrc);
        // Judul asli dipakai server untuk mendeteksi versi live/remix yang
        // sering tertulis di dalam tanda kurung.
        if (track.title) params.set("rawTitle", String(track.title).slice(0, 240));

        const data = await fetchJSON(
          (window.API_BASE || "") + "/api/lossless?" + params.toString()
        );
        if (!data || typeof data.url !== "string" || !/^https:\/\//.test(data.url)) return null;
        return data;
      } catch (error) {
        failed = true;
        return null;
      } finally {
        inflight.delete(key);
      }
    })();

    inflight.set(key, task);
    const value = await task;
    cache.set(key, {
      value,
      // Kegagalan sementara hanya di-cache sebentar agar katalog bisa dicoba lagi.
      expires: Date.now() + (value ? CACHE_TTL : failed ? ERROR_TTL : NEGATIVE_TTL)
    });
    return value;
  }

  function clearCache() {
    cache.clear();
    inflight.clear();
  }

  // Pemanasan fungsi /api/lossless di Vercel: cold start pertama bisa memakan
  // beberapa detik. Dipanggil sekali saat aplikasi siap (hanya jika FLAC aktif)
  // supaya pemutaran pertama tidak kehabisan waktu lalu jatuh ke YouTube.
  function warm(force) {
    if ((!force && warmed) || !shouldUse()) return Promise.resolve(false);
    warmed = true;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), TIMEOUT);
    return fetch((window.API_BASE || "") + "/api/lossless?warm=1", {
      signal: controller.signal,
      cache: "no-store",
      headers: { Accept: "application/json" }
    })
      .catch(() => null)
      .then(() => true)
      .finally(() => window.clearTimeout(timer));
  }

  AM.Lossless = {
    resolve,
    shouldUse,
    clearCache,
    warm,
    parseInfo,
    enabled: function () {
      return true;
    }
  };
})(window.AM || (window.AM = {}));
