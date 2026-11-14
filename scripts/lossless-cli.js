#!/usr/bin/env node
/* CLI kecil untuk server.ps1: menerima query base64 dan mengembalikan JSON
   hasil resolver lossless. Dipakai agar logika lokal sama dengan Vercel. */

const lib = require("../api/_lossless");

function fail(message, code) {
  process.stderr.write(String(message || "Resolver lossless gagal") + "\n");
  process.exit(code || 1);
}

async function main() {
  const [command, payload] = process.argv.slice(2);
  if (command !== "resolve") fail("Perintah tidak dikenal: " + command);

  let query = null;
  try {
    query = JSON.parse(Buffer.from(String(payload || ""), "base64").toString("utf8"));
  } catch (error) {
    fail("Query lossless tidak valid");
  }

  const result = await lib.resolve(query || {});
  // Kode 3 = tidak ada versi yang cocok (bukan kegagalan katalog).
  if (!result) fail("Tidak ada versi FLAC yang cocok", 3);
  process.stdout.write(JSON.stringify(result));
}

main().catch((error) => fail(error && error.message ? error.message : error));
