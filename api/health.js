// Instance Invidious publik yang dipakai sebagai sumber audio di Vercel.
// YouTube memblokir semua permintaan audio dari IP datacenter, jadi audio
// diambil dari instance ini dan diputar langsung oleh browser pengunjung.
const INSTANCES = ["yt.chocolatemoo53.com"];
const PROBE_TIMEOUT = 3000;

async function reachable(host) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT);
  try {
    const response = await fetch("https://" + host + "/api/v1/stats", {
      signal: controller.signal,
      headers: { "user-agent": "Mozilla/5.0", accept: "application/json" }
    });
    return response.ok;
  } catch (error) {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  let instance = "";
  for (const host of INSTANCES) {
    if (await reachable(host)) {
      instance = host;
      break;
    }
  }

  res.json({
    innertube: true,
    ytdlp: false,
    ffmpeg: false,
    mp3: false,
    downloads: false,
    // "invidious" = audio stream langsung tanpa iklan dan tanpa batas embed.
    // "iframe"    = cadangan: pemutar resmi YouTube (bisa ada iklan).
    engine: instance ? "invidious" : "iframe",
    instance
  });
};
