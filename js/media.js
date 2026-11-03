/* ==========================================================================
   media.js — jembatan pemutaran audio
   --------------------------------------------------------------------------
   Player aplikasi memakai satu objek "audio" (elemen HTMLAudioElement).
   Modul ini menyediakan objek serupa yang bisa memutar dari dua mesin:

   1. elemen <audio> biasa (file lokal, blob, URL http) — seperti sebelumnya;
   2. pemutar YouTube resmi (IFrame API) untuk lagu YouTube.

   Mesin kedua dipakai karena YouTube memblokir permintaan video dari IP
   datacenter (Vercel). Dengan IFrame API, audio diambil langsung oleh browser
   pengguna lewat pemutar resmi YouTube, sehingga tidak ada batas ~1 MB dan
   tidak bergantung pada resolver di server.
   ========================================================================== */

(function (AM) {
  "use strict";

  const API_SRC = "https://www.youtube.com/iframe_api";
  const SCHEME = "yt:";
  const TICK_MS = 250;
  const HOST_ID = "ytEngine";
  const PLAYER_ID = "ytEnginePlayer";

  let apiPromise = null;

  function loadApi() {
    if (window.YT && typeof window.YT.Player === "function") return Promise.resolve();
    if (apiPromise) return apiPromise;

    apiPromise = new Promise((resolve, reject) => {
      let settled = false;
      let timer = 0;

      const finish = (error) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        if (error) {
          apiPromise = null;
          reject(error);
        } else {
          resolve();
        }
      };

      const previous = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = function () {
        try {
          if (typeof previous === "function") previous();
        } catch (error) {
          /* Abaikan callback milik pihak lain. */
        }
        finish();
      };

      timer = window.setTimeout(() => finish(new Error("YouTube IFrame API timeout")), 15000);

      const script = document.createElement("script");
      script.src = API_SRC;
      script.async = true;
      script.onerror = () => finish(new Error("Gagal memuat YouTube IFrame API"));
      document.head.appendChild(script);
    });

    return apiPromise;
  }

  function ensureHost() {
    let player = document.getElementById(PLAYER_ID);
    if (player) return player;

    let host = document.getElementById(HOST_ID);
    if (!host) {
      host = document.createElement("div");
      host.id = HOST_ID;
      host.setAttribute("aria-hidden", "true");
      // Tetap punya ukuran nyata agar pemutar YouTube mau berjalan, tetapi
      // tidak terlihat dan tidak menangkap klik.
      host.style.cssText =
        "position:fixed;left:-10000px;top:0;width:320px;height:180px;" +
        "overflow:hidden;pointer-events:none;border:0;";
      document.body.appendChild(host);
    }

    player = document.createElement("div");
    player.id = PLAYER_ID;
    host.appendChild(player);
    return player;
  }

  function isYoutubeSource(value) {
    return String(value || "").indexOf(SCHEME) === 0;
  }

  class MediaEngine {
    constructor(element) {
      this.element = element;
      this.handlers = new Map();

      this.mode = "audio";
      this._src = "";

      this.player = null;
      this.playerReady = false;
      this.playerPromise = null;
      this.videoId = "";
      this.pendingSeek = null;
      this.pendingPlay = false;
      this.playWaiters = [];
      this.state = -1;

      this.volumeValue = 0.8;
      this.mutedValue = false;
      this.rate = 1;

      this.ticker = 0;
      this.playRetryTimer = 0;
      this.lastDuration = 0;
      this.metaEmitted = false;
      this.loadToken = 0;

      this.bindElement();
    }

    /* ---------------------------------------------------------------- event */

    bindElement() {
      const types = [
        "play",
        "playing",
        "pause",
        "ended",
        "waiting",
        "error",
        "progress",
        "timeupdate",
        "durationchange",
        "loadedmetadata",
        "canplay",
        "loadeddata"
      ];

      types.forEach((type) => {
        this.element.addEventListener(type, (event) => {
          if (this.mode !== "audio") return;
          if (type === "durationchange" || type === "loadedmetadata" || type === "loadeddata") {
            const value = Number(this.element.duration);
            if (Number.isFinite(value) && value > 0) this.lastDuration = value;
          }
          this.emit(type, event);
        });
      });
    }

    addEventListener(type, handler) {
      if (typeof handler !== "function") return;
      if (!this.handlers.has(type)) this.handlers.set(type, new Set());
      this.handlers.get(type).add(handler);
    }

    removeEventListener(type, handler) {
      const set = this.handlers.get(type);
      if (set) set.delete(handler);
    }

    emit(type, detail) {
      const set = this.handlers.get(type);
      if (!set || !set.size) return;
      Array.from(set).forEach((handler) => {
        try {
          handler(detail);
        } catch (error) {
          console.error("[media] listener error:", error);
        }
      });
    }

    /* ---------------------------------------------------------------- sumber */

    get src() {
      return this._src;
    }

    set src(value) {
      const text = String(value || "");
      this._src = text;

      if (isYoutubeSource(text)) {
        this.enterYoutube(text.slice(SCHEME.length));
        return;
      }

      this.exitYoutube();
      this.mode = "audio";
      this.element.src = text;
    }

    getAttribute(name) {
      if (name === "src") return this._src || this.element.getAttribute("src") || "";
      return this.element.getAttribute(name);
    }

    removeAttribute(name) {
      if (name !== "src") {
        this.element.removeAttribute(name);
        return;
      }

      this._src = "";
      if (this.mode === "youtube") {
        this.stopTicker();
        window.clearTimeout(this.playRetryTimer);
        this.pendingPlay = false;
        this.pendingSeek = null;
        this.videoId = "";
        this.metaEmitted = false;
        this.lastDuration = 0;
        this.loadToken += 1;
        if (this.playerReady && this.player) {
          try {
            this.player.stopVideo();
          } catch (error) {
            /* Abaikan. */
          }
        }
        return;
      }

      this.element.removeAttribute("src");
    }

    load() {
      if (this.mode === "youtube") return;
      this.element.load();
    }

    enterYoutube(rawId) {
      const id = String(rawId || "").trim();
      if (!/^[A-Za-z0-9_-]{11}$/.test(id)) {
        this.emit("error", new Error("ID video YouTube tidak valid"));
        return;
      }

      this.mode = "youtube";
      this.videoId = id;
      this.lastDuration = 0;
      this.metaEmitted = false;
      this.state = -1;
      this.pendingSeek = null;
      this.loadToken += 1;
      const token = this.loadToken;

      try {
        this.element.pause();
        this.element.removeAttribute("src");
        this.element.load();
      } catch (error) {
        /* Abaikan. */
      }

      this.ensurePlayer()
        .then(() => {
          if (this.loadToken !== token) return;
          this.applyVolume();
          this.player.cueVideoById({ videoId: id });
          this.afterReady();
          this.schedulePlayRetry(token);
        })
        .catch((error) => {
          if (this.loadToken !== token) return;
          this.emit("error", error);
        });
    }

    // playVideo() bisa diabaikan YouTube bila dipanggil sebelum video siap.
    // Coba ulang beberapa kali selama lagu masih ingin diputar.
    schedulePlayRetry(token, attempt) {
      const round = Number(attempt) || 0;
      window.clearTimeout(this.playRetryTimer);
      this.playRetryTimer = window.setTimeout(() => {
        if (this.loadToken !== token || !this.pendingPlay) return;
        if (this.state === 1 || this.state === 3) return;
        if (!this.playerReady || !this.player) return;
        try {
          this.player.playVideo();
        } catch (error) {
          /* Abaikan. */
        }
        if (round < 3) this.schedulePlayRetry(token, round + 1);
      }, 400);
    }

    exitYoutube() {
      this.stopTicker();
      window.clearTimeout(this.playRetryTimer);
      this.pendingPlay = false;
      this.pendingSeek = null;
      this.videoId = "";
      this.metaEmitted = false;
      this.loadToken += 1;
      if (this.playerReady && this.player) {
        try {
          this.player.stopVideo();
        } catch (error) {
          /* Abaikan. */
        }
      }
    }

    /* --------------------------------------------------------------- pemutar */

    ensurePlayer() {
      if (this.playerReady && this.player) return Promise.resolve(this.player);
      if (this.playerPromise) return this.playerPromise;

      this.playerPromise = loadApi()
        .then(
          () =>
            new Promise((resolve, reject) => {
              const host = ensureHost();
              let settled = false;
              const timer = window.setTimeout(() => {
                if (settled) return;
                settled = true;
                reject(new Error("YouTube player timeout"));
              }, 20000);

              const done = () => {
                if (settled) return;
                settled = true;
                window.clearTimeout(timer);
                resolve(this.player);
              };

              this.player = new window.YT.Player(host, {
                width: 320,
                height: 180,
                playerVars: {
                  autoplay: 0,
                  controls: 0,
                  disablekb: 1,
                  fs: 0,
                  playsinline: 1,
                  rel: 0,
                  modestbranding: 1,
                  origin: window.location.origin
                },
                events: {
                  onReady: () => {
                    this.playerReady = true;
                    this.applyVolume();
                    done();
                    this.afterReady();
                  },
                  onStateChange: (event) => this.handleState(event && event.data),
                  onError: (event) => this.handlePlayerError(event)
                }
              });
            })
        )
        .catch((error) => {
          this.playerPromise = null;
          this.playerReady = false;
          throw error;
        });

      return this.playerPromise;
    }

    afterReady() {
      if (!this.playerReady || !this.player) return;
      this.applyVolume();

      if (this.pendingSeek != null) {
        const target = this.pendingSeek;
        this.pendingSeek = null;
        try {
          this.player.seekTo(target, true);
        } catch (error) {
          /* Abaikan. */
        }
      }

      if (this.pendingPlay) this.player.playVideo();
    }

    handleState(state) {
      if (this.mode !== "youtube") return;
      this.state = state;
      const YT = window.YT || {};
      const S = YT.PlayerState || {};

      if (state === S.PLAYING) {
        this.pendingPlay = false;
        window.clearTimeout(this.playRetryTimer);
        const duration = this.readDuration();
        if (duration > 0) this.lastDuration = duration;
        this.applyVolume();
        this.emitMetadata();
        this.emit("play", { state });
        this.emit("playing", { state });
        this.emit("progress", { state });
        this.startTicker();
        this.flushPlayWaiters();
        return;
      }

      if (state === S.PAUSED) {
        this.stopTicker();
        this.emit("pause", { state });
        return;
      }

      if (state === S.ENDED) {
        this.stopTicker();
        this.emit("ended", { state });
        return;
      }

      if (state === S.BUFFERING) {
        this.emit("waiting", { state });
        return;
      }

      if (state === S.CUED) {
        const duration = this.readDuration();
        if (duration > 0) this.lastDuration = duration;
        this.emitMetadata();
        this.afterReady();
      }
    }

    handlePlayerError(event) {
      this.stopTicker();
      const code = event && event.data;
      const messages = {
        2: "ID video YouTube tidak valid",
        5: "Pemutar HTML5 tidak didukung browser ini",
        100: "Video tidak ditemukan atau bersifat privat",
        101: "Pemilik video melarang pemutaran di situs lain",
        150: "Pemilik video melarang pemutaran di situs lain"
      };
      this.emit("error", new Error(messages[code] || "Gagal memutar video YouTube (" + code + ")"));
    }

    readDuration() {
      if (!this.playerReady || !this.player) return 0;
      try {
        const value = Number(this.player.getDuration());
        return Number.isFinite(value) && value > 0 ? value : 0;
      } catch (error) {
        return 0;
      }
    }

    emitMetadata() {
      if (this.metaEmitted) return;
      this.metaEmitted = true;
      this.emit("durationchange", {});
      this.emit("loadedmetadata", {});
    }

    flushPlayWaiters() {
      if (!this.playWaiters.length) return;
      const waiters = this.playWaiters.slice();
      this.playWaiters = [];
      waiters.forEach((resolve) => resolve());
    }

    startTicker() {
      if (this.ticker) return;
      this.ticker = window.setInterval(() => {
        if (this.mode !== "youtube" || !this.playerReady || !this.player) return;
        this.emit("timeupdate", {});
        this.emit("progress", {});
      }, TICK_MS);
    }

    stopTicker() {
      if (!this.ticker) return;
      window.clearInterval(this.ticker);
      this.ticker = 0;
    }

    /* -------------------------------------------------------------- kontrol */

    play() {
      if (this.mode !== "youtube") return this.element.play();

      this.pendingPlay = true;
      const token = this.loadToken;

      const attempt = () => {
        if (this.loadToken !== token) return;
        if (!this.playerReady || !this.player || !this.videoId) return;
        this.player.playVideo();
      };

      if (this.playerReady) attempt();
      else
        this.ensurePlayer()
          .then(attempt)
          .catch((error) => this.emit("error", error));

      return new Promise((resolve) => {
        const timer = window.setTimeout(() => {
          this.playWaiters = this.playWaiters.filter((item) => item !== done);
          resolve();
        }, 5000);

        const done = () => {
          window.clearTimeout(timer);
          resolve();
        };

        this.playWaiters.push(done);
      });
    }

    pause() {
      this.pendingPlay = false;
      window.clearTimeout(this.playRetryTimer);
      if (this.mode === "youtube") {
        if (this.playerReady && this.player) {
          try {
            this.player.pauseVideo();
          } catch (error) {
            /* Abaikan. */
          }
        }
        return;
      }
      this.element.pause();
    }

    get currentTime() {
      if (this.mode !== "youtube") return Number(this.element.currentTime) || 0;
      if (this.playerReady && this.player) {
        try {
          return Number(this.player.getCurrentTime()) || 0;
        } catch (error) {
          return 0;
        }
      }
      return Number(this.pendingSeek) || 0;
    }

    set currentTime(value) {
      const seconds = Math.max(0, Number(value) || 0);
      if (this.mode !== "youtube") {
        this.element.currentTime = seconds;
        return;
      }
      if (this.playerReady && this.player) {
        try {
          this.player.seekTo(seconds, true);
        } catch (error) {
          /* Abaikan. */
        }
        this.pendingSeek = null;
        return;
      }
      this.pendingSeek = seconds;
    }

    get duration() {
      if (this.mode !== "youtube") return Number(this.element.duration) || 0;
      const value = this.readDuration();
      if (value > 0) this.lastDuration = value;
      return this.lastDuration;
    }

    get buffered() {
      if (this.mode !== "youtube") return this.element.buffered;

      const duration = this.duration;
      let fraction = 0;
      if (this.playerReady && this.player && typeof this.player.getVideoLoadedFraction === "function") {
        fraction = Number(this.player.getVideoLoadedFraction()) || 0;
      }
      fraction = Math.max(0, Math.min(1, fraction));

      if (!duration) return { length: 0, end: () => 0 };
      return { length: 1, end: () => fraction * duration };
    }

    get volume() {
      if (this.mode !== "youtube") return Number(this.element.volume);
      return this.volumeValue;
    }

    set volume(value) {
      this.volumeValue = Math.max(0, Math.min(1, Number(value) || 0));
      if (this.mode !== "youtube") {
        this.element.volume = this.volumeValue;
        return;
      }
      this.applyVolume();
    }

    get muted() {
      if (this.mode !== "youtube") return !!this.element.muted;
      return this.mutedValue;
    }

    set muted(value) {
      this.mutedValue = !!value;
      if (this.mode !== "youtube") {
        this.element.muted = this.mutedValue;
        return;
      }
      this.applyVolume();
    }

    get playbackRate() {
      if (this.mode !== "youtube") return Number(this.element.playbackRate) || 1;
      return this.rate;
    }

    set playbackRate(value) {
      const rate = Number(value) || 1;
      this.rate = rate;
      if (this.mode !== "youtube") {
        this.element.playbackRate = rate;
        return;
      }
      if (this.playerReady && this.player) {
        try {
          this.player.setPlaybackRate(rate);
        } catch (error) {
          /* Abaikan. */
        }
      }
    }

    get preload() {
      return this.element.preload;
    }

    set preload(value) {
      this.element.preload = value;
    }

    applyVolume() {
      if (!this.playerReady || !this.player) return;
      try {
        this.player.setVolume(Math.round(this.volumeValue * 100));
        if (this.mutedValue) this.player.mute();
        else this.player.unMute();
      } catch (error) {
        /* Abaikan. */
      }
    }
  }

  AM.Media = {
    create(element) {
      const engine = new MediaEngine(element || document.getElementById("audio"));
      AM.Media.instance = engine;
      return engine;
    },
    isYoutubeSource,
    /** Buang pemutar YouTube (dipakai saat halaman dibongkar). */
    destroy(engine) {
      if (!engine) return;
      try {
        engine.stopTicker();
        if (engine.player && typeof engine.player.destroy === "function") engine.player.destroy();
      } catch (error) {
        /* Abaikan. */
      }
    }
  };
})(window.AM = window.AM || {});
