/* ==========================================================================
   lyrics.js — pencarian lirik LRCLIB saat diminta
   ========================================================================== */

(function (AM) {
  "use strict";

  const ENDPOINT = "https://lrclib.net/api/search";
  const CLIENT = "Musik Web Streaming (https://github.com/ZakiMisuchaAndefi/Web-Streaming)";
  const cache = new Map();

  function normalize(value) {
    return String(value || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
  }

  function findBestMatch(records, track) {
    const title = normalize(track.songTitle || track.title);
    const artist = normalize(track.artist);
    if (!title) return null;

    return (records || [])
      .map((record) => {
        const candidateTitle = normalize(record && record.trackName);
        const candidateArtist = normalize(record && record.artistName);
        if (!candidateTitle) return null;
        const titleMatches =
          candidateTitle === title ||
          (title.length > 3 &&
            (candidateTitle.includes(title) || title.includes(candidateTitle)));
        if (!titleMatches) return null;

        const artistMatches =
          !artist ||
          !candidateArtist ||
          candidateArtist === artist ||
          candidateArtist.includes(artist) ||
          artist.includes(candidateArtist);
        if (!artistMatches) return null;

        const expectedDuration = Number(track.duration) || 0;
        const actualDuration = Number(record.duration) || 0;
        const durationMatches =
          !expectedDuration ||
          !actualDuration ||
          Math.abs(expectedDuration - actualDuration) <= 12;
        if (!durationMatches) return null;

        const lyrics = String(record.syncedLyrics || record.plainLyrics || "").trim();
        if (!lyrics) return null;
        return {
          lyrics,
          score:
            (candidateTitle === title ? 4 : 2) +
            (candidateArtist === artist ? 3 : artistMatches ? 1 : 0) +
            (durationMatches ? 1 : 0)
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score)[0] || null;
  }

  async function lookup(track, options) {
    if (!track || !track.id) throw new Error("Lagu untuk pencarian lirik tidak valid.");
    const force = !!(options && options.force);
    const cached = !force && cache.get(track.id);
    if (cached) return cached;

    const title = String(track.songTitle || track.title || "").trim();
    const artist = String(track.artist || "").trim();
    const query = [artist, title].filter(Boolean).join(" ");
    if (!query) return null;

    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 10000);
    const task = (async () => {
      try {
        const response = await fetch(ENDPOINT + "?q=" + encodeURIComponent(query), {
          signal: controller.signal,
          headers: { "Lrclib-Client": CLIENT },
          cache: "no-store"
        });
        if (!response.ok) {
          throw new Error("LRCLIB merespons HTTP " + response.status + ".");
        }
        const records = await response.json();
        const match = findBestMatch(records, track);
        return match ? { lyrics: match.lyrics } : null;
      } finally {
        window.clearTimeout(timer);
      }
    })();

    cache.set(track.id, task);
    try {
      return await task;
    } catch (error) {
      if (cache.get(track.id) === task) cache.delete(track.id);
      throw error;
    }
  }

  AM.Lyrics = { lookup };
})(window.AM = window.AM || {});
