// Generator PO token (Proof of Origin) untuk YouTube.
//
// Sejak 2025 YouTube meminta bukti "bukan bot" untuk permintaan dari IP
// datacenter (termasuk Vercel). Tanpa token, player menjawab LOGIN_REQUIRED
// ("Sign in to confirm you're not a bot") atau URL audio hanya bisa diambil
// ~1 MB pertama.
//
// Modul ini menjalankan BotGuard milik YouTube di dalam VM Node (lewat
// bgutils-js + jsdom) dan mencetak token per video. Tidak memakai akun/kuki
// pengguna.
const REQUEST_KEY = "O43z0dpjhgX20SCx4KAo";
const MINTER_TTL_MS = 5 * 60 * 60 * 1000;

let setupTask = null;
let minterCache = null;
let minterTask = null;

async function ensureDom() {
  const { JSDOM } = require("jsdom");
  const { USER_AGENT } = await import("bgutils-js/utils");

  const dom = new JSDOM(
    '<!DOCTYPE html><html lang="en"><head><title></title></head><body></body></html>',
    {
      url: "https://www.youtube.com/",
      referrer: "https://www.youtube.com/",
      userAgent: USER_AGENT
    }
  );

  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    location: dom.window.location,
    origin: dom.window.origin
  });
  if (!Reflect.has(globalThis, "navigator")) {
    Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator });
  }
}

async function createMinter() {
  const { BotGuardClient, getChallenge } = await import("bgutils-js/botguard");
  const { WebPoMinter } = await import("bgutils-js/webpo");
  const { buildURL, getHeaders } = await import("bgutils-js/utils");

  await ensureDom();

  const challenge = await getChallenge({ fetchFunction: fetch, requestKey: REQUEST_KEY });
  const interpreter =
    challenge && challenge.interpreterJavascript
      ? challenge.interpreterJavascript.privateDoNotAccessOrElseSafeScriptWrappedValue
      : null;
  if (!interpreter) throw new Error("interpreter BotGuard tidak tersedia");
  new Function(interpreter)();

  const client = await BotGuardClient.create({
    program: challenge.program,
    globalName: challenge.globalName,
    globalObject: globalThis
  });

  const webPoSignalOutput = [];
  const botguardResponse = await client.snapshot({ webPoSignalOutput });

  const response = await fetch(buildURL("GenerateIT", true), {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify([REQUEST_KEY, botguardResponse])
  });
  if (!response.ok) {
    throw new Error("GenerateIT gagal (HTTP " + response.status + ")");
  }

  const json = await response.json();
  const integrityTokenData = {
    integrityToken: json[0],
    estimatedTtlSecs: json[1],
    mintRefreshThreshold: json[2],
    websafeFallbackToken: json[3]
  };
  const minter = await WebPoMinter.create(integrityTokenData, webPoSignalOutput);
  const ttlSecs = Number(json[1]) || 0;

  return {
    minter,
    expiresAt: Date.now() + Math.min(MINTER_TTL_MS, Math.max(600, ttlSecs - 120) * 1000)
  };
}

async function getMinter() {
  if (minterCache && minterCache.expiresAt > Date.now()) return minterCache;
  if (minterTask) return minterTask;

  minterTask = createMinter()
    .then((value) => {
      minterCache = value;
      return value;
    })
    .finally(() => {
      minterTask = null;
    });

  return minterTask;
}

async function getPoToken(videoId) {
  if (!setupTask) setupTask = ensureDom().catch((error) => {
    setupTask = null;
    throw error;
  });
  await setupTask;

  const { minter } = await getMinter();
  return minter.mintAsWebsafeString(String(videoId));
}

module.exports = { getPoToken };
