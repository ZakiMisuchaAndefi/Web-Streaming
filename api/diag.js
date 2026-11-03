// Endpoint diagnosa sementara (dihapus setelah selesai).
// Menguji apakah PO token membuat permintaan player diterima dari IP Vercel.
const https = require("https");
const { getPoToken } = require("./_pottoken");

const INNERTUBE_KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";
const VIDEO_ID = "U3JaukDsceA";
const WEB_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const VISIONOS_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15";

function once(url, options) {
  return new Promise((resolve, reject) => {
    const request = https.request(
      url,
      {
        method: options.method || "GET",
        headers: options.headers || {},
        maxHeaderSize: 8 * 1024 * 1024
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () =>
          resolve({
            status: response.statusCode || 0,
            headers: response.headers,
            body: Buffer.concat(chunks).toString("utf8")
          })
        );
        response.on("error", reject);
      }
    );
    request.setTimeout(20000, () => request.destroy(new Error("timeout")));
    request.on("error", reject);
    if (options.body) request.write(options.body);
    request.end();
  });
}

async function bootstrap() {
  const cookies = [];
  let url = "https://www.youtube.com/";
  let last = null;
  for (let hop = 0; hop < 4; hop += 1) {
    const headers = {
      "User-Agent": WEB_UA,
      "Accept-Language": "en-us,en;q=0.5",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    };
    if (cookies.length) headers.Cookie = cookies.join("; ");
    const response = await once(url, { headers });
    last = response;
    for (const value of response.headers["set-cookie"] || []) {
      const pair = String(value).split(";")[0];
      if (pair && !cookies.some((c) => c.split("=")[0] === pair.split("=")[0])) cookies.push(pair);
    }
    if (response.status >= 300 && response.status < 400 && response.headers.location) {
      url = new URL(response.headers.location, url).toString();
      continue;
    }
    break;
  }
  const match = last ? /"visitorData":"(.*?)"/.exec(last.body) : null;
  let visitorData = null;
  if (match) {
    try {
      visitorData = JSON.parse('"' + match[1] + '"');
    } catch (error) {
      visitorData = match[1];
    }
  }
  return { visitorData, cookies };
}

const CLIENTS = [
  {
    name: "WEB+potVisitor",
    id: 1,
    version: "2.20250312.04.00",
    binding: "visitor",
    ua: WEB_UA,
    client: {
      clientName: "WEB",
      clientVersion: "2.20250312.04.00",
      clientScreen: "WATCH",
      hl: "en",
      gl: "US"
    }
  },
  {
    name: "WEB+potVid",
    id: 1,
    version: "2.20250312.04.00",
    binding: "video",
    ua: WEB_UA,
    client: {
      clientName: "WEB",
      clientVersion: "2.20250312.04.00",
      clientScreen: "WATCH",
      hl: "en",
      gl: "US"
    }
  },
  {
    name: "ANDROID+pot",
    id: 3,
    version: "20.10.38",
    binding: "video",
    ua: "com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip",
    client: {
      clientName: "ANDROID",
      clientVersion: "20.10.38",
      androidSdkVersion: 34,
      osName: "Android",
      osVersion: "14",
      hl: "en",
      gl: "US"
    }
  },
  {
    name: "VISIONOS+pot",
    id: 101,
    version: "1.02",
    ua: VISIONOS_UA,
    client: {
      clientName: "VISIONOS",
      clientVersion: "1.02",
      deviceMake: "Apple",
      deviceModel: "RealityDevice17,1",
      userAgent: VISIONOS_UA,
      osName: "visionOS",
      osVersion: "26.5.23O471",
      hl: "en",
      timeZone: "UTC",
      utcOffsetMinutes: 0
    }
  },
  {
    name: "IOS+pot",
    id: 5,
    version: "20.10.4",
    ua: "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 17_5_1 like Mac OS X;)",
    client: {
      clientName: "IOS",
      clientVersion: "20.10.4",
      deviceMake: "Apple",
      deviceModel: "iPhone16,2",
      osName: "iPhone",
      osVersion: "17.5.1.21F90",
      hl: "en",
      gl: "US"
    }
  }
];

