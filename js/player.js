/* ==========================================================================
   player.js — antrean, pemutaran, shuffle/repeat, media session
   ========================================================================== */

(function (AM) {
  "use strict";

  const U = AM.Utils;
  const audio = document.getElementById("audio");

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
    historyRecordedId: null
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

  async function playQueue(ids, startId, context) {
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
    await loadCurrent(true);
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
    return ids.length + (replayCurrent ? 1 : 0);
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
    emit("trackchange", { track });
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
          emit("blocked", { track, error });
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
        emit("blocked", { track, error });
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
      emit("blocked", { track, error });
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

  async function next(manual) {
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
    if (state.repeat === "all" || manual) {
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
      context: state.context
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

    if (track.audioRetrying) return;
    const retryCount = Number(track.audioRetryCount) || 0;
    if (retryCount < 2 && AM.Youtube) {
      track.audioRetrying = true;
      track.audioRetryCount = retryCount + 1;
      const sourceId = track.audioVideoId || track.sourceId;
      let url = null;
      await new Promise((resolve) => {
        window.setTimeout(resolve, retryCount === 0 ? 500 : 1200);
      });
      if (state.loadToken !== token || state.currentId !== trackId) {
        track.audioRetrying = false;
        return;
      }
      try {
        url = await AM.Youtube.resolveAudio(sourceId, { force: true });
      } catch (error) {
        url = null;
      }
      if (state.loadToken !== token || state.currentId !== trackId) {
        track.audioRetrying = false;
        return;
      }
      if (url) {
        audio.src = url;
        audio.load();
        track.audioRetrying = false;
        try {
          await audio.play();
        } catch (error) {
          if (state.loadToken !== token || state.currentId !== trackId) return;
          emit("blocked", { track, error });
        }
        return;
      }
      track.audioRetrying = false;
      handleAudioError();
      return;
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
      error: new Error("Audio lagu YouTube tidak dapat diambil.")
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
