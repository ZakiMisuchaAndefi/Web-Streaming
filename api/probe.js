// Sementara: matriks klien InnerTube dari fungsi Vercel.
const KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";

const CLIENTS = [
  { name: "WEB_EMBEDDED_PLAYER", id: "56", version: "1.20250310.01.00", clientName: "WEB_EMBEDDED_PLAYER", thirdParty: true },
  { name: "ANDROID_TESTSUITE", id: "30", version: "1.9", clientName: "ANDROID_TESTSUITE", ua: "com.google.android.youtube/1.9 (Linux; U; Android 12) gzip" },
  { name: "ANDROID_CREATOR", id: "14", version: "2.20250310.01.00", clientName: "ANDROID_CREATOR" },
  { name: "WEB_MUSIC_ANALYTICS", id: "31", version: "0.1", clientName: "WEB_MUSIC_ANALYTICS" },
  { name: "WEB_REMIX", id: "67", version: "1.20250310.01.00", clientName: "WEB_REMIX" },
  { name: "WEB", id: "1", version: "2.20250310.01.00", clientName: "WEB" },
  { name: "MWEB", id: "2", version: "2.20250310.01.00", clientName: "MWEB" },
  { name: "ANDROID", id: "3", version: "20.10.38", clientName: "ANDROID", ua: "com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip" },
  { name: "IOS", id: "5", version: "20.10.4", clientName: "IOS", ua: "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)" },
  { name: "TVHTML5", id: "7", version: "7.20250310.10.00", clientName: "TVHTML5" },
  { name: "ANDROID_VR", id: "28", version: "1.62.27", clientName: "ANDROID_VR", ua: "com.google.android.apps.youtube.vr.oculus/1.62.27 (Linux; U; Android 12; GB) gzip" },
  { name: "VISIONOS", id: "101", version: "1.2.0", clientName: "VISIONOS" },
  { name: "TVLITE", id: "113", version: "2.0", clientName: "TVLITE" },
  { name: "MEDIA_CONNECT_FRONTEND", id: "95", version: "0.1", clientName: "MEDIA_CONNECT_FRONTEND" }
];

const DEFAULT_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

async function call(spec, videoId, probeRange) {
  const headers = {
    "Content-Type": "application/json",
    "X-Goog-Api-Format-Version": "1",
    "X-YouTube-Client-Name": spec.id,
    "X-YouTube-Client-Version": spec.version,
    "User-Agent": spec.ua || DEFAULT_UA,
    "Accept-Language": "en-US,en;q=0.9"
  };
  if (spec.thirdParty) {
    headers.Origin = "https://www.youtube.com";
    headers.Referer = "https://www.youtube.com/";
  }
  const client = { clientName: spec.clientName, clientVersion: spec.version, hl: "en", gl: "US" };
  if (spec.name === "WEB_EMBEDDED_PLAYER") client.clientScreen = "EMBED";
  const body = { context: { client }, videoId, contentCheckOk: true, racyCheckOk: true };
  if (spec.thirdParty) body.context.thirdParty = { embedUrl: "https://kiitunes.vercel.app/" };

  const res = await fetch("https://www.youtube.com/youtubei/v1/player?key=" + KEY + "&prettyPrint=false", {
    method: "POST", headers, body: JSON.stringify(body)
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch (e) {}
  const ps = data && data.playabilityStatus;
  const sd = (data && data.streamingData) || {};
  const formats = (sd.adaptiveFormats || []).concat(sd.formats || []);
  const audio = formats.filter((f) => String(f.mimeType || "").startsWith("audio"));
  const row = {
    client: spec.name,
    http: res.status,
    status: ps ? ps.status : String(text).slice(0, 30),
    reason: ps && ps.reason ? String(ps.reason).slice(0, 60) : null,
    audio: audio.length
  };
  if (audio.length && probeRange) {
    const pick = audio.slice().sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
    if (pick.url) {
      try {
        const probe = await fetch(pick.url, { headers: { Range: "bytes=0-2047", "User-Agent": spec.ua || DEFAULT_UA } });
        row.range = probe.status;
        row.bytes = Number(probe.headers.get("content-length")) || 0;
      } catch (e) { row.range = "ERR"; }
    } else row.range = "cipher";
  }
  return row;
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const videoId = String(req.query.v || "UwTnUpDuwGg");
  const probeRange = req.query.range === "1";
  const only = req.query.c ? String(req.query.c).split(",") : null;
  const list = only ? CLIENTS.filter((c) => only.includes(c.name)) : CLIENTS;
  const rows = [];
  await Promise.all(list.map(async (spec) => {
    try { rows.push(await call(spec, videoId, probeRange)); }
    catch (e) { rows.push({ client: spec.name, error: String(e.message).slice(0, 80) }); }
  }));
  rows.sort((a, b) => (b.audio || 0) - (a.audio || 0));
  res.status(200).json({ videoId, rows });
};
