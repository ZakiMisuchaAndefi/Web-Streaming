/* ==========================================================================
   youtube.js — pencarian YouTube (InnerTube) + audio melalui proxy server
   Pencarian memakai API internal YouTube (InnerTube) lewat /api/search.
   Audio diputar di elemen audio aplikasi melalui /api/stream.
   ========================================================================== */

(function (AM) {
  "use strict";

  const OE_BASE = "https://www.youtube.com/oembed";
  const SESSION_MAX = 100;
  const SEARCH_LIMIT = 40;
  const SEARCH_TIMEOUT = 18000;

  // Mesin audio:
  //   "proxy"     — resolver di server lokal (server.ps1), tanpa iklan.
  //   "invidious" — audio diambil dari instance Invidious publik; tanpa iklan
  //                 dan tetap bisa memutar video yang melarang embed.
  //   "iframe"    — pemutar resmi YouTube di browser (cadangan terakhir).
  const ENGINE_OVERRIDE = (() => {
    try {
      const value = new URLSearchParams(window.location.search).get("engine");
      return value === "iframe" || value === "proxy" || value === "invidious" ? value : "";
    } catch (error) {
      return "";
    }
  })();

  // Urutan itag audio Invidious: Opus dulu (bitrate tertinggi), lalu AAC
  // sebagai cadangan yang paling kompatibel. "flac" tidak tersedia di YouTube,
  // jadi ia memakai format terbaik dan ditandai sebagai fallback.
  const INVIDIOUS_ITAGS = {
    low: [249, 139, 250, 140, 251],
    medium: [251, 250, 140, 249, 139],
    high: [251, 140, 250, 249, 139],
    best: [251, 140, 250, 249, 139],
    flac: [251, 140, 250, 249, 139]
  };

  // Metadata itag audio YouTube (bitrate nomina) untuk pemutar.
  const ITAG_INFO = {
    139: { codec: "AAC", bitrate: 48000, sampleRate: 44100, channels: 2 },
    140: { codec: "AAC", bitrate: 128000, sampleRate: 44100, channels: 2 },
    141: { codec: "AAC", bitrate: 256000, sampleRate: 44100, channels: 2 },
    249: { codec: "OPUS", bitrate: 50000, sampleRate: 48000, channels: 2 },
    250: { codec: "OPUS", bitrate: 70000, sampleRate: 48000, channels: 2 },
    251: { codec: "OPUS", bitrate: 160000, sampleRate: 48000, channels: 2 },
    774: { codec: "OPUS", bitrate: 256000, sampleRate: 48000, channels: 2 }
  };

  let streamEngine = ENGINE_OVERRIDE || "unknown";
  // Di luar localhost, pakai instance Invidious sejak awal supaya lagu
  // pertama tidak menunggu /api/health selesai.
  const isLocalHost = /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(window.location.hostname);
  let invidiousHost =
    isLocalHost && ENGINE_OVERRIDE !== "invidious" ? "" : "yt.chocolatemoo53.com";

  const session = [];

  /* ------------------------------------------------------------------------
     Helper
     ------------------------------------------------------------------------ */

  function safeUrl(value) {
    const text = String(value || "").trim();
    if (!/^https?:\/\//i.test(text)) return "";
    return text.replace(/^http:\/\//i, "https://");
  }

  /* ------------------------------------------------------------------------
     Mengenali ID video dari berbagai format tautan
     ------------------------------------------------------------------------ */

  function extractVideoId(input) {
    const value = String(input || "").trim();
    if (!value) return null;
    if (/^[A-Za-z0-9_-]{11}$/.test(value)) return value;

    let url = null;
    const looksLikeHost = /^(www\.|m\.|music\.)?(youtube\.com|youtu\.be|youtube-nocookie\.com)/i.test(value);
    if (looksLikeHost && !/^https?:\/\//i.test(value)) {
      try {
        url = new URL("https://" + value);
      } catch (error) {
        return null;
      }
    } else if (/^https?:\/\//i.test(value)) {
      try {
        url = new URL(value);
      } catch (error) {
        return null;
      }
    }
    if (!url) return null;

    const host = url.hostname.toLowerCase().replace(/^(www\.|m\.|music\.)/, "");
    let id = "";
    if (host === "youtu.be") {
      id = url.pathname.split("/").filter(Boolean)[0] || "";
    } else if (host === "youtube-nocookie.com" || host === "youtube.com") {
      if (url.pathname === "/watch") {
        id = url.searchParams.get("v") || "";
      } else {
        const match = url.pathname.match(/^\/(embed|v|shorts|live)\/([^/?#]+)/);
        id = match ? match[2] : "";
      }
    }
    return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
  }

  function extractPlaylistId(input) {
    const value = String(input || "").trim();
    if (!value) return "";
    try {
      const url = new URL(/^https?:\/\//i.test(value) ? value : "https://" + value);
      return url.searchParams.get("list") || "";
    } catch (error) {
      return "";
    }
  }

  /* ------------------------------------------------------------------------
     Resolusi metadata via oEmbed resmi
     ------------------------------------------------------------------------ */

  function buildTrack(videoId, data) {
    const title = String((data && data.title) || "Video YouTube");
    const info = parseTrackInfo(title, data && data.author_name);
    const track = {
      id: "youtube:" + videoId,
      online: true,
      provider: "youtube",
      providerLabel: "YouTube",
      sourceId: videoId,
      title,
      songTitle: info.song,
      artist: info.artist,
      album: "YouTube",
      duration: 0,
      art: safeUrl(data && data.thumbnail_url),
      externalUrl: "https://www.youtube.com/watch?v=" + videoId,
      preview: false,
      candidates: [videoId]
    };
    return track;
  }

  function rememberSession(track) {
    const index = session.findIndex((item) => item.id === track.id);
    if (index >= 0) session.splice(index, 1);
    session.unshift(track);
    while (session.length > SESSION_MAX) session.pop();
  }

  function sessionTracks() {
    return session.slice(0, SESSION_MAX);
  }

  const notFoundError = () =>
    Object.assign(
      new Error("Video tidak ditemukan, privat, atau tidak tersedia. Coba tautan lain."),
      { youtubeHint: true }
    );

  /* ------------------------------------------------------------------------
     Pencarian kata kunci (via InnerTube di /api/search, tanpa API key resmi)
     ------------------------------------------------------------------------ */

  const VERSION_WORDS = new Set([
    "english",
    "indonesian",
    "japanese",
    "korean",
    "acoustic",
    "live",
    "remix",
    "cover",
    "karaoke",
    "instrumental",
    "version",
    "ver",
    "official",
    "audio",
    "video",
    "lyric",
    "lyrics",
    "lirik",
    "slowed",
    "reverb",
    "nightcore",
    "edit",
    "extended",
    "piano",
    "guitar",
    "orchestral",
    "duet",
    "male",
    "female",
    "session",
    "remaster",
    "remastered",
    "hd",
    "mv",
    "visualizer"
  ]);

  function stripTitleNoise(value) {
    return String(value || "")
      .replace(/\((?:[^)]*)\)|\[[^\]]*\]|【[^】]*】/g, " ")
      .replace(/\s*[|｜].*$/, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function trimTitleTail(value) {
    return String(value || "")
      .replace(/\s*[-–—]\s*(official|lyric|audio|video|music|mv|hd|4k|remaster(ed)?).*$/i, "")
      .replace(/\s+(official\s+)?(music\s+|lyric\s+|video\s+|audio\s+)?(video|audio|lyrics?|lirik|visualizer|mv)\s*$/i, "")
      .replace(/\s*#\w+.*$/, "")
      .trim();
  }

  function normalizeSong(value) {
    return String(value || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/\((?:[^)]*)\)|\[[^\]]*\]|【[^】]*】/g, " ")
      .replace(/\s*[|｜].*$/, " ")
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function primaryArtist(value) {
    const text = String(value || "")
      .replace(/\((?:[^)]*)\)|\[[^\]]*\]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) return "";
    const first = text.split(/\s+(?:feat\.?|ft\.?|featuring|with|vs\.?|x|&|and)\s+/i)[0];
    return normalizeSong(first) || normalizeSong(text);
  }

  function cleanArtist(name) {
    return (
      String(name || "")
        .replace(/\s*-\s*Topic$/i, "")
        .replace(/\s*VEVO$/i, "")
        .replace(/\s+Official\s+(Artist\s+)?Channel$/i, "")
        .replace(/\s+(Official|Music|TV|Channel)$/i, "")
        .trim() || "YouTube"
    );
  }

  function parseTrackInfo(title, uploader) {
    const full = stripTitleNoise(title);
    const uploaderArtist = cleanArtist(uploader);
    const uploaderKey = normalizeSong(uploaderArtist);
    let artist = "";
    let song = full;

    const match = full.match(/^(.{1,80}?)\s*(?:[-–—ù�])\s+(.+)$/);
    if (match) {
      let left = match[1].trim();
      let right = match[2].trim();
      if (left && left.split(/\s+/).length <= 10) {
        const leftScore = artistMatchScore(uploaderKey, normalizeSong(left));
        const rightScore = artistMatchScore(uploaderKey, normalizeSong(right));
        const rightLooksLikeArtists =
          (right.includes(",") || /\b(feat|ft)\.?\s/i.test(right)) &&
          left.split(/\s+/).length <= 8;
        if (rightLooksLikeArtists || rightScore > leftScore) {
          artist = right;
          song = left;
        } else {
          artist = left;
          song = right;
        }
      }
    }

    if (!artist && uploaderArtist !== "YouTube" && uploaderKey) {
      const prefix = new RegExp(
        "^" + uploaderArtist.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*[-–—:]*\\s+",
        "i"
      );
      const stripped = full.replace(prefix, "").trim();
      if (stripped && stripped !== full) song = stripped;
    }

    if (!artist) artist = uploaderArtist;
    return {
      artist: cleanArtist(artist),
      song: trimTitleTail(song) || full
    };
  }

  function artistMatchScore(uploaderKey, sideKey) {
    if (!uploaderKey || !sideKey) return 0;
    if (uploaderKey === sideKey) return 3;
    if (uploaderKey.startsWith(sideKey + " ") || sideKey.startsWith(uploaderKey + " ")) {
      return 2;
    }
    const uploaderWords = new Set(uploaderKey.split(" ").filter(Boolean));
    const sideWords = sideKey.split(" ").filter((word) => word.length >= 3);
    if (!sideWords.length) return 0;
    const hits = sideWords.filter((word) => uploaderWords.has(word)).length;
    return hits / sideWords.length >= 0.6 ? 1 : 0;
  }

  function titlesSimilar(a, b) {
    const first = normalizeSong(a);
    const second = normalizeSong(b);
    if (!first || !second) return false;
    if (first === second) return true;
    const short = first.length <= second.length ? first : second;
    const long = first.length <= second.length ? second : first;
    if (!long.startsWith(short + " ")) return false;
    const extra = long
      .slice(short.length + 1)
      .split(" ")
      .filter(Boolean);
    return extra.length > 0 && extra.every((word) => VERSION_WORDS.has(word));
  }

  function mapSearchItem(raw) {
    if (!raw || !raw.url || !raw.title) return null;
    const match = String(raw.url).match(/[?&]v=([A-Za-z0-9_-]{11})/);
    if (!match) return null;
    const videoId = match[1];
    const info = parseTrackInfo(raw.title, raw.uploaderName);
    const track = {
      id: "youtube:" + videoId,
      online: true,
      provider: "youtube",
      providerLabel: "YouTube",
      sourceId: videoId,
      title: String(raw.title),
      songTitle: info.song,
      artist: info.artist,
      album: "YouTube",
      duration: Math.max(0, Math.round(Number(raw.duration) || 0)),
      art: "https://i.ytimg.com/vi/" + videoId + "/mqdefault.jpg",
      externalUrl: "https://www.youtube.com/watch?v=" + videoId,
      preview: false
    };
    if (AM.Online && typeof AM.Online.remember === "function") {
      AM.Online.remember(track);
    }
    rememberSession(track);
    return track;
  }

  function fetchWithTimeout(url, timeout) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      try {
        controller.abort();
      } catch (error) {
        /* Abaikan. */
      }
    }, timeout);
    return fetch(url, { signal: controller.signal, cache: "no-store" }).finally(() => {
      window.clearTimeout(timer);
    });
  }

  /* ------------------------------------------------------------------------
     Resolver audio lokal (InnerTube lewat server.ps1)
     Dipakai hanya untuk pemakaian pribadi di localhost. Jika InnerTube atau
     endpoint server tidak tersedia, lagu YouTube ditandai gagal (tanpa video).
     ------------------------------------------------------------------------ */

  const AUDIO_CACHE_MARGIN = 5 * 60 * 1000;
  const audioCache = new Map();
  const audioInflight = new Map();
  const formatCache = new Map();
  const formatInflight = new Map();
  const relatedCache = new Map();
  const RELATED_TTL = 15 * 60 * 1000;
  let resolverCheck = null;

  function checkLocalResolver() {
    if (resolverCheck) return resolverCheck;
    resolverCheck = fetchWithTimeout((window.API_BASE || "") + "/api/health", 45000)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!data) return false;
        if (
          !ENGINE_OVERRIDE &&
          (data.engine === "iframe" || data.engine === "proxy" || data.engine === "invidious")
        ) {
          streamEngine = data.engine;
        }
        if (streamEngine === "invidious" && typeof data.instance === "string" && data.instance) {
          invidiousHost = data.instance;
        }
        return !!(data.innertube || data.ytdlp || data.INNER_TUBE || data.innerTube || data.status === "ok");
      })
      .catch(() => false)
      .then((available) => {
        if (!available) resolverCheck = null; // jangan simpan hasil gagal, coba lagi nanti
        return available;
      });
    return resolverCheck;
  }

  function audioQuality() {
    const value = AM.Library ? AM.Library.getSetting("streamQuality", "high") : "high";
    return ["low", "medium", "high", "best", "flac"].includes(value) ? value : "high";
  }

  function audioStreamUrl(videoId, options) {
    const id = String(videoId || "").trim();
    if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return "";
    if (streamEngine === "iframe") return "yt:" + id;
    if ((streamEngine === "invidious" || streamEngine === "unknown") && invidiousHost) {
      return invidiousUrl(id, options);
    }
    const force = options && options.force ? "&force=1" : "";
    return (
      (window.API_BASE || "") +
      "/api/stream?id=" +
      encodeURIComponent(id) +
      "&quality=" +
      encodeURIComponent(audioQuality()) +
      force
    );
  }

  // URL audio langsung dari instance Invidious. `attempt` dipakai untuk
  // mencoba format lain ketika format sebelumnya gagal diputar.
  function invidiousUrl(id, options) {
    const list = INVIDIOUS_ITAGS[audioQuality()] || INVIDIOUS_ITAGS.high;
    const attempt = Math.max(0, Math.min(list.length - 1, Number(options && options.attempt) || 0));
    return (
      "https://" +
      invidiousHost +
      "/latest_version?id=" +
      encodeURIComponent(id) +
      "&itag=" +
      list[attempt] +
      "&local=true"
    );
  }

  // Ringkasan format dari itag (dipakai Invidious, yang tidak memberi detail).
  function describeItag(itag, requested) {
    const info = ITAG_INFO[Number(itag)] || {};
    const codec = info.codec || "";
    const lossless = codec === "FLAC";
    return {
      codec,
      itag: Number(itag) || 0,
      bitrate: info.bitrate || 0,
      sampleRate: info.sampleRate || 0,
      channels: info.channels || 0,
      lossless,
      requested,
      fallback: requested === "flac" && !lossless
    };
  }

  // Metadata format yang bisa diketahui seketika (tanpa menunggu jaringan).
  function formatFor(videoId, options) {
    const id = String(videoId || "").trim();
    if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return null;
    if (streamEngine === "iframe") return null;
    const requested = audioQuality();
    if ((streamEngine === "invidious" || streamEngine === "unknown") && invidiousHost) {
      const list = INVIDIOUS_ITAGS[requested] || INVIDIOUS_ITAGS.high;
      const attempt = Math.max(0, Math.min(list.length - 1, Number(options && options.attempt) || 0));
      return describeItag(list[attempt], requested);
    }
    const cached = formatCache.get(id + "|" + requested);
    return cached && cached.expiresAt > Date.now()
      ? cached.format
      : { codec: "", requested, pending: true };
  }

  // Metadata format final dari resolver server (proxy). Hasilnya di-cache agar
  // tidak memicu resolusi InnerTube tambahan saat lagu mulai berbunyi.
  async function resolveFormat(videoId, options) {
    const opts = options || {};
    const id = String(videoId || "").trim();
    if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return null;
    if (streamEngine === "iframe") return null;
    if ((streamEngine === "invidious" || streamEngine === "unknown") && invidiousHost) {
      return formatFor(id, opts);
    }

    const requested = audioQuality();
    const cacheKey = id + "|" + requested;
    const cached = formatCache.get(cacheKey);
    if (!opts.force && cached && cached.expiresAt > Date.now()) return cached.format;
    if (formatInflight.has(cacheKey)) return formatInflight.get(cacheKey);

    const task = (async () => {
      try {
        const response = await fetchWithTimeout(
          (window.API_BASE || "") +
            "/api/resolve?id=" +
            encodeURIComponent(id) +
            "&quality=" +
            encodeURIComponent(requested),
          45000
        );
        if (!response.ok) return null;
        const data = await response.json();
        const format = data && data.format ? data.format : null;
        if (!format) return null;
        const expires = Number(data && data.expires) || 0;
        const expiresAt =
          expires > 0 ? expires * 1000 - AUDIO_CACHE_MARGIN : Date.now() + 60 * 60 * 1000;
        formatCache.set(cacheKey, { format, expiresAt });
        return format;
      } catch (error) {
        return null;
      } finally {
        formatInflight.delete(cacheKey);
      }
    })();

    formatInflight.set(cacheKey, task);
    return task;
  }

  function clearAudioCache() {
    audioCache.clear();
    audioInflight.clear();
    formatCache.clear();
    formatInflight.clear();
  }

  async function resolveAudio(videoId, options) {
    const opts = options || {};
    const id = String(videoId || "").trim();
    if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return null;
    if (streamEngine === "iframe") return "yt:" + id;
    if ((streamEngine === "invidious" || streamEngine === "unknown") && invidiousHost) {
      return invidiousUrl(id, opts);
    }
    const quality = audioQuality();
    const cacheKey = id + "|" + quality;

    if (opts.force) {
      audioCache.delete(cacheKey);
    } else {
      const cached = audioCache.get(cacheKey);
      if (cached) {
        if (cached.expiresAt > Date.now()) return cached.url;
        audioCache.delete(cacheKey);
      }
    }

    if (audioInflight.has(cacheKey)) return audioInflight.get(cacheKey);

    const task = (async () => {
      try {
        const response = await fetchWithTimeout(
          (window.API_BASE || "") + "/api/resolve?id=" +
            encodeURIComponent(id) +
            "&quality=" +
            encodeURIComponent(quality) +
            (opts.force ? "&force=1" : ""),
          45000
        );
        if (!response.ok) return null;
        const data = await response.json();
        const url = data && typeof data.url === "string" ? data.url.trim() : "";
        if (!url) return null;
        const format = data && data.format ? data.format : null;
        const expires = Number(data && data.expires) || 0;
        const expiresAt =
          expires > 0
            ? expires * 1000 - AUDIO_CACHE_MARGIN
            : Date.now() + 60 * 60 * 1000;
        audioCache.set(cacheKey, { url, expiresAt });
        if (format) formatCache.set(cacheKey, { format, expiresAt });
        return url;
      } catch (error) {
        return null;
      }
    })();

    audioInflight.set(cacheKey, task);
    try {
      return await task;
    } finally {
      audioInflight.delete(cacheKey);
    }
  }

  /* ------------------------------------------------------------------------
     Radio otomatis: rekomendasi mirip lagu yang sedang diputar
     Sumber utama: daftar putar radio YouTube (list=RD...) lewat /api/radio.
     Cadangan: pencarian berdasarkan nama artis.
     ------------------------------------------------------------------------ */

  function buildRelatedTrack(item) {
    const videoId = String((item && item.id) || "").trim();
    if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) return null;
    const title = String((item && item.title) || "YouTube").trim() || "YouTube";
    const info = parseTrackInfo(title, item && item.artist);
    const track = {
      id: "youtube:" + videoId,
      online: true,
      provider: "youtube",
      providerLabel: "YouTube",
      sourceId: videoId,
      title,
      songTitle: info.song,
      artist: info.artist,
      album: "YouTube",
      duration: Math.max(0, Math.round(Number(item && item.duration) || 0)),
      art: "https://i.ytimg.com/vi/" + videoId + "/mqdefault.jpg",
      externalUrl: "https://www.youtube.com/watch?v=" + videoId,
      preview: false,
      candidates: [videoId]
    };
    if (AM.Online && typeof AM.Online.remember === "function") {
      AM.Online.remember(track);
    }
    rememberSession(track);
    return track;
  }

  async function related(videoId, seedTrack) {
    const id = String(videoId || "").trim();
    if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return [];

    const cached = relatedCache.get(id);
    if (cached && cached.expiresAt > Date.now()) return cached.tracks;

    const available = await checkLocalResolver();
    let tracks = [];

    if (available) {
      try {
        const response = await fetchWithTimeout(
          (window.API_BASE || "") + "/api/radio?id=" + encodeURIComponent(id),
          45000
        );
        if (response.ok) {
          const data = await response.json();
          const list = data && Array.isArray(data.tracks) ? data.tracks : [];
          tracks = list
            .map(buildRelatedTrack)
            .filter((track) => !!track && track.sourceId !== id);
        }
      } catch (error) {
        tracks = [];
      }
    }

    // Cadangan: lagu lain dari artis yang sama lewat pencarian InnerTube.
    if (tracks.length < 10) {
      const artist =
        seedTrack && seedTrack.artist ? String(seedTrack.artist).trim() : "";
      if (artist && artist.toLowerCase() !== "youtube") {
        try {
          const found = await search(artist);
          tracks = tracks.concat(found.filter((track) => track && track.sourceId !== id));
        } catch (error) {
          /* Abaikan. */
        }
      }
    }

    if (!tracks.length) return [];

    const seen = new Set();
    const unique = tracks.filter((track) => {
      if (!track || seen.has(track.id)) return false;
      seen.add(track.id);
      return true;
    });

    relatedCache.set(id, { tracks: unique, expiresAt: Date.now() + RELATED_TTL });
    return unique;
  }

  /* ------------------------------------------------------------------------
     Pencarian kata kunci lewat /api/search (InnerTube, tanpa API key resmi)
     Endpoint dijalankan server lokal (server.ps1) atau fungsi Vercel (api/).
     ------------------------------------------------------------------------ */

  async function searchViaServer(query) {
    const response = await fetchWithTimeout(
      (window.API_BASE || "") + "/api/search?q=" + encodeURIComponent(query),
      SEARCH_TIMEOUT
    );
    if (!response.ok) throw new Error("HTTP " + response.status);
    const data = await response.json();
    const items = data && Array.isArray(data.items) ? data.items : [];
    const alternates =
      data && Array.isArray(data.alternates) ? data.alternates : [];
    return { items: items.slice(0, SEARCH_LIMIT), alternates };
  }

  /* ------------------------------------------------------------------
     Kandidat cadangan per lagu
     Video utama bisa saja gagal diambil InnerTube (dihapus, dibatasi, dsb).
     Untuk tiap lagu kita simpan daftar videoId kandidat: video utama +
     hingga CANDIDATES_MAX-1 video lain dari hasil pencarian yang sama
     yang judul/artisnya cocok. Resolver audio akan mencoba kandidat
     berikutnya secara otomatis bila video utama gagal.
     ------------------------------------------------------------------ */

  const CANDIDATES_MAX = 5;

  function normalizedKey(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/\((official|lyric|audio|video|music|visualizer)[^)]*\)/g, "")
      .replace(/[[\]()]/g, " ")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function titleTokens(value) {
    return normalizedKey(value)
      .split(" ")
      .filter((word) => word.length >= 3);
  }

  function videoIdFromUrl(url) {
    const match = String(url || "").match(/[?&]v=([A-Za-z0-9_-]{11})/);
    return match ? match[1] : null;
  }

  function attachCandidates(items, altItems) {
    const alts = (altItems || [])
      .map((raw) => ({
        id: videoIdFromUrl(raw && raw.url),
        title: normalizedKey(raw && raw.title),
        uploader: normalizedKey(cleanArtist(raw && raw.uploaderName)),
        rawTitle: String((raw && raw.title) || "")
      }))
      .filter((item) => !!item.id);

    return items
      .slice(0, SEARCH_LIMIT)
      .map((raw) => {
        const track = mapSearchItem(raw);
        if (!track) return null;
        const songTitle = normalizedKey(track.title);
        const songArtist = normalizedKey(track.artist);
        const songTokens = titleTokens(track.title);
        const candidates = [track.sourceId];

        for (const alt of alts) {
          if (candidates.length >= CANDIDATES_MAX) break;
          if (candidates.includes(alt.id)) continue;
          const titleMatch =
            songTitle.length > 2 &&
            (alt.title.includes(songTitle) || songTitle.includes(alt.title));
          const artistMatch =
            songArtist.length > 1 && alt.uploader.includes(songArtist);
          const overlap = songTokens.filter((token) =>
            alt.title.includes(token)
          ).length;
          if (titleMatch || (artistMatch && overlap > 0)) {
            candidates.push(alt.id);
          }
        }
        track.candidates = candidates;
        return track;
      })
      .filter(Boolean);
  }

  async function search(input) {
    const query = String(input || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80);
    if (!query) return [];

    const crash = Object.assign(
      new Error("Pencarian YouTube sedang tidak dapat diakses. Coba lagi beberapa saat lagi, atau tempel tautan video langsung."),
      { youtubeNetwork: true }
    );

    let result;
    try {
      result = await searchViaServer(query);
    } catch (error) {
      if (error && error.name !== "AbortError") {
        console.warn("[youtube] pencarian InnerTube gagal:", error);
      }
      throw crash;
    }

    const mainItems = result.items;
    if (!mainItems.length) throw crash;

    const altItems = result.alternates.length ? result.alternates : mainItems;
    const list = attachCandidates(mainItems, altItems);
    if (!list.length) throw crash;

    const sessionSeen = new Set();
    return list.filter((track) => {
      if (sessionSeen.has(track.id)) return false;
      sessionSeen.add(track.id);
      return true;
    });
  }

  async function resolve(input, options) {
    const opts = options || {};
    const videoId = extractVideoId(input);
    if (!videoId) return null;

    const existing = session.find((item) => item.sourceId === videoId);
    if (existing) {
      rememberSession(existing);
      return existing;
    }

    const params = new URLSearchParams({
      url: "https://www.youtube.com/watch?v=" + videoId,
      format: "json"
    });

    let data = null;
    try {
      const response = await fetch(OE_BASE + "?" + params.toString(), {
        signal: opts.signal,
        cache: "no-store"
      });
      if (response.status === 401 || response.status === 404 || response.status === 403) {
        throw notFoundError();
      }
      if (!response.ok) {
        throw new Error("HTTP " + response.status);
      }
      data = await response.json();
    } catch (error) {
      if (error && error.name === "AbortError") throw error;
      if (error && error.youtubeHint) throw error;
      throw Object.assign(
        new Error("Tidak dapat memeriksa tautan YouTube. Periksa koneksi internet lalu coba lagi."),
        { youtubeNetwork: true }
      );
    }
    if (!data || !data.title) throw notFoundError();

    const track = buildTrack(videoId, data);
    if (AM.Online && typeof AM.Online.remember === "function") {
      AM.Online.remember(track);
    }
    rememberSession(track);
    return track;
  }

  AM.Youtube = {
    extractVideoId,
    extractPlaylistId,
    parseTrackInfo,
    normalizeSong,
    primaryArtist,
    titlesSimilar,
    resolve,
    resolveAudio,
    resolveFormat,
    formatFor,
    audioStreamUrl,
    clearAudioCache,
    related,
    checkLocalResolver,
    search,
    sessionTracks,
    getStreamEngine: () => streamEngine,
    getInvidiousHost: () => invidiousHost,
    setStreamEngine(mode) {
      if (mode === "iframe" || mode === "proxy" || mode === "invidious") streamEngine = mode;
      return streamEngine;
    }
  };

  // Ketahui mesin audio seawal mungkin supaya lagu pertama tidak salah jalur.
  checkLocalResolver();
})(window.AM = window.AM || {});
