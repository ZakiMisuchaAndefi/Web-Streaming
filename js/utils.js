/* ==========================================================================
   utils.js — helper umum, format, ikon, artwork generatif
   ========================================================================== */

(function (AM) {
  "use strict";

  const $ = (selector, root) => (root || document).querySelector(selector);
  const $$ = (selector, root) => Array.from((root || document).querySelectorAll(selector));

  const HTML_ESCAPES = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  };

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
  }

  function escapeXml(value) {
    return String(value == null ? "" : value).replace(/[<>&"']/g, (ch) => HTML_ESCAPES[ch]);
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function uid(prefix) {
    const time = Date.now().toString(36);
    const random = Math.random().toString(36).slice(2, 9);
    return (prefix || "id") + "_" + time + random;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function pad2(value) {
    return String(value).padStart(2, "0");
  }

  function fmtTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
    const total = Math.floor(seconds + 0.0001);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    if (hours > 0) return hours + ":" + pad2(minutes) + ":" + pad2(secs);
    return minutes + ":" + pad2(secs);
  }

  function fmtLongDuration(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) return "0 mnt";
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return minutes + " mnt";
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest ? hours + " j " + rest + " mnt" : hours + " j";
  }

  function fmtCount(count, word) {
    return count + " " + word;
  }

  function fmtBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
    const units = ["B", "KB", "MB", "GB", "TB"];
    const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
    const value = bytes / Math.pow(1024, index);
    return (value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)) + " " + units[index];
  }

  function fmtDate(timestamp) {
    if (!timestamp) return "";
    try {
      return new Intl.DateTimeFormat("id-ID", {
        day: "numeric",
        month: "long",
        year: "numeric"
      }).format(new Date(timestamp));
    } catch (error) {
      return new Date(timestamp).toLocaleDateString();
    }
  }

  function fmtRelative(timestamp) {
    if (!timestamp) return "";
    const diff = Date.now() - timestamp;
    const minute = 60000;
    const hour = 3600000;
    const day = 86400000;
    if (diff < minute) return "Baru saja";
    if (diff < hour) return Math.floor(diff / minute) + " menit lalu";
    if (diff < day) return Math.floor(diff / hour) + " jam lalu";
    if (diff < day * 7) return Math.floor(diff / day) + " hari lalu";
    return fmtDate(timestamp);
  }

  const diacritics = /[\u0300-\u036f]/g;

  function normalize(value) {
    return String(value == null ? "" : value)
      .toLowerCase()
      .normalize("NFKD")
      .replace(diacritics, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function byText(a, b) {
    return String(a || "").localeCompare(String(b || ""), "id", {
      sensitivity: "base",
      numeric: true
    });
  }

  function hash(value) {
    const text = String(value == null ? "" : value);
    let h = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function debounce(fn, wait) {
    let timer = 0;
    return function debounced() {
      const args = arguments;
      const context = this;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => fn.apply(context, args), wait);
    };
  }

  function throttle(fn, wait) {
    let last = 0;
    let timer = 0;
    return function throttled() {
      const now = Date.now();
      const args = arguments;
      const context = this;
      const remaining = wait - (now - last);
      if (remaining <= 0) {
        window.clearTimeout(timer);
        timer = 0;
        last = now;
        fn.apply(context, args);
      } else if (!timer) {
        timer = window.setTimeout(() => {
          last = Date.now();
          timer = 0;
          fn.apply(context, args);
        }, remaining);
      }
    };
  }

  function isTyping(target) {
    if (!target || !(target instanceof Element)) return false;
    if (target.isContentEditable) return true;
    const tag = target.tagName;
    if (tag === "TEXTAREA" || tag === "SELECT") return true;
    if (tag === "INPUT") {
      const type = (target.getAttribute("type") || "text").toLowerCase();
      return !["checkbox", "radio", "button", "submit", "range", "file", "color"].includes(type);
    }
    return false;
  }

  function svgIcon(name, extraClass) {
    return (
      '<svg class="icon' +
      (extraClass ? " " + extraClass : "") +
      '" aria-hidden="true" focusable="false"><use href="#i-' +
      name +
      '"></use></svg>'
    );
  }

  function setIcon(svg, name) {
    if (!svg) return;
    const use = svg.querySelector("use");
    if (use) use.setAttribute("href", "#i-" + name);
  }

  function setIconIn(container, name) {
    if (!container) return;
    const use = container.querySelector("use");
    if (use) use.setAttribute("href", "#i-" + name);
  }

  /* ------------------------------------------------------------------------
     Artwork generatif
     ------------------------------------------------------------------------ */

  const PALETTES = [
    ["#ff375f", "#ff9f0a", "#ffd60a"],
    ["#5e5ce6", "#bf5af2", "#ff375f"],
    ["#0a84ff", "#64d2ff", "#5e5ce6"],
    ["#30d158", "#66d4cf", "#0a84ff"],
    ["#ff9f0a", "#ff375f", "#bf5af2"],
    ["#64d2ff", "#5e5ce6", "#1c1c1e"],
    ["#ffd60a", "#30d158", "#0a84ff"],
    ["#bf5af2", "#0a84ff", "#30d158"],
    ["#ff375f", "#bf5af2", "#0a84ff"],
    ["#ac8e68", "#ffd60a", "#ff375f"],
    ["#1d1d1f", "#5e5ce6", "#ff375f"],
    ["#66d4cf", "#30d158", "#0a84ff"],
    ["#ff6b6b", "#ffd93d", "#6bcB77"],
    ["#845ec2", "#d65db1", "#ff6f91"],
    ["#0081cf", "#00c9a7", "#f9f871"],
    ["#f83600", "#f9d423", "#ff4e50"]
  ];

  function paletteFor(seed) {
    return PALETTES[hash(seed) % PALETTES.length];
  }

  function initialsOf(value) {
    const cleaned = String(value || "")
      .replace(/\[[^\]]*]/g, " ")
      .replace(/\([^)]*\)/g, " ")
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .trim();
    if (!cleaned) return "♪";
    const words = cleaned.split(/\s+/).filter(Boolean);
    if (words.length === 1) {
      return Array.from(words[0]).slice(0, 2).join("").toUpperCase();
    }
    return (Array.from(words[0])[0] + Array.from(words[1])[0]).toUpperCase();
  }

  const artCache = new Map();

  function generatedArt(seed, options) {
    const opts = options || {};
    const cacheKey = String(seed) + "|" + (opts.label || "") + "|" + (opts.kind || "");
    if (artCache.has(cacheKey)) return artCache.get(cacheKey);

    const palette = paletteFor(seed);
    const initials = initialsOf(seed);
    const label = String(opts.label || seed || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 26)
      .toUpperCase();
    const circle1 = 120 + (hash(seed + "x") % 300);
    const circle2 = 300 + (hash(seed + "y") % 240);
    const rotate = (hash(seed + "r") % 40) - 20;

    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600" width="600" height="600">' +
      "<defs>" +
      '<linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0" stop-color="' + palette[0] + '"/>' +
      '<stop offset="1" stop-color="' + palette[1] + '"/>' +
      "</linearGradient>" +
      '<radialGradient id="v" cx="50%" cy="42%" r="70%">' +
      '<stop offset="0" stop-color="#000" stop-opacity="0"/>' +
      '<stop offset="1" stop-color="#000" stop-opacity="0.24"/>' +
      "</radialGradient>" +
      '<filter id="blur" x="-40%" y="-40%" width="180%" height="180%">' +
      '<feGaussianBlur stdDeviation="48"/>' +
      "</filter>" +
      "</defs>" +
      '<rect width="600" height="600" fill="url(#g)"/>' +
      '<circle cx="' + circle1 + '" cy="' + (90 + (hash(seed + "c") % 120)) + '" r="190" fill="' + palette[2] + '" opacity="0.62" filter="url(#blur)"/>' +
      '<circle cx="' + circle2 + '" cy="' + (420 + (hash(seed + "d") % 110)) + '" r="210" fill="#ffffff" opacity="0.16" filter="url(#blur)"/>' +
      '<g transform="rotate(' + rotate + ' 300 300)">' +
      '<circle cx="300" cy="292" r="168" fill="none" stroke="#ffffff" stroke-opacity="0.17" stroke-width="1.5"/>' +
      '<circle cx="300" cy="292" r="206" fill="none" stroke="#ffffff" stroke-opacity="0.08" stroke-width="1"/>' +
      "</g>" +
      '<text x="300" y="356" text-anchor="middle" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="176" font-weight="700" letter-spacing="-8" fill="#ffffff" fill-opacity="0.95">' + escapeXml(initials) + "</text>" +
      '<rect x="42" y="512" width="26" height="2" rx="1" fill="#ffffff" fill-opacity="0.5"/>' +
      '<text x="80" y="518" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="17" font-weight="600" letter-spacing="3.4" fill="#ffffff" fill-opacity="0.6">' + escapeXml(label) + "</text>" +
      '<rect width="600" height="600" fill="url(#v)"/>' +
      "</svg>";

    const uri = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    artCache.set(cacheKey, uri);
    return uri;
  }

  function highlight(text, query) {
    const raw = String(text == null ? "" : text);
    const q = String(query || "").trim();
    if (!q) return esc(raw);
    const terms = Array.from(new Set(q.split(/\s+/).filter(Boolean)))
      .map(escapeRegExp)
      .sort((a, b) => b.length - a.length);
    if (!terms.length) return esc(raw);
    const regex = new RegExp("(" + terms.join("|") + ")", "gi");
    let result = "";
    let last = 0;
    let match;
    while ((match = regex.exec(raw)) !== null) {
      if (match[0] === "") {
        regex.lastIndex += 1;
        continue;
      }
      result += esc(raw.slice(last, match.index));
      result += "<mark>" + esc(match[0]) + "</mark>";
      last = match.index + match[0].length;
    }
    result += esc(raw.slice(last));
    return result;
  }

  const paletteCache = new Map();

  function imagePalette(src) {
    if (!src) return Promise.resolve(null);
    if (paletteCache.has(src)) return paletteCache.get(src);

    const promise = new Promise((resolve) => {
      const img = new Image();
      img.decoding = "async";
      img.onload = () => {
        try {
          const canvas = document.createElement("canvas");
          const size = 28;
          canvas.width = size;
          canvas.height = size;
          const context = canvas.getContext("2d", { willReadFrequently: true });
          context.drawImage(img, 0, 0, size, size);
          const data = context.getImageData(0, 0, size, size).data;
          let r = 0;
          let g = 0;
          let b = 0;
          let weight = 0;
          for (let i = 0; i < data.length; i += 4) {
            const alpha = data[i + 3];
            if (alpha < 180) continue;
            const max = Math.max(data[i], data[i + 1], data[i + 2]);
            const min = Math.min(data[i], data[i + 1], data[i + 2]);
            const saturation = max - min;
            const brightness = max;
            if (brightness < 22 || brightness > 248) continue;
            const w = 1 + saturation / 45;
            r += data[i] * w;
            g += data[i + 1] * w;
            b += data[i + 2] * w;
            weight += w;
          }
          if (!weight) {
            resolve(null);
            return;
          }
          const toHex = (value) => Math.round(clamp(value, 0, 255)).toString(16).padStart(2, "0");
          resolve({
            a: "#" + toHex(r / weight) + toHex(g / weight) + toHex(b / weight),
            b: "#" + toHex((r / weight) * 0.6) + toHex((g / weight) * 0.6) + toHex((b / weight) * 0.6)
          });
        } catch (error) {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = src;
    });

    paletteCache.set(src, promise);
    return promise;
  }

  function shuffleArray(items) {
    const array = items.slice();
    for (let i = array.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      const temp = array[i];
      array[i] = array[j];
      array[j] = temp;
    }
    return array;
  }

  function parseTrackNumber(value) {
    if (value == null || value === "") return 0;
    const match = String(value).match(/\d+/);
    return match ? Number(match[0]) : 0;
  }

  function parseYear(value) {
    if (!value) return "";
    const match = String(value).match(/\d{4}/);
    return match ? match[0] : "";
  }

  function truncate(value, length) {
    const text = String(value || "");
    return text.length > length ? text.slice(0, length - 1).trimEnd() + "…" : text;
  }

  function nextFrame(fn) {
    window.requestAnimationFrame(() => window.requestAnimationFrame(fn));
  }

  function isMac() {
    return /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
  }

  function detectAudioSupport() {
    const audio = document.createElement("audio");
    return {
      mp3: !!audio.canPlayType('audio/mpeg; codecs="mp3"'),
      m4a: !!audio.canPlayType("audio/mp4"),
      flac: !!audio.canPlayType("audio/flac"),
      wav: !!audio.canPlayType("audio/wav"),
      ogg: !!audio.canPlayType("audio/ogg")
    };
  }

  AM.Utils = {
    $,
    $$,
    esc,
    escapeXml,
    escapeRegExp,
    uid,
    clamp,
    fmtTime,
    fmtLongDuration,
    fmtCount,
    fmtBytes,
    fmtDate,
    fmtRelative,
    normalize,
    byText,
    hash,
    debounce,
    throttle,
    isTyping,
    svgIcon,
    setIcon,
    setIconIn,
    paletteFor,
    initialsOf,
    generatedArt,
    highlight,
    imagePalette,
    shuffleArray,
    parseTrackNumber,
    parseYear,
    truncate,
    nextFrame,
    isMac,
    detectAudioSupport
  };
})(window.AM = window.AM || {});
