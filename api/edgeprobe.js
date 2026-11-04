export const config = { runtime: "edge" };

const HOST = "https://yt.chocolatemoo53.com";

export default async function handler() {
  const out = { host: HOST, api: null, stream: null, stats: null };
  const t0 = Date.now();
  try {
    const r = await fetch(`${HOST}/api/v1/videos/UwTnUpDuwGg`, {
      headers: { "user-agent": "Mozilla/5.0", accept: "application/json" },
      signal: AbortSignal.timeout(8000)
    });
    const d = await r.json();
    const audio = (d.adaptiveFormats || []).filter((f) => String(f.type || "").startsWith("audio"));
    out.api = { status: r.status, audio: audio.length, title: d.title, ms: Date.now() - t0 };
  } catch (e) {
    out.api = { error: String(e.message).slice(0, 80), ms: Date.now() - t0 };
  }

  const t1 = Date.now();
  try {
    const r = await fetch(`${HOST}/latest_version?id=UwTnUpDuwGg&itag=140&local=true`, {
      headers: { Range: "bytes=0-4095", "user-agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(15000),
      redirect: "follow"
    });
    const buf = await r.arrayBuffer();
    out.stream = { status: r.status, ct: r.headers.get("content-type"), bytes: buf.byteLength, ms: Date.now() - t1 };
  } catch (e) {
    out.stream = { error: String(e.message).slice(0, 80), ms: Date.now() - t1 };
  }

  const t2 = Date.now();
  try {
    const r = await fetch(`${HOST}/api/v1/stats`, { signal: AbortSignal.timeout(6000) });
    out.stats = { status: r.status, ms: Date.now() - t2 };
  } catch (e) {
    out.stats = { error: String(e.message).slice(0, 60), ms: Date.now() - t2 };
  }

  return new Response(JSON.stringify(out), { headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
