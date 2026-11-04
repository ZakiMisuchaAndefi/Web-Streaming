export const config = { runtime: "edge" };

const KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";

async function probe(clientName, clientVersion, id, ua, extra) {
  const headers = {
    "Content-Type": "application/json",
    "X-Goog-Api-Format-Version": "1",
    "X-YouTube-Client-Name": id,
    "X-YouTube-Client-Version": clientVersion,
    "User-Agent": ua,
    "Accept-Language": "en-US,en;q=0.9"
  };
  const body = {
    context: { client: Object.assign({ clientName, clientVersion, hl: "en", gl: "US" }, extra || {}) },
    videoId: "UwTnUpDuwGg",
    contentCheckOk: true,
    racyCheckOk: true
  };
  const res = await fetch("https://www.youtube.com/youtubei/v1/player?key=" + KEY + "&prettyPrint=false", {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch (e) {}
  const ps = data && data.playabilityStatus;
  const sd = (data && data.streamingData) || {};
  const audio = ((sd.adaptiveFormats || []).concat(sd.formats || [])).filter((f) =>
    String(f.mimeType || "").startsWith("audio")
  );
  const row = { client: clientName, http: res.status, status: ps ? ps.status : text.slice(0, 40), reason: ps ? ps.reason : null, audio: audio.length };
  if (audio.length) {
    const pick = audio.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
    if (pick.url) {
      const q = new URL(pick.url).searchParams;
      row.ip = q.get("ip");
      try {
        const r = await fetch(pick.url, { headers: { Range: "bytes=0-4095" } });
        const buf = await r.arrayBuffer();
        row.range = r.status;
        row.bytes = buf.byteLength;
      } catch (e) { row.range = "ERR " + String(e.message).slice(0, 40); }
    } else row.cipher = true;
  }
  return row;
}

export default async function handler() {
  const uaWeb = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
  const rows = [];
  rows.push(await probe("WEB", "2.20250310.01.00", "1", uaWeb));
  rows.push(await probe("ANDROID_VR", "1.62.27", "28", "com.google.android.apps.youtube.vr.oculus/1.62.27 (Linux; U; Android 12; GB) gzip", {
    deviceMake: "Oculus", deviceModel: "Quest 3", androidSdkVersion: 32, osName: "Android", osVersion: "12"
  }));
  rows.push(await probe("TVHTML5", "7.20250310.10.00", "7", uaWeb));
  return new Response(JSON.stringify({ region: process.env.VERCEL_REGION || null, rows }, null, 2), {
    headers: { "content-type": "application/json", "cache-control": "no-store" }
  });
}
