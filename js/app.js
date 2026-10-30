/* ==========================================================================
   app.js — bootstrap, router, aksi UI, impor, playlist, pengaturan
   ========================================================================== */

(function (AM) {
  "use strict";

  const U = AM.Utils;
  const L = AM.Library;
  const O = AM.Online;
  const P = AM.Player;
  const UI = AM.UI;

  const KNOWN_ROUTES = new Set([
    "home",
    "browse",
    "radio",
    "recent",
    "settings",
    "artists",
    "albums",
    "songs",
    "favorites",
    "search",
    "album",
    "artist",
    "playlist",
    "genre",
    "notfound"
  ]);

  const KEYED_ROUTES = new Set(["album", "artist", "playlist", "genre"]);
  const NAV_FOR_ROUTE = {
    home: "home",
    browse: "browse",
    radio: "radio",
    recent: "recent",
    settings: "settings",
    artists: "artists",
    albums: "albums",
    songs: "songs",
    favorites: "favorites",
    album: "albums",
    artist: "artists",
    genre: "browse"
  };

  const AUDIO_QUALITIES = [
    { id: "low", label: "Hemat", hint: "hingga 96 kbps" },
    { id: "medium", label: "Standar", hint: "hingga 128 kbps" },
    { id: "high", label: "Tinggi", hint: "hingga 192 kbps" },
    { id: "best", label: "Terbaik", hint: "audio sumber" }
  ];

  function qualitySegmented(action, current, extra) {
    return (
      '<div class="segmented segmented--wrap">' +
      AUDIO_QUALITIES.map(
        (quality) =>
          '<button class="segmented__btn' +
          (quality.id === current ? " is-active" : "") +
          '" type="button" data-action="' +
          action +
          '" data-value="' +
          quality.id +
          '" title="' +
          quality.hint +
          '">' +
          quality.label +
          "</button>"
      ).join("") +
      (extra || "") +
      "</div>"
    );
  }

  const els = {};
  const state = {
    booted: false,
    currentRoute: null,
    viewTitle: "Dengarkan Sekarang",
    history: [],
    historyIndex: 0,
    queueOpen: false,
    dragDepth: 0,
    activeImportModal: null,
    importJob: null,
    importPlaylistId: "",
    suppressRefresh: false,
    blockedNotified: false,
    searchTimer: 0,
    searchOnlineTimer: 0,
    lyricsOpen: false,
    lyricsActiveIndex: -1,
    youtubeFailedIds: new Set(),
    youtubeSkipTimer: 0
  };

  /* ------------------------------------------------------------------------
     Helper
     ------------------------------------------------------------------------ */

  function $(selector, root) {
    return (root || document).querySelector(selector);
  }

  function $$(selector, root) {
    return Array.from((root || document).querySelectorAll(selector));
  }

  function icon(name, className) {
    return U.svgIcon(name, className);
  }

  function toast(message, options) {
    return UI.toast(message, options);
  }

  function normalizeHash(hash) {
    const value = String(hash || "").trim();
    if (!value || value === "#" || value === "#/" || !value.startsWith("#/")) return "#/home";
    return value;
  }

  function parseHash(hash) {
    const raw = String(hash || "").replace(/^#\/?/, "");
    if (!raw) return { name: "home", params: {}, query: {}, raw: "#/home" };

    const queryIndex = raw.indexOf("?");
    const pathPart = queryIndex >= 0 ? raw.slice(0, queryIndex) : raw;
    const queryPart = queryIndex >= 0 ? raw.slice(queryIndex + 1) : "";
    let segments;
    try {
      segments = pathPart.split("/").filter(Boolean).map((part) => decodeURIComponent(part));
    } catch (error) {
      segments = pathPart.split("/").filter(Boolean);
    }

    const query = {};
    try {
      new URLSearchParams(queryPart).forEach((value, key) => {
        query[key] = value;
      });
    } catch (error) {
      /* Query tidak valid — abaikan. */
    }

    const requested = segments[0] || "home";
    const name = KNOWN_ROUTES.has(requested) ? requested : "notfound";
    const params = {};
    if (KEYED_ROUTES.has(name) && segments.length > 1) {
      params.key = segments.slice(1).join("/");
    }

    return { name, params, query, raw: "#/" + raw };
  }

  function buildHash(route, query) {
    const name = route.name || "home";
    let hash = "#/" + name;
    if (KEYED_ROUTES.has(name) && route.params && route.params.key != null) {
      hash += "/" + encodeURIComponent(route.params.key);
    }
    const params = new URLSearchParams();
    Object.keys(query || {}).forEach((key) => {
      const value = query[key];
      if (value !== undefined && value !== null && String(value) !== "") {
        params.set(key, String(value));
      }
    });
    const queryString = params.toString();
    if (queryString) hash += "?" + queryString;
    return hash;
  }

  function routePath(route) {
    return buildHash(route, route.query || {});
  }

  function cacheElements() {
    els.sidebar = $("#sidebar");
    els.sidebarScrim = $("#sidebarScrim");
    els.sidebarClose = $("#sidebarClose");
    els.sidebarSearch = $("#sidebarSearch");
    els.sidebarPlaylists = $("#sidebarPlaylists");
    els.sidebarNewPlaylist = $("#sidebarNewPlaylist");
    els.sidebarImport = $("#sidebarImport");
    els.storageInfo = $("#storageInfo");
    els.menuBtn = $("#menuBtn");
    els.backBtn = $("#backBtn");
    els.forwardBtn = $("#forwardBtn");
    els.topbar = $(".topbar");
    els.topbarTitle = $("#topbarTitle");
    els.topbarSearch = $("#topbarSearch");
    els.topbarQueue = $("#topbarQueue");
    els.topbarImport = $("#topbarImport");
    els.themeToggle = $("#themeToggle");
    els.view = $("#view");
    els.audio = $("#audio");

    els.playerArt = $("#playerArt");
    els.playerArtButton = $("#playerArtButton");
    els.playerTitle = $("#playerTitle");
    els.playerArtist = $("#playerArtist");
    els.playerLike = $("#playerLike");
    els.playerDownload = $("#playerDownload");
    els.btnShuffle = $("#btnShuffle");
    els.btnPrev = $("#btnPrev");
    els.btnPlay = $("#btnPlay");
    els.btnNext = $("#btnNext");
    els.btnRepeat = $("#btnRepeat");
    els.repeatOneBadge = $("#repeatOneBadge");
    els.curTime = $("#curTime");
    els.durTime = $("#durTime");
    els.seek = $("#seek");
    els.seekFill = $("#seekFill");
    els.seekBuffer = $("#seekBuffer");
    els.seekThumb = $("#seekThumb");
    els.volume = $("#volume");
    els.volumeFill = $("#volumeFill");
    els.volumeThumb = $("#volumeThumb");
    els.btnMute = $("#btnMute");
    els.btnSleep = $("#btnSleep");
    els.sleepTime = $("#sleepTime");
    els.btnQueue = $("#btnQueue");

    els.queuePanel = $("#queuePanel");
    els.queueBody = $("#queueBody");
    els.queueClose = $("#queueClose");
    els.queueClear = $("#queueClear");
    els.queueCount = $("#queueCount");

    els.lyricsPanel = $("#lyricsPanel");
    els.lyricsBody = $("#lyricsBody");
    els.lyricsTitle = $("#lyricsTitle");
    els.lyricsMeta = $("#lyricsMeta");
    els.lyricsHint = $("#lyricsHint");
    els.lyricsClose = $("#lyricsClose");
    els.btnLyrics = $("#btnLyrics");
    els.topbarLyrics = $("#topbarLyrics");

    els.modalRoot = $("#modalRoot");
    els.menuRoot = $("#menuRoot");
    els.toasts = $("#toasts");
    els.dropOverlay = $("#dropOverlay");
    els.fileInput = $("#fileInput");
    els.folderInput = $("#folderInput");
  }

  /* ------------------------------------------------------------------------
     Boot
     ------------------------------------------------------------------------ */

  async function boot() {
    if (state.booted) return;
    state.booted = true;
    cacheElements();
    bindChrome();
    bindDelegatedActions();
    bindKeyboard();
    bindPlayerEvents();
    bindOnlineEvents();
    bindHomeEvents();
    bindPlayerControls();
    initHistory();

    if (els.view) {
      els.view.innerHTML =
        '<div class="page"><div class="empty"><span class="empty__icon">' +
        icon("music") +
        '</span><h2>Memuat perpustakaan…</h2><p>Menyiapkan koleksi musikmu.</p></div></div>';
    }

    try {
      await L.init();
    } catch (error) {
      console.error("[app] gagal memuat perpustakaan:", error);
      toast("Gagal memuat perpustakaan. Coba muat ulang halaman.", { type: "error", duration: 8000 });
    }

    applyTheme(L.getSetting("theme", "dark"), false);
    P.init();
    if (AM.Youtube && typeof AM.Youtube.checkLocalResolver === "function") {
      AM.Youtube.checkLocalResolver().then((available) => {
        if (!available) {
          toast(
            "yt-dlp.exe tidak ditemukan — lagu YouTube tidak bisa diputar.",
            { icon: "info", duration: 9000 }
          );
        }
      });
    }
    renderSidebarPlaylists();
    updateStorageInfo();
    renderRoute({ focusSearch: true });

    if (L.state.storage === "memory") {
      toast(
        "Penyimpanan browser tidak tersedia. Impor hanya bertahan selama tab ini terbuka. Jalankan lewat server lokal untuk penyimpanan permanen.",
        { icon: "alert", duration: 9000 }
      );
    }
  }

  /* ------------------------------------------------------------------------
     Tema
     ------------------------------------------------------------------------ */

  function applyTheme(theme, persist) {
    const value = theme === "light" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", value);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", value === "light" ? "#ffffff" : "#1f1f1f");
    if (els.themeToggle) {
      U.setIconIn(els.themeToggle, value === "light" ? "sun" : "moon");
      const label = value === "light" ? "Ganti ke tema gelap" : "Ganti ke tema terang";
      els.themeToggle.setAttribute("title", label);
      els.themeToggle.setAttribute("aria-label", label);
    }
    if (persist) L.setSetting("theme", value);
    syncSettingsControls();
  }

  function toggleTheme() {
    const current = document.documentElement.getAttribute("data-theme");
    applyTheme(current === "light" ? "dark" : "light", true);
  }

  /* ------------------------------------------------------------------------
     Router
     ------------------------------------------------------------------------ */

  function initHistory() {
    const hash = normalizeHash(location.hash);
    state.history = [hash];
    state.historyIndex = 0;
    history.replaceState({ appIndex: 0 }, "", hash);
  }

  function navigate(hash, options) {
    const opts = options || {};
    const target = normalizeHash(hash);
    const same = target === location.hash;

    closeSidebar();
    UI.closeMenu();

    if (same) {
      renderRoute({ focusSearch: opts.focusSearch !== false });
      return;
    }

    if (opts.replace) {
      state.history[state.historyIndex] = target;
      history.replaceState({ appIndex: state.historyIndex }, "", target);
    } else {
      state.history = state.history.slice(0, state.historyIndex + 1);
      state.history.push(target);
      state.historyIndex = state.history.length - 1;
      history.pushState({ appIndex: state.historyIndex }, "", target);
    }

    renderRoute({ focusSearch: opts.focusSearch !== false });
  }

  function renderRoute(options) {
    const opts = options || {};
    const route = parseHash(location.hash);
    state.currentRoute = route;
    window.clearTimeout(state.searchOnlineTimer);

    const result = AM.Views.render(els.view, route);
    state.viewTitle = result && result.title ? result.title : "Musik";
    if (els.topbarTitle) els.topbarTitle.textContent = state.viewTitle;

    if (route.name === "home" && AM.Home) {
      AM.Home.load().catch((error) => {
        console.warn("[app] gagal memuat rekomendasi home:", error);
      });
    }

    if (route.name === "search" && route.query && route.query.q) {
      const value = cleanSearchQuery(route.query.q);
      if (value.length >= 2) prepareSearchOnline(value);
      AM.Views.updateSearch(route.query.q);
    }

    if (route.name === "settings") {
      syncSettingsControls();
      updateSleepTimerUI();
      fillStorageEstimate(document.getElementById("settingsRoot"));
    }

    updateActiveNav(route);
    updateHistoryButtons();
    if (!opts.keepScroll) {
      els.view.scrollTop = 0;
      updateTopbarScrolled();
    }

    syncTrackRows();
    updateDocumentTitle();
    syncSettingsControls();

    if (route.name === "search" && opts.focusSearch !== false) {
      window.setTimeout(() => {
        const input = $("#searchInput");
        if (!input) return;
        input.focus({ preventScroll: true });
        const length = input.value.length;
        try {
          input.setSelectionRange(length, length);
        } catch (error) {
          /* Tipe input tertentu tidak mendukung selection. */
        }
      }, 40);
    }
  }

  function refreshView(options) {
    if (!state.currentRoute) return;
    const opts = options || {};
    const keepScroll = opts.keepScroll !== false;
    const top = keepScroll ? els.view.scrollTop : 0;
    renderRoute({ keepScroll: keepScroll, focusSearch: false });
    if (keepScroll) els.view.scrollTop = top;
    updateTopbarScrolled();
  }

  function bindOnlineEvents() {
    O.on("change", (snapshot) => {
      if (state.currentRoute && state.currentRoute.name === "search") {
        const query = searchRouteQuery();
        if (query && cleanSearchQuery(snapshot.query) === query) {
          AM.Views.updateSearch(query);
        }
      }
    });

    document.addEventListener("pointerover", (event) => {
      const row = event.target.closest && event.target.closest(".track-row--online");
      if (!row || row.contains(event.relatedTarget)) return;
      const track = O.getTrack(row.dataset.trackId);
      if (!track || !track.sourceId || !AM.Youtube) return;
      AM.Youtube.resolveAudio(track.sourceId).catch(() => {});
    });

    O.on("likeschange", (detail) => {
      if (detail && detail.id) updateLikeUI(detail.id);
      if (P.state.currentId === (detail && detail.id)) syncPlayerBar(P.getState());
      if (state.currentRoute && state.currentRoute.name === "favorites") {
        refreshView({ keepScroll: true });
      }
    });

    document.addEventListener(
      "error",
      (event) => {
        const img = event.target;
        if (!img || img.tagName !== "IMG" || img.dataset.artFallback) return;
        const row = img.closest(".track-row--online, .queue-item");
        if (!row && img !== els.playerArt) return;
        if (!/^https?:\/\//i.test(img.currentSrc || img.src || "")) return;
        const titleEl = row
          ? row.querySelector(".track-row__name, .queue-item__title")
          : null;
        const label = titleEl ? titleEl.textContent.trim() : img.alt || "Musik online";
        const seed = (row && (row.dataset.trackId || row.dataset.queueId)) || label || "musik-online";
        img.dataset.artFallback = "1";
        img.src = U.generatedArt(seed, { label });
      },
      true
    );
  }

  function bindHomeEvents() {
    if (!AM.Home) return;
    AM.Home.on("change", (snapshot) => {
      if (!state.currentRoute || state.currentRoute.name !== "home") return;
      AM.Views.updateHomeFeed(snapshot);
      syncTrackRows();
    });
  }

  function updateHistoryButtons() {
    if (els.backBtn) els.backBtn.disabled = state.historyIndex <= 0;
    if (els.forwardBtn) els.forwardBtn.disabled = state.historyIndex >= state.history.length - 1;
  }

  function updateActiveNav(route) {
    const target = NAV_FOR_ROUTE[route.name] || "";
    $$(".nav-item[data-nav]", els.sidebar).forEach((link) => {
      const active = link.dataset.nav === target;
      link.classList.toggle("is-active", active);
      if (active) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
    $$(".nav-item[data-playlist-key]", els.sidebar).forEach((link) => {
      const active = route.name === "playlist" && link.dataset.playlistKey === route.params.key;
      link.classList.toggle("is-active", active);
      if (active) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
  }

  function updateRouteQuery(patch) {
    if (!state.currentRoute) return;
    const query = Object.assign({}, state.currentRoute.query, patch);
    Object.keys(query).forEach((key) => {
      if (query[key] === "" || query[key] == null) delete query[key];
    });
    const hash = buildHash(state.currentRoute, query);
    state.history[state.historyIndex] = hash;
    history.replaceState({ appIndex: state.historyIndex }, "", hash);
    refreshView({ keepScroll: true });
  }

  function updateDocumentTitle() {
    const track = P.currentTrack();
    if (track) document.title = track.title + " — " + track.artist + " · Musik";
    else document.title = state.viewTitle + " · Musik";
  }

  /* ------------------------------------------------------------------------
     Sidebar & topbar
     ------------------------------------------------------------------------ */

  function openSidebar() {
    if (!els.sidebar) return;
    els.sidebar.classList.add("is-open");
    if (els.sidebarScrim) els.sidebarScrim.hidden = false;
  }

  function closeSidebar() {
    if (!els.sidebar) return;
    els.sidebar.classList.remove("is-open");
    if (els.sidebarScrim) els.sidebarScrim.hidden = true;
  }

  function updateTopbarScrolled() {
    if (!els.topbar || !els.view) return;
    els.topbar.classList.toggle("is-scrolled", els.view.scrollTop > 10);
  }

  function renderSidebarPlaylists() {
    if (!els.sidebarPlaylists) return;
    const playlists = L.state.playlists || [];
    if (!playlists.length) {
      els.sidebarPlaylists.innerHTML =
        '<li class="nav-empty">Belum ada playlist. <button type="button" data-action="new-playlist">Buat sekarang</button></li>';
    } else {
      els.sidebarPlaylists.innerHTML = playlists
        .map(
          (playlist) =>
            '<li><a class="nav-item" href="#/playlist/' +
            encodeURIComponent(playlist.id) +
            '" data-playlist-key="' +
            U.esc(playlist.id) +
            '" title="' +
            U.esc(playlist.name) +
            '">' +
            icon("playlist") +
            "<span>" +
            U.esc(playlist.name) +
            "</span></a></li>"
        )
        .join("");
    }
    if (state.currentRoute) updateActiveNav(state.currentRoute);
  }

  function updateStorageInfo() {
    if (!els.storageInfo) return;
    const count = L.state.tracks.length;
    if (!count) {
      els.storageInfo.textContent =
        L.state.storage === "indexeddb" ? "Penyimpanan lokal" : "Mode sementara";
    } else {
      els.storageInfo.textContent = count + " lagu · " + U.fmtBytes(L.totalSize());
    }
    els.storageInfo.title =
      L.state.storage === "indexeddb"
        ? "Koleksi tersimpan di IndexedDB browser ini"
        : "IndexedDB tidak tersedia — koleksi hanya bertahan selama tab ini terbuka";
  }

  function openSearch() {
    closeSidebar();
    if (state.currentRoute && state.currentRoute.name === "search") {
      const input = $("#searchInput");
      if (input) {
        input.focus();
        input.select();
      }
      return;
    }
    navigate("#/search", { focusSearch: true });
  }

  function setSearchQuery(value) {
    window.clearTimeout(state.searchOnlineTimer);
    const query = cleanSearchQuery(value);
    if (!state.currentRoute || state.currentRoute.name !== "search") {
      const hash = value ? "#/search?q=" + encodeURIComponent(value) : "#/search";
      navigate(hash, { focusSearch: true });
      return;
    }
    if (query.length >= 2) prepareSearchOnline(query);
    setSearchInput(value, true);
    const hash = value ? buildHash(state.currentRoute, { q: value }) : "#/search";
    state.history[state.historyIndex] = hash;
    history.replaceState({ appIndex: state.historyIndex }, "", hash);
    state.currentRoute = parseHash(hash);
    const input = $("#searchInput");
    if (input) input.focus();
  }

  function setSearchInput(value, updateResults) {
    const input = $("#searchInput");
    if (input) input.value = value;
    if (updateResults) AM.Views.updateSearch(value);
  }

  /* ------------------------------------------------------------------------
     Pemutar — pembaruan UI
     ------------------------------------------------------------------------ */

  function bindPlayerEvents() {
    P.on("statechange", (detail) => {
      syncPlayerBar(detail || P.getState());
      syncTrackRows();
    });
    P.on("trackchange", () => {
      syncPlayerBar(P.getState());
      syncTrackRows();
      renderQueue();
    });
    P.on("queuechange", renderQueue);
    P.on("time", updateTime);
    P.on("time", (detail) => updateLyricsHighlight(detail && detail.currentTime));
    P.on("volumechange", updateVolume);
    P.on("sleeptimerchange", updateSleepTimerUI);
    P.on("sleepdone", () => {
      toast("Timer tidur selesai — pemutaran dijeda.", { icon: "clock", duration: 6000 });
    });
    P.on("trackchange", () => {
      if (state.lyricsOpen) renderLyricsPanel();
    });
    P.on("buffer", (detail) => {
      if (!els.seek || !detail) return;
      const ratio = Number(detail.buffered) || 0;
      els.seek.style.setProperty("--buffer", U.clamp(ratio, 0, 1) * 100 + "%");
    });
    P.on("error", (detail) => {
      const track = detail && detail.track ? detail.track : null;
      const isYoutube = !!(track && track.provider === "youtube");
      const title = track ? '"' + track.title + '"' : "Lagu ini";

      if (isYoutube) {
        // Satu toast per lagu. Kandidat cadangan sudah dicoba diam-diam
        // oleh resolver audio yt-dlp.
        const failed = state.youtubeFailedIds || (state.youtubeFailedIds = new Set());
        if (track && track.id) failed.add(track.id);

        const queueItems = P.getQueue().queue || [];
        const queueIds = queueItems
          .map((item) => item.id)
          .filter((id) => /^youtube:/.test(id));
        // Pesan final hanya jika tidak ada lagu lain (lokal) yang tersisa —
        // lagu lokal tetap bisa diputar meski semua video YouTube gagal.
        const hasOtherTracks = queueItems.some(
          (item) => !/^youtube:/.test(item.id)
        );
        const allFailed =
          !hasOtherTracks &&
          queueIds.length > 0 &&
          queueIds.every((id) => failed.has(id));
        const openUrl = track && track.externalUrl;
        const openAction = openUrl
          ? {
              label: "Buka di YouTube",
              onClick: () => window.open(openUrl, "_blank", "noopener,noreferrer")
            }
          : null;

        if (allFailed) {
          toast("Semua lagu YouTube di antrean tidak bisa diputar.", {
            type: "error",
            duration: 8000,
            action: openAction
          });
          P.pause();
          return;
        }

        toast(title + " tidak bisa diputar — lanjut ke lagu berikutnya.", {
          duration: 5000,
          action: openAction
        });

        if (state.youtubeSkipTimer) return;
        state.youtubeSkipTimer = window.setTimeout(() => {
          state.youtubeSkipTimer = 0;
          if (P.state.isPlaying) return;
          P.next(true);
        }, 700);
        return;
      }

      const message = track && track.online
        ? "Tidak dapat memutar " + title + " dari internet. Periksa koneksi lalu coba lagi."
        : "Tidak dapat memutar " + title + ". Format mungkin tidak didukung browser.";
      toast(message, { type: "error", duration: 6000 });
    });
    P.on("trackchange", (detail) => {
      if (state.youtubeSkipTimer) {
        window.clearTimeout(state.youtubeSkipTimer);
        state.youtubeSkipTimer = 0;
      }
      if (detail && detail.track && detail.track.provider === "youtube") return;
      state.youtubeFailedIds = new Set();
    });
    P.on("blocked", () => {
      if (state.blockedNotified) return;
      state.blockedNotified = true;
      toast("Pemutaran diblokir browser. Tekan tombol putar untuk memulai.", {
        icon: "info",
        duration: 5000
      });
    });
  }

  function syncPlayerBar(playerState) {
    const s = playerState || P.getState();
    const track = s.track || null;
    const hasTrack = !!track;
    const hasQueue = s.queueLength > 0;
    const online = !!(track && track.online);
    const providerLabel = online ? track.providerLabel || O.providerLabel(track.provider) : "";

    if (els.playerTitle) {
      els.playerTitle.textContent = track ? track.title : "Tidak ada yang diputar";
      els.playerTitle.disabled = !hasTrack;
      els.playerTitle.title = track
        ? online
          ? "Buka di " + providerLabel
          : "Buka album " + (track.album || track.title)
        : "Buka album";
    }
    if (els.playerArtist) {
      els.playerArtist.textContent = track ? track.artist : "Pilih lagu dari perpustakaanmu";
      els.playerArtist.disabled = !hasTrack;
      els.playerArtist.title = track
        ? online
          ? "Cari " + track.artist + " di " + providerLabel
          : "Buka artis " + track.artist
        : "Buka artis";
    }
    if (els.playerArt) {
      const art = L.trackArt(track);
      if (els.playerArt.getAttribute("src") !== art) els.playerArt.src = art;
      els.playerArt.alt = track ? "Sampul " + (track.album || track.title) : "";
    }
    if (els.playerArtButton) {
      els.playerArtButton.disabled = !hasTrack;
      els.playerArtButton.title = track
        ? online
          ? "Buka di " + providerLabel
          : "Buka album " + (track.album || track.title)
        : "Buka album";
    }

    if (els.playerLike) {
      const liked = !!track && !!track.liked;
      const likeLabel = liked ? "Hapus dari suka" : "Sukai lagu";
      els.playerLike.disabled = !hasTrack;
      els.playerLike.classList.toggle("is-liked", liked);
      els.playerLike.setAttribute("aria-pressed", liked ? "true" : "false");
      els.playerLike.setAttribute("aria-label", hasTrack ? likeLabel : "Sukai lagu");
      els.playerLike.setAttribute("title", hasTrack ? likeLabel : "Sukai");
      U.setIconIn(els.playerLike, liked ? "heart-fill" : "heart");
    }

    if (els.playerDownload) {
      const downloadable = !!(
        track &&
        track.online &&
        track.provider === "youtube" &&
        track.sourceId
      );
      els.playerDownload.disabled = !downloadable;
      els.playerDownload.title = downloadable
        ? "Unduh audio dari YouTube"
        : "Unduhan tersedia untuk lagu YouTube";
      els.playerDownload.setAttribute(
        "aria-label",
        downloadable ? "Unduh audio dari YouTube" : "Unduhan tidak tersedia"
      );
    }

    if (els.btnPrev) els.btnPrev.disabled = !hasTrack;
    if (els.btnNext) els.btnNext.disabled = !hasQueue;
    if (els.btnPlay) {
      els.btnPlay.disabled = !hasTrack && !hasQueue;
      els.btnPlay.dataset.state = s.isPlaying ? "playing" : "paused";
      els.btnPlay.setAttribute("aria-label", s.isPlaying ? "Jeda" : "Putar");
      els.btnPlay.setAttribute("title", s.isPlaying ? "Jeda" : "Putar");
      U.setIconIn(els.btnPlay, s.isPlaying ? "pause" : "play");
    }
    if (els.btnShuffle) {
      els.btnShuffle.classList.toggle("is-active", !!s.shuffle);
      els.btnShuffle.setAttribute("aria-pressed", s.shuffle ? "true" : "false");
    }
    if (els.btnRepeat) {
      const labels = { off: "Ulangi: mati", all: "Ulangi: semua lagu", one: "Ulangi: satu lagu" };
      els.btnRepeat.classList.toggle("is-active", s.repeat !== "off");
      els.btnRepeat.setAttribute("aria-pressed", s.repeat !== "off" ? "true" : "false");
      els.btnRepeat.setAttribute("aria-label", labels[s.repeat] || labels.off);
      els.btnRepeat.setAttribute("title", labels[s.repeat] || labels.off);
    }
    if (els.repeatOneBadge) els.repeatOneBadge.hidden = s.repeat !== "one";

    $$(".queue-toggle").forEach((button) => {
      button.classList.toggle("has-queue", hasQueue);
    });
    if (els.btnQueue) els.btnQueue.setAttribute("aria-pressed", state.queueOpen ? "true" : "false");

    if (!hasTrack) {
      updateTime({ currentTime: 0, duration: 0, buffered: 0 });
    }

    syncSettingsControls();
    updateDocumentTitle();
  }

  function updateTime(detail) {
    const duration = Math.max(0, Number(detail && detail.duration) || 0);
    const current = Math.max(0, Number(detail && detail.currentTime) || 0);
    const ratio = duration > 0 ? U.clamp(current / duration, 0, 1) : 0;
    const buffer = U.clamp(Number(detail && detail.buffered) || 0, 0, 1);

    if (els.seek) {
      els.seek.style.setProperty("--pct", (ratio * 100).toFixed(3) + "%");
      els.seek.style.setProperty("--buffer", (buffer * 100).toFixed(3) + "%");
      els.seek.setAttribute("aria-valuemin", "0");
      els.seek.setAttribute("aria-valuemax", String(Math.round(duration)));
      els.seek.setAttribute("aria-valuenow", String(Math.round(current)));
      els.seek.setAttribute("aria-valuetext", U.fmtTime(current) + " dari " + U.fmtTime(duration));
    }
    if (els.curTime) els.curTime.textContent = U.fmtTime(current);
    if (els.durTime) els.durTime.textContent = U.fmtTime(duration);
  }

  function updateVolume(detail) {
    const volume = U.clamp(Number(detail && detail.volume) || 0, 0, 1);
    const muted = !!(detail && detail.muted);
    if (els.volume) {
      els.volume.style.setProperty("--pct", volume * 100 + "%");
      els.volume.setAttribute("aria-valuenow", String(Math.round(volume * 100)));
      els.volume.setAttribute("aria-valuetext", muted ? "Bisu" : Math.round(volume * 100) + "%");
    }
    if (els.btnMute) {
      const name = muted || volume === 0 ? "volume-x" : volume < 0.5 ? "volume-1" : "volume-2";
      U.setIconIn(els.btnMute, name);
      els.btnMute.setAttribute("title", muted ? "Bunyikan" : "Bisukan");
      els.btnMute.setAttribute("aria-label", muted ? "Bunyikan" : "Bisukan");
      els.btnMute.setAttribute("aria-pressed", muted ? "true" : "false");
    }
  }

  function syncTrackRows() {
    const currentId = P.state.currentId;
    const playing = P.state.isPlaying;
    $$("#view .track-row[data-track-id]").forEach((row) => {
      const current = row.dataset.trackId === currentId;
      row.classList.toggle("is-current", current);
      row.classList.toggle("is-playing", current && playing);
    });
  }

  /* ------------------------------------------------------------------------
     Antrean
     ------------------------------------------------------------------------ */

  function renderQueue() {
    if (!els.queueBody) return;
    const queue = P.getQueue();
    els.queueBody.innerHTML = AM.Views.queueHTML();
    if (els.queueCount) {
      els.queueCount.textContent = queue.queue.length + " lagu";
    }
    if (els.queueClear) els.queueClear.disabled = !queue.queue.length;
    $$(".queue-toggle").forEach((button) => {
      button.classList.toggle("has-queue", queue.queue.length > 0);
    });
  }

  function setQueueOpen(open) {
    if (open && state.lyricsOpen) setLyricsOpen(false);
    state.queueOpen = !!open;
    if (els.queuePanel) {
      els.queuePanel.classList.toggle("is-open", state.queueOpen);
      els.queuePanel.setAttribute("aria-hidden", state.queueOpen ? "false" : "true");
    }
    if (els.btnQueue) els.btnQueue.setAttribute("aria-pressed", state.queueOpen ? "true" : "false");
    if (els.topbarQueue) els.topbarQueue.setAttribute("aria-pressed", state.queueOpen ? "true" : "false");
    if (state.queueOpen) renderQueue();
  }

  function toggleQueue() {
    setQueueOpen(!state.queueOpen);
  }

  /* ------------------------------------------------------------------------
     Lirik
     ------------------------------------------------------------------------ */

  function parseLyrics(raw) {
    const text = String(raw || "").replace(/\r\n?/g, "\n").trim();
    if (!text) return { synced: [], plain: [] };
    const lines = text.split("\n");
    const timeTag = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
    const synced = [];
    const plain = [];
    let hasTimestamps = false;

    lines.forEach((line) => {
      timeTag.lastIndex = 0;
      const stamps = [];
      let match = timeTag.exec(line);
      while (match) {
        hasTimestamps = true;
        const fraction = match[3] ? Number("0." + match[3]) : 0;
        stamps.push((Number(match[1]) || 0) * 60 + (Number(match[2]) || 0) + fraction);
        match = timeTag.exec(line);
      }
      const content = line.replace(timeTag, "").trim();
      if (!content) return;
      if (/^\[(ar|ti|al|by|offset|re|ve|length):/i.test(content)) return;
      if (stamps.length) {
        stamps.forEach((time) => synced.push({ time, text: content }));
      } else if (!hasTimestamps) {
        plain.push(content);
      }
    });

    if (!hasTimestamps) return { synced: [], plain };
    synced.sort((a, b) => a.time - b.time);
    return { synced, plain: [] };
  }

  function lyricsEmptyHTML() {
    return (
      '<div class="lyrics-empty">' +
      icon("lyrics") +
      "<p><strong>Lirik tidak tersedia</strong></p>" +
      "<p>Lagu ini belum memiliki lirik tertanam di tag audionya. Lirik dari file MP3, M4A, FLAC, atau OGG akan muncul otomatis di sini.</p>" +
      "</div>"
    );
  }

  function lyricsTranslitHTML(text) {
    if (!AM.Romanize || typeof AM.Romanize.romanize !== "function") return "";
    const value = AM.Romanize.romanize(text);
    return value ? '<span class="lyrics-line__translit">' + U.esc(value) + "</span>" : "";
  }

  function renderLyricsPanel() {
    if (!els.lyricsBody) return;
    const track = P.currentTrack();
    const parsed = parseLyrics(track && track.lyrics);
    const synced = parsed.synced.length > 0;
    state.lyricsActiveIndex = -1;

    if (els.lyricsTitle) {
      els.lyricsTitle.textContent = track ? track.title : "Lirik";
    }
    if (els.lyricsMeta) {
      els.lyricsMeta.textContent = !track || (!synced && !parsed.plain.length)
        ? "Lirik tidak tersedia"
        : synced
          ? "Lirik sinkron"
          : "Lirik teks";
    }
    if (els.lyricsHint) {
      els.lyricsHint.textContent = synced ? "Ketuk baris untuk melompat" : "Lirik tertanam dari file";
      els.lyricsHint.hidden = !synced;
    }

    if (!track || (!synced && !parsed.plain.length)) {
      els.lyricsBody.innerHTML = lyricsEmptyHTML();
      return;
    }

    if (synced) {
      els.lyricsBody.innerHTML =
        '<div class="lyrics-synced">' +
        parsed.synced
          .map(
            (line, index) =>
              '<button class="lyrics-line" type="button" data-action="lyrics-seek" data-time="' +
              line.time.toFixed(2) +
              '" data-index="' +
              index +
              '"><span class="lyrics-line__text">' +
              U.esc(line.text) +
              "</span>" +
              lyricsTranslitHTML(line.text) +
              "</button>"
          )
          .join("") +
        "</div>";
    } else {
      els.lyricsBody.innerHTML =
        '<div class="lyrics-plain">' +
        parsed.plain.map((line) => "<p>" + U.esc(line) + lyricsTranslitHTML(line) + "</p>").join("") +
        "</div>";
    }
    updateLyricsHighlight(P.state.currentTime, true);
  }

  function updateLyricsHighlight(currentTime, force) {
    if (!state.lyricsOpen || !els.lyricsBody) return;
    const lines = $$(".lyrics-line", els.lyricsBody);
    if (!lines.length) return;
    const time = Number(currentTime) || 0;
    let active = -1;
    for (let i = 0; i < lines.length; i += 1) {
      const at = Number(lines[i].dataset.time) || 0;
      if (at <= time + 0.2) active = i;
      else break;
    }
    if (!force && active === state.lyricsActiveIndex) return;
    state.lyricsActiveIndex = active;
    lines.forEach((line, index) => line.classList.toggle("is-active", index === active));
    const line = lines[active];
    if (!line) return;

    const rect = line.getBoundingClientRect();
    const box = els.lyricsBody.getBoundingClientRect();
    const delta = rect.top - box.top;
    if (delta < 0 || delta > box.height * 0.62) {
      const top = els.lyricsBody.scrollTop + delta - box.height / 2 + rect.height / 2;
      if (typeof els.lyricsBody.scrollTo === "function") {
        els.lyricsBody.scrollTo({ top: Math.max(0, top), behavior: force ? "auto" : "smooth" });
      } else {
        els.lyricsBody.scrollTop = Math.max(0, top);
      }
    }
  }

  function setLyricsOpen(open) {
    const next = !!open;
    if (next && state.queueOpen) setQueueOpen(false);
    state.lyricsOpen = next;
    if (els.lyricsPanel) {
      els.lyricsPanel.classList.toggle("is-open", next);
      els.lyricsPanel.setAttribute("aria-hidden", next ? "false" : "true");
    }
    $$(".lyrics-toggle").forEach((button) => {
      button.setAttribute("aria-pressed", next ? "true" : "false");
    });
    if (next) renderLyricsPanel();
  }

  function toggleLyrics() {
    setLyricsOpen(!state.lyricsOpen);
  }

  /* ------------------------------------------------------------------------
     Timer tidur
     ------------------------------------------------------------------------ */

  function formatSleepRemaining(ms) {
    const total = Math.max(0, Math.ceil((Number(ms) || 0) / 1000));
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return minutes + ":" + String(seconds).padStart(2, "0");
  }

  function updateSleepTimerUI(timer) {
    const value = timer || P.getSleepTimer();
    const active = value.mode !== "off";
    const label =
      value.mode === "track" ? "akhir lagu" : formatSleepRemaining(value.remainingMs);

    if (els.btnSleep) {
      els.btnSleep.classList.toggle("is-active", active);
      els.btnSleep.setAttribute("aria-pressed", active ? "true" : "false");
      const title = active ? "Timer tidur · " + label : "Timer tidur";
      els.btnSleep.title = title;
      els.btnSleep.setAttribute("aria-label", title);
    }
    if (els.sleepTime) {
      els.sleepTime.hidden = !active;
      els.sleepTime.textContent = active ? (value.mode === "track" ? "1 lagu" : label) : "";
    }

    const settingsText = document.getElementById("settingsSleepText");
    if (settingsText) {
      settingsText.textContent = !active
        ? "Nonaktif — pemutaran berhenti mengikuti pilihanmu."
        : value.mode === "track"
          ? "Akan berhenti setelah lagu ini selesai."
          : "Berhenti otomatis dalam " + label + ".";
    }
  }

  function openSleepMenu(anchor) {
    const timer = P.getSleepTimer();
    const items = [5, 10, 15, 30, 45, 60].map((minutes) => ({
      label: minutes + " menit",
      icon: "clock",
      onSelect: () => {
        P.setSleepTimer(minutes);
        toast("Timer tidur: " + minutes + " menit.", { icon: "clock" });
      }
    }));
    items.push("divider", {
      label: "Akhir lagu",
      icon: "music",
      onSelect: () => {
        P.setSleepTimer("track");
        toast("Pemutaran berhenti setelah lagu ini selesai.", { icon: "clock" });
      }
    });
    if (timer.mode !== "off") {
      items.push("divider", {
        label: "Batalkan timer",
        icon: "x",
        onSelect: () => {
          P.cancelSleepTimer();
          toast("Timer tidur dibatalkan.");
        }
      });
    }
    UI.contextMenu({ anchor, items });
  }

  /* ------------------------------------------------------------------------
     Slider
     ------------------------------------------------------------------------ */

  function bindPlayerControls() {
    if (els.btnPlay) els.btnPlay.addEventListener("click", () => P.toggle());
    if (els.btnPrev) els.btnPrev.addEventListener("click", () => P.prev());
    if (els.btnNext) els.btnNext.addEventListener("click", () => P.next(true));
    if (els.btnShuffle) els.btnShuffle.addEventListener("click", () => P.toggleShuffle());
    if (els.btnRepeat) els.btnRepeat.addEventListener("click", () => P.cycleRepeat());
    if (els.btnMute) els.btnMute.addEventListener("click", () => P.toggleMute());
    if (els.btnSleep) els.btnSleep.addEventListener("click", () => openSleepMenu(els.btnSleep));

    if (els.playerLike) {
      els.playerLike.addEventListener("click", () => {
        if (P.state.currentId) toggleLike(P.state.currentId);
      });
    }
    if (els.playerDownload) {
      els.playerDownload.addEventListener("click", () => downloadCurrentTrack());
    }
    if (els.playerArtButton) els.playerArtButton.addEventListener("click", openCurrentAlbum);
    if (els.playerTitle) els.playerTitle.addEventListener("click", openCurrentAlbum);
    if (els.playerArtist) els.playerArtist.addEventListener("click", openCurrentArtist);

    if (els.btnQueue) els.btnQueue.addEventListener("click", toggleQueue);
    if (els.topbarQueue) els.topbarQueue.addEventListener("click", toggleQueue);
    $$(".lyrics-toggle").forEach((button) => button.addEventListener("click", toggleLyrics));
    if (els.lyricsClose) els.lyricsClose.addEventListener("click", () => setLyricsOpen(false));
    if (els.queueClose) els.queueClose.addEventListener("click", () => setQueueOpen(false));
    if (els.queueClear) {
      els.queueClear.addEventListener("click", () => {
        if (!P.getQueue().queue.length) return;
        P.clearQueue();
        toast("Antrean dibersihkan.");
      });
    }

    bindSeek();
    bindVolume();
  }

  function openExternalUrl(url) {
    if (!url) return false;
    try {
      const win = window.open(url, "_blank", "noopener,noreferrer");
      if (win) win.opener = null;
      return true;
    } catch (error) {
      return false;
    }
  }

  function openCurrentAlbum() {
    const track = P.currentTrack();
    if (!track) return;
    if (track.online) {
      if (openExternalUrl(track.externalUrl)) return;
      navigate("#/search?q=" + encodeURIComponent(track.artist));
      return;
    }
    if (track.albumKey && L.getAlbum(track.albumKey)) {
      navigate("#/album/" + encodeURIComponent(track.albumKey));
    } else {
      navigate("#/artist/" + encodeURIComponent(track.artistKey));
    }
  }

  function openCurrentArtist() {
    const track = P.currentTrack();
    if (!track) return;
    if (track.online) {
      navigate("#/search?q=" + encodeURIComponent(track.artist));
      return;
    }
    navigate("#/artist/" + encodeURIComponent(track.artistKey));
  }

  function bindSeek() {
    const el = els.seek;
    if (!el) return;
    let dragging = false;
    let lastRatio = 0;

    function ratioFromEvent(event) {
      const rect = el.getBoundingClientRect();
      if (!rect.width) return 0;
      return U.clamp((event.clientX - rect.left) / rect.width, 0, 1);
    }

    function preview(ratio) {
      const duration = Number(P.state.duration) || 0;
      if (!(duration > 0)) return;
      lastRatio = ratio;
      els.seek.style.setProperty("--pct", (ratio * 100).toFixed(3) + "%");
      if (els.curTime) els.curTime.textContent = U.fmtTime(ratio * duration);
      el.setAttribute("aria-valuenow", String(Math.round(ratio * duration)));
      el.setAttribute("aria-valuetext", U.fmtTime(ratio * duration) + " dari " + U.fmtTime(duration));
    }

    function finish(event) {
      if (!dragging) return;
      dragging = false;
      P.state.seeking = false;
      el.classList.remove("is-dragging");
      if (event && typeof event.clientX === "number") lastRatio = ratioFromEvent(event);
      const duration = Number(P.state.duration) || 0;
      if (duration > 0) P.seekTo(lastRatio * duration);
    }

    el.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || !(Number(P.state.duration) > 0)) return;
      dragging = true;
      P.state.seeking = true;
      el.classList.add("is-dragging");
      if (el.setPointerCapture) {
        try {
          el.setPointerCapture(event.pointerId);
        } catch (error) {
          /* Abaikan. */
        }
      }
      preview(ratioFromEvent(event));
      event.preventDefault();
    });

    el.addEventListener("pointermove", (event) => {
      if (!dragging) return;
      preview(ratioFromEvent(event));
    });

    el.addEventListener("pointerup", finish);
    el.addEventListener("pointercancel", finish);

    el.addEventListener("keydown", (event) => {
      const duration = Number(P.state.duration) || 0;
      if (!(duration > 0)) return;
      let handled = true;
      if (event.key === "ArrowRight") P.seekBy(5);
      else if (event.key === "ArrowLeft") P.seekBy(-5);
      else if (event.key === "Home") P.seekTo(0);
      else if (event.key === "End") P.seekTo(duration);
      else if (event.key === "ArrowUp") P.seekBy(5);
      else if (event.key === "ArrowDown") P.seekBy(-5);
      else handled = false;
      if (handled) {
        event.preventDefault();
        event.stopPropagation();
      }
    });
  }

  function bindVolume() {
    const el = els.volume;
    if (!el) return;
    let dragging = false;

    function ratioFromEvent(event) {
      const rect = el.getBoundingClientRect();
      if (!rect.width) return 0;
      return U.clamp((event.clientX - rect.left) / rect.width, 0, 1);
    }

    el.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      dragging = true;
      el.classList.add("is-dragging");
      if (el.setPointerCapture) {
        try {
          el.setPointerCapture(event.pointerId);
        } catch (error) {
          /* Abaikan. */
        }
      }
      P.setVolume(ratioFromEvent(event));
      event.preventDefault();
    });

    el.addEventListener("pointermove", (event) => {
      if (!dragging) return;
      P.setVolume(ratioFromEvent(event));
    });

    function finish() {
      if (!dragging) return;
      dragging = false;
      el.classList.remove("is-dragging");
    }

    el.addEventListener("pointerup", finish);
    el.addEventListener("pointercancel", finish);

    el.addEventListener("keydown", (event) => {
      let handled = true;
      if (event.key === "ArrowRight" || event.key === "ArrowUp") P.setVolume(P.state.volume + 0.05);
      else if (event.key === "ArrowLeft" || event.key === "ArrowDown") P.setVolume(P.state.volume - 0.05);
      else if (event.key === "Home") P.setVolume(0);
      else if (event.key === "End") P.setVolume(1);
      else handled = false;
      if (handled) {
        event.preventDefault();
        event.stopPropagation();
      }
    });

    el.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        P.setVolume(P.state.volume + (event.deltaY < 0 ? 0.05 : -0.05));
      },
      { passive: false }
    );
  }

  /* ------------------------------------------------------------------------
     Chrome / event global
     ------------------------------------------------------------------------ */

  function bindChrome() {
    const kbd = $(".search-pill__kbd");
    if (kbd) kbd.textContent = U.isMac() ? "⌘K" : "Ctrl K";

    if (els.menuBtn) els.menuBtn.addEventListener("click", openSidebar);
    if (els.sidebarClose) els.sidebarClose.addEventListener("click", closeSidebar);
    if (els.sidebarScrim) els.sidebarScrim.addEventListener("click", closeSidebar);
    if (els.sidebarSearch) els.sidebarSearch.addEventListener("click", openSearch);
    if (els.topbarSearch) els.topbarSearch.addEventListener("click", openSearch);
    if (els.themeToggle) els.themeToggle.addEventListener("click", toggleTheme);
    if (els.sidebarImport) els.sidebarImport.addEventListener("click", () => openImportDialog());
    if (els.topbarImport) els.topbarImport.addEventListener("click", () => openImportDialog());
    if (els.sidebarNewPlaylist) {
      els.sidebarNewPlaylist.addEventListener("click", () => createPlaylistInteractive());
    }

    if (els.backBtn) els.backBtn.addEventListener("click", () => history.back());
    if (els.forwardBtn) els.forwardBtn.addEventListener("click", () => history.forward());

    if (els.view) {
      els.view.addEventListener("scroll", U.throttle(updateTopbarScrolled, 80), { passive: true });
    }

    if (els.fileInput) {
      els.fileInput.addEventListener("change", () => {
        const files = Array.from(els.fileInput.files || []);
        els.fileInput.value = "";
        if (files.length) startImport(files);
      });
    }
    if (els.folderInput) {
      els.folderInput.addEventListener("change", () => {
        const files = Array.from(els.folderInput.files || []);
        els.folderInput.value = "";
        if (files.length) startImport(files);
      });
    }

    const skip = $(".skip-link");
    if (skip) {
      skip.addEventListener("click", (event) => {
        event.preventDefault();
        if (els.view) els.view.focus();
      });
    }

    window.addEventListener("popstate", (event) => {
      const candidate = event.state && typeof event.state.appIndex === "number" ? event.state.appIndex : -1;
      let index = candidate;
      if (index < 0 || index >= state.history.length || state.history[index] !== location.hash) {
        const found = state.history.lastIndexOf(location.hash);
        if (found >= 0) {
          index = found;
        } else {
          const fallback = normalizeHash(location.hash);
          state.history = state.history.slice(0, state.historyIndex + 1);
          state.history.push(fallback);
          index = state.history.length - 1;
          // Jangan push state baru di sini; cukup perbarui indeks internal.
          history.replaceState({ appIndex: index }, "", location.hash || fallback);
        }
      }
      state.historyIndex = index;
      renderRoute({ focusSearch: false });
      closeSidebar();
      UI.closeMenu();
    });

    window.addEventListener("resize", () => {
      if (window.innerWidth > 900) closeSidebar();
    });

    bindGlobalDrop();
  }

  function updateTopbarOnScroll() {
    updateTopbarScrolled();
  }

  /* ------------------------------------------------------------------------
     Aksi terdelegasi
     ------------------------------------------------------------------------ */

  function bindDelegatedActions() {
    document.addEventListener("click", (event) => {
      if (event.defaultPrevented) return;
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;

      const actionEl = target.closest("[data-action]");
      if (actionEl) {
        event.preventDefault();
        Promise.resolve(dispatchAction(actionEl)).catch((error) => {
          console.error("[app] aksi gagal:", error);
          toast("Terjadi kesalahan. Coba lagi.", { type: "error" });
        });
        return;
      }

      const link = target.closest('a[href^="#/"]');
      if (link) {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        navigate(link.getAttribute("href"), { focusSearch: true });
      }
    });

    document.addEventListener("keydown", (event) => {
      if (event.defaultPrevented) return;
      if (event.key !== "Enter" && event.key !== " ") return;
      const target = event.target instanceof Element ? event.target : null;
      if (!target || !target.matches('[data-action][role="button"]')) return;
      if (target.closest("button, a")) return;
      event.preventDefault();
      Promise.resolve(dispatchAction(target)).catch((error) => {
        console.error("[app] aksi gagal:", error);
        toast("Terjadi kesalahan. Coba lagi.", { type: "error" });
      });
    });

    document.addEventListener("dblclick", (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target || target.closest("button, a, input")) return;
      const row = target.closest(".track-row[data-track-id]");
      if (!row) return;
      playFromRow(row.dataset.trackId, row);
    });

    document.addEventListener("input", (event) => {
      const target = event.target;
      if (!target) return;
      if (target.id === "searchInput") handleSearchInput(target.value);
    });

    document.addEventListener("keydown", (event) => {
      const target = event.target;
      if (!target) return;
      if (target.id !== "searchInput") return;
      if (event.key === "Enter") {
        const value = target.value.trim();
        if (!value) return;
        event.preventDefault();
        playSearch(value);
      } else if (event.key === "Escape" && target.value) {
        event.preventDefault();
        setSearchQuery("");
      }
    });
  }

  async function dispatchAction(actionEl) {
    const action = actionEl.dataset.action;
    switch (action) {
      case "open-import":
        openImportDialog();
        return;
      case "load-demo":
        return loadDemo();
      case "new-playlist":
        return createPlaylistInteractive();
      case "open-album":
        if (actionEl.dataset.key) navigate("#/album/" + encodeURIComponent(actionEl.dataset.key));
        return;
      case "open-artist":
        if (actionEl.dataset.key) navigate("#/artist/" + encodeURIComponent(actionEl.dataset.key));
        return;
      case "open-playlist":
        if (actionEl.dataset.key) navigate("#/playlist/" + encodeURIComponent(actionEl.dataset.key));
        return;
      case "open-genre":
        if (actionEl.dataset.key) navigate("#/genre/" + encodeURIComponent(actionEl.dataset.key));
        return;
      case "play-album":
        return playAlbum(actionEl.dataset.key, false);
      case "shuffle-album":
        return playAlbum(actionEl.dataset.key, true);
      case "queue-album":
        return queueAlbum(actionEl.dataset.key);
      case "like-album":
        return likeAlbum(actionEl.dataset.key);
      case "album-menu":
        return openAlbumMenu(actionEl.dataset.key, actionEl);
      case "play-artist":
        return playArtist(actionEl.dataset.key, false);
      case "shuffle-artist":
        return playArtist(actionEl.dataset.key, true);
      case "queue-artist":
        return queueArtist(actionEl.dataset.key);
      case "play-playlist":
        return playPlaylist(actionEl.dataset.key, false);
      case "shuffle-playlist":
        return playPlaylist(actionEl.dataset.key, true);
      case "playlist-add":
        return openAddTracksToPlaylist(actionEl.dataset.key);
      case "playlist-import":
        return openImportDialog({ playlistId: actionEl.dataset.key });
      case "playlist-menu":
        return openPlaylistMenu(actionEl.dataset.key, actionEl);
      case "play-genre":
        return playGenre(actionEl.dataset.key, false);
      case "shuffle-genre":
        return playGenre(actionEl.dataset.key, true);
      case "play-track": {
        const row = actionEl.closest(".track-row");
        return playFromRow(actionEl.dataset.id, row);
      }
      case "toggle-like":
        return toggleLike(actionEl.dataset.id);
      case "track-menu":
        return openTrackMenu(actionEl.dataset.id, actionEl);
      case "play-songs":
        return playSongs();
      case "shuffle-library":
        return shuffleLibrary();
      case "shuffle-recent":
        return shuffleRecent();
      case "clear-history":
        return clearHistoryInteractive();
      case "play-favorites":
        return playFavorites(false);
      case "shuffle-favorites":
        return playFavorites(true);
      case "play-search":
        return playSearch(actionEl.dataset.query || "");
      case "set-search":
        setSearchQuery(actionEl.dataset.q || "");
        return;
      case "clear-search":
        setSearchQuery("");
        return;
      case "search-online":
        return useOnlineSearch(actionEl.dataset.query || "");
      case "search-online-retry":
        return retrySearchOnline(actionEl.dataset.query || "");
      case "online-queue":
        return queueOnlineTrack(actionEl.dataset.id);
      case "online-menu":
        return openOnlineMenu(actionEl.dataset.id, actionEl);
      case "home-play":
        if (AM.Home) {
          return AM.Home.playTrack(
            actionEl.dataset.section || "rekomendasi",
            actionEl.dataset.id
          );
        }
        return;
      case "home-queue":
        if (AM.Home) return AM.Home.queueTrack(actionEl.dataset.id);
        return;
      case "home-play-section":
        if (AM.Home) {
          return AM.Home.playSection(
            actionEl.dataset.section || "rekomendasi",
            actionEl.dataset.shuffle === "true"
          );
        }
        return;
      case "home-station":
        if (AM.Home) return AM.Home.playStation(actionEl.dataset.id);
        return;
      case "home-seed":
        if (AM.Home) return AM.Home.playSeed(actionEl.dataset.query || "");
        return;
      case "home-refresh":
        if (AM.Home) return AM.Home.refresh();
        return;
      case "sort-songs":
        updateRouteQuery({ sort: actionEl.dataset.sort || "title" });
        return;
      case "sort-albums":
        updateRouteQuery({ sort: actionEl.dataset.sort || "recent" });
        return;
      case "queue-jump":
        if (actionEl.dataset.id) P.playTrack(actionEl.dataset.id);
        return;
      case "queue-remove":
        if (actionEl.dataset.id) {
          P.removeFromQueue(actionEl.dataset.id);
          if (!P.getQueue().queue.length) toast("Antrean kosong.");
        }
        return;
      case "set-theme":
        applyTheme(actionEl.dataset.theme || "dark", true);
        return;
      case "set-shuffle":
        P.setShuffle(actionEl.dataset.value === "true");
        syncSettingsControls();
        return;
      case "set-repeat":
        P.setRepeat(actionEl.dataset.value || "off");
        syncSettingsControls();
        return;
      case "sleep-menu":
        return openSleepMenu(actionEl);
      case "lyrics-seek":
        if (actionEl.dataset.time != null) {
          P.seekTo(Number(actionEl.dataset.time));
          if (!P.state.isPlaying) P.play();
        }
        return;
      case "set-stream-quality":
        return applyStreamQuality(actionEl.dataset.value || "high");
      case "set-download-quality":
        return applyDownloadQuality(actionEl.dataset.value || "best");
      case "settings-import":
        closeSettingsForAction(() => openImportDialog());
        return;
      case "settings-demo":
        closeSettingsForAction(() => loadDemo());
        return;
      case "settings-clear":
        return clearLibraryInteractive();
      case "settings-shortcuts":
        return showShortcuts();
      default:
        return;
    }
  }

  /* ------------------------------------------------------------------------
     Keyboard
     ------------------------------------------------------------------------ */

  function bindKeyboard() {
    document.addEventListener("keydown", (event) => {
      if (event.defaultPrevented) return;
      const mod = event.metaKey || event.ctrlKey;
      if (mod && (event.key === "k" || event.key === "K")) {
        if (UI.hasOpenModal()) return;
        event.preventDefault();
        openSearch();
        return;
      }

      if (event.key === "Escape") {
        if (UI.hasOpenModal() || UI.hasOpenMenu()) return;
        if (state.lyricsOpen) {
          event.preventDefault();
          setLyricsOpen(false);
          return;
        }
        if (state.queueOpen) {
          event.preventDefault();
          setQueueOpen(false);
          return;
        }
        if (els.sidebar && els.sidebar.classList.contains("is-open")) {
          event.preventDefault();
          closeSidebar();
        }
        return;
      }

      if (UI.hasOpenModal() || UI.hasOpenMenu()) return;
      if (U.isTyping(event.target)) return;
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.repeat) return;

      const target = event.target instanceof Element ? event.target : null;
      const interactive = target
        ? target.closest('button, a[href], [role="button"], input, select, textarea, summary, [contenteditable="true"]')
        : null;

      if (event.key === " " || event.code === "Space") {
        if (interactive) return;
        event.preventDefault();
        P.toggle();
        return;
      }

      if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        if (target && (target.id === "seek" || target.id === "volume")) return;
        event.preventDefault();
        P.seekBy(event.key === "ArrowRight" ? 5 : -5);
        return;
      }

      const key = event.key.toLowerCase();
      if (key === "m") {
        event.preventDefault();
        P.toggleMute();
      } else if (key === "s") {
        event.preventDefault();
        P.toggleShuffle();
      } else if (key === "r") {
        event.preventDefault();
        P.cycleRepeat();
      } else if (key === "l") {
        if (P.state.currentId) {
          event.preventDefault();
          toggleLike(P.state.currentId);
        }
      } else if (key === "q") {
        event.preventDefault();
        toggleQueue();
      } else if (key === "/" || (event.shiftKey && key === "?")) {
        event.preventDefault();
        openSearch();
      }
    });
  }

  /* ------------------------------------------------------------------------
     Pencarian
     ------------------------------------------------------------------------ */

  function cleanSearchQuery(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80);
  }

  function searchRouteQuery() {
    if (!state.currentRoute || state.currentRoute.name !== "search") return "";
    return cleanSearchQuery(state.currentRoute.query && state.currentRoute.query.q);
  }

  function prepareSearchOnline(query, options) {
    const opts = options || {};
    const value = cleanSearchQuery(query);
    if (!value || !AM.Online || typeof AM.Online.prepare !== "function") {
      return Promise.resolve(null);
    }
    return AM.Online.prepare("youtube", value, { force: !!opts.force }).catch((error) => {
      console.warn("[app] gagal mencari di YouTube:", error);
      return null;
    });
  }

  function handleSearchInput(value) {
    window.clearTimeout(state.searchTimer);
    window.clearTimeout(state.searchOnlineTimer);
    const raw = String(value || "");
    state.searchTimer = window.setTimeout(() => {
      if (!state.currentRoute || state.currentRoute.name !== "search") return;
      AM.Views.updateSearch(raw);
      const hash = raw ? buildHash(state.currentRoute, { q: raw }) : "#/search";
      state.history[state.historyIndex] = hash;
      history.replaceState({ appIndex: state.historyIndex }, "", hash);
      state.currentRoute = parseHash(hash);

      const query = cleanSearchQuery(raw);
      if (query.length < 2) return;
      state.searchOnlineTimer = window.setTimeout(() => {
        if (!state.currentRoute || state.currentRoute.name !== "search") return;
        if (searchRouteQuery() !== query) return;
        prepareSearchOnline(query);
      }, 420);
    }, 140);
  }

  /* ------------------------------------------------------------------------
     Aksi perpustakaan
     ------------------------------------------------------------------------ */

  function getRowQueue(row) {
    if (!row) return null;
    const type = row.dataset.queueType || "songs";
    return {
      type,
      key: row.dataset.queueKey || "",
      query: row.dataset.query || "",
      provider: row.dataset.queueProvider || "",
      label: row.dataset.queueLabel || "",
      playlistId: row.dataset.playlistId || ""
    };
  }

  function sortTracks(tracks, sort) {
    const list = (tracks || []).slice();
    if (sort === "artist") {
      list.sort(
        (a, b) => U.byText(a.artist, b.artist) || U.byText(a.album, b.album) || U.byText(a.title, b.title)
      );
    } else if (sort === "album") {
      list.sort(
        (a, b) => U.byText(a.album || "Singel", b.album || "Singel") || (a.trackNo || 0) - (b.trackNo || 0)
      );
    } else if (sort === "duration") {
      list.sort((a, b) => (b.duration || 0) - (a.duration || 0));
    } else {
      list.sort((a, b) => U.byText(a.title, b.title));
    }
    return list;
  }

  function idsFromQueue(queue) {
    const type = queue && queue.type ? queue.type : "songs";
    const key = queue && queue.key ? queue.key : "";
    const query = queue && queue.query ? queue.query : "";
    if (type === "album") {
      const album = L.getAlbum(key);
      return album ? album.tracks.map((track) => track.id) : [];
    }
    if (type === "artist") {
      const artist = L.getArtist(key);
      return artist ? artist.tracks.map((track) => track.id) : [];
    }
    if (type === "playlist") {
      const playlist = L.getPlaylist(key);
      return playlist ? L.playlistTracks(playlist).map((track) => track.id) : [];
    }
    if (type === "genre") {
      const genre = L.genres().find((item) => item.name === key);
      return genre ? genre.tracks.map((track) => track.id) : [];
    }
    if (type === "search") {
      return L.search(query, 500).tracks.map((track) => track.id);
    }
    if (type === "online") {
      return O.idsForQueue({
        provider: queue && queue.provider ? queue.provider : "",
        query
      });
    }
    if (type === "recent") {
      return L.recent().map((track) => track.id);
    }
    if (type === "favorites") {
      return L.favorites().map((track) => track.id);
    }
    if (type === "online-favorites") {
      return O.likedTrackIds();
    }
    if (type === "top") {
      return L.tracksByAdded()
        .filter((track) => (track.playCount || 0) > 0)
        .sort((a, b) => (b.playCount || 0) - (a.playCount || 0))
        .map((track) => track.id);
    }
    if (type === "songs") {
      const sort = state.currentRoute && state.currentRoute.name === "songs"
        ? (state.currentRoute.query && state.currentRoute.query.sort) || "title"
        : "title";
      return sortTracks(L.tracksByAdded(), sort).map((track) => track.id);
    }
    return L.tracksAlphabetical().map((track) => track.id);
  }

  function playQueueIds(ids, startId, context, shuffle) {
    const clean = (ids || []).filter(Boolean);
    if (!clean.length) {
      toast("Belum ada lagu untuk diputar.", { icon: "info" });
      return;
    }
    state.youtubeFailedIds = new Set();
    let start = startId && clean.includes(startId) ? startId : clean[0];
    if (shuffle) {
      P.setShuffle(true);
      start = clean[Math.floor(Math.random() * clean.length)];
    }
    P.playQueue(clean, start, context || { type: "library", label: "Perpustakaan" });
  }

  function resolveTrack(trackId) {
    if (!trackId) return null;
    return O.isOnlineId(trackId) ? O.getTrack(trackId) : L.getTrack(trackId);
  }

  function trackSongKey(track) {
    if (!track) return "";
    const YT = AM.Youtube;
    if (!YT || typeof YT.normalizeSong !== "function") return "";
    const parsed =
      typeof YT.parseTrackInfo === "function"
        ? YT.parseTrackInfo(track.title, track.artist)
        : null;
    return YT.normalizeSong(track.songTitle || (parsed && parsed.song) || track.title);
  }

  function sameSongTitle(first, second) {
    if (!first || !second) return false;
    const YT = AM.Youtube;
    return YT && typeof YT.titlesSimilar === "function"
      ? YT.titlesSimilar(first, second)
      : first === second;
  }

  function isSongTitleQuery(query, track) {
    if (!track || !O.isOnlineId(track.id)) return false;
    const YT = AM.Youtube;
    if (!YT || typeof YT.normalizeSong !== "function") return false;
    const song = trackSongKey(track);
    const asked = YT.normalizeSong(query);
    if (!song || !asked) return false;
    if (asked === song) return true;
    if (sameSongTitle(asked, song)) return true;
    // Contoh: "panah asmara afgan" tetap dianggap pencarian judul lagu.
    return (" " + asked + " ").includes(" " + song + " ");
  }

  function playFromRow(trackId, row) {
    const track = resolveTrack(trackId);
    if (!track) return;
    const queue = getRowQueue(row) || { type: "songs" };
    let ids = idsFromQueue(queue);
    if (queue.type === "search" || queue.type === "online") {
      // Kalau yang dicari adalah judul lagu, mulai dari lagu ini saja lalu
      // biarkan radio mengisi lagu lain yang mirip. Untuk pencarian artis,
      // hasil lain tetap dipakai, tetapi unggahan berjudul sama dibuang.
      if (isSongTitleQuery(queue.query, track)) {
        ids = [trackId];
      } else {
        const seedSong = trackSongKey(track);
        ids = ids.filter((id) => {
          if (id === trackId) return true;
          const item = resolveTrack(id);
          return !item || !sameSongTitle(seedSong, trackSongKey(item));
        });
      }
    }
    if (!ids.includes(trackId)) ids.unshift(trackId);
    state.youtubeFailedIds = new Set();
    P.playQueue(ids, trackId, {
      type: queue.type || "songs",
      key: queue.key || "",
      provider: queue.provider || "",
      query: queue.query || "",
      label: contextLabel(queue)
    });
  }

  function contextLabel(queue) {
    if (!queue) return "Perpustakaan";
    if (queue.type === "album") {
      const album = L.getAlbum(queue.key);
      return album ? album.name : "Album";
    }
    if (queue.type === "artist") {
      const artist = L.getArtist(queue.key);
      return artist ? artist.name : "Artis";
    }
    if (queue.type === "playlist") {
      const playlist = L.getPlaylist(queue.key);
      return playlist ? playlist.name : "Playlist";
    }
    if (queue.type === "genre") return queue.key || "Genre";
    if (queue.type === "search") return queue.query || "Pencarian";
    if (queue.type === "online") {
      const provider = O.providerLabel(queue.provider);
      if (queue.label && queue.label !== queue.query) return queue.label;
      if (queue.query) return queue.query + " · " + provider;
      return provider + " Trending";
    }
    if (queue.type === "favorites") return "Suka";
    if (queue.type === "online-favorites") return "Suka · YouTube";
    if (queue.type === "recent") return "Terbaru";
    return "Perpustakaan";
  }

  async function toggleLike(trackId) {
    if (!trackId) return;
    if (O.isOnlineId(trackId)) {
      const liked = O.toggleLike(trackId);
      if (liked === false && !O.getTrack(trackId)) {
        toast("Lagu ini belum siap disimpan. Coba putar dulu.", { icon: "info" });
      }
      return;
    }
    await L.toggleFavorite(trackId);
  }

  function updateLikeUI(trackId) {
    const track = resolveTrack(trackId);
    if (!track) return;
    const liked = !!track.liked;
    $$('[data-action="toggle-like"]').forEach((button) => {
      if (button.dataset.id !== trackId) return;
      button.classList.toggle("is-liked", liked);
      button.setAttribute("aria-pressed", liked ? "true" : "false");
      button.setAttribute("title", liked ? "Hapus dari suka" : "Sukai");
      button.setAttribute("aria-label", liked ? "Hapus dari suka" : "Sukai");
      U.setIconIn(button, liked ? "heart-fill" : "heart");
    });
    if (P.state.currentId === trackId && els.playerLike) {
      els.playerLike.disabled = false;
      els.playerLike.classList.toggle("is-liked", liked);
      els.playerLike.setAttribute("aria-pressed", liked ? "true" : "false");
      els.playerLike.setAttribute("aria-label", liked ? "Hapus dari suka" : "Sukai lagu");
      els.playerLike.setAttribute("title", liked ? "Hapus dari suka" : "Sukai");
      U.setIconIn(els.playerLike, liked ? "heart-fill" : "heart");
    }
  }

  async function playAlbum(key, shuffle) {
    const album = L.getAlbum(key);
    if (!album || !album.tracks.length) return;
    const ids = album.tracks.map((track) => track.id);
    playQueueIds(ids, ids[0], { type: "album", key: album.key, label: album.name }, shuffle);
  }

  async function queueAlbum(key) {
    const album = L.getAlbum(key);
    if (!album || !album.tracks.length) return;
    const added = await P.addToQueue(album.tracks.map((track) => track.id));
    if (added) {
      toast(added + " lagu dari “" + album.name + "” ditambahkan ke antrean.", {
        type: "success"
      });
    } else {
      toast("Lagu yang sedang diputar sudah ada di antrean.", { icon: "info" });
    }
  }

  async function likeAlbum(key) {
    const album = L.getAlbum(key);
    if (!album || !album.tracks.length) return;
    const target = !album.tracks.every((track) => track.liked);
    state.suppressRefresh = true;
    try {
      for (const track of album.tracks) {
        if (!!track.liked !== target) await L.toggleFavorite(track.id);
      }
    } finally {
      state.suppressRefresh = false;
    }
    refreshView({ keepScroll: true });
    toast(target ? "Album ditambahkan ke Suka." : "Album dihapus dari Suka.", { type: "success" });
  }

  async function playArtist(key, shuffle) {
    const artist = L.getArtist(key);
    if (!artist || !artist.tracks.length) return;
    const ids = artist.tracks.map((track) => track.id);
    playQueueIds(ids, ids[0], { type: "artist", key: artist.key, label: artist.name }, shuffle);
  }

  async function queueArtist(key) {
    const artist = L.getArtist(key);
    if (!artist || !artist.tracks.length) return;
    const added = await P.addToQueue(artist.tracks.map((track) => track.id));
    if (added) {
      toast(added + " lagu oleh " + artist.name + " ditambahkan ke antrean.", {
        type: "success"
      });
    } else {
      toast("Lagu yang sedang diputar sudah ada di antrean.", { icon: "info" });
    }
  }

  async function playPlaylist(id, shuffle) {
    const playlist = L.getPlaylist(id);
    if (!playlist) return;
    const tracks = L.playlistTracks(playlist);
    if (!tracks.length) {
      toast("Playlist ini masih kosong.", { icon: "info" });
      return;
    }
    const ids = tracks.map((track) => track.id);
    playQueueIds(ids, ids[0], { type: "playlist", key: playlist.id, label: playlist.name }, shuffle);
  }

  async function playGenre(key, shuffle) {
    const genre = L.genres().find((item) => item.name === key);
    if (!genre || !genre.tracks.length) return;
    const ids = genre.tracks.map((track) => track.id);
    playQueueIds(ids, ids[0], { type: "genre", key: genre.name, label: genre.name }, shuffle);
  }

  async function playSongs() {
    const ids = $$("#view .track-row[data-track-id]").map((row) => row.dataset.trackId);
    const fallback = sortTracks(L.tracksByAdded(), (state.currentRoute && state.currentRoute.query.sort) || "title");
    const list = ids.length ? ids : fallback.map((track) => track.id);
    if (!list.length) {
      toast("Belum ada lagu.", { icon: "info" });
      return;
    }
    playQueueIds(list, list[0], { type: "songs", label: "Semua lagu" }, false);
  }

  async function shuffleLibrary() {
    const ids = L.tracksAlphabetical().map((track) => track.id);
    if (!ids.length) {
      toast("Perpustakaan masih kosong.", { icon: "info" });
      return;
    }
    playQueueIds(ids, null, { type: "library", label: "Perpustakaan" }, true);
  }

  async function shuffleRecent() {
    const ids = L.recent().map((track) => track.id);
    if (!ids.length) {
      toast("Belum ada riwayat pemutaran.", { icon: "info" });
      return;
    }
    playQueueIds(ids, null, { type: "recent", label: "Riwayat" }, true);
  }

  async function clearHistoryInteractive() {
    const ok = await UI.confirm({
      title: "Hapus riwayat pemutaran?",
      message: "Daftar lagu yang pernah diputar akan dihapus. Lagu di perpustakaan tetap aman.",
      confirmLabel: "Hapus riwayat",
      danger: true,
      icon: "clock"
    });
    if (!ok) return;
    await L.clearHistory();
    toast("Riwayat pemutaran dihapus.", { type: "success" });
    refreshView({ keepScroll: true });
  }

  async function playFavorites(shuffle) {
    const ids = L.favorites().map((track) => track.id);
    if (O && typeof O.likedTrackIds === "function") {
      O.likedTrackIds().forEach((id) => {
        if (!ids.includes(id)) ids.push(id);
      });
    }
    if (!ids.length) {
      toast("Belum ada lagu yang disukai.", { icon: "info" });
      return;
    }
    playQueueIds(ids, ids[0], { type: "favorites", label: "Suka" }, shuffle);
  }

  async function playSearch(query) {
    const value = String(query || "").trim();
    if (!value) return;
    const results = L.search(value, 500);
    if (results.tracks.length) {
      const ids = results.tracks.map((track) => track.id);
      P.playQueue(ids, ids[0], { type: "search", query: value, label: value });
      return;
    }

    const snapshot = await prepareSearchOnline(value);
    const onlineTracks =
      snapshot &&
      cleanSearchQuery(snapshot.query).toLowerCase() === cleanSearchQuery(value).toLowerCase() &&
      Array.isArray(snapshot.results)
        ? snapshot.results
        : [];
    if (!onlineTracks.length) {
      toast("Tidak ada lagu untuk diputar. Coba kata kunci lain.", { icon: "info" });
      return;
    }
    const ids = onlineTracks.map((track) => track.id);
    P.playQueue(ids, ids[0], {
      type: "online",
      provider: "youtube",
      query: cleanSearchQuery(value),
      label: "Cari · YouTube"
    });
  }

  function retrySearchOnline(query) {
    const value = cleanSearchQuery(query) || searchRouteQuery();
    if (!value) return;
    prepareSearchOnline(value, { force: true });
  }

  function useOnlineSearch(query) {
    const value = String(query || "").trim();
    const params = new URLSearchParams();
    if (value) params.set("q", value);
    navigate(params.toString() ? "#/search?" + params.toString() : "#/search");
  }

  function queueOnlineTrack(trackId) {
    const track = O.getTrack(trackId);
    if (!track) return;
    const snapshot = O.snapshot();
    const query = snapshot.provider === track.provider ? snapshot.query : "";
    const context = {
      type: "online",
      provider: track.provider,
      query,
      label: contextLabel({ type: "online", provider: track.provider, query })
    };
    return addTrackToQueue(
      track,
      { context },
      "“" + track.title + "” ditambahkan ke antrean."
    );
  }

  async function addTrackToQueue(track, options, successMessage) {
    const added = await P.addToQueue([track.id], options);
    if (added) {
      toast(successMessage, { type: "success" });
    } else {
      toast("“" + track.title + "” sedang diputar dan sudah ada di antrean.", {
        icon: "info"
      });
    }
  }

  function openOnlineMenu(trackId, anchor) {
    const track = O.getTrack(trackId);
    if (!track) return;
    const liked = !!track.liked;
    const quality =
      AM.Downloads && typeof AM.Downloads.downloadQuality === "function"
        ? AM.Downloads.qualityLabel(AM.Downloads.downloadQuality())
        : "";
    const row = anchor.closest(".track-row");
    const items = [
      {
        label: "Putar",
        icon: "play",
        onSelect: () => playFromRow(trackId, row)
      },
      {
        label: "Putar berikutnya",
        icon: "list",
        onSelect: () =>
          addTrackToQueue(track, { next: true }, "“" + track.title + "” akan diputar berikutnya.")
      },
      {
        label: "Tambahkan ke antrean",
        icon: "plus",
        onSelect: () => queueOnlineTrack(trackId)
      },
      "divider",
      {
        label: liked ? "Hapus dari Suka" : "Sukai lagu",
        icon: liked ? "heart-fill" : "heart",
        onSelect: () => toggleLike(trackId)
      },
      {
        label: "Unduh audio" + (quality ? " · " + quality : ""),
        icon: "download",
        onSelect: () => downloadTrack(track)
      }
    ];
    if (track.externalUrl) {
      items.push("divider", {
        label: "Buka di YouTube",
        icon: "external",
        onSelect: () => openExternalUrl(track.externalUrl)
      });
    }
    UI.contextMenu({ anchor, items });
  }

  async function downloadTrack(track) {
    if (!AM.Downloads) {
      toast("Modul unduhan belum siap. Muat ulang halaman.", { type: "error" });
      return;
    }
    try {
      await AM.Downloads.download(track);
    } catch (error) {
      console.warn("[app] unduhan gagal:", error);
      toast("Unduhan gagal dimulai. Coba lagi.", { type: "error" });
    }
  }

  function downloadCurrentTrack() {
    const track = P.currentTrack();
    if (!track || !track.online || track.provider !== "youtube") {
      toast("Unduhan tersedia untuk lagu YouTube.", { icon: "info" });
      return;
    }
    downloadTrack(track);
  }

  /* ------------------------------------------------------------------------
     Menu konteks
     ------------------------------------------------------------------------ */

  function openTrackMenu(trackId, anchor) {
    const track = L.getTrack(trackId);
    if (!track) return;
    const row = anchor.closest(".track-row");
    const queue = getRowQueue(row) || { type: "songs" };
    const items = [
      {
        label: "Putar",
        icon: "play",
        onSelect: () => playFromRow(trackId, row)
      },
      {
        label: "Putar berikutnya",
        icon: "list",
        onSelect: () =>
          addTrackToQueue(track, { next: true }, "“" + track.title + "” akan diputar berikutnya.")
      },
      {
        label: "Tambahkan ke antrean",
        icon: "plus",
        onSelect: () =>
          addTrackToQueue(track, {}, "“" + track.title + "” ditambahkan ke antrean.")
      },
      "divider",
      {
        label: track.liked ? "Hapus dari Suka" : "Sukai lagu",
        icon: track.liked ? "heart-fill" : "heart",
        onSelect: () => toggleLike(trackId)
      },
      {
        label: "Tambahkan ke playlist…",
        icon: "playlist",
        onSelect: () => openAddToPlaylist([trackId])
      },
      "divider",
      {
        label: "Buka album",
        icon: "disc",
        onSelect: () => {
          if (track.albumKey) navigate("#/album/" + encodeURIComponent(track.albumKey));
        }
      },
      {
        label: "Buka artis",
        icon: "user",
        onSelect: () => {
          if (track.artistKey) navigate("#/artist/" + encodeURIComponent(track.artistKey));
        }
      }
    ];

    if (queue.playlistId) {
      items.push("divider", {
        label: "Hapus dari playlist",
        icon: "minus",
        onSelect: async () => {
          await L.removeFromPlaylist(queue.playlistId, [trackId]);
          toast("Lagu dihapus dari playlist.");
        }
      });
    }

    items.push("divider", {
      label: "Hapus dari perpustakaan",
      icon: "trash",
      danger: true,
      onSelect: async () => {
        const ok = await UI.confirm({
          title: "Hapus lagu?",
          message:
            "“" +
            track.title +
            "” akan dihapus dari perpustakaan aplikasi ini. File asli di perangkatmu tidak terpengaruh.",
          confirmLabel: "Hapus lagu",
          danger: true,
          icon: "trash"
        });
        if (!ok) return;
        state.suppressRefresh = true;
        try {
          await L.removeTracks([trackId]);
        } finally {
          state.suppressRefresh = false;
        }
        afterTrackRemoval({ albumKey: track.albumKey, artistKey: track.artistKey });
        toast("Lagu dihapus dari perpustakaan.");
      }
    });

    UI.contextMenu({ anchor, items });
  }

  function afterTrackRemoval(info) {
    if (
      state.currentRoute &&
      state.currentRoute.name === "album" &&
      info.albumKey &&
      !L.getAlbum(info.albumKey)
    ) {
      navigate("#/albums", { replace: true });
      return;
    }
    if (
      state.currentRoute &&
      state.currentRoute.name === "artist" &&
      info.artistKey &&
      !L.getArtist(info.artistKey)
    ) {
      navigate("#/artists", { replace: true });
      return;
    }
    refreshView({ keepScroll: true });
  }

  function openAlbumMenu(key, anchor) {
    const album = L.getAlbum(key);
    if (!album) return;
    const allLiked = album.tracks.every((track) => track.liked);
    const items = [
      { label: "Putar album", icon: "play", onSelect: () => playAlbum(key, false) },
      { label: "Acak album", icon: "shuffle", onSelect: () => playAlbum(key, true) },
      {
        label: "Tambahkan ke antrean",
        icon: "plus",
        onSelect: () => queueAlbum(key)
      },
      "divider",
      {
        label: allLiked ? "Hapus album dari Suka" : "Sukai semua lagu",
        icon: allLiked ? "heart-fill" : "heart",
        onSelect: () => likeAlbum(key)
      },
      {
        label: "Tambahkan ke playlist…",
        icon: "playlist",
        onSelect: () =>
          openAddToPlaylist(album.tracks.map((track) => track.id), {
            title: "Tambahkan album ke playlist",
            sub: album.name
          })
      },
      {
        label: "Buka artis",
        icon: "user",
        onSelect: () => navigate("#/artist/" + encodeURIComponent(album.artistKey))
      },
      "divider",
      {
        label: "Hapus album dari perpustakaan",
        icon: "trash",
        danger: true,
        onSelect: async () => {
          const ok = await UI.confirm({
            title: "Hapus album?",
            message:
              "Semua " +
              album.tracks.length +
              " lagu dalam “" +
              album.name +
              "” akan dihapus dari perpustakaan aplikasi. File asli tetap aman.",
            confirmLabel: "Hapus album",
            danger: true,
            icon: "trash"
          });
          if (!ok) return;
          state.suppressRefresh = true;
          try {
            await L.removeTracks(album.tracks.map((track) => track.id));
          } finally {
            state.suppressRefresh = false;
          }
          if (state.currentRoute && state.currentRoute.name === "album" && state.currentRoute.params.key === key) {
            navigate("#/albums", { replace: true });
          } else {
            refreshView({ keepScroll: true });
          }
          toast("Album dihapus dari perpustakaan.");
        }
      }
    ];
    UI.contextMenu({ anchor, items });
  }

  function openPlaylistMenu(id, anchor) {
    const playlist = L.getPlaylist(id);
    if (!playlist) return;
    const items = [
      { label: "Putar playlist", icon: "play", onSelect: () => playPlaylist(id, false) },
      { label: "Acak playlist", icon: "shuffle", onSelect: () => playPlaylist(id, true) },
      { label: "Tambah lagu…", icon: "plus", onSelect: () => openAddTracksToPlaylist(id) },
      "divider",
      {
        label: "Ganti nama playlist",
        icon: "edit",
        onSelect: async () => {
          const name = await UI.prompt({
            title: "Ganti nama playlist",
            label: "Nama playlist",
            value: playlist.name,
            confirmLabel: "Simpan"
          });
          if (!name) return;
          await L.updatePlaylist(id, { name });
          toast("Nama playlist diperbarui.", { type: "success" });
        }
      },
      "divider",
      {
        label: "Hapus playlist",
        icon: "trash",
        danger: true,
        onSelect: async () => {
          const ok = await UI.confirm({
            title: "Hapus playlist?",
            message: "Playlist “" + playlist.name + "” akan dihapus. Lagu di perpustakaan tetap aman.",
            confirmLabel: "Hapus playlist",
            danger: true,
            icon: "trash"
          });
          if (!ok) return;
          await L.deletePlaylist(id);
          if (state.currentRoute && state.currentRoute.name === "playlist" && state.currentRoute.params.key === id) {
            navigate("#/home", { replace: true });
          }
          toast("Playlist dihapus.");
        }
      }
    ];
    UI.contextMenu({ anchor, items });
  }

  /* ------------------------------------------------------------------------
     Playlist — buat & pilih
     ------------------------------------------------------------------------ */

  async function createPlaylistInteractive(options) {
    const opts = options || {};
    closeSidebar();
    const name = await UI.prompt({
      title: "Playlist baru",
      eyebrow: "Playlist",
      label: "Nama playlist",
      placeholder: "Misalnya: Lagu untuk malam",
      confirmLabel: "Buat playlist"
    });
    if (!name) return null;
    const playlist = L.createPlaylist(name);
    renderSidebarPlaylists();
    toast("Playlist “" + playlist.name + "” dibuat.", { type: "success" });
    if (opts.navigate !== false) {
      navigate("#/playlist/" + encodeURIComponent(playlist.id));
    }
    return playlist;
  }

  function openAddToPlaylist(trackIds, options) {
    const opts = options || {};
    const ids = Array.from(new Set(trackIds || [])).filter((id) => L.getTrack(id));
    if (!ids.length) return;

    const selected = new Set();
    const body = document.createElement("div");
    body.innerHTML =
      (opts.sub ? '<p class="field__hint" style="margin-bottom:12px">' + U.esc(opts.sub) + "</p>" : "") +
      '<div class="picker-search"><input class="input" type="search" data-picker-filter placeholder="Cari playlist…" aria-label="Cari playlist"></div>' +
      '<div class="picker-list" data-picker-list></div>';

    const footer = document.createElement("div");
    const footerActions = document.createElement("div");
    footerActions.className = "inline-actions";
    const createButton = UI.makeButton("Playlist baru", {
      small: false,
      icon: "plus",
      className: "btn--secondary"
    });
    const cancelButton = UI.makeButton("Batal", { onClick: () => api.close() });
    const saveButton = UI.makeButton("Tambahkan", { primary: true, onClick: () => save() });
    footerActions.appendChild(cancelButton);
    footerActions.appendChild(saveButton);
    footer.appendChild(createButton);
    footer.appendChild(footerActions);

    function renderList(filter) {
      const list = body.querySelector("[data-picker-list]");
      if (!list) return;
      const needle = U.normalize(filter || "");
      const playlists = L.state.playlists.filter(
        (playlist) => !needle || U.normalize(playlist.name).includes(needle)
      );
      if (!L.state.playlists.length) {
        list.innerHTML =
          '<div class="picker-empty">Belum ada playlist. Buat playlist baru untuk mulai menyusun koleksi.</div>';
        updateSave();
        return;
      }
      if (!playlists.length) {
        list.innerHTML = '<div class="picker-empty">Playlist tidak ditemukan.</div>';
        updateSave();
        return;
      }
      list.innerHTML = playlists
        .map((playlist) => {
          const isSelected = selected.has(playlist.id);
          return (
            '<button class="picker-item' +
            (isSelected ? " is-selected" : "") +
            '" type="button" role="checkbox" aria-checked="' +
            (isSelected ? "true" : "false") +
            '" data-pick-playlist="' +
            U.esc(playlist.id) +
            '">' +
            '<span class="picker-item__art"><img src="' +
            U.esc(L.playlistArt(playlist)) +
            '" alt="" loading="lazy"></span>' +
            '<span class="picker-item__text"><span class="picker-item__title">' +
            U.esc(playlist.name) +
            '</span><span class="picker-item__sub">' +
            L.playlistTracks(playlist).length +
            " lagu</span></span>" +
            '<span class="picker-item__check">' +
            icon("check") +
            "</span></button>"
          );
        })
        .join("");
      updateSave();
    }

    function updateSave() {
      saveButton.disabled = selected.size === 0 || !L.state.playlists.length;
      saveButton.innerHTML =
        icon("plus") + "<span>" + (selected.size ? "Tambahkan (" + selected.size + ")" : "Tambahkan") + "</span>";
    }

    async function save() {
      if (!selected.size) return;
      const chosen = Array.from(selected);
      let added = 0;
      for (const playlistId of chosen) {
        // eslint-disable-next-line no-await-in-loop
        added += await L.addToPlaylist(playlistId, ids);
      }
      api.close();
      if (added) {
        toast(
          added +
            " lagu ditambahkan ke " +
            (chosen.length === 1 ? "playlist." : chosen.length + " playlist."),
          { type: "success" }
        );
      } else {
        toast("Lagu sudah ada di playlist yang dipilih.", { icon: "info" });
      }
      refreshView({ keepScroll: true });
    }

    const api = UI.openModal({
      title: opts.title || "Tambahkan ke playlist",
      eyebrow: "Playlist",
      sub: ids.length + " lagu dipilih",
      body,
      footer,
      footerBetween: true,
      initialFocus: "[data-picker-filter]",
      onClose: () => {
        /* Tidak ada yang perlu dibersihkan. */
      }
    });

    body.addEventListener("click", (event) => {
      const item = event.target.closest("[data-pick-playlist]");
      if (!item) return;
      const id = item.dataset.pickPlaylist;
      if (selected.has(id)) selected.delete(id);
      else selected.add(id);
      item.classList.toggle("is-selected", selected.has(id));
      item.setAttribute("aria-checked", selected.has(id) ? "true" : "false");
      updateSave();
    });

    const filter = body.querySelector("[data-picker-filter]");
    if (filter) {
      filter.addEventListener("input", () => renderList(filter.value));
    }

    createButton.addEventListener("click", async () => {
      const playlist = await createPlaylistInteractive({ navigate: false });
      if (!playlist) return;
      selected.add(playlist.id);
      renderSidebarPlaylists();
      renderList(filter ? filter.value : "");
      toast("Playlist baru ditambahkan. Tekan Tambahkan untuk menyimpan.", { icon: "info" });
    });

    renderList("");
  }

  function openAddTracksToPlaylist(playlistId) {
    const playlist = L.getPlaylist(playlistId);
    if (!playlist) return;
    const existing = new Set(playlist.trackIds);
    const available = L.tracksAlphabetical().filter((track) => !existing.has(track.id));
    const selected = new Set();
    const body = document.createElement("div");

    if (!L.allTracks().length) {
      let emptyModal;
      emptyModal = UI.openModal({
        title: "Tambah lagu",
        eyebrow: "Playlist",
        sub: playlist.name,
        body: AM.Views.emptyState({
          icon: "music",
          title: "Perpustakaan masih kosong",
          text: "Impor musik terlebih dahulu untuk menambahkan lagu ke playlist.",
          actions:
            '<button class="btn btn--primary" type="button" data-action="open-import">' +
            icon("upload") +
            "<span>Impor musik</span></button>"
        }),
        footer: UI.makeButton("Tutup", { primary: true, onClick: () => emptyModal.close() })
      });
      return;
    }

    body.innerHTML =
      '<div class="picker-search"><input class="input" type="search" data-picker-filter placeholder="Cari lagu, artis, atau album…" aria-label="Cari lagu"></div>' +
      '<div class="picker-list picker-list--tracks" data-picker-list></div>';

    const footer = document.createElement("div");
    footer.className = "inline-actions";
    const cancel = UI.makeButton("Batal", { onClick: () => api.close() });
    const save = UI.makeButton("Tambahkan", { primary: true, onClick: () => doSave() });
    footer.appendChild(cancel);
    footer.appendChild(save);

    let api;

    function renderTracks(filter) {
      const list = body.querySelector("[data-picker-list]");
      if (!list) return;
      const needle = U.normalize(filter || "");
      const tracks = available.filter((track) => {
        if (!needle) return true;
        return (
          U.normalize(track.title).includes(needle) ||
          U.normalize(track.artist).includes(needle) ||
          U.normalize(track.album).includes(needle)
        );
      });
      if (!available.length) {
        list.innerHTML =
          '<div class="picker-empty">Semua lagu di perpustakaan sudah ada di playlist ini.</div>';
      } else if (!tracks.length) {
        list.innerHTML = '<div class="picker-empty">Tidak ada lagu yang cocok.</div>';
      } else {
        list.innerHTML = tracks
          .map((track) => {
            const isSelected = selected.has(track.id);
            return (
              '<button class="picker-item' +
              (isSelected ? " is-selected" : "") +
              '" type="button" role="checkbox" aria-checked="' +
              (isSelected ? "true" : "false") +
              '" data-pick-track="' +
              U.esc(track.id) +
              '">' +
              '<span class="picker-item__art"><img src="' +
              U.esc(L.trackArt(track)) +
              '" alt="" loading="lazy"></span>' +
              '<span class="picker-item__text"><span class="picker-item__title">' +
              U.esc(track.title) +
              '</span><span class="picker-item__sub">' +
              U.esc(track.artist) +
              (track.album ? " · " + U.esc(track.album) : "") +
              "</span></span>" +
              '<span class="picker-item__check">' +
              icon("check") +
              "</span></button>"
            );
          })
          .join("");
      }
      updateSave();
    }

    function updateSave() {
      save.disabled = !selected.size;
      save.innerHTML =
        icon("plus") + "<span>" + (selected.size ? "Tambah (" + selected.size + ")" : "Tambahkan") + "</span>";
    }

    async function doSave() {
      if (!selected.size) return;
      const added = await L.addToPlaylist(playlistId, Array.from(selected));
      api.close();
      if (added) {
        toast(added + " lagu ditambahkan ke “" + playlist.name + "”.", { type: "success" });
        refreshView({ keepScroll: true });
      } else {
        toast("Tidak ada lagu baru yang ditambahkan.", { icon: "info" });
      }
    }

    api = UI.openModal({
      title: "Tambah lagu",
      eyebrow: "Playlist",
      sub: playlist.name,
      width: "wide",
      body,
      footer,
      initialFocus: "[data-picker-filter]"
    });

    body.addEventListener("click", (event) => {
      const item = event.target.closest("[data-pick-track]");
      if (!item) return;
      const id = item.dataset.pickTrack;
      if (selected.has(id)) selected.delete(id);
      else selected.add(id);
      item.classList.toggle("is-selected", selected.has(id));
      item.setAttribute("aria-checked", selected.has(id) ? "true" : "false");
      updateSave();
    });

    const filter = body.querySelector("[data-picker-filter]");
    if (filter) filter.addEventListener("input", () => renderTracks(filter.value));

    renderTracks("");
  }

  /* ------------------------------------------------------------------------
     Impor
     ------------------------------------------------------------------------ */

  function importChooserHTML() {
    return (
      '<div class="dropzone" data-import-dropzone>' +
      '<span class="dropzone__icon">' +
      icon("upload") +
      "</span>" +
      "<h3>Seret file musik ke sini</h3>" +
      "<p>atau pilih file dari perangkatmu. Metadata dan sampul dibaca otomatis.</p>" +
      '<div class="import-actions">' +
      '<button class="btn btn--primary btn--small" type="button" data-import-pick>' +
      icon("folder") +
      "<span>Pilih file</span></button>" +
      '<button class="btn btn--secondary btn--small" type="button" data-import-folder>' +
      icon("folder") +
      "<span>Pilih folder</span></button>" +
      "</div>" +
      '<p class="import-formats"><strong>MP3 · M4A · FLAC · WAV · OGG</strong><br>File tetap berada di perangkat ini.</p>' +
      '<button class="text-btn" type="button" data-import-demo style="margin-top:8px">' +
      icon("sparkles") +
      " Coba perpustakaan demo</button>" +
      "</div>"
    );
  }

  function resetImportChooser(modal) {
    if (!modal) return;
    const target = state.importPlaylistId ? L.getPlaylist(state.importPlaylistId) : null;
    modal.setTitle(
      target ? "Impor ke playlist" : "Impor musik",
      target
        ? "File masuk ke perpustakaan sekaligus ke “" + target.name + "”."
        : "Tambahkan file audio dari perangkatmu."
    );
    modal.setBody(importChooserHTML());
    modal.setFooter(null);
    bindImportChooser(modal, modal.body);
  }

  function openImportDialog(options) {
    const opts = options || {};
    const target = opts.playlistId ? L.getPlaylist(opts.playlistId) : null;
    if (opts.playlistId) state.importPlaylistId = opts.playlistId;
    closeSidebar();
    if (state.activeImportModal) {
      if (!state.importJob) resetImportChooser(state.activeImportModal);
      return state.activeImportModal;
    }

    const body = document.createElement("div");
    body.innerHTML = importChooserHTML();

    const modal = UI.openModal({
      title: target ? "Impor ke playlist" : "Impor musik",
      eyebrow: target ? "Playlist" : "Perpustakaan",
      sub: target
        ? "File masuk ke perpustakaan sekaligus ke “" + target.name + "”."
        : "Tambahkan file audio dari perangkatmu.",
      body,
      onClose: () => {
        if (state.activeImportModal === modal) state.activeImportModal = null;
        if (state.importJob) state.importJob.cancel = true;
        state.importPlaylistId = "";
      }
    });

    state.activeImportModal = modal;
    bindImportChooser(modal, body);
    return modal;
  }

  function bindImportChooser(modal, body) {
    if (!body) return;
    const dropzone = body.querySelector("[data-import-dropzone]");
    const pick = body.querySelector("[data-import-pick]");
    const folder = body.querySelector("[data-import-folder]");
    const demo = body.querySelector("[data-import-demo]");

    if (pick) pick.addEventListener("click", () => els.fileInput && els.fileInput.click());
    if (folder) folder.addEventListener("click", () => els.folderInput && els.folderInput.click());
    if (demo) {
      demo.addEventListener("click", () => {
        loadDemo(modal);
      });
    }

    if (dropzone) {
      dropzone.addEventListener("click", (event) => {
        if (event.target.closest("button, a, input")) return;
        if (els.fileInput) els.fileInput.click();
      });
      dropzone.addEventListener("dragover", (event) => {
        event.preventDefault();
        event.stopPropagation();
        dropzone.classList.add("is-dragover");
      });
      dropzone.addEventListener("dragleave", () => {
        dropzone.classList.remove("is-dragover");
      });
      dropzone.addEventListener("drop", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        dropzone.classList.remove("is-dragover");
        if (state.importJob) {
          toast("Impor sedang berjalan. Tunggu hingga selesai.", { icon: "info" });
          return;
        }
        const files = await filesFromDataTransfer(event.dataTransfer);
        if (files.length) startImport(files);
        else toast("Tidak ada file yang terbaca.", { icon: "alert" });
      });
    }
  }

  function showImportProgress(modal, options) {
    if (!modal) return;
    const opts = options || {};
    modal.setTitle(opts.title || "Mengimpor musik", opts.sub || "Jangan tutup jendela ini.");
    const body = document.createElement("div");
    body.innerHTML =
      '<div class="progress"><div class="progress__bar" data-import-bar></div></div>' +
      '<div class="progress-meta"><strong data-import-count>Menyiapkan…</strong><span data-import-pct>0%</span></div>' +
      '<div class="import-progress-file" data-import-file><span data-import-stage>Membaca file</span> · <span data-import-name>—</span></div>';
    modal.setBody(body);
    if (opts.onCancel) {
      const footer = document.createElement("div");
      footer.className = "inline-actions";
      const cancel = UI.makeButton("Batalkan", {
        onClick: () => {
          cancel.disabled = true;
          cancel.innerHTML = "<span>Membatalkan…</span>";
          opts.onCancel();
        }
      });
      footer.appendChild(cancel);
      modal.setFooter(footer);
    } else {
      modal.setFooter(null);
    }
  }

  function updateImportProgress(modal, detail) {
    if (!modal || !modal.el) return;
    const current = Number(detail && detail.current) || 0;
    const total = Number(detail && detail.total) || 0;
    const ratio = total > 0 ? U.clamp(current / total, 0, 1) : 0;
    const bar = modal.el.querySelector("[data-import-bar]");
    const count = modal.el.querySelector("[data-import-count]");
    const pct = modal.el.querySelector("[data-import-pct]");
    const stage = modal.el.querySelector("[data-import-stage]");
    const name = modal.el.querySelector("[data-import-name]");
    if (bar) bar.style.width = (ratio * 100).toFixed(2) + "%";
    if (pct) pct.textContent = Math.round(ratio * 100) + "%";
    if (count) {
      count.textContent =
        total > 0 ? "Memproses " + current + " dari " + total + " file" : "Memeriksa file…";
    }
    if (stage) stage.textContent = (detail && detail.stage) || "Memproses";
    if (name) name.textContent = (detail && detail.name) || "—";
  }

  function summaryRow(iconName, html) {
    return '<div class="import-summary__row">' + icon(iconName) + "<div>" + html + "</div></div>";
  }

  function importSummaryHTML(summary) {
    const rows = [];
    if (summary.added) {
      rows.push(
        summaryRow("check", "<strong>" + summary.added + " lagu</strong> berhasil diimpor ke perpustakaan.")
      );
    }
    if (summary.skipped) {
      rows.push(summaryRow("info", "<strong>" + summary.skipped + " lagu</strong> dilewati karena sudah ada."));
    }
    if (summary.unsupported) {
      rows.push(
        summaryRow("alert", "<strong>" + summary.unsupported + " file</strong> bukan audio yang didukung dan dilewati.")
      );
    }
    if (summary.failed) {
      rows.push(summaryRow("alert", "<strong>" + summary.failed + " file</strong> gagal diimpor."));
    }
    if (summary.cancelled) {
      rows.push(summaryRow("info", "Impor dibatalkan sebelum semua file selesai."));
    }
    if (summary.playlistName) {
      rows.push(
        summaryRow(
          "playlist",
          summary.playlistAdded
            ? "<strong>" +
              summary.playlistAdded +
              " lagu</strong> ditambahkan ke playlist “" +
              U.esc(summary.playlistName) +
              "”."
            : "Semua lagu sudah ada di playlist “" + U.esc(summary.playlistName) + "”."
        )
      );
    }
    if (!rows.length) {
      rows.push(
        summaryRow(
          "info",
          summary.errors && summary.errors.length
            ? "Tidak ada file yang berhasil diimpor."
            : "Tidak ada file audio yang dipilih."
        )
      );
    }
    if (summary.errors && summary.errors.length) {
      summary.errors.slice(0, 12).forEach((error) => {
        rows.push(
          summaryRow(
            "alert",
            "<strong>" + U.esc(error.name || "File") + "</strong><br>" + U.esc(error.message || "Gagal diimpor")
          )
        );
      });
    }
    return '<div class="import-summary">' + rows.join("") + "</div>";
  }

  function showImportSummary(modal, summary) {
    if (!modal || !modal.el || !modal.el.isConnected) return;
    const added = summary.added || 0;
    const title = added
      ? "Impor selesai"
      : summary.cancelled
        ? "Impor dibatalkan"
        : "Tidak ada yang diimpor";
    const sub = added
      ? added +
        " lagu ditambahkan ke perpustakaanmu" +
        (summary.playlistName ? " dan playlist “" + summary.playlistName + "”." : ".")
      : "Periksa detail di bawah ini.";
    modal.setTitle(title, sub);
    modal.setBody(importSummaryHTML(summary));

    const footer = document.createElement("div");
    footer.className = "inline-actions";
    footer.appendChild(
      UI.makeButton("Impor lagi", {
        onClick: () => resetImportChooser(modal)
      })
    );
    footer.appendChild(
      UI.makeButton("Selesai", {
        primary: true,
        onClick: () => modal.close()
      })
    );
    modal.setFooter(footer);
  }

  async function applyImportPlaylistTarget(summary, playlistId) {
    const targetId = playlistId || state.importPlaylistId;
    if (!summary || !targetId) return summary;
    const playlist = L.getPlaylist(targetId);
    const ids = (summary.addedIds || []).concat(summary.existingIds || []);
    if (!playlist || !ids.length) return summary;
    summary.playlistId = playlist.id;
    summary.playlistName = playlist.name;
    summary.playlistAdded = await L.addToPlaylist(playlist.id, ids);
    return summary;
  }

  async function startImport(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    const targetPlaylistId = state.importPlaylistId;
    if (state.importJob) {
      toast("Impor sedang berjalan. Tunggu hingga selesai.", { icon: "info" });
      return;
    }

    const modal = state.activeImportModal || openImportDialog();
    const job = { cancel: false };
    state.importJob = job;

    const audioCount = files.filter((file) => L.isAudioFile(file)).length;
    showImportProgress(modal, {
      title: "Mengimpor musik",
      sub: "Jangan tutup jendela ini sampai selesai.",
      onCancel: () => {
        job.cancel = true;
        const count = modal.body.querySelector("[data-import-count]");
        if (count) count.textContent = "Membatalkan setelah file ini…";
      }
    });

    const off = L.on("importprogress", (detail) => updateImportProgress(modal, detail));
    let summary;
    try {
      summary = await L.importFiles(files, { shouldCancel: () => job.cancel });
    } catch (error) {
      console.error("[app] impor gagal:", error);
      summary = {
        total: audioCount,
        added: 0,
        skipped: 0,
        failed: files.length,
        unsupported: 0,
        errors: [{ name: "Impor", message: error && error.message ? error.message : "Gagal mengimpor" }],
        addedIds: [],
        cancelled: false
      };
    } finally {
      off();
      if (state.importJob === job) state.importJob = null;
    }

    await applyImportPlaylistTarget(summary, targetPlaylistId);

    if (modal.el && modal.el.isConnected) {
      showImportSummary(modal, summary);
    } else if (summary.playlistName) {
      toast(
        (summary.playlistAdded || 0) +
          " lagu ditambahkan ke playlist “" +
          summary.playlistName +
          "”.",
        { type: "success" }
      );
    } else if (summary.added) {
      toast(summary.added + " lagu diimpor ke perpustakaan.", { type: "success" });
    } else if (summary.failed || summary.errors.length) {
      toast("Impor selesai dengan masalah. " + summary.failed + " file gagal.", { type: "error" });
    }
  }

  async function loadDemo(sourceModal) {
    if (state.importJob) {
      toast("Impor sedang berjalan. Tunggu hingga selesai.", { icon: "info" });
      return;
    }
    if (L.getSetting("demoLoaded", false) && L.allTracks().length) {
      toast("Perpustakaan demo sudah dimuat.", { icon: "info" });
      return;
    }
    if (L.allTracks().length) {
      const ok = await UI.confirm({
        title: "Muat perpustakaan demo?",
        message:
          "Ini akan menambahkan 12 lagu demo ke perpustakaanmu. Kamu bisa menghapusnya kapan saja tanpa memengaruhi file aslimu.",
        confirmLabel: "Muat demo"
      });
      if (!ok) return;
    }

    const modal = sourceModal || state.activeImportModal || openImportDialog();
    const targetPlaylistId = state.importPlaylistId;
    showImportProgress(modal, {
      title: "Menyiapkan demo",
      sub: "Membuat audio contoh di browser. Ini mungkin memerlukan beberapa detik."
    });

    const updateDemo = (detail) =>
      updateImportProgress(modal, {
        current: detail.current,
        total: detail.total,
        name: detail.name,
        stage: "Merender audio demo"
      });
    const updateImport = (detail) => updateImportProgress(modal, detail);
    const offDemo = L.on("demo-progress", updateDemo);
    const offImport = L.on("importprogress", updateImport);

    let summary;
    try {
      summary = await L.importDemo();
    } catch (error) {
      console.error("[app] demo gagal:", error);
      summary = {
        total: 0,
        added: 0,
        skipped: 0,
        failed: 1,
        unsupported: 0,
        errors: [{ name: "Demo", message: error && error.message ? error.message : "Gagal membuat demo" }],
        addedIds: [],
        cancelled: false
      };
    } finally {
      offDemo();
      offImport();
    }

    await applyImportPlaylistTarget(summary, targetPlaylistId);

    if (modal.el && modal.el.isConnected) {
      showImportSummary(modal, summary);
    } else if (summary.added) {
      toast("Perpustakaan demo siap — " + summary.added + " lagu ditambahkan.", { type: "success" });
    }
    if (summary.added) refreshView({ focusSearch: false });
  }

  async function filesFromDataTransfer(dataTransfer) {
    if (!dataTransfer) return [];
    const items = dataTransfer.items ? Array.from(dataTransfer.items) : [];
    const entries = items
      .filter((item) => item.kind === "file" && typeof item.webkitGetAsEntry === "function")
      .map((item) => item.webkitGetAsEntry())
      .filter(Boolean);

    if (!entries.length) return Array.from(dataTransfer.files || []);

    const files = [];
    for (const entry of entries) {
      // eslint-disable-next-line no-await-in-loop
      await walkEntry(entry, files);
    }
    return files;
  }

  function readEntryFile(entry) {
    return new Promise((resolve) => {
      entry.file(
        (file) => resolve(file),
        () => resolve(null)
      );
    });
  }

  function readDirectoryEntries(reader) {
    return new Promise((resolve) => {
      const result = [];
      const read = () => {
        reader.readEntries(
          (entries) => {
            if (!entries.length) {
              resolve(result);
              return;
            }
            result.push.apply(result, entries);
            read();
          },
          () => resolve(result)
        );
      };
      read();
    });
  }

  async function walkEntry(entry, result) {
    if (!entry) return;
    if (entry.isFile) {
      const file = await readEntryFile(entry);
      if (file) result.push(file);
      return;
    }
    if (entry.isDirectory) {
      const reader = entry.createReader();
      const entries = await readDirectoryEntries(reader);
      for (const child of entries) {
        // eslint-disable-next-line no-await-in-loop
        await walkEntry(child, result);
      }
    }
  }

  function bindGlobalDrop() {
    const hasFiles = (event) => {
      const types = event.dataTransfer && event.dataTransfer.types;
      return types ? Array.from(types).includes("Files") : false;
    };

    const modalOpen = () => UI.hasOpenModal();

    window.addEventListener("dragenter", (event) => {
      if (!hasFiles(event) || modalOpen()) return;
      event.preventDefault();
      state.dragDepth += 1;
      if (els.dropOverlay) els.dropOverlay.hidden = false;
    });

    window.addEventListener("dragover", (event) => {
      if (!hasFiles(event)) return;
      if (modalOpen()) {
        if (els.dropOverlay) els.dropOverlay.hidden = true;
        return;
      }
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      if (els.dropOverlay) els.dropOverlay.hidden = false;
    });

    window.addEventListener("dragleave", (event) => {
      if (!hasFiles(event)) return;
      state.dragDepth = Math.max(0, state.dragDepth - 1);
      if ((!state.dragDepth || modalOpen()) && els.dropOverlay) els.dropOverlay.hidden = true;
    });

    window.addEventListener("drop", async (event) => {
      if (!hasFiles(event) || modalOpen()) return;
      event.preventDefault();
      state.dragDepth = 0;
      if (els.dropOverlay) els.dropOverlay.hidden = true;
      if (state.importJob) {
        toast("Impor sedang berjalan. Tunggu hingga selesai.", { icon: "info" });
        return;
      }
      const files = await filesFromDataTransfer(event.dataTransfer);
      if (files.length) startImport(files);
      else toast("Tidak ada file audio yang terbaca.", { icon: "alert" });
    });
  }

  /* ------------------------------------------------------------------------
     Pengaturan
     ------------------------------------------------------------------------ */

  function settingsHTML() {
    const theme = document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
    const shuffle = P.state.shuffle;
    const repeat = P.state.repeat;
    const streamQuality = L.getSetting("streamQuality", "high");
    const downloadQuality = L.getSetting("downloadQuality", "best");
    return (
      '<div class="settings">' +
      '<section class="settings-group"><h3 class="settings-group__title">Tampilan</h3>' +
      '<div class="settings-row"><div class="settings-row__text"><div class="settings-row__title">Tema</div><div class="settings-row__sub">Sesuaikan warna antarmuka dengan suasana hatimu.</div></div>' +
      '<div class="settings-row__action"><div class="segmented">' +
      '<button class="segmented__btn' +
      (theme === "dark" ? " is-active" : "") +
      '" type="button" data-action="set-theme" data-theme="dark">' +
      icon("moon") +
      "Gelap</button>" +
      '<button class="segmented__btn' +
      (theme === "light" ? " is-active" : "") +
      '" type="button" data-action="set-theme" data-theme="light">' +
      icon("sun") +
      "Terang</button>" +
      "</div></div></div></section>" +
      '<section class="settings-group"><h3 class="settings-group__title">Pemutaran</h3>' +
      '<div class="settings-row"><div class="settings-row__text"><div class="settings-row__title">Acak</div><div class="settings-row__sub">Putar antrean dalam urutan acak.</div></div>' +
      '<div class="settings-row__action"><div class="segmented">' +
      '<button class="segmented__btn' +
      (!shuffle ? " is-active" : "") +
      '" type="button" data-action="set-shuffle" data-value="false">Mati</button>' +
      '<button class="segmented__btn' +
      (shuffle ? " is-active" : "") +
      '" type="button" data-action="set-shuffle" data-value="true">Aktif</button>' +
      "</div></div></div>" +
      '<div class="settings-row"><div class="settings-row__text"><div class="settings-row__title">Ulangi</div><div class="settings-row__sub">Ulangi semua lagu atau satu lagu.</div></div>' +
      '<div class="settings-row__action"><div class="segmented">' +
      '<button class="segmented__btn' +
      (repeat === "off" ? " is-active" : "") +
      '" type="button" data-action="set-repeat" data-value="off">Mati</button>' +
      '<button class="segmented__btn' +
      (repeat === "all" ? " is-active" : "") +
      '" type="button" data-action="set-repeat" data-value="all">Semua</button>' +
      '<button class="segmented__btn' +
      (repeat === "one" ? " is-active" : "") +
      '" type="button" data-action="set-repeat" data-value="one">Satu</button>' +
      "</div></div></div>" +
      '<div class="settings-row"><div class="settings-row__text"><div class="settings-row__title">Timer tidur</div><div class="settings-row__sub" id="settingsSleepText">Nonaktif — pemutaran berhenti mengikuti pilihanmu.</div></div>' +
      '<div class="settings-row__action"><button class="btn btn--secondary btn--small" type="button" data-action="sleep-menu">' +
      icon("moon") +
      "Atur</button></div></div></section>" +
      '<section class="settings-group"><h3 class="settings-group__title">Audio</h3>' +
      '<div class="settings-row"><div class="settings-row__text"><div class="settings-row__title">Kualitas streaming</div><div class="settings-row__sub">Bitrate audio untuk lagu YouTube. Perubahan diterapkan ulang ke lagu yang sedang diputar.</div></div>' +
      '<div class="settings-row__action">' +
      qualitySegmented("set-stream-quality", streamQuality) +
      "</div></div>" +
      '<div class="settings-row"><div class="settings-row__text"><div class="settings-row__title">Kualitas unduhan (MP3)</div><div class="settings-row__sub">Semua unduhan YouTube dikonversi ke MP3 dengan judul, artis, album, dan sampul tertanam. Membutuhkan ffmpeg.exe di folder aplikasi.</div></div>' +
      '<div class="settings-row__action">' +
      qualitySegmented("set-download-quality", downloadQuality) +
      "</div></div></section>" +
      '<section class="settings-group"><h3 class="settings-group__title">Data</h3>' +
      '<div class="settings-row"><div class="settings-row__text"><div class="settings-row__title">Impor musik</div><div class="settings-row__sub">MP3, M4A, FLAC, WAV, OGG, dan format audio lain yang didukung browser.</div></div>' +
      '<div class="settings-row__action"><button class="btn btn--secondary btn--small" type="button" data-action="settings-import">' +
      icon("upload") +
      "Impor</button></div></div>" +
      '<div class="settings-row"><div class="settings-row__text"><div class="settings-row__title">Perpustakaan demo</div><div class="settings-row__sub">Tambahkan 12 lagu contoh untuk mencoba semua fitur tanpa file pribadi.</div></div>' +
      '<div class="settings-row__action"><button class="btn btn--secondary btn--small" type="button" data-action="settings-demo">' +
      icon("sparkles") +
      "Muat demo</button></div></div>" +
      '<div class="settings-row"><div class="settings-row__text"><div class="settings-row__title">Penyimpanan</div>' +
      '<div class="settings-row__sub" id="settingsStorageText">' +
      storageSummaryText() +
      '</div><div class="storage-line"><div class="storage-bar"><span id="settingsStorageBar" style="width:0%"></span></div></div></div>' +
      '<div class="settings-row__action"><span class="settings-row__sub">' +
      (L.state.storage === "indexeddb" ? "IndexedDB" : "Memori") +
      "</span></div></div>" +
      '<div class="settings-row"><div class="settings-row__text"><div class="settings-row__title">Hapus semua data</div><div class="settings-row__sub">Menghapus seluruh lagu, sampul, dan playlist dari aplikasi. File asli tidak terhapus.</div></div>' +
      '<div class="settings-row__action"><button class="btn btn--danger btn--small" type="button" data-action="settings-clear">Hapus</button></div></div>' +
      "</section>" +
      '<section class="settings-group"><h3 class="settings-group__title">Tentang</h3>' +
      '<div class="settings-row"><div class="settings-row__text"><div class="settings-row__title">Musik</div><div class="settings-row__sub">Pemutar musik lokal bergaya Apple Music. Semua data tetap di perangkat ini.</div></div>' +
      '<div class="settings-row__action"><button class="text-btn" type="button" data-action="settings-shortcuts">Pintasan</button></div></div>' +
      '<p class="about-line">Dibuat dengan HTML, CSS, dan JavaScript tanpa server. <strong>Space</strong> putar/jeda · <strong>←/→</strong> geser 5 detik · <strong>⌘K/Ctrl K</strong> cari · <strong>M</strong> bisukan · <strong>Q</strong> antrean.</p>' +
      "</section>" +
      "</div>"
    );
  }

  function storageSummaryText() {
    const count = L.state.tracks.length;
    const size = L.totalSize();
    if (!count) return "Belum ada data musik tersimpan.";
    return (
      count +
      " lagu · " +
      U.fmtBytes(size) +
      (L.state.storage === "indexeddb" ? " tersimpan di browser." : " (hanya di memori tab ini).")
    );
  }

  function settingsRoot() {
    return document.getElementById("settingsRoot");
  }

  function syncSettingsControls() {
    const root = settingsRoot();
    if (!root) return;
    const theme = document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
    $$('[data-action="set-theme"]', root).forEach((button) => {
      button.classList.toggle("is-active", button.dataset.theme === theme);
    });
    $$('[data-action="set-shuffle"]', root).forEach((button) => {
      button.classList.toggle("is-active", (button.dataset.value === "true") === !!P.state.shuffle);
    });
    $$('[data-action="set-repeat"]', root).forEach((button) => {
      button.classList.toggle("is-active", (button.dataset.value || "off") === P.state.repeat);
    });
    const streamQuality = L.getSetting("streamQuality", "high");
    $$('[data-action="set-stream-quality"]', root).forEach((button) => {
      button.classList.toggle("is-active", (button.dataset.value || "high") === streamQuality);
    });
    const downloadQuality = L.getSetting("downloadQuality", "best");
    $$('[data-action="set-download-quality"]', root).forEach((button) => {
      button.classList.toggle("is-active", (button.dataset.value || "best") === downloadQuality);
    });
  }

  function qualityLabel(id) {
    const quality = AUDIO_QUALITIES.find((item) => item.id === id);
    return quality ? quality.label + " (" + quality.hint + ")" : "Terbaik (audio sumber)";
  }

  async function applyStreamQuality(value) {
    const quality = AUDIO_QUALITIES.some((item) => item.id === value) ? value : "high";
    const previous = L.getSetting("streamQuality", "high");
    if (previous === quality) {
      syncSettingsControls();
      return;
    }
    await L.setSetting("streamQuality", quality);
    if (AM.Youtube && typeof AM.Youtube.clearAudioCache === "function") {
      AM.Youtube.clearAudioCache();
    }
    syncSettingsControls();

    const track = P.currentTrack();
    if (track && track.provider === "youtube" && P.state.isPlaying) {
      const position = P.state.currentTime || 0;
      try {
        await P.loadCurrent(true);
        if (position > 1) P.seekTo(position);
      } catch (error) {
        console.warn("[app] gagal memuat ulang kualitas audio:", error);
      }
      toast("Kualitas streaming: " + qualityLabel(quality) + ". Lagu dimuat ulang.", {
        type: "success"
      });
      return;
    }
    toast("Kualitas streaming: " + qualityLabel(quality) + ". Berlaku untuk lagu berikutnya.");
  }

  async function applyDownloadQuality(value) {
    const quality = AUDIO_QUALITIES.some((item) => item.id === value) ? value : "best";
    await L.setSetting("downloadQuality", quality);
    syncSettingsControls();
    toast("Kualitas unduhan: " + qualityLabel(quality) + ".");
  }

  function closeSettingsForAction(callback) {
    if (typeof callback === "function") callback();
  }

  async function fillStorageEstimate(root) {
    const container = root && root.el ? root.el : root;
    if (!container || typeof container.querySelector !== "function") return;
    const text = container.querySelector("#settingsStorageText");
    const bar = container.querySelector("#settingsStorageBar");
    if (!text) return;
    try {
      if (navigator.storage && typeof navigator.storage.estimate === "function") {
        const estimate = await navigator.storage.estimate();
        const usage = Number(estimate.usage) || 0;
        const quota = Number(estimate.quota) || 0;
        if (quota > 0) {
          text.textContent =
            L.state.tracks.length +
            " lagu · " +
            U.fmtBytes(L.totalSize()) +
            " data musik · " +
            U.fmtBytes(usage) +
            " dari " +
            U.fmtBytes(quota) +
            " kuota browser.";
          if (bar) bar.style.width = U.clamp((usage / quota) * 100, 0.5, 100).toFixed(2) + "%";
        }
      }
    } catch (error) {
      /* Perkiraan penyimpanan tidak wajib. */
    }
  }

  async function showShortcuts() {
    const body = document.createElement("div");
    body.innerHTML =
      '<div class="settings">' +
      '<section class="settings-group">' +
      '<div class="settings-row"><div class="settings-row__text"><div class="settings-row__title">Putar / jeda</div></div><div class="settings-row__action"><kbd class="settings-kbd">Space</kbd></div></div>' +
      '<div class="settings-row"><div class="settings-row__text"><div class="settings-row__title">Geser 5 detik</div></div><div class="settings-row__action"><kbd class="settings-kbd">← / →</kbd></div></div>' +
      '<div class="settings-row"><div class="settings-row__text"><div class="settings-row__title">Lagu sebelumnya / berikutnya</div></div><div class="settings-row__action"><kbd class="settings-kbd">Klik tombol</kbd></div></div>' +
      '<div class="settings-row"><div class="settings-row__text"><div class="settings-row__title">Cari</div></div><div class="settings-row__action"><kbd class="settings-kbd">⌘K / Ctrl K</kbd></div></div>' +
      '<div class="settings-row"><div class="settings-row__text"><div class="settings-row__title">Bisukan</div></div><div class="settings-row__action"><kbd class="settings-kbd">M</kbd></div></div>' +
      '<div class="settings-row"><div class="settings-row__text"><div class="settings-row__title">Acak</div></div><div class="settings-row__action"><kbd class="settings-kbd">S</kbd></div></div>' +
      '<div class="settings-row"><div class="settings-row__text"><div class="settings-row__title">Ulangi</div></div><div class="settings-row__action"><kbd class="settings-kbd">R</kbd></div></div>' +
      '<div class="settings-row"><div class="settings-row__text"><div class="settings-row__title">Suka lagu saat ini</div></div><div class="settings-row__action"><kbd class="settings-kbd">L</kbd></div></div>' +
      '<div class="settings-row"><div class="settings-row__text"><div class="settings-row__title">Antrean</div></div><div class="settings-row__action"><kbd class="settings-kbd">Q</kbd></div></div>' +
      "</section></div>";
    const modal = UI.openModal({
      title: "Pintasan keyboard",
      eyebrow: "Bantuan",
      width: "narrow",
      body,
      footer: UI.makeButton("Tutup", { primary: true, onClick: () => modal.close() })
    });
  }

  async function clearLibraryInteractive() {
    const ok = await UI.confirm({
      title: "Hapus semua data?",
      message:
        "Seluruh lagu, sampul, playlist, dan riwayat di aplikasi ini akan dihapus. File asli di perangkatmu tetap aman. Tindakan ini tidak bisa dibatalkan.",
      confirmLabel: "Hapus semua",
      danger: true,
      icon: "trash"
    });
    if (!ok) return;
    state.suppressRefresh = true;
    try {
      P.clearQueue();
      await L.clearLibrary();
    } catch (error) {
      console.error("[app] gagal menghapus data:", error);
      toast("Gagal menghapus semua data.", { type: "error" });
    } finally {
      state.suppressRefresh = false;
    }
    updateStorageInfo();
    renderSidebarPlaylists();
    navigate("#/home", { replace: true });
    toast("Semua data perpustakaan dihapus.", { type: "success" });
  }

  /* ------------------------------------------------------------------------
     Event perpustakaan
     ------------------------------------------------------------------------ */

  function bindLibraryEvents() {
    L.on("change", (detail) => {
      const reason = detail && detail.reason;
      updateStorageInfo();

      if (state.suppressRefresh) return;

      if (reason === "favorite") {
        if (detail.trackId) updateLikeUI(detail.trackId);
        if (state.currentRoute && state.currentRoute.name === "favorites") {
          refreshView({ keepScroll: true });
        }
        return;
      }

      if (reason === "import" || reason === "remove" || reason === "durations" || reason === "update") {
        refreshView({ keepScroll: true });
        return;
      }

      if (reason === "clear") {
        renderSidebarPlaylists();
        navigate("#/home", { replace: true });
        return;
      }

      if (reason === "playlist" || reason === "playlist-tracks" || reason === "playlist-order") {
        renderSidebarPlaylists();
        if (
          state.currentRoute &&
          state.currentRoute.name === "playlist" &&
          state.currentRoute.params.key === detail.playlistId
        ) {
          refreshView({ keepScroll: true });
        }
        return;
      }

      if (reason === "playlist-delete") {
        renderSidebarPlaylists();
        if (
          state.currentRoute &&
          state.currentRoute.name === "playlist" &&
          state.currentRoute.params.key === detail.playlistId
        ) {
          navigate("#/home", { replace: true });
        }
      }
    });

    L.on("historychange", () => {
      if (state.suppressRefresh) return;
      if (state.currentRoute && state.currentRoute.name === "recent") {
        refreshView({ keepScroll: true });
      }
    });

    L.on("playlistschange", () => {
      renderSidebarPlaylists();
    });

    L.on("trackupdate", (detail) => {
      const track = detail && detail.track;
      if (!track) return;
      updateLikeUI(track.id);
      $$('.track-row[data-track-id="' + cssEscape(track.id) + '"] .track-row__time').forEach((node) => {
        node.textContent = track.duration ? U.fmtTime(track.duration) : "--:--";
      });
      if (P.state.currentId === track.id) {
        syncPlayerBar(P.getState());
      }
    });

    L.on("tracksremoved", () => {
      if (state.suppressRefresh) return;
      refreshView({ keepScroll: true });
    });
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === "function") return window.CSS.escape(String(value));
    return String(value).replace(/["\\]/g, "\\$&");
  }

  // Halaman Pengaturan memakai markup yang sama dengan modal lama, agar
  // kontrol tema/audio/data tetap satu sumber.
  AM.SettingsPage = {
    render: settingsHTML
  };

  // Hubungkan event perpustakaan setelah modul dimuat.
  bindLibraryEvents();

  /* ------------------------------------------------------------------------
     Jalankan
     ------------------------------------------------------------------------ */

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})(window.AM = window.AM || {});
