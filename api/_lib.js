// Helper bersama untuk fungsi /api (file berawalan _ tidak dijadikan endpoint).
const fs = require("fs");
const { execFile } = require("child_process");

const ID = /^[A-Za-z0-9_-]{11}$/;
const FORMATS = {
  low: "bestaudio[abr<=96]/bestaudio[ext=m4a][abr<=128]/bestaudio",
  medium: "bestaudio[abr<=128]/bestaudio[ext=m4a]/bestaudio",
  high: "bestaudio[abr<=192]/bestaudio[ext=m4a]/bestaudio",
  best: "bestaudio/bestaudio[ext=m4a]"
};
const BIN = process.env.YTDLP_PATH || "/tmp/yt-dlp";
const BIN_URL = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux";
const audioCache = new Map();

const qualityOf = (q) => (FORMATS[q] ? q : "best");

// yt-dlp (binary Linux) diunduh sekali ke /tmp, lalu dipakai ulang selama instance hidup.
let binTask = null;
function ensureBinary() {
  if (process.env.YTDLP_PATH) return Promise.resolve(BIN);
  if (binTask) return binTask;
  binTask = (async () => {
    if (fs.existsSync(BIN) && fs.statSync(BIN).size > 1e6) return BIN;
    const res = await fetch(BIN_URL, { redirect: "follow" });
    if (!res.ok) throw new Error("Gagal mengunduh yt-dlp (HTTP " + res.status + ")");
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(BIN + ".part", buf, { mode: 0o755 });
    fs.renameSync(BIN + ".part", BIN);
    fs.chmodSync(BIN, 0o755);
    return BIN;
  })().catch((e) => {
    binTask = null;
    throw e;
  });
  return binTask;
}

// Opsional: isi env YT_COOKIES dengan isi cookies.txt jika kena "Sign in to confirm you are not a bot".
function cookieArgs() {
  const raw = process.env.YT_COOKIES;
  if (!raw) return [];
  const p = "/tmp/yt-cookies.txt";
  try {
    if (!fs.existsSync(p)) fs.writeFileSync(p, raw.replace(/\\n/g, "\n"));
    return ["--cookies", p];
  } catch (e) {
    return [];
  }
}

async function run(args, timeout) {
  const bin = await ensureBinary();
  const base = ["--no-cache-dir", "--no-warnings"].concat(cookieArgs());
  const attempt = (extra) =>
    new Promise((resolve, reject) => {
      execFile(
        bin,
        extra.concat(base, args),
        { timeout, maxBuffer: 10 * 1024 * 1024, env: Object.assign({}, process.env, { TMPDIR: "/tmp", HOME: "/tmp" }) },
        (err, stdout, stderr) => {
          if (err) {
            const text = String(stderr || "");
            const e = new Error(text.trim().split("\n").pop() || err.message);
            e.stderr = text;
            return reject(e);
          }
          resolve(stdout);
        }
      );
    });
  if (process.env.YTDLP_NO_JS_RUNTIME) return attempt([]);
  try {
    return await attempt(["--js-runtimes", "node:" + process.execPath]);
  } catch (e) {
    if (/js-runtimes|no such option|unrecognized/i.test(e.stderr || "")) return attempt([]);
    throw e;
  }
}

async function getAudioUrl(id, quality, force) {
  const key = id + "|" + quality;
  const now = Math.floor(Date.now() / 1000);
  if (force) audioCache.delete(key);
  const cached = audioCache.get(key);
  if (cached && cached.expires > now + 300) return cached;
  const out = await run(
    ["-f", FORMATS[quality], "-g", "--no-playlist", "https://www.youtube.com/watch?v=" + id],
    45000
  );
  const url = out.split(/\r?\n/).map((l) => l.trim()).find(Boolean);
  if (!url || !/^https?:\/\//.test(url)) throw new Error("yt-dlp tidak mengembalikan URL audio");
  const m = url.match(/[?&]expire=(\d+)/);
  const entry = { url, expires: m ? Number(m[1]) : now + 3600 };
  audioCache.set(key, entry);
  return entry;
}

// Hanya boleh meneruskan audio dari googlevideo.com (mencegah proxy terbuka).
const lib = {
  ID,
  qualityOf,
  run,
  getAudioUrl,
  isAllowed(raw) {
    try {
      const u = new URL(raw);
      return u.protocol === "https:" && (u.hostname === "googlevideo.com" || u.hostname.endsWith(".googlevideo.com"));
    } catch (e) {
      return false;
    }
  }
};
module.exports = lib;
