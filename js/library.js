/* ==========================================================================
   library.js — state perpustakaan, impor, playlist, pencarian, cache URL
   ========================================================================== */

(function (AM) {
  "use strict";

  const U = AM.Utils;
  const AUDIO_EXTENSIONS = [
    "mp3",
    "m4a",
    "m4b",
    "mp4",
    "aac",
    "flac",
    "wav",
    "wave",
    "ogg",
    "oga",
    "opus",
    "weba",
    "webm"
  ];

  const HISTORY_MAX = 500;

  const DEFAULT_SETTINGS = {
    theme: "dark",
    volume: 0.8,
    muted: false,
    shuffle: false,
    repeat: "off",
    demoLoaded: false,
    lastRoute: "#/home",
    streamQuality: "high",
    downloadQuality: "best"
  };

  const state = {
    ready: false,
    storage: "memory",
    tracks: [],
    trackById: new Map(),
    playlists: [],
    playlistById: new Map(),
    history: [],
    covers: new Map(),
    settings: Object.assign({}, DEFAULT_SETTINGS),
    coverUrls: new Map(),
    audioUrls: new Map(),
    importing: false,
    durationQueue: null
  };

  const listeners = new Map();
  const memory = {
    tracks: new Map(),
    files: new Map(),
    covers: new Map(),
    playlists: new Map(),
    settings: new Map(),
    history: new Map()
  };

  const derived = {
    albums: null,
    artists: null,
    genres: null,
    favorites: null,
    recent: null
  };

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
        console.error("[library] listener error:", error);
      }
    });
  }

  function invalidate() {
    derived.albums = null;
    derived.artists = null;
    derived.genres = null;
    derived.favorites = null;
    derived.recent = null;
  }

  /* ------------------------------------------------------------------------
     Adapter penyimpanan (IndexedDB dengan fallback memori)
     ------------------------------------------------------------------------ */

  const store = {
    async getAll(name) {
      if (state.storage === "indexeddb") return AM.DB.getAll(name);
      return Array.from(memory[name].values());
    },
    async get(name, key) {
      if (state.storage === "indexeddb") return AM.DB.get(name, key);
      return memory[name].get(key) || null;
    },
    async putMany(name, values, extra) {
      if (state.storage === "indexeddb") return AM.DB.putMany(name, values, extra);
      (values || []).forEach((value) => memory[name].set(value.id, value));
      Object.entries(extra || {}).forEach((entry) => {
        const target = memory[entry[0]];
        (entry[1] || []).forEach((value) => target.set(value.id, value));
      });
    },
    async put(name, value) {
      if (state.storage === "indexeddb") return AM.DB.put(name, value);
      const key = name === "settings" ? value.key : value.id;
      memory[name].set(key, value);
      return value;
    },
    async removeMany(entries) {
      if (state.storage === "indexeddb") return AM.DB.removeMany(entries);
      entries.forEach((entry) => {
        const target = memory[entry[0]];
        (entry[1] || []).forEach((key) => target.delete(key));
      });
    },
    async clearAll() {
      if (state.storage === "indexeddb") return AM.DB.clearAll();
      Object.keys(memory).forEach((name) => memory[name].clear());
    }
  };

  /* ------------------------------------------------------------------------
     Inisialisasi
     ------------------------------------------------------------------------ */

  async function init() {
    try {
      await AM.DB.open();
      state.storage = "indexeddb";
    } catch (error) {
      state.storage = "memory";
      console.warn("[library] IndexedDB tidak tersedia, memakai memori:", error);
    }

    const [tracks, covers, playlists, settings, history] = await Promise.all([
      store.getAll("tracks").catch(() => []),
      store.getAll("covers").catch(() => []),
      store.getAll("playlists").catch(() => []),
      store.getAll("settings").catch(() => []),
      store.getAll("history").catch(() => [])
    ]);

    state.tracks = (tracks || []).map(hydrateTrack).sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
    state.trackById = new Map(state.tracks.map((track) => [track.id, track]));

    (covers || []).forEach((cover) => {
      if (cover && cover.id) state.covers.set(cover.id, cover);
    });

    state.playlists = (playlists || [])
      .filter((playlist) => playlist && playlist.id)
      .map((playlist) => ({
        id: playlist.id,
        name: playlist.name || "Playlist tanpa nama",
        description: playlist.description || "",
        trackIds: Array.isArray(playlist.trackIds) ? playlist.trackIds.filter((id) => state.trackById.has(id)) : [],
        createdAt: playlist.createdAt || Date.now(),
        updatedAt: playlist.updatedAt || Date.now()
      }))
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    state.playlistById = new Map(state.playlists.map((playlist) => [playlist.id, playlist]));

    (settings || []).forEach((row) => {
      if (row && row.key) state.settings[row.key] = row.value;
    });
    state.settings = Object.assign({}, DEFAULT_SETTINGS, state.settings);

    state.history = (history || [])
      .map(hydrateHistory)
      .filter((entry) => entry.id)
      .sort((a, b) => (b.playedAt || 0) - (a.playedAt || 0))
      .slice(0, HISTORY_MAX);
    // Lagu YouTube tidak lagi ada di memori setelah refresh, jadi daftarkan
    // ulang dari snapshot riwayat agar bisa diputar kembali.
    state.history.forEach((entry) => {
      if (!entry.online || !AM.Online || typeof AM.Online.remember !== "function") return;
      AM.Online.remember(historyOnlineTrack(entry));
    });

    state.ready = true;
    invalidate();
    emit("ready", { storage: state.storage });
    emit("change", { reason: "init" });

    if (state.tracks.some((track) => !(track.duration > 0))) {
      ensureDurations();
    }

    return state;
  }

  function hydrateTrack(track) {
    const artist = track.artist || "Artis tidak dikenal";
    const album = track.album || "";
    const albumArtist = track.albumArtist || artist;
    return Object.assign({}, track, {
      title: track.title || "Lagu tanpa judul",
      artist,
      album,
      albumArtist,
      genre: track.genre || "",
      year: track.year || "",
      trackNo: Number(track.trackNo) || 0,
      discNo: Number(track.discNo) || 1,
      duration: Number(track.duration) || Number(track.durationHint) || 0,
      liked: !!track.liked,
      playCount: Number(track.playCount) || 0,
      addedAt: Number(track.addedAt) || Date.now(),
      updatedAt: Number(track.updatedAt) || Number(track.addedAt) || Date.now(),
      albumKey: track.albumKey || albumKeyOf(albumArtist, album),
      artistKey: track.artistKey || artistKeyOf(artist),
      coverId: track.coverId || null,
      size: Number(track.size) || 0,
      lyrics: typeof track.lyrics === "string" ? track.lyrics : ""
    });
  }

  function hydrateHistory(entry) {
    if (!entry) return { id: "" };
    const id = entry.id || entry.trackId || "";
    return {
      id,
      title: entry.title || "Lagu tanpa judul",
      artist: entry.artist || "Artis tidak dikenal",
      album: entry.album || "",
      art: entry.art || "",
      coverId: entry.coverId || null,
      duration: Number(entry.duration) || 0,
      online: !!entry.online,
      provider: entry.provider || (entry.online ? "youtube" : "local"),
      providerLabel: entry.providerLabel || (entry.online ? "YouTube" : "Perpustakaan"),
      sourceId: entry.sourceId || "",
      externalUrl: entry.externalUrl || "",
      candidates: Array.isArray(entry.candidates) ? entry.candidates.slice(0, 6) : [],
      playedAt: Number(entry.playedAt) || Date.now()
    };
  }

  function historySnapshot(track, playedAt) {
    return {
      id: track.id,
      title: track.title || "Lagu tanpa judul",
      artist: track.artist || "Artis tidak dikenal",
      album: track.album || "",
      art: typeof track.art === "string" && /^https?:\/\//i.test(track.art) ? track.art : "",
      coverId: track.coverId || null,
      duration: Number(track.duration) || 0,
      online: !!track.online,
      provider: track.provider || (track.online ? "youtube" : "local"),
      providerLabel: track.providerLabel || (track.online ? "YouTube" : "Perpustakaan"),
      sourceId: track.sourceId || "",
      externalUrl: track.externalUrl || "",
      candidates: Array.isArray(track.candidates) ? track.candidates.slice(0, 6) : [],
      playedAt
    };
  }

  function historyOnlineTrack(entry) {
    return {
      id: entry.id,
      online: true,
      provider: entry.provider || "youtube",
      providerLabel: entry.providerLabel || "YouTube",
      sourceId: entry.sourceId || "",
      title: entry.title,
      artist: entry.artist,
      album: entry.album || "YouTube",
      duration: entry.duration || 0,
      art: entry.art || "",
      externalUrl: entry.externalUrl || "",
      candidates: entry.candidates || []
    };
  }

  function artistKeyOf(artist) {
    return U.normalize(artist || "Artis tidak dikenal");
  }

  function albumKeyOf(albumArtist, album) {
    return U.normalize(albumArtist || "Artis tidak dikenal") + "|" + U.normalize(album || "Singel");
  }

  /* ------------------------------------------------------------------------
     Akses data & turunan
     ------------------------------------------------------------------------ */

  function getTrack(id) {
    return state.trackById.get(id) || null;
  }

  function getTracks(ids) {
    if (!Array.isArray(ids)) return [];
    return ids.map((id) => state.trackById.get(id)).filter(Boolean);
  }

  function allTracks() {
    return state.tracks.slice();
  }

  function tracksByAdded() {
    return state.tracks.slice().sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
  }

  function tracksAlphabetical() {
    return state.tracks.slice().sort((a, b) => {
      const artist = U.byText(a.artist, b.artist);
      if (artist) return artist;
      const album = U.byText(a.album, b.album);
      if (album) return album;
      if (a.discNo !== b.discNo) return a.discNo - b.discNo;
      if (a.trackNo !== b.trackNo) return a.trackNo - b.trackNo;
      return U.byText(a.title, b.title);
    });
  }

  function albums() {
    if (derived.albums) return derived.albums;
    const map = new Map();
    state.tracks.forEach((track) => {
      const key = track.albumKey;
      if (!map.has(key)) {
        map.set(key, {
          key,
          name: track.album || "Singel",
          artist: track.albumArtist || track.artist,
          year: track.year || "",
          genre: track.genre || "",
          coverId: track.coverId || null,
          tracks: []
        });
      }
      const album = map.get(key);
      album.tracks.push(track);
      if (track.coverId && !album.coverId) album.coverId = track.coverId;
      if (track.year && !album.year) album.year = track.year;
      if (track.genre && !album.genre) album.genre = track.genre;
    });
    const list = Array.from(map.values());
    list.forEach((album) => {
      album.tracks.sort((a, b) => {
        if (a.discNo !== b.discNo) return a.discNo - b.discNo;
        if (a.trackNo !== b.trackNo) return a.trackNo - b.trackNo;
        return U.byText(a.title, b.title);
      });
      album.duration = album.tracks.reduce((sum, track) => sum + (track.duration || 0), 0);
      album.addedAt = Math.max.apply(null, album.tracks.map((track) => track.addedAt || 0));
      album.artistKey = artistKeyOf(album.artist);
    });
    derived.albums = list.sort((a, b) => {
      const artist = U.byText(a.artist, b.artist);
      if (artist) return artist;
      return U.byText(a.name, b.name);
    });
    return derived.albums;
  }

  function getAlbum(key) {
    return albums().find((album) => album.key === key) || null;
  }

  function artists() {
    if (derived.artists) return derived.artists;
    const map = new Map();
    state.tracks.forEach((track) => {
      const key = track.artistKey;
      if (!map.has(key)) {
        map.set(key, {
          key,
          name: track.artist,
          tracks: [],
          albumKeys: new Set(),
          coverId: track.coverId || null,
          genres: new Set()
        });
      }
      const artist = map.get(key);
      artist.tracks.push(track);
      if (track.albumKey) artist.albumKeys.add(track.albumKey);
      if (track.coverId && !artist.coverId) artist.coverId = track.coverId;
      if (track.genre) artist.genres.add(track.genre);
    });
    derived.artists = Array.from(map.values())
      .map((artist) => ({
        key: artist.key,
        name: artist.name,
        tracks: artist.tracks.sort((a, b) => (b.playCount || 0) - (a.playCount || 0)),
        albumCount: artist.albumKeys.size,
        coverId: artist.coverId,
        genres: Array.from(artist.genres)
      }))
      .sort((a, b) => U.byText(a.name, b.name));
    return derived.artists;
  }

  function getArtist(key) {
    return artists().find((artist) => artist.key === key) || null;
  }

  function genres() {
    if (derived.genres) return derived.genres;
    const map = new Map();
    state.tracks.forEach((track) => {
      const name = track.genre || "Lainnya";
      if (!map.has(name)) map.set(name, { name, tracks: [], count: 0 });
      const genre = map.get(name);
      genre.tracks.push(track);
      genre.count += 1;
    });
    derived.genres = Array.from(map.values()).sort((a, b) => U.byText(a.name, b.name));
    return derived.genres;
  }

  function favorites() {
    if (derived.favorites) return derived.favorites;
    derived.favorites = tracksByAdded().filter((track) => track.liked);
    return derived.favorites;
  }

  function history() {
    return state.history.slice();
  }

  function recentTrackFor(entry) {
    const local = state.trackById.get(entry.id);
    if (local) return local;
    if (entry.online && AM.Online && typeof AM.Online.getTrack === "function") {
      return AM.Online.getTrack(entry.id);
    }
    return null;
  }

  function recent() {
    if (derived.recent) return derived.recent;
    derived.recent = state.history.map(recentTrackFor).filter(Boolean);
    return derived.recent;
  }

  function recordHistory(track) {
    if (!track || !track.id) return null;
    const entry = historySnapshot(track, Date.now());
    state.history = [entry]
      .concat(state.history.filter((item) => item.id !== entry.id))
      .slice(0, HISTORY_MAX);
    invalidate();
    emit("historychange", { entry, history: state.history.slice() });
    store.put("history", entry).catch((error) => {
      console.warn("[library] gagal menyimpan riwayat:", error);
    });
    return entry;
  }

  async function clearHistory() {
    state.history = [];
    invalidate();
    try {
      if (state.storage === "indexeddb") {
        const tx = AM.DB.transaction("history", "readwrite");
        tx.objectStore("history").clear();
        await new Promise((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error || new Error("Gagal menghapus riwayat."));
        });
      } else {
        memory.history.clear();
      }
    } catch (error) {
      console.warn("[library] gagal menghapus riwayat:", error);
    }
    emit("historychange", { entry: null, history: [] });
    emit("change", { reason: "history-clear" });
  }

  function playlistTracks(playlist) {
    if (!playlist) return [];
    return getTracks(playlist.trackIds);
  }

  function getPlaylist(id) {
    return state.playlistById.get(id) || null;
  }

  function normalizePlaylist(playlist) {
    return Object.assign({}, playlist, {
      trackIds: Array.isArray(playlist.trackIds) ? playlist.trackIds.filter((id) => state.trackById.has(id)) : []
    });
  }

  function totalSize() {
    return state.tracks.reduce((sum, track) => sum + (track.size || 0), 0);
  }

  /* ------------------------------------------------------------------------
     Artwork & URL audio
     ------------------------------------------------------------------------ */

  function coverURL(coverId) {
    if (!coverId) return null;
    if (state.coverUrls.has(coverId)) return state.coverUrls.get(coverId);
    const cover = state.covers.get(coverId);
    if (!cover || !cover.blob) return null;
    const url = URL.createObjectURL(cover.blob);
    state.coverUrls.set(coverId, url);
    return url;
  }

  function artFor(seed, coverId, label) {
    return coverURL(coverId) || U.generatedArt(seed || label || "musik", { label: label || "" });
  }

  function trackArt(track) {
    if (!track) return U.generatedArt("musik", { label: "Musik" });
    if (typeof track.art === "string" && /^https?:\/\//i.test(track.art)) return track.art;
    return artFor(track.album || track.title, track.coverId, track.album || track.title);
  }

  function albumArt(album) {
    if (!album) return U.generatedArt("album", { label: "Album" });
    return artFor(album.key, album.coverId, album.name);
  }

  function artistArt(artist) {
    if (!artist) return U.generatedArt("artis", { label: "Artis" });
    return artFor(artist.key, artist.coverId, artist.name);
  }

  function playlistArt(playlist) {
    const tracks = playlistTracks(playlist).filter((track) => track.coverId);
    if (playlist && tracks.length) return coverURL(tracks[0].coverId);
    return U.generatedArt(playlist ? playlist.id : "playlist", {
      label: playlist ? playlist.name : "Playlist"
    });
  }

  async function getAudioURL(trackId) {
    if (state.audioUrls.has(trackId)) return state.audioUrls.get(trackId);
    const record = await store.get("files", trackId);
    if (!record || !record.blob) throw new Error("File audio tidak ditemukan.");
    const url = URL.createObjectURL(record.blob);
    state.audioUrls.set(trackId, url);
    return url;
  }

  function releaseAudioURL(trackId) {
    const url = state.audioUrls.get(trackId);
    if (!url) return;
    URL.revokeObjectURL(url);
    state.audioUrls.delete(trackId);
  }

  function isAudioFile(file) {
    if (!file) return false;
    const type = String(file.type || "").toLowerCase();
    if (type.indexOf("audio/") === 0) return true;
    const extension = String(file.name || "").split(".").pop().toLowerCase();
    return AUDIO_EXTENSIONS.includes(extension);
  }

  /* ------------------------------------------------------------------------
     Impor
     ------------------------------------------------------------------------ */

  async function importFiles(files, options) {
    const opts = options || {};
    const items = Array.from(files || []).map((file) => (file && file.file ? file : { file }));
    const valid = items.filter((item) => isAudioFile(item.file));
    const total = valid.length;
    const summary = {
      total,
      added: 0,
      skipped: 0,
      failed: 0,
      unsupported: items.length - total,
      errors: [],
      addedIds: [],
      existingIds: [],
      cancelled: false
    };

    if (!total) {
      emit("importdone", summary);
      return summary;
    }

    state.importing = true;
    emit("importstart", summary);

    // Sidik jari koleksi yang sudah ada, untuk cegah duplikat.
    // Nilai peta adalah id trek agar file duplikat tetap bisa ditambahkan
    // ke playlist tujuan tanpa membuat salinan di perpustakaan.
    const knownFingerprints = new Map();
    state.tracks.forEach((track) => {
      if (track.fingerprint) knownFingerprints.set(track.fingerprint, track.id);
    });

    for (let index = 0; index < total; index += 1) {
      if (opts.shouldCancel && opts.shouldCancel()) {
        summary.cancelled = true;
        break;
      }
      const item = valid[index];
      const file = item.file;
      try {
        emit("importprogress", {
          current: index + 1,
          total,
          name: file.name,
          stage: "Membaca metadata"
        });

        let metadata = item.meta || null;
        if (!metadata) {
          metadata = await AM.Metadata.parseFile(file);
        }
        metadata = Object.assign({}, metadata);

        const title = (metadata.title || "").trim() || "Lagu tanpa judul";
        const artist = (metadata.artist || "").trim() || "Artis tidak dikenal";
        const album = (metadata.album || "").trim();
        const albumArtist = (metadata.albumArtist || "").trim() || artist;
        const fingerprint = [
          file.name || "",
          file.size || 0,
          file.lastModified || 0,
          U.normalize(artist),
          U.normalize(title),
          U.normalize(album)
        ].join("|");

        if (knownFingerprints.has(fingerprint)) {
          summary.skipped += 1;
          const existingId = knownFingerprints.get(fingerprint);
          if (existingId && !summary.existingIds.includes(existingId)) {
            summary.existingIds.push(existingId);
          }
          emit("importprogress", {
            current: index + 1,
            total,
            name: file.name,
            stage: "Sudah ada — dilewati"
          });
          continue;
        }

        const now = Date.now();
        const trackId = U.uid("trk");
        let coverId = null;
        let coverRecord = null;

        if (metadata.cover && metadata.cover.blob && metadata.cover.blob.size > 0) {
          const blob = metadata.cover.blob;
          coverId =
            "cvr_" +
            U.hash(
              [U.normalize(albumArtist), U.normalize(album), blob.size, metadata.cover.mime || blob.type].join("|")
            ).toString(36);
          if (!state.covers.has(coverId)) {
            coverRecord = {
              id: coverId,
              blob,
              mime: metadata.cover.mime || blob.type || "image/jpeg",
              size: blob.size,
              createdAt: now
            };
          }
        }

        const track = hydrateTrack({
          id: trackId,
          title,
          artist,
          album,
          albumArtist,
          genre: (metadata.genre || "").trim(),
          year: U.parseYear(metadata.year),
          trackNo: Number(metadata.trackNo) || 0,
          discNo: Number(metadata.discNo) || 1,
          duration: Number(metadata.durationHint) || 0,
          fileName: file.name || title,
          fileType: file.type || "",
          size: file.size || 0,
          coverId,
          lyrics: metadata.lyrics || "",
          liked: false,
          playCount: 0,
          addedAt: now,
          updatedAt: now,
          fingerprint
        });

        const fileRecord = {
          id: trackId,
          blob: file,
          name: file.name || title,
          type: file.type || "",
          size: file.size || 0,
          lastModified: file.lastModified || now
        };

        emit("importprogress", {
          current: index + 1,
          total,
          name: file.name,
          stage: "Menyimpan ke perangkat"
        });

        await store.putMany("tracks", [track], {
          files: [fileRecord],
          covers: coverRecord ? [coverRecord] : []
        });

        state.tracks.push(track);
        state.trackById.set(trackId, track);
        if (coverRecord) state.covers.set(coverRecord.id, coverRecord);
        knownFingerprints.set(fingerprint, trackId);
        summary.added += 1;
        summary.addedIds.push(trackId);
      } catch (error) {
        console.error("[library] gagal mengimpor", file && file.name, error);
        summary.failed += 1;
        summary.errors.push({
          name: (file && file.name) || "File",
          message: error && error.message ? error.message : "Gagal diimpor"
        });
      }
    }

    state.importing = false;
    invalidate();
    emit("importdone", summary);
    emit("change", { reason: "import", summary });

    if (summary.added) {
      ensureDurations();
    }

    return summary;
  }

  async function importDemo() {
    if (typeof AM.Demo === "undefined") {
      throw new Error("Modul demo tidak tersedia.");
    }
    emit("demo-start", {});
    const items = await AM.Demo.generate((index, total, spec) => {
      emit("demo-progress", {
        current: index + 1,
        total,
        name: spec.title
      });
    });
    const summary = await importFiles(items, {});
    if (summary.added) {
      await setSetting("demoLoaded", true);
    }
    emit("demo-done", summary);
    return summary;
  }

  /* ------------------------------------------------------------------------
     Durasi (dibaca dari elemen audio untuk file tanpa metadata durasi)
     ------------------------------------------------------------------------ */

  function detectDuration(track) {
    return new Promise((resolve) => {
      let settled = false;
      let url = null;
      const audio = document.createElement("audio");
      const finish = (value) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        audio.removeAttribute("src");
        audio.load();
        if (url) URL.revokeObjectURL(url);
        resolve(value);
      };
      const timeout = window.setTimeout(() => finish(0), 8000);
      audio.preload = "metadata";
      audio.addEventListener("loadedmetadata", () => {
        const value = Number(audio.duration);
        finish(Number.isFinite(value) && value > 0 ? value : 0);
      });
      audio.addEventListener("error", () => finish(0));
      store
        .get("files", track.id)
        .then((record) => {
          if (!record || !record.blob) {
            finish(0);
            return;
          }
          url = URL.createObjectURL(record.blob);
          audio.src = url;
        })
        .catch(() => finish(0));
    });
  }

  async function updateTrackDuration(trackId, duration) {
    const track = state.trackById.get(trackId);
    const value = Number(duration);
    if (!track || !Number.isFinite(value) || value <= 0) return false;
    const rounded = Math.round(value * 1000) / 1000;
    if (track.duration > 0 && Math.abs(track.duration - rounded) < 0.05) return false;
    track.duration = rounded;
    track.updatedAt = Date.now();
    invalidate();
    emit("trackupdate", { track });
    try {
      await store.put("tracks", track);
    } catch (error) {
      console.warn("[library] gagal menyimpan durasi", error);
    }
    return true;
  }

  async function ensureDurations() {
    if (state.durationQueue) return state.durationQueue;
    state.durationQueue = (async () => {
      const pending = state.tracks.filter((track) => !(track.duration > 0));
      for (let index = 0; index < pending.length; index += 1) {
        const track = pending[index];
        if (!track || !state.trackById.has(track.id)) continue;
        // eslint-disable-next-line no-await-in-loop
        const duration = await detectDuration(track);
        if (duration > 0 && state.trackById.has(track.id)) {
          // eslint-disable-next-line no-await-in-loop
          await updateTrackDuration(track.id, duration);
        }
      }
      state.durationQueue = null;
      emit("durationsdone", {});
      emit("change", { reason: "durations" });
    })();
    return state.durationQueue;
  }

  /* ------------------------------------------------------------------------
     Favorit, putar, riwayat
     ------------------------------------------------------------------------ */

  async function toggleFavorite(trackId) {
    const track = state.trackById.get(trackId);
    if (!track) return false;
    track.liked = !track.liked;
    track.updatedAt = Date.now();
    invalidate();
    emit("trackupdate", { track });
    emit("change", { reason: "favorite", trackId });
    try {
      await store.put("tracks", track);
    } catch (error) {
      console.warn("[library] gagal menyimpan favorit", error);
    }
    return track.liked;
  }

  function markPlayed(trackId) {
    const track = state.trackById.get(trackId);
    if (!track) return;
    track.playCount = (track.playCount || 0) + 1;
    track.lastPlayedAt = Date.now();
    track.updatedAt = track.lastPlayedAt;
    invalidate();
    emit("trackupdate", { track });
    store.put("tracks", track).catch(() => {});
  }

  async function updateTrack(trackId, patch) {
    const track = state.trackById.get(trackId);
    if (!track) return null;
    const next = hydrateTrack(Object.assign({}, track, patch, { updatedAt: Date.now() }));
    next.albumKey = albumKeyOf(next.albumArtist, next.album);
    next.artistKey = artistKeyOf(next.artist);
    state.trackById.set(trackId, next);
    const index = state.tracks.findIndex((item) => item.id === trackId);
    if (index >= 0) state.tracks[index] = next;
    invalidate();
    await store.put("tracks", next);
    emit("trackupdate", { track: next });
    emit("change", { reason: "update", trackId });
    return next;
  }

  /* ------------------------------------------------------------------------
     Hapus trek
     ------------------------------------------------------------------------ */

  async function removeTracks(ids) {
    const unique = Array.from(new Set(ids || [])).filter((id) => state.trackById.has(id));
    if (!unique.length) return 0;

    const coversToCheck = new Set();
    unique.forEach((id) => {
      const track = state.trackById.get(id);
      if (track && track.coverId) coversToCheck.add(track.coverId);
      releaseAudioURL(id);
    });

    state.tracks = state.tracks.filter((track) => !unique.includes(track.id));
    unique.forEach((id) => state.trackById.delete(id));

    const touchedPlaylists = [];
    state.playlists.forEach((playlist) => {
      const before = playlist.trackIds.length;
      playlist.trackIds = playlist.trackIds.filter((id) => !unique.includes(id));
      if (playlist.trackIds.length !== before) {
        playlist.updatedAt = Date.now();
        touchedPlaylists.push(playlist);
      }
    });

    invalidate();
    emit("tracksremoved", { ids: unique });
    emit("change", { reason: "remove", ids: unique });

    const coverKeys = [];
    coversToCheck.forEach((coverId) => {
      const stillUsed = state.tracks.some((track) => track.coverId === coverId);
      if (!stillUsed) {
        coverKeys.push(coverId);
        const url = state.coverUrls.get(coverId);
        if (url) URL.revokeObjectURL(url);
        state.coverUrls.delete(coverId);
        state.covers.delete(coverId);
      }
    });

    try {
      const entries = [["tracks", unique], ["files", unique], ["covers", coverKeys]];
      if (touchedPlaylists.length) {
        await store.putMany("playlists", touchedPlaylists, {});
      }
      await store.removeMany(entries);
    } catch (error) {
      console.warn("[library] gagal menghapus trek", error);
    }

    return unique.length;
  }

  /* ------------------------------------------------------------------------
     Playlist
     ------------------------------------------------------------------------ */

  function createPlaylist(name, trackIds, description) {
    const cleanName = String(name || "").trim() || "Playlist baru";
    const now = Date.now();
    const playlist = {
      id: U.uid("pl"),
      name: cleanName,
      description: String(description || "").trim(),
      trackIds: Array.from(new Set(trackIds || [])).filter((id) => state.trackById.has(id)),
      createdAt: now,
      updatedAt: now
    };
    state.playlists.unshift(playlist);
    state.playlistById.set(playlist.id, playlist);
    store.put("playlists", playlist).catch((error) => {
      console.warn("[library] gagal menyimpan playlist", error);
    });
    emit("playlistschange", { playlist });
    emit("change", { reason: "playlist", playlistId: playlist.id });
    return playlist;
  }

  async function updatePlaylist(playlistId, patch) {
    const playlist = state.playlistById.get(playlistId);
    if (!playlist) return null;
    if (typeof patch.name === "string") {
      const name = patch.name.trim();
      if (name) playlist.name = name;
    }
    if (typeof patch.description === "string") playlist.description = patch.description.trim();
    if (Array.isArray(patch.trackIds)) {
      playlist.trackIds = Array.from(new Set(patch.trackIds)).filter((id) => state.trackById.has(id));
    }
    playlist.updatedAt = Date.now();
    try {
      await store.put("playlists", playlist);
    } catch (error) {
      console.warn("[library] gagal menyimpan playlist", error);
    }
    emit("playlistschange", { playlist });
    emit("change", { reason: "playlist", playlistId });
    return playlist;
  }

  async function deletePlaylist(playlistId) {
    const playlist = state.playlistById.get(playlistId);
    if (!playlist) return false;
    state.playlists = state.playlists.filter((item) => item.id !== playlistId);
    state.playlistById.delete(playlistId);
    try {
      await store.removeMany([["playlists", [playlistId]]]);
    } catch (error) {
      console.warn("[library] gagal menghapus playlist", error);
    }
    emit("playlistschange", { playlist });
    emit("change", { reason: "playlist-delete", playlistId });
    return true;
  }

  async function addToPlaylist(playlistId, trackIds) {
    const playlist = state.playlistById.get(playlistId);
    if (!playlist) return 0;
    const existing = new Set(playlist.trackIds);
    let added = 0;
    Array.from(trackIds || []).forEach((id) => {
      if (state.trackById.has(id) && !existing.has(id)) {
        playlist.trackIds.push(id);
        existing.add(id);
        added += 1;
      }
    });
    if (added) {
      playlist.updatedAt = Date.now();
      await store.put("playlists", playlist).catch(() => {});
      emit("playlistschange", { playlist });
      emit("change", { reason: "playlist-tracks", playlistId });
    }
    return added;
  }

  async function removeFromPlaylist(playlistId, trackIds) {
    const playlist = state.playlistById.get(playlistId);
    if (!playlist) return 0;
    const remove = new Set(trackIds || []);
    const before = playlist.trackIds.length;
    playlist.trackIds = playlist.trackIds.filter((id) => !remove.has(id));
    const removed = before - playlist.trackIds.length;
    if (removed) {
      playlist.updatedAt = Date.now();
      await store.put("playlists", playlist).catch(() => {});
      emit("playlistschange", { playlist });
      emit("change", { reason: "playlist-tracks", playlistId });
    }
    return removed;
  }

  async function reorderPlaylist(playlistId, fromIndex, toIndex) {
    const playlist = state.playlistById.get(playlistId);
    if (!playlist) return;
    const ids = playlist.trackIds.slice();
    if (fromIndex < 0 || fromIndex >= ids.length || toIndex < 0 || toIndex >= ids.length) return;
    const [moved] = ids.splice(fromIndex, 1);
    ids.splice(toIndex, 0, moved);
    playlist.trackIds = ids;
    playlist.updatedAt = Date.now();
    await store.put("playlists", playlist).catch(() => {});
    emit("playlistschange", { playlist });
    emit("change", { reason: "playlist-order", playlistId });
  }

  /* ------------------------------------------------------------------------
     Pencarian
     ------------------------------------------------------------------------ */

  function search(query, limit) {
    const max = limit || 24;
    const raw = String(query || "").trim();
    const normalized = U.normalize(raw);
    const result = {
      query: raw,
      tracks: [],
      albums: [],
      artists: [],
      playlists: [],
      total: 0
    };
    if (!normalized) return result;
    const tokens = normalized.split(/\s+/).filter(Boolean);

    function score(text, weights) {
      const value = U.normalize(text);
      if (!value) return 0;
      let total = 0;
      tokens.forEach((token) => {
        const index = value.indexOf(token);
        if (index < 0) return;
        let points = weights;
        if (value === token) points += weights * 1.6;
        else if (index === 0) points += weights * 0.7;
        total += points;
      });
      return total;
    }

    const trackScores = [];
    state.tracks.forEach((track) => {
      let value = score(track.title, 6) + score(track.artist, 3) + score(track.album, 2);
      if (track.genre) value += score(track.genre, 1);
      if (value > 0) trackScores.push({ track, score: value });
    });
    trackScores.sort((a, b) => b.score - a.score || U.byText(a.track.title, b.track.title));
    result.tracks = trackScores.slice(0, max).map((entry) => entry.track);

    const albumScores = [];
    albums().forEach((album) => {
      const value = score(album.name, 5) + score(album.artist, 3);
      if (value > 0) albumScores.push({ album, score: value });
    });
    albumScores.sort((a, b) => b.score - a.score || U.byText(a.album.name, b.album.name));
    result.albums = albumScores.slice(0, max).map((entry) => entry.album);

    const artistScores = [];
    artists().forEach((artist) => {
      const value = score(artist.name, 5);
      if (value > 0) artistScores.push({ artist, score: value });
    });
    artistScores.sort((a, b) => b.score - a.score || U.byText(a.artist.name, b.artist.name));
    result.artists = artistScores.slice(0, max).map((entry) => entry.artist);

    const playlistScores = [];
    state.playlists.forEach((playlist) => {
      const value = score(playlist.name, 5) + score(playlist.description, 1);
      if (value > 0) playlistScores.push({ playlist, score: value });
    });
    playlistScores.sort((a, b) => b.score - a.score || U.byText(a.playlist.name, b.playlist.name));
    result.playlists = playlistScores.slice(0, max).map((entry) => entry.playlist);

    result.total =
      result.tracks.length + result.albums.length + result.artists.length + result.playlists.length;
    return result;
  }

  /* ------------------------------------------------------------------------
     Pengaturan
     ------------------------------------------------------------------------ */

  function getSetting(key, fallback) {
    const value = state.settings[key];
    return value === undefined ? fallback : value;
  }

  async function setSetting(key, value) {
    state.settings[key] = value;
    emit("setting", { key, value });
    try {
      await store.put("settings", { key, value });
    } catch (error) {
      console.warn("[library] gagal menyimpan pengaturan", error);
    }
    return value;
  }

  async function clearLibrary() {
    state.tracks = [];
    state.trackById.clear();
    state.playlists = [];
    state.playlistById.clear();
    state.history = [];
    state.covers.clear();
    state.coverUrls.forEach((url) => URL.revokeObjectURL(url));
    state.coverUrls.clear();
    state.audioUrls.forEach((url) => URL.revokeObjectURL(url));
    state.audioUrls.clear();
    invalidate();
    try {
      await store.clearAll();
    } catch (error) {
      console.warn("[library] gagal membersihkan basis data", error);
    }
    // Pertahankan tema, volume, dan pengaturan tampilan setelah reset data.
    for (const key of ["theme", "volume", "muted"]) {
      try {
        await store.put("settings", { key, value: state.settings[key] });
      } catch (error) {
        /* diabaikan */
      }
    }
    state.settings.demoLoaded = false;
    try {
      await store.put("settings", { key: "demoLoaded", value: false });
    } catch (error) {
      /* diabaikan */
    }
    emit("change", { reason: "clear" });
    emit("playlistschange", {});
  }

  AM.Library = {
    init,
    on,
    emit,
    state,
    getTrack,
    getTracks,
    allTracks,
    tracksByAdded,
    tracksAlphabetical,
    albums,
    getAlbum,
    artists,
    getArtist,
    genres,
    favorites,
    recent,
    history,
    recordHistory,
    clearHistory,
    playlistTracks,
    getPlaylist,
    totalSize,
    coverURL,
    artFor,
    trackArt,
    albumArt,
    artistArt,
    playlistArt,
    getAudioURL,
    isAudioFile,
    importFiles,
    importDemo,
    ensureDurations,
    updateTrackDuration,
    toggleFavorite,
    markPlayed,
    updateTrack,
    removeTracks,
    createPlaylist,
    updatePlaylist,
    deletePlaylist,
    addToPlaylist,
    removeFromPlaylist,
    reorderPlaylist,
    search,
    getSetting,
    setSetting,
    clearLibrary,
    albumKeyOf,
    artistKeyOf,
    invalidate
  };
})(window.AM = window.AM || {});
