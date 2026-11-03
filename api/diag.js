// Endpoint diagnosa sementara (dihapus setelah selesai).
// Mencoba beberapa klien InnerTube dari server Vercel lalu melaporkan mana yang
// menghasilkan URL audio yang bisa diambil penuh.
const https = require("https");

const INNERTUBE_KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";
const VIDEO_ID = "U3JaukDsceA";

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
    request.setTimeout(15000, () => request.destroy(new Error("timeout")));
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
    const response = await once(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15",
        "Accept-Language": "en-us,en;q=0.5",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        ...(cookies.length ? { Cookie: cookies.join("; ") } : {})
      }
    });
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
  return { status: last ? last.status : 0, visitorData, cookies, hops: url };
}

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15";

const CLIENTS = [
  {
    name: "VISIONOS",
    id: 101,
    version: "1.02",
    platform: "MOBILE",
    client: {
      clientName: "VISIONOS",
      clientVersion: "1.02",
      deviceMake: "Apple",
      deviceModel: "RealityDevice17,1",
      userAgent: UA,
      osName: "visionOS",
      osVersion: "26.5.23O471",
      hl: "en",
      timeZone: "UTC",
      utcOffsetMinutes: 0
    }
  },
  {
    name: "ANDROID_VR",
    id: 28,
    version: "1.62.27",
    platform: "MOBILE",
    client: {
      clientName: "ANDROID_VR",
      clientVersion: "1.62.27",
      deviceMake: "Oculus",
      deviceModel: "Quest 3",
      osName: "Android",
      osVersion: "12",
      androidSdkVersion: 32,
      hl: "en",
      gl: "US",
      utcOffsetMinutes: 0
    }
  },
  {
    name: "TVHTML5_SIMPLY_EMBEDDED_PLAYER",
    id: 85,
    version: "2.0",
    platform: "TV",
    thirdParty: true,
    client: {
      clientName: "TVHTML5_SIMPLY_EMBEDDED_PLAYER",
      clientVersion: "2.0",
      hl: "en",
      gl: "US"
    }
  },
  {
    name: "WEB_EMBEDDED_PLAYER",
    id: 56,
    version: "1.20250310.01.00",
    platform: "DESKTOP",
    thirdParty: true,
    client: {
      clientName: "WEB_EMBEDDED_PLAYER",
      clientVersion: "1.20250310.01.00",
      clientScreen: "EMBED",
      hl: "en",
      gl: "US"
    }
  },
  {
    name: "TVHTML5",
    id: 7,
    version: "7.20250312.16.00",
    platform: "TV",
    client: {
      clientName: "TVHTML5",
      clientVersion: "7.20250312.16.00",
      hl: "en",
      gl: "US"
    }
  },
  {
    name: "IOS",
    id: 5,
    version: "20.10.4",
    platform: "MOBILE",
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
  },
  {
    name: "ANDROID",
    id: 3,
    version: "20.10.38",
    platform: "MOBILE",
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
    name: "MWEB",
    id: 2,
    version: "2.20240726.01.00",
    platform: "MOBILE",
    client: { clientName: "MWEB", clientVersion: "2.20240726.01.00", hl: "en", gl: "US" }
  },
  {
    name: "WEB",
    id: 1,
    version: "2.20250312.04.00",
    platform: "DESKTOP",
    client: { clientName: "WEB", clientVersion: "2.20250312.04.00", clientScreen: "WATCH", hl: "en", gl: "US" }
  }
];

async function callPlayer(spec, boot) {
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
  if (spec.thirdParty) {
    body.context.thirdParty = { embedUrl: "https://www.youtube.com/" };
  }
  const headers = {
    "Content-Type": "application/json",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-us,en;q=0.5",
    "User-Agent": UA,
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

async function probe(url) {
  try {
    const response = await once(url, {
      headers: { Range: "bytes=0-1", "User-Agent": UA }
    });
    return response.status;
  } catch (error) {
    return "ERR";
  }
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const out = { bootstrap: null, clients: [] };
  let boot = { visitorData: null, cookies: [] };
  try {
    const b = await bootstrap();
    boot = b;
    out.bootstrap = {
      status: b.status,
      hasVisitor: !!b.visitorData,
      cookies: b.cookies.length,
      finalUrl: String(b.hops).slice(0, 80)
    };
  } catch (error) {
    out.bootstrap = { error: String(error.message) };
  }

  for (const spec of CLIENTS) {
    const row = { name: spec.name };
    try {
      const result = await callPlayer(spec, boot);
      const data = result.data;
      row.http = result.http;
      if (!data || !data.playabilityStatus) {
        row.status = "NO_JSON";
        out.clients.push(row);
        continue;
      }
      row.status = data.playabilityStatus.status;
      row.reason = String(data.playabilityStatus.reason || "").slice(0, 80);
      const formats = (data.streamingData && data.streamingData.adaptiveFormats) || [];
      const audio = formats.filter((f) => String(f.mimeType || "").startsWith("audio/") && f.url);
      row.audio = audio.length;
      if (audio.length) {
        const pick = audio.find((f) => /webm/i.test(f.mimeType)) || audio[0];
        const q = new URL(pick.url).searchParams;
        row.c = q.get("c");
        row.n = q.get("n") ? "yes" : null;
        row.pot = q.get("pot") ? "yes" : null;
        row.itag = pick.itag;
        row.range0 = await probe(pick.url);
      }
    } catch (error) {
      row.status = "ERROR";
      row.reason = String(error.message).slice(0, 80);
    }
    out.clients.push(row);
  }

  res.status(200).json(out);
};
