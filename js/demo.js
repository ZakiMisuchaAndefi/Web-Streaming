/* ==========================================================================
   demo.js — perpustakaan demo prosedural (WAV yang dibuat di browser)
   Dipakai agar aplikasi bisa dicoba tanpa file musik pengguna.
   ========================================================================== */

(function (AM) {
  "use strict";

  const U = AM.Utils;

  const TRACKS = [
    {
      title: "Senja di Jendela",
      artist: "Ruang Tunggu",
      album: "Warna Sore",
      genre: "Indie Pop",
      year: "2024",
      trackNo: 1,
      duration: 22,
      tempo: 92,
      root: 57,
      mode: "minor",
      seed: "senja-jendela",
      progression: [0, 5, 3, 4]
    },
    {
      title: "Kopi Tanpa Gula",
      artist: "Ruang Tunggu",
      album: "Warna Sore",
      genre: "Indie Pop",
      year: "2024",
      trackNo: 2,
      duration: 20,
      tempo: 104,
      root: 60,
      mode: "major",
      seed: "kopi-gula",
      progression: [0, 4, 5, 3]
    },
    {
      title: "Lampu Kota",
      artist: "Ruang Tunggu",
      album: "Warna Sore",
      genre: "Indie Pop",
      year: "2024",
      trackNo: 3,
      duration: 24,
      tempo: 88,
      root: 55,
      mode: "minor",
      seed: "lampu-kota",
      progression: [0, 3, 5, 4]
    },
    {
      title: "Hujan Pertama",
      artist: "Nadira",
      album: "Catatan Musim",
      genre: "Akustik",
      year: "2023",
      trackNo: 1,
      duration: 21,
      tempo: 76,
      root: 62,
      mode: "major",
      seed: "hujan-pertama",
      progression: [0, 5, 3, 4]
    },
    {
      title: "Ruang Sunyi",
      artist: "Nadira",
      album: "Catatan Musim",
      genre: "Akustik",
      year: "2023",
      trackNo: 2,
      duration: 23,
      tempo: 70,
      root: 59,
      mode: "minor",
      seed: "ruang-sunyi",
      progression: [0, 4, 3, 5]
    },
    {
      title: "Garis Pantai",
      artist: "Biru Muda",
      album: "Ombak Kecil",
      genre: "Chill",
      year: "2025",
      trackNo: 1,
      duration: 25,
      tempo: 84,
      root: 53,
      mode: "major",
      seed: "garis-pantai",
      progression: [0, 3, 4, 5]
    },
    {
      title: "Pasir Hangat",
      artist: "Biru Muda",
      album: "Ombak Kecil",
      genre: "Chill",
      year: "2025",
      trackNo: 2,
      duration: 19,
      tempo: 96,
      root: 56,
      mode: "major",
      seed: "pasir-hangat",
      progression: [0, 5, 4, 3]
    },
    {
      title: "Nadi",
      artist: "Voltase",
      album: "Sinyal",
      genre: "Elektronik",
      year: "2025",
      trackNo: 1,
      duration: 22,
      tempo: 118,
      root: 50,
      mode: "minor",
      seed: "nadi-voltase",
      progression: [0, 0, 5, 3]
    },
    {
      title: "Frekuensi",
      artist: "Voltase",
      album: "Sinyal",
      genre: "Elektronik",
      year: "2025",
      trackNo: 2,
      duration: 20,
      tempo: 124,
      root: 52,
      mode: "minor",
      seed: "frekuensi-voltase",
      progression: [0, 3, 0, 5]
    },
    {
      title: "Pagi Perlahan",
      artist: "Langit Keenam",
      album: "Sebelum Terang",
      genre: "Alternatif",
      year: "2022",
      trackNo: 1,
      duration: 24,
      tempo: 80,
      root: 58,
      mode: "major",
      seed: "pagi-perlahan",
      progression: [0, 4, 5, 3]
    },
    {
      title: "Jalan Pulang",
      artist: "Langit Keenam",
      album: "Sebelum Terang",
      genre: "Alternatif",
      year: "2022",
      trackNo: 2,
      duration: 21,
      tempo: 90,
      root: 57,
      mode: "minor",
      seed: "jalan-pulang",
      progression: [0, 5, 3, 4]
    },
    {
      title: "Bintang Kecil",
      artist: "Langit Keenam",
      album: "Sebelum Terang",
      genre: "Alternatif",
      year: "2022",
      trackNo: 3,
      duration: 23,
      tempo: 86,
      root: 60,
      mode: "major",
      seed: "bintang-kecil",
      progression: [0, 3, 4, 5]
    }
  ];

  const MINOR = [0, 2, 3, 5, 7, 8, 10];
  const MAJOR = [0, 2, 4, 5, 7, 9, 11];

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function random() {
      a += 0x6d2b79f5;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function freqOf(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  function addTone(buffer, sampleRate, start, length, frequency, gain, type, attack, release) {
    const from = Math.max(0, Math.floor(start * sampleRate));
    const to = Math.min(buffer.length, Math.floor((start + length) * sampleRate));
    if (to <= from) return;
    const attackSamples = Math.max(1, Math.floor(attack * sampleRate));
    const releaseSamples = Math.max(1, Math.floor(release * sampleRate));
    const total = to - from;
    for (let i = 0; i < total; i += 1) {
      const t = i / sampleRate;
      let env = 1;
      if (i < attackSamples) env = i / attackSamples;
      if (i > total - releaseSamples) env = Math.min(env, (total - i) / releaseSamples);
      env *= env;
      let wave;
      if (type === "sine") {
        wave = Math.sin(2 * Math.PI * frequency * t);
      } else if (type === "triangle") {
        wave = (2 / Math.PI) * Math.asin(Math.sin(2 * Math.PI * frequency * t));
      } else {
        wave = Math.sin(2 * Math.PI * frequency * t) + 0.32 * Math.sin(4 * Math.PI * frequency * t);
      }
      buffer[from + i] += wave * env * gain;
    }
  }

  function addKick(buffer, sampleRate, start, gain) {
    const from = Math.max(0, Math.floor(start * sampleRate));
    const length = Math.floor(0.18 * sampleRate);
    for (let i = 0; i < length && from + i < buffer.length; i += 1) {
      const t = i / sampleRate;
      const env = Math.exp(-t * 22);
      const f = 118 * Math.exp(-t * 36) + 42;
      buffer[from + i] += Math.sin(2 * Math.PI * f * t) * env * gain;
    }
  }

  function addHat(buffer, sampleRate, start, gain, random) {
    const from = Math.max(0, Math.floor(start * sampleRate));
    const length = Math.floor(0.045 * sampleRate);
    let last = 0;
    for (let i = 0; i < length && from + i < buffer.length; i += 1) {
      const t = i / sampleRate;
      const noise = random() * 2 - 1;
      const filtered = noise - last * 0.72;
      last = noise;
      buffer[from + i] += filtered * Math.exp(-t * 70) * gain;
    }
  }

  function render(spec) {
    const sampleRate = 22050;
    const duration = spec.duration;
    const buffer = new Float32Array(Math.ceil(duration * sampleRate));
    const random = mulberry32(U.hash(spec.seed));
    const scale = spec.mode === "minor" ? MINOR : MAJOR;
    const beat = 60 / spec.tempo;
    const bar = beat * 4;
    const bars = Math.ceil(duration / bar);
    const chordDegrees = spec.progression;
    const melodyPattern = [0, 2, 4, 2, 5, 4, 2, 1, 0, 4, 2, 5, 4, 2, 1, 3];

    function chordMidi(degree, offset) {
      const value = degree + offset * 2;
      return spec.root + scale[value % 7] + Math.floor(value / 7) * 12;
    }

    for (let b = 0; b < bars; b += 1) {
      const start = b * bar;
      if (start >= duration) break;
      const degree = chordDegrees[b % chordDegrees.length];

      // Pad: tiga nada akor dengan serangan lembut.
      for (let voice = 0; voice < 3; voice += 1) {
        const note = chordMidi(degree, voice) + (voice === 0 ? 0 : 0);
        addTone(buffer, sampleRate, start, Math.min(bar, duration - start), freqOf(note), 0.065, "sine", 0.35, 0.8);
        addTone(buffer, sampleRate, start, Math.min(bar, duration - start), freqOf(note + 12), 0.022, "triangle", 0.5, 0.9);
      }

      // Bass.
      const bassNote = chordMidi(degree, 0) - 12;
      for (let step = 0; step < 4; step += 1) {
        addTone(buffer, sampleRate, start + step * beat, beat * 0.82, freqOf(bassNote), 0.12, "sine", 0.012, 0.16);
      }

      // Melodi.
      for (let step = 0; step < 8; step += 1) {
        if (random() < 0.18) continue;
        const pattern = melodyPattern[(b * 3 + step) % melodyPattern.length];
        const offset = pattern;
        const note = spec.root + 12 + scale[offset % 7] + Math.floor(offset / 7) * 12;
        const jitter = random() < 0.25 ? 1 : 0;
        addTone(
          buffer,
          sampleRate,
          start + step * (beat / 2),
          beat * 0.42,
          freqOf(note + jitter),
          0.075,
          "triangle",
          0.008,
          0.1
        );
      }

      // Drum ringan.
      if (b > 0 || start > 0.4) {
        addKick(buffer, sampleRate, start, 0.22);
        addKick(buffer, sampleRate, start + beat * 2, 0.16);
      }
      for (let step = 1; step < 8; step += 2) {
        addHat(buffer, sampleRate, start + step * (beat / 2), 0.045, random);
      }
    }

    // Fade masuk/keluar dan normalisasi lembut.
    const fadeIn = Math.floor(0.35 * sampleRate);
    const fadeOut = Math.floor(1.2 * sampleRate);
    let peak = 0;
    for (let i = 0; i < buffer.length; i += 1) {
      let gain = 1;
      if (i < fadeIn) gain = i / fadeIn;
      if (i > buffer.length - fadeOut) gain = Math.min(gain, (buffer.length - i) / fadeOut);
      buffer[i] *= gain;
      const abs = Math.abs(buffer[i]);
      if (abs > peak) peak = abs;
    }
    const norm = peak > 0 ? Math.min(1.35, 0.86 / peak) : 1;

    const dataSize = buffer.length * 2;
    const out = new ArrayBuffer(44 + dataSize);
    const view = new DataView(out);
    const writeAscii = (offset, text) => {
      for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
    };
    writeAscii(0, "RIFF");
    view.setUint32(4, 36 + dataSize, true);
    writeAscii(8, "WAVE");
    writeAscii(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeAscii(36, "data");
    view.setUint32(40, dataSize, true);
    for (let i = 0; i < buffer.length; i += 1) {
      const sample = Math.max(-1, Math.min(1, buffer[i] * norm));
      view.setInt16(44 + i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    }

    return new Blob([out], { type: "audio/wav" });
  }

  function fileName(spec) {
    return (
      spec.trackNo +
      " - " +
      spec.artist +
      " - " +
      spec.title +
      ".wav"
    );
  }

  async function generate(onProgress) {
    const result = [];
    for (let index = 0; index < TRACKS.length; index += 1) {
      const spec = TRACKS[index];
      if (typeof onProgress === "function") {
        onProgress(index, TRACKS.length, spec);
      }
      // Beri kesempatan UI bernapas sebelum merender trek berikutnya.
      await new Promise((resolve) => window.setTimeout(resolve, 16));
      const blob = render(spec);
      const file = new File([blob], fileName(spec), { type: "audio/wav" });
      result.push({
        file,
        meta: {
          title: spec.title,
          artist: spec.artist,
          album: spec.album,
          albumArtist: spec.artist,
          genre: spec.genre,
          year: spec.year,
          trackNo: spec.trackNo,
          discNo: 1,
          durationHint: spec.duration,
          cover: null
        }
      });
    }
    return result;
  }

  AM.Demo = {
    count: TRACKS.length,
    generate
  };
})(window.AM = window.AM || {});
