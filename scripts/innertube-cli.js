// CLI kecil untuk server.ps1 (pengembangan lokal).
// Tujuannya agar server lokal memakai resolver yang sama persis dengan
// fungsi /api di Vercel: api/_innertube.js, api/_lib.js, dan api/radio.js.
//
// Pemakaian:
//   node scripts/innertube-cli.js search "kata kunci"
//   node scripts/innertube-cli.js audio <videoId> [quality]
//   node scripts/innertube-cli.js radio <videoId>
const innertube = require("../api/_innertube");
const lib = require("../api/_lib");
const radio = require("../api/radio");

async function main() {
  const [command, ...args] = process.argv.slice(2);

  if (command === "search") {
    const query = args.join(" ").trim();
    const payload = await innertube.search(query, { limit: 40 });
    process.stdout.write(JSON.stringify(payload));
    return;
  }

  if (command === "audio") {
    const id = String(args[0] || "").trim();
    const quality = lib.qualityOf(args[1]);
    const entry = await lib.getAudioUrl(id, quality, true);
    process.stdout.write(JSON.stringify(entry));
    return;
  }

  if (command === "radio") {
    const id = String(args[0] || "").trim();
    const tracks = await radio.getRadioTracks(id);
    const lines = tracks.map((track) =>
      [track.id, track.title, track.duration, track.artist].join("\t")
    );
    process.stdout.write(lines.join("\n"));
    return;
  }

  throw new Error("Perintah tidak dikenal: " + command);
}

main().catch((error) => {
  process.stderr.write((error && error.message ? error.message : String(error)) + "\n");
  process.exit(1);
});
