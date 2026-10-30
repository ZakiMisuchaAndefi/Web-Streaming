/* ==========================================================================
   home.js — feed streaming untuk menu utama (rekomendasi, stasiun, populer)
   Sumber: pencarian musik YouTube lewat AM.Youtube.search (tanpa API key).
   Hasil disimpan sementara agar home tidak mencari ulang setiap kali dibuka.
   ========================================================================== */

(function (AM) {
  "use strict";

  const CACHE_KEY = "musik.home.feed.v3";
  const CACHE_TTL = 30 * 60 * 1000;
  const TRACKS_PER_SEARCH = 14;

  // Ubin cepat di bagian atas home. Setiap ubin memutar hasil pencariannya.
  const TILES = [
    { key: "harian", title: "Rekomendasi harian", query: "lagu indonesia populer", icon: "sparkles" },
    { key: "galau", title: "Lagu galau", query: "lagu galau indonesia populer", icon: "heart" },
    { key: "akustik", title: "Akustik santai", query: "lagu akustik indonesia santai", icon: "music" },
    { key: "nostalgia", title: "Nostalgia 80–90an", query: "lagu indonesia 90an populer", icon: "clock" },
    { key: "koplo", title: "Dangdut koplo", query: "dangdut koplo populer", icon: "radio" },
    { key: "internasional", title: "Pop internasional", query: "top pop hits", icon: "globe" }
  ];

  const listeners = new Map();
  const state = {
    status: "idle",
    error: "",
    sections: [],
    lastUpdated: 0,
    pending: null,
    source: ""
  };

  /* ------------------------------------------------------------------------
     Event
     ------------------------------------------------------------------------ */

  function on(type, handler) {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add(handler);
    return function off() {
      const set = listeners.get(type);
      if (set) set.delete(handler);
    };
  }

  function emit(type, detail) {
    const set = listeners.get(type);
    if (!set) return;
    set.forEach((handler) => {
      try {
        handler(detail);
      } catch (error) {
        console.warn("[home] listener gagal:", error);
      }
    });
  }

  /* ------------------------------------------------------------------------
     Cache
     ------------------------------------------------------------------------ */

  function readCache() {
    try {
      const raw = window.sessionStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || !Array.isArray(data.sections) || !data.sections.length) return null;
      if (Date.now() - (data.at || 0) > CACHE_TTL) return null;
      return data;
    } catch (error) {
      return null;
    }
  }

  function writeCache(sections) {
    try {
      window.sessionStorage.setItem(
        CACHE_KEY,
        JSON.stringify({ at: Date.now(), sections })
      );
    } catch (error) {
      /* Penyimpanan penuh atau diblokir — abaikan. */
    }
  }

  function rememberSections(sections) {
    if (!AM.Online || typeof AM.Online.remember !== "function") return sections;
    (sections || []).forEach((section) => {
      (section.tracks || []).forEach((track) => {
        try {
          AM.Online.remember(track);
        } catch (error) {
          /* Abaikan satu lagu yang rusak. */
        }
      });
    });
    return sections;
  }

  /* ------------------------------------------------------------------------
     Bantuan data
     ------------------------------------------------------------------------ */

  function clean(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function validTrack(track) {
    if (!track || !track.id || !track.sourceId) return false;
    const title = clean(track.title).toLowerCase();
    if (!title) return false;
    if (/^(live|short|shorts)\b/.test(title)) return false;
    const duration = Number(track.duration) || 0;
    if (duration && (duration < 40 || duration > 1200)) return false;
    return true;
  }

  function uniqueTracks(list, used) {
    const result = [];
    (list || []).forEach((track) => {
      if (!validTrack(track)) return;
      if (used.has(track.id)) return;
      used.add(track.id);
      result.push(track);
    });
    return result;
  }

  function libraryArtistName() {
    try {
      if (!AM.Library) return "";
      const artists = AM.Library.artists();
      if (!artists || !artists.length) return "";
      const ranked = artists.slice().sort((a, b) => {
        const plays = (artist) =>
          (artist.tracks || []).reduce((sum, track) => sum + (track.playCount || 0), 0);
        return plays(b) - plays(a);
      });
      return ranked[0] ? clean(ranked[0].name) : "";
    } catch (error) {
      return "";
    }
  }

  function libraryGenreName() {
    try {
      if (!AM.Library) return "";
      const genres = AM.Library.genres();
      if (!genres || !genres.length) return "";
      const sorted = genres.slice().sort((a, b) => (b.count || 0) - (a.count || 0));
      return sorted[0] ? clean(sorted[0].name) : "";
    } catch (error) {
      return "";
    }
  }

  function seedQueries() {
    const artist = libraryArtistName();
    const genre = libraryGenreName();
    const first = artist ? artist + " lagu terbaik" : "lagu indonesia populer";
    const second = genre ? genre + " indonesia" : "lagu pop indonesia akustik";
    return [first, second];
  }

  /* ------------------------------------------------------------------------
     Memuat feed
     ------------------------------------------------------------------------ */

  function buildSections(recoTracks, popularTracks) {
    const used = new Set();
    const recos = uniqueTracks(recoTracks, used).slice(0, 8);
    const popular = uniqueTracks(popularTracks, used).slice(0, 10);

    const sections = [];

    if (recos.length) {
      const stations = [];
      const stationSeeds = recos.slice(0, 4);
      stationSeeds.forEach((track) => {
        stations.push({
          id: track.id,
          title: clean(track.title),
          artist: clean(track.artist),
          art: track.art,
          label: "Radio " + (clean(track.artist) || clean(track.title))
        });
      });
      sections.push({
        key: "rekomendasi",
        title: "Rekomendasi untukmu",
        sub: "Dipilih dari lagu yang sedang populer dan yang kamu dengarkan",
        variant: "cards",
        tracks: recos,
        stations
      });
    }

    if (popular.length) {
      sections.push({
        key: "populer",
        title: "Lagu populer hari ini",
        sub: "Sering diputar orang lain — tekan untuk memutar",
        variant: "rows",
        tracks: popular
      });
    }

    return sections;
  }

  function load(options) {
    const opts = options || {};
    if (!opts.force) {
      if (state.status === "ready" && state.sections.length) {
        return Promise.resolve(snapshot());
      }
      if (state.pending) return state.pending;
      const cached = readCache();
      if (cached) {
        state.status = "ready";
        state.sections = rememberSections(cached.sections);
        state.lastUpdated = cached.at || Date.now();
        state.error = "";
        emit("change", snapshot());
        return Promise.resolve(snapshot());
      }
    }

    if (!AM.Youtube || typeof AM.Youtube.search !== "function") {
      state.status = "error";
      state.error = "Modul YouTube belum siap. Muat ulang halaman.";
      emit("change", snapshot());
      return Promise.resolve(snapshot());
    }

    const queries = seedQueries();
    state.status = "loading";
    state.error = "";
    state.source = queries.join(" • ");
    emit("change", snapshot());

    const task = (async () => {
      const results = [];
      // Dua pencarian dijalankan berurutan supaya instance Piped tidak
      // kebanjiran permintaan, tetapi kegagalan satu tidak memblokir lainnya.
      for (const query of queries) {
        try {
          const list = await AM.Youtube.search(query);
          results.push(Array.isArray(list) ? list.slice(0, TRACKS_PER_SEARCH) : []);
        } catch (error) {
          console.warn("[home] pencarian gagal:", query, error);
          results.push([]);
        }
      }

      const sections = buildSections(results[0] || [], results[1] || []);
      if (!sections.length) {
        state.status = "error";
        state.error =
          "Tidak dapat memuat rekomendasi. Periksa koneksi internet lalu coba lagi.";
        state.sections = [];
        emit("change", snapshot());
        return snapshot();
      }

      state.status = "ready";
      state.sections = sections;
      state.lastUpdated = Date.now();
      writeCache(sections);
      emit("change", snapshot());
      return snapshot();
    })().finally(() => {
      if (state.pending === task) state.pending = null;
    });

    state.pending = task;
    return task;
  }

  function refresh() {
    state.status = "idle";
    return load({ force: true });
  }

  function snapshot() {
    return {
      status: state.status,
      error: state.error,
      sections: state.sections.slice(),
      tiles: TILES.slice(),
      lastUpdated: state.lastUpdated
    };
  }

  /* ------------------------------------------------------------------------
     Pemutaran
     ------------------------------------------------------------------------ */

  function toast(message, options) {
    if (AM.UI && typeof AM.UI.toast === "function") {
      AM.UI.toast(message, options);
    }
  }

  function sectionById(key) {
    return state.sections.find((section) => section.key === key) || null;
  }

  function playIds(ids, startId, label, shuffle) {
    if (!AM.Player || typeof AM.Player.playQueue !== "function") return;
    const cleanIds = (ids || []).filter(Boolean);
    if (!cleanIds.length) {
      toast("Belum ada lagu untuk diputar.", { icon: "info" });
      return;
    }
    if (shuffle) {
      AM.Player.setShuffle(true);
      const random = cleanIds[Math.floor(Math.random() * cleanIds.length)];
      AM.Player.playQueue(cleanIds, random, { type: "home", label });
      return;
    }
    const start = startId && cleanIds.includes(startId) ? startId : cleanIds[0];
    AM.Player.playQueue(cleanIds, start, { type: "home", label });
  }

  function ensureResolver() {
    if (!AM.Youtube || typeof AM.Youtube.checkLocalResolver !== "function") {
      return Promise.resolve(true);
    }
    return AM.Youtube.checkLocalResolver().then((available) => {
      if (!available) {
        toast("yt-dlp belum siap — lagu YouTube tidak bisa diputar.", {
          type: "error",
          icon: "alert"
        });
      }
      return available;
    });
  }

  async function playTrack(sectionKey, trackId, options) {
    const opts = options || {};
    const section = sectionById(sectionKey);
    if (!section) return;
    const ids = section.tracks.map((track) => track.id);
    if (!ids.includes(trackId)) ids.unshift(trackId);
    const available = await ensureResolver();
    if (!available) return;
    playIds(ids, trackId, section.title, !!opts.shuffle);
  }

  async function playSection(sectionKey, shuffle) {
    const section = sectionById(sectionKey);
    if (!section || !section.tracks.length) {
      toast("Rekomendasi masih dimuat. Coba lagi sebentar.", { icon: "info" });
      return;
    }
    const available = await ensureResolver();
    if (!available) return;
    playIds(
      section.tracks.map((track) => track.id),
      section.tracks[0].id,
      section.title,
      !!shuffle
    );
  }

  async function playStation(trackId) {
    const track = findTrack(trackId);
    if (!track) return;
    const available = await ensureResolver();
    if (!available) return;
    const label = "Radio " + (clean(track.artist) || clean(track.title));
    playIds([track.id], track.id, label);
    toast("Stasiun " + label.replace(/^Radio /, "") + " dimulai.", { icon: "radio" });
  }

  async function queueTrack(trackId) {
    if (!AM.Player || typeof AM.Player.addToQueue !== "function") return;
    const track = findTrack(trackId);
    if (!track) return;
    const added = await AM.Player.addToQueue([track.id], {
      context: { type: "home", label: "Rekomendasi" }
    });
    if (added) {
      toast("“" + clean(track.title) + "” ditambahkan ke antrean.", { type: "success" });
    } else {
      toast("“" + clean(track.title) + "” sedang diputar dan sudah ada di antrean.", {
        icon: "info"
      });
    }
  }

  function findTrack(trackId) {
    for (const section of state.sections) {
      const found = (section.tracks || []).find((track) => track.id === trackId);
      if (found) return found;
    }
    return null;
  }

  async function playSeed(query) {
    const value = clean(query);
    if (!value) return;
    if (!AM.Youtube || typeof AM.Youtube.search !== "function") return;
    toast("Memuat “" + value + "” dari YouTube…", { icon: "globe" });
    const available = await ensureResolver();
    if (!available) return;
    try {
      const list = await AM.Youtube.search(value);
      const tracks = uniqueTracks(list, new Set()).slice(0, 20);
      if (!tracks.length) {
        toast("Tidak ada lagu yang bisa diputar untuk “" + value + "”.", {
          type: "error",
          icon: "alert"
        });
        return;
      }
      playIds(tracks.map((track) => track.id), tracks[0].id, value);
    } catch (error) {
      toast("Gagal memuat “" + value + "”. Periksa koneksi internet.", {
        type: "error",
        icon: "alert"
      });
    }
  }

  function tiles() {
    return TILES.slice();
  }

  AM.Home = {
    load,
    refresh,
    snapshot,
    on,
    playTrack,
    playSection,
    playStation,
    queueTrack,
    playSeed,
    tiles
  };
})(window.AM = window.AM || {});
