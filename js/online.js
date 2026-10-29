/* ==========================================================================
   online.js — musik online tanpa API key
   Sumber: YouTube — cari lagu dengan kata kunci, atau tempel tautan video.
   Pemutaran memakai URL audio yang disiapkan yt-dlp melalui server aplikasi.
   ========================================================================== */

(function (AM) {
  "use strict";

  const CACHE_TTL = 5 * 60 * 1000;
  const REQUEST_TIMEOUT = 16000;
  const MAX_TRACKS = 3000;
  const LIKES_KEY = "musik.online.likes.v1";
  const LIKES_MAX = 500;

  const state = {
    provider: "youtube",
    query: "",
    mode: "intro",
    status: "idle",
    error: "",
    errorKind: "",
    results: [],
    resultKey: "",
    lastUpdated: 0,
    token: 0,
    audioPrefetchToken: 0,
    pending: null,
    controller: null
  };

  const tracks = new Map();
  const resultSets = new Map();
  const cache = new Map();
  const listeners = new Map();
  const likedMap = new Map();
  let likedOrder = [];

  /* ------------------------------------------------------------------------
     Event & helper
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
        console.error("[online] listener error:", error);
      }
    });
  }

  function normalizeProvider(value) {
    return "youtube";
  }

  function cleanQuery(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80);
  }

  function keyFor(provider, query) {
    return normalizeProvider(provider) + "|" + cleanQuery(query).toLowerCase();
  }

  function providerLabel() {
    return "YouTube";
  }

  function rememberTrack(track) {
    if (!track || !track.id) return;
    track.liked = likedMap.has(track.id);
    tracks.set(track.id, track);
    if (tracks.size > MAX_TRACKS) {
      const first = tracks.keys().next();
      if (!first.done) tracks.delete(first.value);
    }
  }

  /* ------------------------------------------------------------------------
     Lagu Suka dari internet
     Disimpan terpisah dari favorit perpustakaan lokal dan bertahan setelah
     halaman dimuat ulang. Data lagu ikut disimpan agar bisa diputar lagi.
     ------------------------------------------------------------------------ */

  function plainTrack(track) {
    if (!track || !track.id) return null;
    return {
      id: track.id,
      online: true,
      provider: track.provider || "youtube",
      providerLabel: track.providerLabel || providerLabel(track.provider),
      sourceId: track.sourceId || "",
      title: track.title || "YouTube",
      artist: track.artist || "YouTube",
      album: track.album || "YouTube",
      duration: Math.max(0, Math.round(Number(track.duration) || 0)),
      art: track.art || "",
      externalUrl: track.externalUrl || "",
      candidates: Array.isArray(track.candidates) ? track.candidates.slice(0, 6) : []
    };
  }

  function loadLikes() {
    try {
      const raw = window.localStorage.getItem(LIKES_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      const list = Array.isArray(data)
        ? data
        : data && Array.isArray(data.tracks)
          ? data.tracks
          : [];
      list.slice(0, LIKES_MAX).forEach((saved) => {
        const clean = plainTrack(saved);
        if (!clean || !isOnlineId(clean.id)) return;
        if (likedMap.has(clean.id)) return;
        clean.liked = true;
        likedMap.set(clean.id, clean);
        likedOrder.push(clean.id);
        rememberTrack(clean);
      });
    } catch (error) {
      console.warn("[online] gagal memuat lagu suka:", error);
    }
  }

  function persistLikes() {
    try {
      const list = likedOrder
        .map((id) => {
          const live = tracks.get(id);
          return plainTrack(live || likedMap.get(id));
        })
        .filter(Boolean);
      window.localStorage.setItem(
        LIKES_KEY,
        JSON.stringify({ version: 1, tracks: list })
      );
    } catch (error) {
      console.warn("[online] gagal menyimpan lagu suka:", error);
    }
  }

  function isLiked(id) {
    return !!id && likedMap.has(String(id));
  }

  function likedTracks() {
    return likedOrder
      .map((id) => {
        const live = tracks.get(id);
        if (live) {
          live.liked = true;
          return live;
        }
        return likedMap.get(id) || null;
      })
      .filter(Boolean);
  }

  function likedTrackIds() {
    return likedOrder.slice();
  }

  function toggleLike(input) {
    const id = typeof input === "string" ? input : input && input.id;
    if (!id || !isOnlineId(id)) return false;
    const source =
      (input && typeof input === "object" ? input : null) ||
      tracks.get(id) ||
      likedMap.get(id);
    if (!source) return false;

    const nowLiked = !likedMap.has(id);
    if (nowLiked) {
      const saved = plainTrack(source);
      if (!saved) return false;
      saved.liked = true;
      likedMap.set(id, saved);
      likedOrder = [id].concat(likedOrder.filter((item) => item !== id)).slice(0, LIKES_MAX);
      source.liked = true;
      source.online = true;
      tracks.set(id, source);
    } else {
      likedMap.delete(id);
      likedOrder = likedOrder.filter((item) => item !== id);
      source.liked = false;
    }

    persistLikes();
    emit("likeschange", { id, liked: nowLiked, track: source });
    return nowLiked;
  }

  function rememberResultSet(provider, query, list) {
    const key = keyFor(provider, query);
    resultSets.set(key, {
      provider: normalizeProvider(provider),
      query: cleanQuery(query),
      ids: (list || []).map((track) => track.id),
      at: Date.now()
    });
    if (resultSets.size > 40) {
      const first = resultSets.keys().next();
      if (!first.done) resultSets.delete(first.value);
    }
  }

  /* ------------------------------------------------------------------------
     Jaringan
     ------------------------------------------------------------------------ */

  function isLinkInput(value) {
    const text = String(value || "").trim();
    return !!(
      AM.Youtube &&
      AM.Youtube.extractVideoId(text)
    );
  }

  async function fetchYouTube(query, signal) {
    if (!AM.Youtube) {
      throw new Error("Modul YouTube belum siap. Muat ulang halaman.");
    }
    // Tautan / ID video → ambil metadata video itu.
    if (isLinkInput(query)) {
      const track = await AM.Youtube.resolve(query, { signal });
      if (!track) {
        throw Object.assign(
          new Error("Video tidak ditemukan, privat, atau embed-nya dinonaktifkan. Coba tautan lain."),
          { youtubeHint: true }
        );
      }
      return AM.Youtube.sessionTracks();
    }
    // Kata kunci → cari lagu di YouTube.
    return AM.Youtube.search(query);
  }

  function applyResultSet(provider, query, list, mode) {
    state.provider = normalizeProvider(provider);
    state.query = cleanQuery(query);
    state.mode = mode || (state.query ? "search" : "intro");
    state.results = list.slice();
    prefetchFirstTrack(state.results);
    state.lastUpdated = Date.now();
    state.error = "";
    state.errorKind = "";
    state.status = "ready";
    rememberResultSet(state.provider, state.query, list);
    return snapshot();
  }

  function prefetchFirstTrack(list) {
    if (!AM.Youtube) return;
    const token = ++state.audioPrefetchToken;
    const tracks = (list || [])
      .slice(0, 10)
      .filter((track) => track && track.sourceId);
    let index = 0;

    async function prefetchWorker() {
      while (token === state.audioPrefetchToken && index < tracks.length) {
        const track = tracks[index++];
        try {
          await AM.Youtube.resolveAudio(track.sourceId);
        } catch (error) {
          console.warn("[online] gagal menyiapkan audio:", error);
        }
      }
    }

    prefetchWorker();
    prefetchWorker();
  }

  function cachedResult(provider, query) {
    const key = keyFor(provider, query);
    const entry = cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.at > CACHE_TTL) {
      cache.delete(key);
      return null;
    }
    return entry;
  }

  /* ------------------------------------------------------------------------
     Memuat & mencari
     ------------------------------------------------------------------------ */

  function prepare(provider, query, options) {
    const opts = options || {};
    const nextProvider = normalizeProvider(provider);
    const nextQuery = cleanQuery(query);
    const key = keyFor(nextProvider, nextQuery);

    state.provider = nextProvider;
    state.query = nextQuery;

    if (
      !opts.force &&
      state.resultKey === key &&
      state.status === "loading" &&
      state.pending
    ) {
      return state.pending;
    }

    if (
      !opts.force &&
      state.resultKey === key &&
      state.status === "ready" &&
      state.provider === nextProvider &&
      state.query === nextQuery
    ) {
      return Promise.resolve(snapshot());
    }

    state.audioPrefetchToken += 1;
    if (state.controller) {
      try {
        state.controller.abort();
      } catch (error) {
        /* Abaikan. */
      }
    }
    state.pending = null;
    state.controller = null;

    if (!nextQuery) {
      state.token += 1;
      state.resultKey = key;
      state.mode = "intro";
      state.status = "ready";
      state.error = "";
      state.errorKind = "";
      state.lastUpdated = Date.now();
      state.results = [];
      rememberResultSet(nextProvider, nextQuery, []);
      const value = snapshot();
      emit("change", value);
      return Promise.resolve(value);
    }

    const cacheable = !isLinkInput(nextQuery);
    const cached = cacheable ? cachedResult(nextProvider, nextQuery) : null;
    if (cached) {
      state.token += 1;
      state.resultKey = key;
      const value = applyResultSet(
        nextProvider,
        nextQuery,
        cached.tracks,
        nextQuery ? "search" : "trending"
      );
      emit("change", value);
      return Promise.resolve(value);
    }

    state.token += 1;
    const token = state.token;
    state.resultKey = key;
    state.mode = "search";
    state.status = "loading";
    state.error = "";
    state.errorKind = "";
    state.results = [];
    state.lastUpdated = 0;
    emit("change", snapshot());

    const controller = new AbortController();
    state.controller = controller;
    let timedOut = false;
    const timer = window.setTimeout(() => {
      timedOut = true;
      try {
        controller.abort();
      } catch (error) {
        /* Abaikan. */
      }
    }, REQUEST_TIMEOUT);

    const promise = (async function run() {
      try {
        const list = await fetchYouTube(nextQuery, controller.signal);

        if (token !== state.token) return snapshot();

        state.status = "ready";
        state.error = "";
        state.errorKind = "";
        state.lastUpdated = Date.now();
        state.results = list;
        prefetchFirstTrack(list);
        rememberResultSet(nextProvider, nextQuery, list);
        if (cacheable) {
          cache.set(key, { at: Date.now(), tracks: list.slice() });
        }

        const value = snapshot();
        emit("change", value);
        return value;
      } catch (error) {
        if (token !== state.token) return snapshot();
        state.status = "error";
        state.results = [];
        state.lastUpdated = 0;
        state.errorKind =
          error && (error.youtubeHint ? "hint" : error.youtubeNetwork ? "network" : "generic");
        state.error = friendlyError(nextProvider, error, timedOut);
        console.warn("[online] gagal memuat " + nextProvider + ":", error);
        const value = snapshot();
        emit("change", value);
        return value;
      } finally {
        window.clearTimeout(timer);
        if (token === state.token) {
          state.pending = null;
          state.controller = null;
        }
      }
    })();

    state.pending = promise;
    return promise;
  }

  function friendlyError(provider, error, timedOut) {
    if (error && (error.youtubeHint || error.youtubeNetwork)) {
      return error.message;
    }
    if (timedOut) {
      return "Permintaan memakan waktu terlalu lama. Periksa koneksi internet lalu coba lagi.";
    }
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      return "Kamu sedang offline. Sambungkan internet untuk memutar musik online.";
    }
    if (error && error.name === "AbortError") {
      return "Permintaan dibatalkan.";
    }
    return (
      "Tidak dapat terhubung ke " +
      providerLabel(provider) +
      ". Periksa koneksi internet atau coba lagi beberapa saat lagi."
    );
  }

  function retry() {
    return prepare(state.provider, state.query, { force: true });
  }

  /* ------------------------------------------------------------------------
     Akses data
     ------------------------------------------------------------------------ */

  function snapshot() {
    return {
      provider: state.provider,
      query: state.query,
      mode: state.mode,
      status: state.status,
      error: state.error,
      errorKind: state.errorKind || "",
      results: state.results.slice(),
      total: state.results.length,
      lastUpdated: state.lastUpdated
    };
  }

  function remember(track) {
    rememberTrack(track);
  }

  function getTrack(id) {
    if (!id) return null;
    return tracks.get(String(id)) || null;
  }

  function isOnlineId(id) {
    return /^youtube:|^itunes:|^audius:/.test(String(id || ""));
  }

  function getStreamURL(track) {
    if (!track || !track.online) {
      return Promise.reject(new Error("Bukan lagu online."));
    }
    if (!track.streamUrl) {
      return Promise.reject(new Error("Tautan streaming tidak tersedia."));
    }
    return Promise.resolve(track.streamUrl);
  }

  function idsForQueue(queue) {
    const provider = normalizeProvider(queue && queue.provider);
    const query = cleanQuery(queue && queue.query);
    const key = keyFor(provider, query);
    const set = resultSets.get(key);
    if (set) return set.ids.slice();
    if (state.provider === provider && state.query === query) {
      return state.results.map((track) => track.id);
    }
    return [];
  }

  loadLikes();

  AM.Online = {
    prepare,
    retry,
    snapshot,
    getSnapshot: snapshot,
    getTrack,
    isOnlineId,
    getStreamURL,
    idsForQueue,
    providerLabel,
    remember,
    on,
    toggleLike,
    isLiked,
    likedTracks,
    likedTrackIds,
    likesCount: () => likedOrder.length
  };
})(window.AM = window.AM || {});
