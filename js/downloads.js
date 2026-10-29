/* ==========================================================================
   downloads.js — unduhan audio YouTube lewat yt-dlp di server lokal.
   Server menjalankan yt-dlp sebagai proses latar; klien memantau statusnya
   lalu meminta browser menyimpan file hasil unduhan.
   ========================================================================== */

(function (AM) {
  "use strict";

  const HEALTH_TTL = 60 * 1000;
  const POLL_INTERVAL = 1400;
  const MAX_WAIT = 10 * 60 * 1000;

  const active = new Map();
  let healthCache = null;
  let healthTask = null;

  function toast(message, options) {
    if (AM.UI && typeof AM.UI.toast === "function") AM.UI.toast(message, options);
  }

  function qualityLabel(id) {
    switch (id) {
      case "low":
        return "Hemat";
      case "medium":
        return "Standar";
      case "high":
        return "Tinggi";
      case "lossless":
        return "Lossless";
      case "best":
      default:
        return "Terbaik";
    }
  }

  function downloadQuality() {
    const value = AM.Library ? AM.Library.getSetting("downloadQuality", "best") : "best";
    return ["low", "medium", "high", "best", "lossless"].includes(value) ? value : "best";
  }

  function health() {
    if (healthCache && Date.now() - healthCache.at < HEALTH_TTL) {
      return Promise.resolve(healthCache);
    }
    if (healthTask) return healthTask;

    healthTask = fetch((window.API_BASE || "") + "/api/health", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        healthCache = {
          ytdlp: !!(data && data.ytdlp),
          ffmpeg: !!(data && data.ffmpeg),
          at: Date.now()
        };
        return healthCache;
      })
      .catch(() => {
        healthCache = { ytdlp: false, ffmpeg: false, at: Date.now() };
        return healthCache;
      })
      .then((value) => {
        healthTask = null;
        return value;
      });
    return healthTask;
  }

  function sleep(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function saveFile(url, name) {
    const link = document.createElement("a");
    link.href = url;
    link.download = name || "audio";
    link.rel = "noopener";
    link.style.display = "none";
    document.body.appendChild(link);
    try {
      link.click();
    } finally {
      window.setTimeout(() => link.remove(), 0);
    }
  }

  async function download(track, qualityId) {
    if (!track || track.provider !== "youtube" || !track.sourceId) {
      toast("Unduhan hanya tersedia untuk lagu YouTube.", { icon: "info" });
      return null;
    }
    if (active.has(track.id)) {
      toast("Lagu ini sedang diunduh. Tunggu sampai selesai.", { icon: "info" });
      return null;
    }

    const quality = qualityId || downloadQuality();
    const status = await health();
    if (!status.ytdlp) {
      toast(
        "yt-dlp tidak tersedia di server. Coba lagi beberapa saat.",
        { type: "error", duration: 9000 }
      );
      return null;
    }
    if (!status.ffmpeg) {
      toast(
        "Unduhan MP3 hanya tersedia di versi lokal (butuh ffmpeg.exe).",
        { type: "error", duration: 9000 }
      );
      return null;
    }

    const label = qualityLabel(quality);
    toast("Mengunduh “" + track.title + "” · " + label + "…", {
      icon: "download",
      duration: 4500
    });
    active.set(track.id, true);

    try {
      const params = new URLSearchParams({
        id: track.sourceId,
        quality,
        title: track.title || "audio"
      });
      const response = await fetch((window.API_BASE || "") + "/api/download?" + params.toString(), {
        cache: "no-store"
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data || !data.jobId) {
        throw new Error((data && data.error) || "Server tidak dapat memulai unduhan.");
      }

      const startedAt = Date.now();
      while (Date.now() - startedAt < MAX_WAIT) {
        await sleep(POLL_INTERVAL);
        const statusResponse = await fetch(
          (window.API_BASE || "") + "/api/download-status?job=" + encodeURIComponent(data.jobId),
          { cache: "no-store" }
        );
        const payload = await statusResponse.json().catch(() => null);
        if (!statusResponse.ok || !payload) continue;

        if (payload.status === "done" && payload.url) {
          const file = {
            url: (window.API_BASE || "") + payload.url,
            name: payload.name || track.title + ".mp3"
          };
          saveFile(file.url, file.name);
          toast("“" + track.title + "” siap diunduh. Kalau tidak muncul, tekan Simpan.", {
            type: "success",
            duration: 12000,
            action: { label: "Simpan", onClick: () => saveFile(file.url, file.name) }
          });
          return file;
        }
        if (payload.status === "error") {
          throw new Error(payload.error || "Unduhan gagal.");
        }
      }
      throw new Error("Unduhan melebihi batas waktu 10 menit.");
    } catch (error) {
      toast(
        "Gagal mengunduh: " + (error && error.message ? error.message : "coba lagi."),
        { type: "error", duration: 9000 }
      );
      return null;
    } finally {
      active.delete(track.id);
    }
  }

  AM.Downloads = {
    download,
    health,
    qualityLabel,
    downloadQuality,
    isDownloading: (trackId) => active.has(trackId)
  };
})(window.AM = window.AM || {});
