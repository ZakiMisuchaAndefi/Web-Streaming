import express from "express";
import cors from "cors";
import fs from "fs";
import { execFile } from "child_process";
import { Readable } from "stream";

const app = express();
app.set("trust proxy", true);
app.use(cors());

const ID = /^[A-Za-z0-9_-]{11}$/;
const FORMATS = {
  low: "bestaudio[abr<=96]/bestaudio[ext=m4a][abr<=128]/bestaudio",
  medium: "bestaudio[abr<=128]/bestaudio[ext=m4a]/bestaudio",
  high: "bestaudio[abr<=192]/bestaudio[ext=m4a]/bestaudio",
  best: "bestaudio/bestaudio[ext=m4a]",
};
const audioCache = new Map();
const radioCache = new Map();

// Cookies opsional (untuk lolos "Sign in to confirm you're not a bot").
// Upload cookies.txt sebagai Secret File di Render, lalu set env COOKIES_FILE=/etc/secrets/cookies.txt
let cookieArgs = [];
if (process.env.COOKIES_FILE && fs.existsSync(process.env.COOKIES_FILE)) {
  fs.copyFileSync(process.env.COOKIES_FILE, "/tmp/cookies.txt");
  cookieArgs = ["--cookies", "/tmp/cookies.txt"];
}

// Jika yt-dlp menolak --js-runtimes (versi lama), set env YTDLP_NO_JS_RUNTIME=1
const jsArgs = process.env.YTDLP_NO_JS_RUNTIME ? [] : ["--js-runtimes", "node"];

const run = (args, timeout) =>
  new Promise((resolve, reject) => {
    execFile(
      "yt-dlp",
      [...jsArgs, "--no-warnings", ...cookieArgs, ...args],
      { timeout, maxBuffer: 10 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          const last = String(stderr || "").trim().split("\n").pop();
          return reject(new Error(last || err.message));
        }
        resolve(stdout);
      }
    );
  });

const qualityOf = (q) => (FORMATS[q] ? q : "best");

async function getAudioUrl(id, quality) {
  const key = `${id}|${quality}`;
  const now = Math.floor(Date.now() / 1000);
  const cached = audioCache.get(key);
  if (cached && cached.expires > now + 300) return cached.url;

  const out = await run(
    ["-f", FORMATS[quality], "-g", "--no-playlist", `https://www.youtube.com/watch?v=${id}`],
    20000
  );
  const url = out.split(/\r?\n/).find((l) => l.trim())?.trim();
  if (!url || !/^https?:\/\//.test(url)) {
    throw new Error("yt-dlp tidak mengembalikan URL audio");
  }
  const m = url.match(/[?&]expire=(\d+)/);
  audioCache.set(key, { url, expires: m ? Number(m[1]) : now + 3600 });
  return url;
}

app.get("/", (_, res) => res.send("ok"));

// Unduhan MP3 tidak tersedia di server ini (butuh ffmpeg + disk).
app.get("/api/health", (_, res) =>
  res.json({ ytdlp: true, ffmpeg: false, mp3: false, downloads: false })
);

// Mengembalikan URL proxy milik server ini, bukan URL googlevideo langsung
// (URL googlevideo terikat ke IP yang me-resolve, jadi tidak bisa dipakai browser).
app.get("/api/resolve", async (req, res) => {
  const id = String(req.query.id || "");
  if (!ID.test(id)) return res.status(400).json({ error: "ID video tidak valid" });
  const quality = qualityOf(req.query.quality);
  try {
    await getAudioUrl(id, quality); // validasi dulu supaya error langsung sampai ke frontend
    res.json({
      url: `${req.protocol}://${req.get("host")}/api/stream?id=${id}&quality=${quality}`,
      expires: Math.floor(Date.now() / 1000) + 3600,
      quality,
    });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// Proxy audio dengan dukungan Range (agar seek berfungsi)
app.get("/api/stream", async (req, res) => {
  const id = String(req.query.id || "");
  if (!ID.test(id)) return res.status(400).end();
  const quality = qualityOf(req.query.quality);
  try {
    const url = await getAudioUrl(id, quality);
    const upstream = await fetch(url, {
      headers: req.headers.range ? { Range: req.headers.range } : {},
    });
    if (upstream.status === 403) audioCache.delete(`${id}|${quality}`);
    res.status(upstream.status);
    for (const h of ["content-type", "content-length", "content-range", "accept-ranges"]) {
      const v = upstream.headers.get(h);
      if (v) res.setHeader(h, v);
    }
    if (!upstream.body) return res.end();
    const body = Readable.fromWeb(upstream.body);
    req.on("close", () => body.destroy());
    body.on("error", () => res.end());
    body.pipe(res);
  } catch (e) {
    if (!res.headersSent) res.status(502).json({ error: e.message });
  }
});

app.get("/api/radio", async (req, res) => {
  const id = String(req.query.id || "");
  if (!ID.test(id)) return res.status(400).json({ error: "ID video tidak valid" });
  const now = Date.now();
  const cached = radioCache.get(id);
  if (cached && cached.expires > now) return res.json({ tracks: cached.tracks });
  try {
    const out = await run(
      [
        "--flat-playlist",
        "--playlist-end", "50",
        "--print", "%(id)s\t%(title)s\t%(duration)s\t%(uploader)s",
        `https://www.youtube.com/watch?v=${id}&list=RD${id}`,
      ],
      30000
    );
    const skip =
      /full album|compilation|kompilasi|podcast|medley|nonstop|non-stop|greatest hits|mega hits|dj mix|megamix/i;
    const seen = new Set();
    const tracks = [];
    for (const line of out.split(/\r?\n/)) {
      const [vid, title, dur, artist] = line.split("\t");
      const duration = parseInt(dur, 10) || 0;
      if (!ID.test(vid || "") || vid === id || seen.has(vid)) continue;
      if (!title || skip.test(title) || duration < 60 || duration > 600) continue;
      seen.add(vid);
      tracks.push({ id: vid, title: title.trim(), artist: (artist || "").trim(), duration });
      if (tracks.length >= 40) break;
    }
    if (!tracks.length) throw new Error("Radio YouTube tidak mengembalikan lagu");
    radioCache.set(id, { tracks, expires: now + 30 * 60 * 1000 });
    res.json({ tracks });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.listen(process.env.PORT || 3000, () => console.log("yt-server siap"));
