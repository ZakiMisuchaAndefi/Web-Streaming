// Sementara: uji klien embed langsung dari fungsi Vercel.
const KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";
const VIDEO = "UwTnUpDuwGg";

const CLIENTS = [
  {
    name: "WEB_EMBEDDED_PLAYER",
    id: "56",
    version: "1.20250310.01.00",
    client: { clientName: "WEB_EMBEDDED_PLAYER", clientVersion: "1.20250310.01.00", clientScreen: "EMBED", hl: "en", gl: "US" },
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    thirdParty: true
  },
  {
    name: "TVHTML5_SIMPLY_EMBEDDED_PLAYER",
    id: "85",
    version: "2.0",
    client: { clientName: "TVHTML5_SIMPLY_EMBEDDED_PLAYER", clientVersion: "2.0", hl: "en", gl: "US" },
    ua: "Mozilla/5.0 (PlayStation; PlayStation 4/12.00) AppleWebKit/605.1.15 (KHTML, like Gecko)",
    thirdParty: true
  },
  {
    name: "WEB_CREATOR",
    id: "62",
    version: "1.20250310.01.00",
    client: { clientName: "WEB_CREATOR", clientVersion: "1.20250310.01.00", hl: "en", gl: "US" },
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
  },
  {
    name: "IOS_MESSAGES_EXTENSION",
    id: "66",
    version: "1.20250310.01.00",
    client: { clientName: "IOS_MESSAGES_EXTENSION", clientVersion: "1.20250310.01.00", hl: "en", gl: "US" },
    ua: "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)"
  }
];

async function call(spec) {
  const headers = {
    "Content-Type": "application/json",
    "X-Goog-Api-Format-Version": "1",
    "X-YouTube-Client-Name": spec.id,
    "X-YouTube-Client-Version": spec.version,
    "User-Agent": spec.ua,
    "Accept-Language": "en-US,en;q=0.9"
  };
  if (spec.thirdParty) {
    headers.Origin = "https://www.youtube.com";
    headers.Referer = "https://www.youtube.com/";
  }
  const body = {
    context: { client: spec.client, thirdParty: spec.thirdParty ? { embedUrl: "https://kiitunes.vercel.app/" } : undefined },
    videoId: VIDEO,
    contentCheckOk: true,
    racyCheckOk: true
  };
  const res = await fetch(
    "https://www.youtube.com/youtubei/v1/player?key=" + KEY + "&prettyPrint=false",
    { method: "POST", headers, body: JSON.stringify(body) }
  );
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch (e) { data = null; }
  const ps = data && data.playabilityStatus;
  const sd = (data && data.streamingData) || {};
  const formats = (sd.adaptiveFormats || []).concat(sd.formats || []);
  const audio = formats.filter((f) => String(f.mimeType || "").startsWith("audio"));
  const row = {
    name: spec.name,
    http: res.status,
    status: ps ? ps.status : String(text).slice(0, 40),
    reason: ps ? ps.reason : null,
    audio: audio.length
  };
  if (audio.length) {
    const pick = audio.slice().sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
    const url = pick.url || (pick.signatureCipher ? null : null);
    row.itag = pick.itag;
    row.mime = pick.mimeType;
    if (url) {
      const q = new URL(url).searchParams;
      row.ip = q.get("ip");
      row.hasPot = !!q.get("pot");
      try {
        const probe = await fetch(url, {
          headers: { Range: "bytes=0-2047", "User-Agent": spec.ua, Referer: "https://www.youtube.com/" }
        });
        row.rangeStatus = probe.status;
        row.rangeBytes = Number(probe.headers.get("content-length")) || 0;
      } catch (e) {
        row.rangeStatus = "ERR";
      }
    } else {
      row.cipher = true;
    }
  }
  return row;
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const out = { rows: [] };
  for (const spec of CLIENTS) {
    try {
      out.rows.push(await call(spec));
    } catch (e) {
      out.rows.push({ name: spec.name, error: String(e.message).slice(0, 120) });
    }
  }
  res.status(200).json(out);
};