async function callPlayer(spec, boot, poToken) {
  const client = Object.assign({}, spec.client);
  if (boot.visitorData) client.visitorData = boot.visitorData;

  const body = {
    context: { client },
    videoId: VIDEO_ID,
    playbackContext: {
      contentPlaybackContext: { html5Preference: "HTML5_PREF_WANTS", signatureTimestamp: 20754 }
    },
    contentCheckOk: true,
    racyCheckOk: true
  };
  if (poToken) body.serviceIntegrityDimensions = { poToken };

  const headers = {
    "Content-Type": "application/json",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-us,en;q=0.5",
    "User-Agent": spec.ua,
    "X-Youtube-Client-Name": String(spec.id),
    "X-Youtube-Client-Version": spec.version,
    Origin: "https://www.youtube.com"
  };
  if (boot.visitorData) headers["X-Goog-Visitor-Id"] = boot.visitorData;
  if (boot.cookies.length) headers.Cookie = boot.cookies.join("; ");

  const response = await once(
    "https://www.youtube.com/youtubei/v1/player?prettyPrint=false&key=" + INNERTUBE_KEY,
    { method: "POST", headers, body: JSON.stringify(body) }
  );
  let data = null;
  try {
    data = JSON.parse(response.body);
  } catch (error) {
    data = null;
  }
  return { http: response.status, data };
}

async function probe(url, range, ua) {
  try {
    const response = await once(url, { headers: { Range: range, "User-Agent": ua } });
    return response.status;
  } catch (error) {
    return "ERR";
  }
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const out = { poToken: null, bootstrap: null, clients: [] };

  let boot = { visitorData: null, cookies: [] };
  try {
    boot = await bootstrap();
    out.bootstrap = { hasVisitor: !!boot.visitorData, cookies: boot.cookies.length };
  } catch (error) {
    out.bootstrap = { error: String(error.message) };
  }

  let tokens = { video: null, visitor: null };
  const startToken = Date.now();
  try {
    tokens.video = await getPoToken(VIDEO_ID);
    if (boot.visitorData) tokens.visitor = await getPoToken(boot.visitorData);
    out.poToken = {
      ok: true,
      ms: Date.now() - startToken,
      length: tokens.video.length,
      visitor: tokens.visitor ? tokens.visitor.length : null
    };
  } catch (error) {
    out.poToken = { ok: false, ms: Date.now() - startToken, error: String(error.message).slice(0, 200) };
  }

  for (const spec of CLIENTS) {
    const row = { name: spec.name };
    const poToken = tokens[spec.binding] || tokens.video;
    try {
      const result = await callPlayer(spec, boot, poToken);
      const data = result.data;
      row.http = result.http;
      if (!data || !data.playabilityStatus) {
        row.status = "NO_JSON";
        out.clients.push(row);
        continue;
      }
      row.status = data.playabilityStatus.status;
      row.reason = String(data.playabilityStatus.reason || "").slice(0, 70);
      const formats = (data.streamingData && data.streamingData.adaptiveFormats) || [];
      const audio = formats.filter((f) => String(f.mimeType || "").startsWith("audio/") && f.url);
      row.audio = audio.length;
      if (audio.length) {
        const pick = audio.find((f) => /webm/i.test(f.mimeType)) || audio[0];
        let target = pick.url;
        const q = new URL(target).searchParams;
        row.c = q.get("c");
        row.potInUrl = q.get("pot") ? "yes" : null;
        if (poToken && !q.get("pot")) target += "&pot=" + encodeURIComponent(poToken);
        row.range0 = await probe(target, "bytes=0-1", spec.ua);
        row.range3m = await probe(target, "bytes=3000000-3000001", spec.ua);
      }
    } catch (error) {
      row.status = "ERROR";
      row.reason = String(error.message).slice(0, 70);
    }
    out.clients.push(row);
  }

  res.status(200).json(out);
};
