/* ==========================================================================
   player.js — antrean, pemutaran, shuffle/repeat, media session
   ========================================================================== */

(function (AM) {
  "use strict";

  const U = AM.Utils;
  const audio = AM.Media.create(document.getElementById("audio"));

  const state = {
    baseQueue: [],
    queue: [],
    cursor: -1,
    history: [],
    currentId: null,
    isPlaying: false,
    shuffle: false,
    repeat: "off",
    volume: 0.8,
    muted: false,
    duration: 0,
    currentTime: 0,
    context: { type: "library", label: "" },
    loadToken: 0,
    loadingTrackId: null,
    loadedTrackId: null,
    pendingPlay: false,
    markedId: null,
    seeking: false,
    radioLoading: "",
    radioPromise: null,
    radioSeeded: new Set(),
    autoIds: new Set(),
    pendingSeek: null,
    restoring: false,
    historyRecordedId: null,
    format: null
  };

  const listeners = new Map();
  let settingsReady = false;
  let volumeSaveTimer = 0;

  const SNAPSHOT_KEY = "musik.playback.v1";
  let snapshotTimer = 0;
  let lastSnapshotAt = 0;
  let restoreGuardTimer = 0;

  // Timer tidur: "off" | "minutes" | "track".
  let sleepMode = "off";
  let sleepDeadline = 0;
  let sleepTickId = 0;
  let sleepFadeId = 0;
  let sleepSavedVolume = null;

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
        console.error("[player] listener error:", error);
      }
    });
  }

  function lookupTrack(trackId) {
    if (!trackId) return null;
    if (AM.Online && AM.Online.isOnlineId(trackId)) return AM.Online.getTrack(trackId);
    return AM.Library.getTrack(trackId);
  }

  function currentTrack() {
    return lookupTrack(state.currentId);
  }

  /* ------------------------------------------------------------------------
     Format audio yang sedang mengalir
     Metadata ini dipakai pemutar untuk menampilkan codec + detail kecil
     (sample rate, bitrate) ketika "Stats for nerds" diaktifkan.
     ------------------------------------------------------------------------ */

  const LOCAL_CODECS = {
    flac: "FLAC",
    alac: "ALAC",
    mp3: "MP3",
    m4a: "AAC",
    mp4: "AAC",
    aac: "AAC",
    wav: "WAV",
    aiff: "AIFF",
    aif: "AIFF",
    ogg: "VORBIS",
    oga: "VORBIS",
    opus: "OPUS",
    webm: "OPUS"
  };

  /* ------------------------------------------------------------------------
     Pembaca header berkas lokal
     Elemen <audio> tidak memberi sample rate/kanal/bit depth, jadi beberapa
     ratus byte pertama berkas dibaca langsung. Hasilnya di-cache per lagu.
     ------------------------------------------------------------------------ */

  const LOCAL_CONTAINERS = {
    flac: "FLAC",
    wav: "WAV",
    wave: "WAV",
    mp3: "MP3",
    m4a: "MP4",
    mp4: "MP4",
    aac: "AAC",
    ogg: "OGG",
    oga: "OGG",
    opus: "OGG",
    aiff: "AIFF",
    aif: "AIFF"
  };

  const headerCache = new Map();

  function asciiAt(bytes, offset, length) {
    let out = "";
    for (let i = 0; i < length; i += 1) out += String.fromCharCode(bytes[offset + i] || 0);
    return out;
  }

  function indexOfAscii(bytes, text, start) {
    const first = text.charCodeAt(0);
    for (let i = Math.max(0, start || 0); i <= bytes.length - text.length; i += 1) {
      if (bytes[i] !== first) continue;
      let match = true;
      for (let j = 1; j < text.length; j += 1) {
        if (bytes[i + j] !== text.charCodeAt(j)) {
          match = false;
          break;
        }
      }
      if (match) return i;
    }
    return -1;
  }

  function readU16(bytes, offset) {
    return (bytes[offset] << 8) | bytes[offset + 1];
  }

  function readU16LE(bytes, offset) {
    return bytes[offset] | (bytes[offset + 1] << 8);
  }

  function readU32(bytes, offset) {
    return (
      ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0
    );
  }

  function readU32LE(bytes, offset) {
    return (
      (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0
    );
  }

  // Angka floating point 80-bit (dipakai AIFF untuk sample rate).
  function readExtended(bytes, offset) {
    const exponent = ((bytes[offset] & 0x7f) << 8) | bytes[offset + 1];
    if (!exponent) return 0;
    let mantissa = 0;
    for (let i = 0; i < 8; i += 1) mantissa = mantissa * 256 + bytes[offset + 2 + i];
    return mantissa * Math.pow(2, exponent - 16383 - 63);
  }

  // "fLaC" + header blok metadata 4 byte + STREAMINFO 34 byte.
  function parseFlacHeader(bytes) {
    if (bytes.length < 26 || asciiAt(bytes, 0, 4) !== "fLaC") return null;
    const b18 = bytes[18];
    const b19 = bytes[19];
    const b20 = bytes[20];
    const b21 = bytes[21];
    const sampleRate = (b18 << 12) | (b19 << 4) | (b20 >> 4);
    const channels = ((b20 >> 1) & 0x07) + 1;
    const bitDepth = (((b20 & 0x01) << 4) | (b21 >> 4)) + 1;
    if (!sampleRate) return null;
    return {
      codec: "FLAC",
      container: "FLAC",
      mimeType: "audio/flac",
      sampleRate,
      channels,
      bitDepth,
      lossless: true
    };
  }

  function parseWavHeader(bytes) {
    if (bytes.length < 24 || asciiAt(bytes, 0, 4) !== "RIFF" || asciiAt(bytes, 8, 4) !== "WAVE") {
      return null;
    }
    let offset = 12;
    while (offset + 8 <= bytes.length) {
      const id = asciiAt(bytes, offset, 4);
      const size = readU32LE(bytes, offset + 4);
      if (id === "fmt " && offset + 24 <= bytes.length) {
        const channels = readU16LE(bytes, offset + 10);
        const sampleRate = readU32LE(bytes, offset + 12);
        const bitDepth = readU16LE(bytes, offset + 22);
        if (!sampleRate) return null;
        return {
          codec: "WAV",
          container: "WAV",
          mimeType: "audio/wav",
          sampleRate,
          channels,
          bitDepth,
          lossless: true
        };
      }
      offset += 8 + size + (size % 2);
    }
    return null;
  }

  function parseAiffHeader(bytes) {
    if (bytes.length < 24 || asciiAt(bytes, 0, 4) !== "FORM") return null;
    const form = asciiAt(bytes, 8, 4);
    if (form !== "AIFF" && form !== "AIFC") return null;
    let offset = 12;
    while (offset + 8 <= bytes.length) {
      const id = asciiAt(bytes, offset, 4);
      const size = readU32(bytes, offset + 4);
      if (id === "COMM" && offset + 26 <= bytes.length) {
        const channels = readU16(bytes, offset + 8);
        const bitDepth = readU16(bytes, offset + 14);
        const sampleRate = Math.round(readExtended(bytes, offset + 16));
        if (!sampleRate) return null;
        return {
          codec: form === "AIFC" ? "AIFF" : "AIFF",
          container: "AIFF",
          mimeType: "audio/aiff",
          sampleRate,
          channels,
          bitDepth,
          lossless: true
        };
      }
      offset += 8 + size + (size % 2);
    }
    return null;
  }

  const MP3_BITRATES = {
    mpeg1: {
      1: [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
      2: [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
      3: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
    },
    mpeg2: {
      1: [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
      2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
      3: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160]
    }
  };

  function parseMp3Header(bytes) {
    let offset = 0;
    if (bytes.length > 10 && asciiAt(bytes, 0, 3) === "ID3") {
      const size =
        ((bytes[6] & 0x7f) << 21) |
        ((bytes[7] & 0x7f) << 14) |
        ((bytes[8] & 0x7f) << 7) |
        (bytes[9] & 0x7f);
      offset = 10 + size + (bytes[5] & 0x10 ? 10 : 0);
    }
    for (let i = offset; i + 4 <= bytes.length; i += 1) {
      if (bytes[i] !== 0xff || (bytes[i + 1] & 0xe0) !== 0xe0) continue;
      const versionBits = (bytes[i + 1] >> 3) & 0x03;
      const layerBits = (bytes[i + 1] >> 1) & 0x03;
      const bitrateIndex = (bytes[i + 2] >> 4) & 0x0f;
      const rateIndex = (bytes[i + 2] >> 2) & 0x03;
      if (versionBits === 1 || layerBits === 0 || bitrateIndex === 0 || bitrateIndex === 15) continue;
      if (rateIndex === 3) continue;
      const rates = versionBits === 3 ? [44100, 48000, 32000] : versionBits === 2 ? [22050, 24000, 16000] : [11025, 12000, 8000];
      const table = versionBits === 3 ? MP3_BITRATES.mpeg1 : MP3_BITRATES.mpeg2;
      // layerBits: 3 = Layer I, 2 = Layer II, 1 = Layer III.
      const layer = 4 - layerBits;
      const bitrate = (table[layer] || [])[bitrateIndex] || 0;
      const channelMode = (bytes[i + 3] >> 6) & 0x03;
      return {
        codec: "MP3",
        container: "MP3",
        mimeType: "audio/mpeg",
        sampleRate: rates[rateIndex],
        channels: channelMode === 3 ? 1 : 2,
        bitDepth: 0,
        bitrate: bitrate * 1000,
        lossless: false
      };
    }
    return null;
  }

  function parseOggHeader(bytes) {
    if (bytes.length < 32 || asciiAt(bytes, 0, 4) !== "OggS") return null;
    const opusIndex = indexOfAscii(bytes, "OpusHead", 0);
    if (opusIndex >= 0 && opusIndex + 10 < bytes.length) {
      return {
        codec: "OPUS",
        container: "OGG",
        mimeType: "audio/ogg",
        // Opus selalu didekode pada 48 kHz.
        sampleRate: 48000,
        channels: bytes[opusIndex + 9] || 2,
        bitDepth: 0,
        lossless: false
      };
    }
    const vorbisIndex = indexOfAscii(bytes, "vorbis", 0);
    if (vorbisIndex > 0 && vorbisIndex + 20 < bytes.length) {
      const sampleRate = readU32LE(bytes, vorbisIndex + 8);
      if (!sampleRate) return null;
      const bitrate = readU32LE(bytes, vorbisIndex + 19);
      return {
        codec: "VORBIS",
        container: "OGG",
        mimeType: "audio/ogg",
        sampleRate,
        channels: bytes[vorbisIndex + 7] || 2,
        bitDepth: 0,
        bitrate: bitrate > 0 ? bitrate : 0,
        lossless: false
      };
    }
    return null;
  }

  function parseAudioHeader(bytes) {
    if (!bytes || bytes.length < 16) return null;
    return (
      parseFlacHeader(bytes) ||
      parseWavHeader(bytes) ||
      parseAiffHeader(bytes) ||
      parseOggHeader(bytes) ||
      parseMp3Header(bytes)
    );
  }

  async function readLocalHeader(blob) {
    const slice = blob.slice(0, Math.min(blob.size, 768 * 1024));
    const buffer = await slice.arrayBuffer();
    return parseAudioHeader(new Uint8Array(buffer));
  }

  function applyLocalHeader(track, id, info) {
    if (!track || !info) return;
    const base = localFormat(track);
    const next = Object.assign({}, base, info, {
      codec: info.codec || base.codec,
      // Rata-rata dari ukuran berkas lebih akurat daripada bitrate frame
      // pertama pada MP3 VBR; header hanya dipakai bila ukuran tidak ada.
      bitrate: base.bitrate || info.bitrate,
      local: true,
      requested: "",
      fallback: false
    });
    setFormat(next, id);
  }

  async function enrichLocalFormat(track, trackId) {
    const id = trackId || (track && track.id);
    if (!track || !id || track.provider === "youtube" || !AM.Library) return null;
    if (headerCache.has(id)) {
      applyLocalHeader(track, id, headerCache.get(id));
      return headerCache.get(id);
    }
    if (typeof AM.Library.getAudioBlob !== "function") return null;
    let blob = null;
    try {
      blob = await AM.Library.getAudioBlob(id);
    } catch (error) {
      return null;
    }
    if (!blob) return null;
    let info = null;
    try {
      info = await readLocalHeader(blob);
    } catch (error) {
      info = null;
    }
    if (!info) return null;
    headerCache.set(id, info);
    applyLocalHeader(track, id, info);
    return info;
  }

  function localFormat(track) {
    if (!track) return null;
    const fileName = String(track.fileName || "");
    const extension = fileName.includes(".") ? fileName.split(".").pop().toLowerCase() : "";
    const mime = String(track.fileType || "").toLowerCase();
    let codec = LOCAL_CODECS[extension] || "";
    if (!codec) {
      if (mime.includes("flac")) codec = "FLAC";
      else if (mime.includes("mpeg")) codec = "MP3";
      else if (mime.includes("mp4") || mime.includes("aac")) codec = "AAC";
      else if (mime.includes("wav")) codec = "WAV";
      else if (mime.includes("ogg")) codec = "VORBIS";
      else if (mime.includes("webm") || mime.includes("opus")) codec = "OPUS";
    }
    const duration = Number(state.duration) || Number(track.duration) || 0;
    const bitrate = track.size && duration > 0 ? Math.round((track.size * 8) / duration) : 0;
    const container = LOCAL_CONTAINERS[extension] || "";
    return {
      codec: codec || "AUDIO",
      container,
      mimeType: track.fileType || "",
      itag: 0,
      bitrate,
      sampleRate: 0,
      channels: 0,
      bitDepth: 0,
      lossless: codec === "FLAC" || codec === "ALAC" || codec === "WAV" || codec === "AIFF",
      requested: "",
      fallback: false,
      local: true
    };
  }

  // Metadata awal: lokal langsung dari berkas, YouTube dari itag (Invidious)
  // atau menunggu resolver (proxy).
  function initialFormat(track) {
    if (!track) return null;
    if (track.provider === "youtube" && AM.Youtube) {
      if (typeof AM.Youtube.formatFor === "function") {
        return AM.Youtube.formatFor(track.audioVideoId || track.sourceId);
      }
      return null;
    }
    return localFormat(track);
  }

  function setFormat(format, trackId) {
    const id = trackId == null ? state.currentId : trackId;
    if (!id || id !== state.currentId) return;
    const next = format || null;
    const same =
      state.format === next ||
      (state.format &&
        next &&
        state.format.codec === next.codec &&
        state.format.container === next.container &&
        state.format.itag === next.itag &&
        state.format.bitrate === next.bitrate &&
        state.format.sampleRate === next.sampleRate &&
        state.format.channels === next.channels &&
        state.format.bitDepth === next.bitDepth &&
        state.format.lossless === next.lossless &&
        state.format.requested === next.requested &&
        state.format.fallback === next.fallback);
    state.format = next;
    if (!same) emit("format", { track: currentTrack(), format: next });
  }

  // Ambil metadata format final saat audio benar-benar berjalan.
  async function refreshFormat(trackId, token) {
    const id = trackId || state.currentId;
    if (!id) return;
    if (token != null && token !== state.loadToken) return;
    if (id !== state.currentId) return;
    const track = lookupTrack(id);
    if (!track) return;
    if (track.provider !== "youtube") {
      setFormat(localFormat(track), id);
      await enrichLocalFormat(track, id);
      return;
    }
    const sourceId = track.audioVideoId || track.sourceId;
    if (!AM.Youtube) return;
    if (typeof AM.Youtube.resolveFormat === "function") {
      const format = await AM.Youtube.resolveFormat(sourceId);
      if (format) setFormat(format, id);
    }
  }

  // Pastikan metadata format sudah lengkap sebelum panel "Stats for nerds"
  // dibuka (berkas lokal dibaca header-nya, YouTube memakai resolver).
  async function ensureFormat(trackId) {
    const id = trackId || state.currentId;
    if (!id) return null;
    const track = lookupTrack(id);
    if (!track) return null;
    if (track.provider !== "youtube") await enrichLocalFormat(track, id);
    else await refreshFormat(id, state.loadToken);
    return id === state.currentId ? state.format : null;
  }

  function maybeRecordHistory() {
    const track = currentTrack();
    if (!track || !track.id) return;
    if (state.historyRecordedId === track.id) return;
    state.historyRecordedId = track.id;
    AM.Library.recordHistory(track);
  }

  /* ------------------------------------------------------------------------
     Snapshot pemutaran
     Lagu lokal dipulihkan dari perpustakaan, lagu online membutuhkan salinan
     metadatanya karena AM.Online hanya menyimpan data di memori.
     ------------------------------------------------------------------------ */

  function onlineSnapshot(track) {
    if (!track || !track.id) return null;
    return {
      id: track.id,
      online: true,
      provider: track.provider || "youtube",
      providerLabel: track.providerLabel || "YouTube",
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

  function readSnapshot() {
    try {
      const raw = window.localStorage.getItem(SNAPSHOT_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      return data && typeof data === "object" ? data : null;
    } catch (error) {
      console.warn("[player] gagal membaca snapshot:", error);
      return null;
    }
  }

  function clearSnapshot() {
    window.clearTimeout(snapshotTimer);
    snapshotTimer = 0;
    lastSnapshotAt = 0;
    try {
      window.localStorage.removeItem(SNAPSHOT_KEY);
    } catch (error) {
      /* Abaikan. */
    }
  }

  function snapshotPosition() {
    if (Number.isFinite(audio.currentTime) && audio.currentTime > 0) {
      return audio.currentTime;
    }
    return Number(state.currentTime) || 0;
  }

  function writeSnapshot(force) {
    if (state.restoring) return;
    if (!state.currentId || !state.queue.length) return;
    const now = Date.now();
    if (!force && now - lastSnapshotAt < 4000) {
      if (!snapshotTimer) {
        snapshotTimer = window.setTimeout(() => {
          snapshotTimer = 0;
          writeSnapshot(true);
        }, 4000);
      }
      return;
    }
    window.clearTimeout(snapshotTimer);
    snapshotTimer = 0;

    const onlineTracks = [];
    state.queue
      .concat(state.baseQueue, state.history, [state.currentId])
      .forEach((id) => {
        if (!AM.Online || !AM.Online.isOnlineId(id)) return;
        const track = AM.Online.getTrack(id);
        const plain = onlineSnapshot(track);
        if (plain) onlineTracks.push(plain);
      });

    const data = {
      version: 1,
      savedAt: now,
      trackId: state.currentId,
      cursor: state.cursor,
      position: snapshotPosition(),
      queue: state.queue.slice(),
      baseQueue: state.baseQueue.slice(),
      history: state.history.slice(),
      autoIds: Array.from(state.autoIds),
      radioSeeded: Array.from(state.radioSeeded),
      context: state.context,
      volume: state.volume,
      muted: state.muted,
      shuffle: state.shuffle,
      repeat: state.repeat,
      onlineTracks: onlineTracks
    };

    try {
      window.localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(data));
      lastSnapshotAt = now;
    } catch (error) {
      console.warn("[player] gagal menyimpan snapshot:", error);
    }
  }

  function scheduleSnapshot(delay) {
    if (state.restoring) return;
    window.clearTimeout(snapshotTimer);
    snapshotTimer = window.setTimeout(() => {
      snapshotTimer = 0;
      writeSnapshot(true);
    }, Math.max(0, delay || 0));
  }

  function finishRestore() {
    window.clearTimeout(restoreGuardTimer);
    restoreGuardTimer = 0;
    state.restoring = false;
  }

  function applyPendingSeek() {
    if (state.pendingSeek == null) return;
    const target = state.pendingSeek;
    state.pendingSeek = null;
    const max =
      Number.isFinite(audio.duration) && audio.duration > 0
        ? Math.max(0, audio.duration - 0.25)
        : target;
    const value = U.clamp(target, 0, max);
    try {
      audio.currentTime = value;
    } catch (error) {
      /* Abaikan. */
    }
    state.currentTime = value;
    if (Number.isFinite(audio.duration) && audio.duration > 0) {
      state.duration = audio.duration;
    }
    finishRestore();
    emit("time", {
      currentTime: state.currentTime,
      duration: state.duration,
      buffered: bufferedRatio()
    });
    writeSnapshot(true);
  }

  function restoreSnapshot() {
    const data = readSnapshot();
    if (!data) return false;

    (Array.isArray(data.onlineTracks) ? data.onlineTracks : []).forEach((saved) => {
      const track = onlineSnapshot(saved);
      if (!track) return;
      if (AM.Online && typeof AM.Online.remember === "function") {
        AM.Online.remember(track);
      }
    });

    const queue = (Array.isArray(data.queue) ? data.queue : []).filter((id) => lookupTrack(id));
    const currentId = data.trackId && lookupTrack(data.trackId) ? data.trackId : queue[0];
    if (!queue.length || !currentId) {
      clearSnapshot();
      return false;
    }

    const savedCursor = Number(data.cursor);
    let cursor =
      Number.isInteger(savedCursor) &&
      savedCursor >= 0 &&
      savedCursor < queue.length &&
      queue[savedCursor] === currentId
        ? savedCursor
        : queue.indexOf(currentId);

    state.restoring = true;
    state.baseQueue = (Array.isArray(data.baseQueue) ? data.baseQueue : queue).filter((id) =>
      lookupTrack(id)
    );
    if (state.baseQueue.indexOf(currentId) < 0) state.baseQueue.unshift(currentId);
    state.queue = queue;
    state.cursor = cursor;
    state.currentId = currentId;
    state.history = (Array.isArray(data.history) ? data.history : []).filter((id) => lookupTrack(id));
    state.autoIds = new Set(
      (Array.isArray(data.autoIds) ? data.autoIds : []).filter((id) => lookupTrack(id))
    );
    state.radioSeeded = new Set(
      (Array.isArray(data.radioSeeded) ? data.radioSeeded : []).filter(Boolean)
    );
    state.context = data.context && typeof data.context === "object"
      ? data.context
      : { type: "library", label: "" };
    state.isPlaying = false;

    const track = lookupTrack(currentId);
    const position = Math.max(0, Number(data.position) || 0);
    state.currentTime = position;
    state.duration = Number(track && track.duration) || 0;

    emit("trackchange", { track });
    emit("queuechange", getQueue());
    emit("statechange", getState());
    emit("time", { currentTime: position, duration: state.duration, buffered: 0 });

    // Jangan biarkan snapshot lama ditimpa posisi 0 selama audio dimuat.
    window.clearTimeout(restoreGuardTimer);
    restoreGuardTimer = window.setTimeout(finishRestore, 20000);

    loadCurrent(false, { startAt: position });
    return true;
  }

  function applyVolume() {
    audio.volume = U.clamp(state.volume, 0, 1);
    audio.muted = !!state.muted;
    emit("volumechange", { volume: state.volume, muted: state.muted });
  }

  function persistVolume() {
    window.clearTimeout(volumeSaveTimer);
    volumeSaveTimer = window.setTimeout(() => {
      AM.Library.setSetting("volume", state.volume);
      AM.Library.setSetting("muted", state.muted);
    }, 250);
  }

  function setVolume(value, options) {
    state.volume = U.clamp(Number(value) || 0, 0, 1);
    if (state.volume > 0 && state.muted) state.muted = false;
    applyVolume();
    if (!options || options.persist !== false) persistVolume();
  }

  function setMuted(value) {
    state.muted = !!value;
    applyVolume();
    persistVolume();
  }

  function toggleMute() {
    setMuted(!state.muted);
  }

  /* ------------------------------------------------------------------------
     Timer tidur
     ------------------------------------------------------------------------ */

  function sleepRemainingMs() {
    return sleepMode === "minutes" ? Math.max(0, sleepDeadline - Date.now()) : 0;
  }

  function getSleepTimer() {
    return {
      mode: sleepMode,
      remainingMs: sleepRemainingMs(),
      endsAt: sleepDeadline
    };
  }

  function emitSleepTimer() {
    emit("sleeptimerchange", getSleepTimer());
  }

  function restoreSleepVolume() {
    if (sleepSavedVolume == null) return;
    const volume = sleepSavedVolume;
    sleepSavedVolume = null;
    state.volume = U.clamp(volume, 0, 1);
    applyVolume();
    persistVolume();
  }

  function clearSleepTicker() {
    if (sleepTickId) {
      window.clearInterval(sleepTickId);
      sleepTickId = 0;
    }
    if (sleepFadeId) {
      window.clearInterval(sleepFadeId);
      sleepFadeId = 0;
    }
  }

  function finishSleep() {
    clearSleepTicker();
    pause();
    restoreSleepVolume();
    sleepMode = "off";
    sleepDeadline = 0;
    emitSleepTimer();
    emit("sleepdone", {});
  }

  function startSleepFade() {
    if (sleepFadeId) return;
    sleepSavedVolume = state.volume;
    const start = state.volume;
    const steps = 20;
    let step = 0;
    // Turunkan volume bertahap selama ±5 detik sebelum dijeda.
    sleepFadeId = window.setInterval(() => {
      step += 1;
      if (step >= steps) {
        setVolume(0, { persist: false });
        finishSleep();
        return;
      }
      setVolume(start * (1 - step / steps), { persist: false });
    }, 250);
  }

  function sleepDeadlineReached() {
    clearSleepTicker();
    if (state.isPlaying) startSleepFade();
    else finishSleep();
  }

  function setSleepTimer(minutes) {
    cancelSleepTimer();
    if (minutes === "track" || minutes === 0) {
      sleepMode = "track";
      sleepDeadline = 0;
      emitSleepTimer();
      return;
    }
    const value = Number(minutes);
    if (!Number.isFinite(value) || value <= 0) return;
    sleepMode = "minutes";
    sleepDeadline = Date.now() + value * 60000;
    sleepTickId = window.setInterval(() => {
      if (sleepMode !== "minutes") return;
      if (sleepRemainingMs() <= 0) {
        sleepDeadlineReached();
        return;
      }
      emitSleepTimer();
    }, 1000);
    emitSleepTimer();
  }

  function cancelSleepTimer() {
    clearSleepTicker();
    restoreSleepVolume();
    sleepMode = "off";
    sleepDeadline = 0;
    emitSleepTimer();
  }

  /* ------------------------------------------------------------------------
     Antrean
     ------------------------------------------------------------------------ */

  function uniqueIds(ids) {
    const seen = new Set();
    const result = [];
    (ids || []).forEach((id) => {
      if (!id || seen.has(id) || !lookupTrack(id)) return;
      seen.add(id);
      result.push(id);
    });
    return result;
  }

  function occurrenceIndex(ids, trackId, occurrence) {
    let seen = 0;
    for (let index = 0; index < ids.length; index += 1) {
      if (ids[index] !== trackId) continue;
      if (seen === occurrence) return index;
      seen += 1;
    }
    return -1;
  }

  function occurrenceBefore(ids, index, trackId) {
    let count = 0;
    for (let cursor = 0; cursor <= index && cursor < ids.length; cursor += 1) {
      if (ids[cursor] === trackId) count += 1;
    }
    return count - 1;
  }

  function setShuffle(value) {
    const next = !!value;
    if (state.shuffle === next) return;
    state.shuffle = next;

    const current = state.currentId;
    if (state.queue.length) {
      if (next) {
        const head = state.queue.slice(0, state.cursor + 1);
        const rest = state.queue.slice(state.cursor + 1);
        state.queue = head.concat(U.shuffleArray(rest));
        state.cursor = current ? head.length - 1 : -1;
      } else {
        const base = state.baseQueue.slice();
        const activeOccurrence = current
          ? occurrenceBefore(state.queue, state.cursor, current)
          : -1;
        state.queue = base;
        state.cursor = current
          ? occurrenceIndex(base, current, activeOccurrence)
          : -1;
        if (current && state.cursor < 0) {
          base.unshift(current);
          state.queue = base;
          state.cursor = 0;
        }
      }
    }

    AM.Library.setSetting("shuffle", state.shuffle);
    emit("shufflechange", { shuffle: state.shuffle });
    emit("queuechange", getQueue());
    emit("statechange", getState());
    scheduleSnapshot(0);
  }

  function toggleShuffle() {
    setShuffle(!state.shuffle);
  }

  function setRepeat(mode) {
    const allowed = ["off", "all", "one"];
    state.repeat = allowed.includes(mode) ? mode : "off";
    AM.Library.setSetting("repeat", state.repeat);
    emit("repeatchange", { repeat: state.repeat });
    emit("statechange", getState());
    scheduleSnapshot(0);
  }

  function cycleRepeat() {
    const order = ["off", "all", "one"];
    const index = order.indexOf(state.repeat);
    setRepeat(order[(index + 1) % order.length]);
  }

  function buildActiveQueue(base, startId) {
    const baseQueue = uniqueIds(base);
    if (!baseQueue.length) return { baseQueue: [], queue: [], cursor: -1 };
    if (!state.shuffle) {
      const index = startId ? baseQueue.indexOf(startId) : -1;
      return { baseQueue, queue: baseQueue.slice(), cursor: index >= 0 ? index : 0 };
    }
    const rest = baseQueue.filter((id) => id !== startId);
    const queue = startId && baseQueue.includes(startId) ? [startId].concat(U.shuffleArray(rest)) : U.shuffleArray(baseQueue);
    return { baseQueue, queue, cursor: 0 };
  }

  async function playQueue(ids, startId, context, options) {
    const clean = uniqueIds(ids);
    if (!clean.length) return;
    const start = startId && clean.includes(startId) ? startId : clean[0];
    const built = buildActiveQueue(clean, start);
    state.baseQueue = built.baseQueue;
    state.queue = built.queue;
    state.cursor = built.cursor;
    state.context = context || { type: "library", label: "" };
    state.history = [];
    state.radioSeeded = new Set();
    state.autoIds = new Set();
    emit("queuechange", getQueue());
    await loadCurrent(!(options && options.autoplay === false));
  }

  async function playTrack(trackId, options) {
    const opts = options || {};
    const track = lookupTrack(trackId);
    if (!track) return;

    if (state.queue.includes(trackId)) {
      state.cursor = state.queue.indexOf(trackId);
      if (state.currentId === trackId) {
        if (!state.isPlaying) resume();
        return;
      }
      await loadCurrent(true);
      return;
    }

    const ids = opts.queueIds && opts.queueIds.length ? opts.queueIds.slice() : [trackId];
    if (!ids.includes(trackId)) ids.unshift(trackId);
    await playQueue(ids, trackId, opts.context || state.context);
  }

  async function addToQueue(trackIds, options) {
    const opts = options || {};
    const isAuto = !!opts.auto;
    const current = state.currentId;
    const requestedIds = uniqueIds(trackIds);
    const replayCurrent = !!current && requestedIds.includes(current);
    const ids = requestedIds.filter((id) => id !== current);
    if (!ids.length && !replayCurrent) return 0;

    if (!state.queue.length) {
      if (replayCurrent) return 0;
      await playQueue(ids, ids[0], opts.context || state.context);
      ids.forEach((id) => {
        if (isAuto) state.autoIds.add(id);
        else state.autoIds.delete(id);
      });
      if (!isAuto && ids.length) emit("queueadded", { ids: ids.slice() });
      return ids.length;
    }

    const currentOccurrence =
      current && state.cursor >= 0
        ? occurrenceBefore(state.queue, state.cursor, current)
        : -1;
    ids.forEach((id) => state.autoIds.delete(id));

    const base = state.baseQueue.filter((id) => !ids.includes(id));
    const currentBase = current
      ? occurrenceIndex(base, current, currentOccurrence)
      : -1;
    let insertBaseAt;
    if (opts.next) {
      insertBaseAt = currentBase + 1;
    } else if (isAuto) {
      insertBaseAt = base.length;
    } else {
      // Tambahan manual tetap di atas rekomendasi otomatis.
      let firstAuto = -1;
      for (let i = Math.max(0, currentBase + 1); i < base.length; i += 1) {
        if (state.autoIds.has(base[i])) {
          firstAuto = i;
          break;
        }
      }
      insertBaseAt = firstAuto >= 0 ? firstAuto : base.length;
    }
    base.splice.apply(base, [Math.max(0, insertBaseAt), 0].concat(ids));
    state.baseQueue = base;

    if (state.shuffle) {
      const head = state.queue.slice(0, state.cursor + 1);
      const tail = state.queue.slice(state.cursor + 1).filter((id) => !ids.includes(id));
      if (opts.next) {
        state.queue = head.concat(ids, tail);
      } else if (isAuto) {
        state.queue = head.concat(tail, ids);
      } else {
        const firstAuto = tail.findIndex(
          (id) => id !== current && state.autoIds.has(id)
        );
        state.queue =
          firstAuto >= 0
            ? head.concat(tail.slice(0, firstAuto), ids, tail.slice(firstAuto))
            : head.concat(tail, ids);
      }
      state.cursor = head.length - 1;
    } else {
      state.queue = base.slice();
      state.cursor = current
        ? occurrenceIndex(state.queue, current, currentOccurrence)
        : -1;
    }

    if (isAuto) ids.forEach((id) => state.autoIds.add(id));

    if (replayCurrent) {
      const activeIndex = current
        ? occurrenceIndex(state.queue, current, currentOccurrence)
        : -1;
      const nextIndex = activeIndex + 1;
      let queueIndex = nextIndex;
      let baseIndex = currentBase + 1;

      if (!opts.next && !isAuto) {
        const tail = state.queue.slice(nextIndex);
        const firstAuto = tail.findIndex(
          (id) => id !== current && state.autoIds.has(id)
        );
        queueIndex = firstAuto >= 0 ? nextIndex + firstAuto : state.queue.length;
        const firstBaseAuto = base.slice(baseIndex).findIndex(
          (id) => id !== current && state.autoIds.has(id)
        );
        baseIndex =
          firstBaseAuto >= 0 ? baseIndex + firstBaseAuto : base.length;
      } else if (isAuto && !opts.next) {
        queueIndex = state.queue.length;
        baseIndex = base.length;
      }

      state.queue.splice(Math.max(0, queueIndex), 0, current);
      base.splice(Math.max(0, baseIndex), 0, current);
      state.baseQueue = base;
      if (isAuto) state.autoIds.add(current);
    }

    emit("queuechange", getQueue());
    emit("statechange", getState());
    scheduleSnapshot(0);
    const added = ids.length + (replayCurrent ? 1 : 0);
    if (!isAuto && added) {
      emit("queueadded", {
        ids: ids.concat(replayCurrent ? [current] : [])
      });
    }
    return added;
  }

  function removeQueueIndex(index) {
    if (!Number.isInteger(index) || index < 0 || index >= state.queue.length) return;
    const trackId = state.queue[index];
    const wasCurrent = index === state.cursor;
    const occurrence = occurrenceBefore(state.queue, index, trackId);
    state.queue.splice(index, 1);
    if (!state.queue.includes(trackId)) state.autoIds.delete(trackId);
    const baseIndex = occurrenceIndex(state.baseQueue, trackId, occurrence);
    if (baseIndex >= 0) state.baseQueue.splice(baseIndex, 1);
    state.history = state.history.filter((id) => id !== trackId);

    if (wasCurrent) {
      state.cursor = Math.min(index, state.queue.length - 1);
      if (state.cursor >= 0 && state.queue[state.cursor]) {
        loadCurrent(state.isPlaying);
      } else {
        stop();
      }
    } else if (index < state.cursor) {
      state.cursor -= 1;
    }

    emit("queuechange", getQueue());
    emit("statechange", getState());
    scheduleSnapshot(0);
  }

  function removeFromQueue(trackId) {
    removeQueueIndex(state.queue.indexOf(trackId));
  }

  async function playQueueIndex(index) {
    if (!Number.isInteger(index) || index < 0 || index >= state.queue.length) return;
    if (index === state.cursor) {
      if (!state.isPlaying) await play();
      return;
    }
    state.cursor = index;
    await loadCurrent(true);
  }

  function clearQueue() {
    pause();
    state.baseQueue = [];
    state.queue = [];
    state.cursor = -1;
    state.history = [];
    state.currentId = null;
    state.isPlaying = false;
    state.loadToken += 1;
    state.pendingSeek = null;
    finishRestore();
    clearSnapshot();
    state.radioSeeded = new Set();
    state.autoIds = new Set();
    audio.removeAttribute("src");
    audio.load();
    state.duration = 0;
    state.currentTime = 0;
    updateMediaSession(null);
    emit("queuechange", getQueue());
    emit("trackchange", { track: null });
    emit("statechange", getState());
    emit("time", { currentTime: 0, duration: 0, buffered: 0 });
  }

  function getQueue() {
    return {
      queue: state.queue.map((id) => lookupTrack(id)).filter(Boolean),
      baseQueue: state.baseQueue.slice(),
      cursor: state.cursor,
      currentId: state.currentId,
      history: state.history.slice(),
      context: state.context
    };
  }

  /* ------------------------------------------------------------------------
     Pemutaran
     ------------------------------------------------------------------------ */

  function updateMediaSession(track) {
    if (!("mediaSession" in navigator)) return;
    try {
      if (!track) {
        navigator.mediaSession.metadata = null;
        navigator.mediaSession.playbackState = "none";
        return;
      }
      const artwork = [];
      const cover = track.online ? track.art : AM.Library.coverURL(track.coverId);
      if (cover) {
        artwork.push({ src: cover, sizes: track.online ? "480x480" : "512x512" });
      }
      if (typeof MediaMetadata !== "undefined") {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: track.title,
          artist: track.artist,
          album: track.album || "Musik",
          artwork
        });
      }
      navigator.mediaSession.playbackState = state.isPlaying ? "playing" : "paused";
      if (state.duration > 0 && state.currentTime >= 0) {
        navigator.mediaSession.setPositionState({
          duration: state.duration,
          playbackRate: audio.playbackRate || 1,
          position: U.clamp(state.currentTime, 0, state.duration)
        });
      }
    } catch (error) {
      /* Media Session tidak wajib. */
    }
  }

  function reportPlayFailure(track, error) {
    if (error && error.name === "NotAllowedError") {
      emit("blocked", { track, error });
    } else if (!error || error.name !== "AbortError") {
      console.warn("[player] audio.play() gagal:", error);
    }
  }

  function youtubeCandidateIds(track) {
    const ids = [track && track.sourceId].concat(
      track && Array.isArray(track.candidates) ? track.candidates : []
    );
    return ids.filter((id, index) => !!id && ids.indexOf(id) === index);
  }

  async function resolveYoutubeAudio(track, token, trackId) {
    if (!AM.Youtube || typeof AM.Youtube.resolveAudio !== "function") return null;
    const ids = youtubeCandidateIds(track);
    for (const id of ids) {
      let url = null;
      try {
        url = await AM.Youtube.resolveAudio(id);
      } catch (error) {
        url = null;
      }
      if (state.loadToken !== token || state.currentId !== trackId) return null;
      if (url) return { url, videoId: id };
    }
    return null;
  }

  function prefetchAudio(track) {
    if (!track || track.provider !== "youtube" || !track.sourceId) return;
    if (!AM.Youtube || typeof AM.Youtube.resolveAudio !== "function") return;
    try {
      AM.Youtube.resolveAudio(track.sourceId).catch(() => {});
    } catch (error) {
      /* Abaikan. */
    }
  }

  /* ------------------------------------------------------------------------
     Radio otomatis (mirip autoplay YouTube Music/Spotify)
     Sumber utama: playlist Mix/Radio YouTube untuk lagu yang sedang diputar.
     Antrean diisi sampai ±20 lagu dan diperpanjang lagi saat sisa 5 lagu.
     Semua pengambilan berjalan di latar belakang.
     ------------------------------------------------------------------------ */

  const RADIO_TARGET_TOTAL = 20;
  const RADIO_REFILL_AT = 5;
  const RADIO_ARTIST_WINDOW = 10;
  const RADIO_ARTIST_MAX = 2;
  const RADIO_BLOCKED = [
    "full album",
    "fullalbum",
    "compilation",
    "compilations",
    "kompilasi",
    "podcast",
    "medley",
    "nonstop",
    "non-stop",
    "mega hits",
    "greatest hits",
    "kumpulan lagu",
    "album penuh",
    "full concert",
    "dj mix",
    "megamix"
  ];

  function radioInfo(track) {
    if (!track) return { song: "", artist: "" };
    const YT = AM.Youtube || {};
    const parsed =
      typeof YT.parseTrackInfo === "function"
        ? YT.parseTrackInfo(track.title, track.artist)
        : { song: track.songTitle || track.title, artist: track.artist };
    const song = track.songTitle || parsed.song || track.title || "";
    const artist =
      track.artist && track.artist !== "YouTube" ? track.artist : parsed.artist || "";
    return {
      song:
        typeof YT.normalizeSong === "function"
          ? YT.normalizeSong(song)
          : String(song).toLowerCase(),
      artist:
        typeof YT.primaryArtist === "function"
          ? YT.primaryArtist(artist)
          : String(artist || "").toLowerCase()
    };
  }

  function radioSongKey(track) {
    const info = radioInfo(track);
    return info.song + "|" + info.artist;
  }

  function radioBlocked(track) {
    const text = (
      String((track && track.title) || "") +
      " " +
      String((track && track.songTitle) || "")
    ).toLowerCase();
    return RADIO_BLOCKED.some((phrase) => text.includes(phrase));
  }

  function radioVersionType(track) {
    const text = (
      String((track && track.title) || "") +
      " " +
      String((track && track.songTitle) || "")
    ).toLowerCase();
    return /\b(cover|karaoke|remix|nightcore|instrumental|tribute|made famous|originally performed)\b/.test(
      text
    );
  }

  function selectRadioTracks(candidates, seed, usedIds, usedKeys, upcoming) {
    const need = Math.max(0, RADIO_TARGET_TOTAL - 1 - upcoming.length);
    if (!need) return [];

    const YT = AM.Youtube || {};
    const seedInfo = radioInfo(seed);
    const seedIsVersion = radioVersionType(seed);
    const artists = upcoming.map((track) => radioInfo(track).artist);
    const picked = [];
    const pickedKeys = new Set();

    for (const track of candidates || []) {
      if (picked.length >= need) break;
      if (!track || usedIds.has(track.id)) continue;
      if (radioBlocked(track)) continue;

      const duration = Number(track.duration) || 0;
      if (duration && (duration < 60 || duration > 600)) continue;

      if (!seedIsVersion && radioVersionType(track)) continue;

      const info = radioInfo(track);
      if (!info.song) continue;

      const sameSong =
        typeof YT.titlesSimilar === "function"
          ? YT.titlesSimilar(seedInfo.song, info.song)
          : seedInfo.song === info.song;
      if (sameSong) continue;

      const key = info.song + "|" + info.artist;
      if (usedKeys.has(key) || pickedKeys.has(key)) continue;

      if (info.artist) {
        if (artists.length && artists[artists.length - 1] === info.artist) continue;
        const windowArtists = artists.slice(-(RADIO_ARTIST_WINDOW - 1));
        const count = windowArtists.filter((artist) => artist === info.artist).length;
        if (count >= RADIO_ARTIST_MAX) continue;
      }

      picked.push(track);
      pickedKeys.add(key);
      if (info.artist) artists.push(info.artist);
    }

    return picked;
  }

  function prepareUpNext(track, token) {
    if (!track || track.provider !== "youtube") return;
    if (!AM.Youtube || typeof AM.Youtube.related !== "function") return;

    const remaining = state.queue.length - state.cursor - 1;
    if (remaining > 0) {
      prefetchAudio(lookupTrack(state.queue[state.cursor + 1]));
    }

    // Ulangi satu / ulangi semua: jangan campur antrean dengan radio.
    if (state.repeat !== "off") return;
    if (remaining > RADIO_REFILL_AT) return;

    const seedKey = track.id + "@" + state.cursor;
    if (state.radioLoading === seedKey) return;
    if (state.radioSeeded.has(seedKey)) return;

    state.radioLoading = seedKey;
    const task = AM.Youtube.related(track.sourceId, track)
      .then((tracks) => {
        if (state.loadToken !== token || state.currentId !== track.id) return;
        if (!Array.isArray(tracks) || !tracks.length) return; // biarkan dicoba lagi nanti

        const upcoming = state.queue
          .slice(state.cursor + 1)
          .map((id) => lookupTrack(id))
          .filter(Boolean);
        const usedTracks = state.queue
          .concat(state.history)
          .map((id) => lookupTrack(id))
          .filter(Boolean);
        if (!usedTracks.includes(track)) usedTracks.push(track);
        const usedIds = new Set(state.queue.concat(state.history, [track.id]));
        const usedKeys = new Set(usedTracks.map((item) => radioSongKey(item)));

        const picked = selectRadioTracks(tracks, track, usedIds, usedKeys, upcoming);
        state.radioSeeded.add(seedKey);

        if (picked.length) {
          addToQueue(
            picked.map((item) => item.id),
            { auto: true }
          );
        }
        prefetchAudio(lookupTrack(state.queue[state.cursor + 1]));
      })
      .catch(() => {})
      .finally(() => {
        if (state.radioLoading === seedKey) state.radioLoading = "";
        if (state.radioPromise === task) state.radioPromise = null;
      });

    state.radioPromise = task;
  }

  async function loadCurrent(autoplay, options) {
    const opts = options || {};
    if (opts.startAt == null) {
      // Pemutaran baru membatalkan proses pemulihan snapshot.
      state.pendingSeek = null;
      finishRestore();
    }
    const trackId = state.queue[state.cursor];
    if (!trackId) {
      stop();
      return;
    }
    const track = lookupTrack(trackId);
    if (!track) {
      state.queue.splice(state.cursor, 1);
      loadCurrent(autoplay, opts);
      return;
    }

    const startAt = opts.startAt != null ? Math.max(0, Number(opts.startAt) || 0) : 0;
    state.currentId = trackId;
    state.loadToken += 1;
    const token = state.loadToken;
    state.loadingTrackId = trackId;
    state.loadedTrackId = null;
    state.pendingPlay = !!autoplay;
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    state.markedId = null;
    state.historyRecordedId = null;
    state.currentTime = startAt;
    state.pendingSeek = opts.startAt != null ? startAt : null;
    state.duration = Number(track.duration) || 0;
    state.format = initialFormat(track);
    emit("trackchange", { track });
    emit("format", { track, format: state.format });
    if (track.provider !== "youtube") enrichLocalFormat(track, trackId).catch(() => {});
    emit("statechange", getState());
    emit("queuechange", getQueue());
    emit("time", { currentTime: startAt, duration: state.duration, buffered: 0 });
    if (!state.restoring) writeSnapshot(true);

    state.isPlaying = false;

    if (track.provider === "youtube" && AM.Youtube) {
      const sourceId = track.audioVideoId || track.sourceId;
      const streamUrl =
        typeof AM.Youtube.audioStreamUrl === "function"
          ? AM.Youtube.audioStreamUrl(sourceId)
          : "";
      if (!streamUrl) {
        state.loadingTrackId = null;
        state.pendingPlay = false;
        emit("error", {
          track,
          error: new Error("Audio lagu YouTube tidak dapat diambil.")
        });
        state.isPlaying = false;
        state.pendingSeek = null;
        finishRestore();
        emit("statechange", getState());
        return;
      }

      // Start the media request in the user gesture before the server resolves the stream.
      track.audioVideoId = sourceId;
      track.audioRetryCount = 0;
      track.audioRetrying = false;
      track.iframeTried = false;
      audio.src = streamUrl;
      audio.load();
      state.loadedTrackId = trackId;
      state.loadingTrackId = null;
      updateMediaSession(track);
      const playRequest = state.pendingPlay ? audio.play() : null;
      if (playRequest) {
        try {
          await playRequest;
        } catch (error) {
          if (token !== state.loadToken || state.currentId !== trackId) return;
          state.pendingPlay = false;
          reportPlayFailure(track, error);
          state.isPlaying = false;
          emit("statechange", getState());
        }
      }
      if (token === state.loadToken && state.currentId === trackId) {
        prepareUpNext(track, token);
      }
      return;
    }

    let url;
    try {
      url = track.online
        ? await AM.Online.getStreamURL(track)
        : await AM.Library.getAudioURL(trackId);
    } catch (error) {
      if (token !== state.loadToken || state.currentId !== trackId) return;
      if (token === state.loadToken) {
        state.loadingTrackId = null;
        state.pendingPlay = false;
      }
      emit("error", { track, error });
      state.isPlaying = false;
      state.pendingSeek = null;
      finishRestore();
      emit("statechange", getState());
      return;
    }

    if (token !== state.loadToken || state.currentId !== trackId) return;

    audio.src = url;
    audio.load();
    state.loadedTrackId = trackId;
    state.loadingTrackId = null;
    updateMediaSession(track);

    if (state.pendingPlay) {
      try {
        await audio.play();
      } catch (error) {
        if (token !== state.loadToken || state.currentId !== trackId) return;
        state.pendingPlay = false;
        reportPlayFailure(track, error);
        state.isPlaying = false;
        emit("statechange", getState());
      }
    }
  }

  async function play() {
    if (!state.currentId) {
      if (state.queue.length) {
        state.cursor = Math.max(0, state.cursor);
        loadCurrent(true);
      }
      return;
    }
    const track = currentTrack();
    const trackId = state.currentId;
    const token = state.loadToken;
    if (state.loadedTrackId !== state.currentId) {
      state.pendingPlay = true;
      if (state.loadingTrackId !== state.currentId) await loadCurrent(true);
      return;
    }
    try {
      await audio.play();
    } catch (error) {
      if (token !== state.loadToken || state.currentId !== trackId) return;
      state.pendingPlay = false;
      reportPlayFailure(track, error);
    }
  }

  function pause() {
    state.pendingPlay = false;
    audio.pause();
  }

  async function resume() {
    if (!state.currentId) return;
    await play();
  }

  async function toggle() {
    if (!state.currentId) {
      if (state.queue.length) {
        await loadCurrent(true);
      }
      return;
    }
    if (!state.isPlaying) {
      await play();
    } else {
      pause();
    }
  }

  function stop() {
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    state.loadingTrackId = null;
    state.loadedTrackId = null;
    state.pendingPlay = false;
    state.loadToken += 1;
    state.currentId = null;
    state.isPlaying = false;
    state.duration = 0;
    state.currentTime = 0;
    state.pendingSeek = null;
    finishRestore();
    clearSnapshot();
    updateMediaSession(null);
    emit("trackchange", { track: null });
    emit("statechange", getState());
    emit("time", { currentTime: 0, duration: 0, buffered: 0 });
  }

  async function next(manual, stopAtEnd) {
    if (!state.queue.length) return;
    // Hanya tunggu radio bila benar-benar sudah di ujung antrean; lompat
    // lagu di tengah antrean tidak boleh tertahan proses latar belakang.
    if (state.cursor >= state.queue.length - 1 && state.radioPromise) {
      try {
        await state.radioPromise;
      } catch (error) {
        /* Abaikan. */
      }
    }
    const current = state.currentId;
    if (current) {
      state.history.push(current);
      if (state.history.length > 100) state.history.shift();
    }
    if (state.cursor < state.queue.length - 1) {
      state.cursor += 1;
      await loadCurrent(true);
      return;
    }
    if ((state.repeat === "all" && !stopAtEnd) || manual) {
      state.cursor = 0;
      await loadCurrent(true);
      return;
    }
    pause();
    state.isPlaying = false;
    emit("statechange", getState());
  }

  async function prev() {
    if (!state.currentId) return;
    if (state.currentTime > 3.2) {
      seekTo(0);
      return;
    }
    if (state.cursor > 0) {
      state.cursor -= 1;
      await loadCurrent(true);
      return;
    }
    if (state.history.length) {
      const previous = state.history.pop();
      if (previous && lookupTrack(previous)) {
        let index = state.queue.indexOf(previous);
        if (index < 0) index = state.cursor;
        state.cursor = index;
        state.currentId = previous;
        await loadCurrent(true);
        return;
      }
    }
    seekTo(0);
  }

  function handleEnded() {
    // Lagu pendek (< 30 detik) dicatat saat selesai, karena ambang 30 detik
    // tidak akan pernah tercapai.
    const track = currentTrack();
    if (track && track.duration > 0 && track.duration < 30) maybeRecordHistory();
    if (sleepMode === "track") {
      finishSleep();
      return;
    }
    if (state.repeat === "one") {
      state.historyRecordedId = null;
      seekTo(0);
      play();
      return;
    }
    next(false);
  }

  function seekTo(seconds) {
    if (!Number.isFinite(seconds)) return;
    const max = Number.isFinite(state.duration) && state.duration > 0 ? state.duration : seconds;
    const value = U.clamp(seconds, 0, max);
    if (Number.isFinite(audio.duration) && audio.duration > 0) {
      try {
        audio.currentTime = Math.min(value, audio.duration);
      } catch (error) {
        /* Abaikan. */
      }
    }
    state.currentTime = value;
    emit("time", {
      currentTime: state.currentTime,
      duration: state.duration,
      buffered: bufferedRatio()
    });
    scheduleSnapshot(0);
  }

  function seekBy(delta) {
    seekTo(state.currentTime + delta);
  }

  function bufferedRatio() {
    if (!audio.buffered || !audio.buffered.length) return 0;
    try {
      const end = audio.buffered.end(audio.buffered.length - 1);
      if (!state.duration) return 0;
      return U.clamp(end / state.duration, 0, 1);
    } catch (error) {
      return 0;
    }
  }

  function getState() {
    return {
      currentId: state.currentId,
      track: currentTrack(),
      isPlaying: state.isPlaying,
      shuffle: state.shuffle,
      repeat: state.repeat,
      volume: state.volume,
      muted: state.muted,
      duration: state.duration,
      currentTime: state.currentTime,
      queueLength: state.queue.length,
      context: state.context,
      format: state.format
    };
  }

  /* ------------------------------------------------------------------------
     Event audio
     ------------------------------------------------------------------------ */

  async function handleAudioError() {
    if (!state.currentId) return;
    if (!audio.getAttribute("src")) return;
    const track = currentTrack();
    const token = state.loadToken;
    const trackId = state.currentId;

    if (!track || track.provider !== "youtube") {
      emit("error", {
        track,
        error: new Error("Format audio mungkin tidak didukung browser ini.")
      });
      return;
    }

    const engine =
      AM.Youtube && typeof AM.Youtube.getStreamEngine === "function"
        ? AM.Youtube.getStreamEngine()
        : "";
    // Pemutar YouTube (iframe) tidak perlu diulang: error di sana berarti
    // video itu memang tidak boleh diputar di luar YouTube.
    const iframeEngine = audio.mode === "youtube" || engine === "iframe";
    // Invidious punya beberapa format audio; proxy/iframe cukup dua percobaan.
    const invidiousEngine = engine === "invidious" || engine === "unknown";
    const maxRetries = invidiousEngine ? 4 : 2;

    if (track.audioRetrying) return;
    const retryCount = Number(track.audioRetryCount) || 0;
    if (retryCount < maxRetries && !iframeEngine && AM.Youtube) {
      track.audioRetrying = true;
      track.audioRetryCount = retryCount + 1;
      const sourceId = track.audioVideoId || track.sourceId;
      let streamUrl = "";
      await new Promise((resolve) => {
        window.setTimeout(resolve, retryCount === 0 ? 500 : 1200);
      });
      if (state.loadToken !== token || state.currentId !== trackId) {
        track.audioRetrying = false;
        return;
      }
      try {
        streamUrl = AM.Youtube.audioStreamUrl(sourceId, {
          force: true,
          attempt: retryCount + 1
        });
      } catch (error) {
        streamUrl = "";
      }
      if (state.loadToken !== token || state.currentId !== trackId) {
        track.audioRetrying = false;
        return;
      }
      if (streamUrl) {
        audio.src = streamUrl;
        audio.load();
        if (typeof AM.Youtube.formatFor === "function") {
          setFormat(AM.Youtube.formatFor(sourceId, { attempt: retryCount + 1 }), trackId);
        }
        track.audioRetrying = false;
        try {
          await audio.play();
        } catch (error) {
          if (state.loadToken !== token || state.currentId !== trackId) return;
          reportPlayFailure(track, error);
        }
        return;
      }
      track.audioRetrying = false;
      handleAudioError();
      return;
    }

    // Semua format Invidious gagal untuk lagu ini (mis. video dibatasi usia).
    // Pakai pemutar resmi YouTube untuk lagu ini saja supaya tetap berbunyi.
    if (invidiousEngine && !iframeEngine && !track.iframeTried) {
      track.iframeTried = true;
      track.audioRetryCount = 0;
      track.audioRetrying = false;
      const sourceId = track.audioVideoId || track.sourceId;
      audio.src = "yt:" + sourceId;
      setFormat(null, trackId);
      try {
        await audio.play();
      } catch (error) {
        if (state.loadToken !== token || state.currentId !== trackId) return;
        reportPlayFailure(track, error);
      }
      return;
    }

    const candidateIds = youtubeCandidateIds(track);
    const currentIndex = candidateIds.indexOf(track.audioVideoId || track.sourceId);
    const nextCandidate = candidateIds
      .slice(currentIndex + 1)
      .find((id) => id !== (track.audioVideoId || track.sourceId));
    if (nextCandidate && typeof AM.Youtube.audioStreamUrl === "function") {
      const candidateUrl = AM.Youtube.audioStreamUrl(nextCandidate);
      if (candidateUrl) {
        track.audioVideoId = nextCandidate;
        track.audioRetryCount = 0;
        track.audioRetrying = true;
        audio.src = candidateUrl;
        audio.load();
        if (typeof AM.Youtube.formatFor === "function") {
          setFormat(AM.Youtube.formatFor(nextCandidate), trackId);
        }
        try {
          await audio.play();
        } catch (error) {
          if (state.loadToken !== token || state.currentId !== trackId) return;
          reportPlayFailure(track, error);
        }
        if (state.loadToken === token && state.currentId === trackId) {
          track.audioRetrying = false;
        }
        return;
      }
    }

    if (state.loadToken !== token || state.currentId !== trackId) return;

    audio.removeAttribute("src");
    try {
      audio.load();
    } catch (error) {
      /* Abaikan. */
    }
    emit("error", {
      track,
      error: new Error(
        iframeEngine
          ? "Video ini tidak mengizinkan pemutaran di luar YouTube. Coba pilih hasil pencarian lain."
          : "Audio lagu YouTube tidak dapat diambil."
      )
    });
    state.isPlaying = false;
    emit("statechange", getState());
  }

  function rememberCurrentDuration() {
    const track = currentTrack();
    if (!track || track.online) return;
    if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;
    AM.Library.updateTrackDuration(track.id, audio.duration);
  }

  function init() {
    state.volume = Number(AM.Library.getSetting("volume", 0.8));
    if (!Number.isFinite(state.volume)) state.volume = 0.8;
    state.muted = !!AM.Library.getSetting("muted", false);
    state.shuffle = !!AM.Library.getSetting("shuffle", false);
    const repeat = AM.Library.getSetting("repeat", "off");
    state.repeat = ["off", "all", "one"].includes(repeat) ? repeat : "off";
    applyVolume();

    audio.addEventListener("play", () => {
      state.pendingPlay = false;
      state.isPlaying = true;
      if (state.currentId && state.markedId !== state.currentId) {
        state.markedId = state.currentId;
        if (!AM.Online || !AM.Online.isOnlineId(state.currentId)) {
          AM.Library.markPlayed(state.currentId);
        }
      }
      updateMediaSession(currentTrack());
      emit("statechange", getState());
      writeSnapshot(true);
    });

    audio.addEventListener("pause", () => {
      state.isPlaying = false;
      updateMediaSession(currentTrack());
      emit("statechange", getState());
      writeSnapshot(true);
    });

    audio.addEventListener("timeupdate", () => {
      if (state.seeking) return;
      state.currentTime = Number(audio.currentTime) || 0;
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        state.duration = audio.duration;
      }
      emit("time", {
        currentTime: state.currentTime,
        duration: state.duration,
        buffered: bufferedRatio()
      });
      writeSnapshot();
      if (state.currentTime >= 30) maybeRecordHistory();
    });

    audio.addEventListener("durationchange", () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        state.duration = audio.duration;
      }
      emit("time", {
        currentTime: state.currentTime,
        duration: state.duration,
        buffered: bufferedRatio()
      });
      rememberCurrentDuration();
    });

    audio.addEventListener("loadedmetadata", () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        state.duration = audio.duration;
      }
      updateMediaSession(currentTrack());
      emit("time", {
        currentTime: state.currentTime,
        duration: state.duration,
        buffered: bufferedRatio()
      });
      rememberCurrentDuration();
      applyPendingSeek();
    });

    audio.addEventListener("ended", handleEnded);

    audio.addEventListener("error", () => {
      handleAudioError();
    });

    audio.addEventListener("progress", () => {
      emit("buffer", { buffered: bufferedRatio() });
    });

    audio.addEventListener("waiting", () => {
      emit("waiting", {});
    });

    audio.addEventListener("playing", () => {
      const token = state.loadToken;
      const trackId = state.currentId;
      refreshFormat(trackId, token).catch(() => {});
      emit("ready", {});
    });

    if ("mediaSession" in navigator) {
      const actions = {
        play: () => play(),
        pause: () => pause(),
        previoustrack: () => prev(),
        nexttrack: () => next(true),
        stop: () => pause(),
        seekbackward: (details) => seekBy(-(details.seekOffset || 10)),
        seekforward: (details) => seekBy(details.seekOffset || 10),
        seekto: (details) => {
          if (typeof details.seekTime === "number") seekTo(details.seekTime);
        }
      };
      Object.entries(actions).forEach((entry) => {
        try {
          navigator.mediaSession.setActionHandler(entry[0], entry[1]);
        } catch (error) {
          /* Tidak semua action didukung. */
        }
      });
    }

    AM.Library.on("tracksremoved", (detail) => {
      const ids = new Set(detail.ids || []);
      if (!ids.size) return;
      state.baseQueue = state.baseQueue.filter((id) => !ids.has(id));
      state.history = state.history.filter((id) => !ids.has(id));
      const currentRemoved = state.currentId && ids.has(state.currentId);
      const before = state.cursor;
      state.queue = state.queue.filter((id) => !ids.has(id));
      if (currentRemoved) {
        state.cursor = Math.min(before, state.queue.length - 1);
        if (state.cursor >= 0) loadCurrent(state.isPlaying);
        else stop();
      } else {
        state.cursor = state.currentId ? state.queue.indexOf(state.currentId) : -1;
      }
      emit("queuechange", getQueue());
      emit("statechange", getState());
    });

    AM.Library.on("trackupdate", (detail) => {
      if (detail && detail.track && detail.track.id === state.currentId) {
        updateMediaSession(detail.track);
        emit("trackchange", { track: detail.track });
      }
    });

    window.addEventListener("beforeunload", () => writeSnapshot(true));
    window.addEventListener("pagehide", () => writeSnapshot(true));

    settingsReady = true;
    emit("statechange", getState());
    emit("volumechange", { volume: state.volume, muted: state.muted });
    emit("queuechange", getQueue());
    restoreSnapshot();
    return state;
  }

  AM.Player = {
    init,
    on,
    state,
    getState,
    ensureFormat,
    currentTrack,
    play,
    pause,
    resume,
    toggle,
    next,
    prev,
    seekTo,
    seekBy,
    setVolume,
    setMuted,
    toggleMute,
    getSleepTimer,
    setSleepTimer,
    cancelSleepTimer,
    setShuffle,
    toggleShuffle,
    setRepeat,
    cycleRepeat,
    playQueue,
    playTrack,
    addToQueue,
    removeFromQueue,
    removeQueueIndex,
    playQueueIndex,
    clearQueue,
    getQueue,
    loadCurrent,
    get settingsReady() {
      return settingsReady;
    }
  };
})(window.AM = window.AM || {});
