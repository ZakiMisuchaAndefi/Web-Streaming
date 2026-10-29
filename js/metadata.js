/* ==========================================================================
   metadata.js — pembaca tag ID3, FLAC, M4A/MP4, OGG, dan WAV
   ========================================================================== */

(function (AM) {
  "use strict";

  const U = AM.Utils;

  const ID3_GENRES = {
    0: "Blues", 1: "Classic Rock", 2: "Country", 3: "Dance", 4: "Disco", 5: "Funk",
    6: "Grunge", 7: "Hip-Hop", 8: "Jazz", 9: "Metal", 10: "New Age", 11: "Oldies",
    12: "Other", 13: "Pop", 14: "R&B", 15: "Rap", 16: "Reggae", 17: "Rock",
    18: "Techno", 19: "Industrial", 20: "Alternative", 21: "Ska", 22: "Death Metal",
    23: "Pranks", 24: "Soundtrack", 25: "Euro-Techno", 26: "Ambient", 27: "Trip-Hop",
    28: "Vocal", 29: "Jazz+Funk", 30: "Fusion", 31: "Trance", 32: "Classical",
    33: "Instrumental", 34: "Acid", 35: "House", 36: "Game", 37: "Sound Clip",
    38: "Gospel", 39: "Noise", 40: "AlternRock", 41: "Bass", 42: "Soul", 43: "Punk",
    44: "Space", 45: "Meditative", 46: "Instrumental Pop", 47: "Instrumental Rock",
    48: "Ethnic", 49: "Gothic", 50: "Darkwave", 51: "Techno-Industrial",
    52: "Electronic", 53: "Pop-Folk", 54: "Eurodance", 55: "Dream", 56: "Southern Rock",
    57: "Comedy", 58: "Cult", 59: "Gangsta", 60: "Top 40", 61: "Christian Rap",
    62: "Pop/Funk", 63: "Jungle", 64: "Native American", 65: "Cabaret", 66: "New Wave",
    67: "Psychedelic", 68: "Rave", 69: "Showtunes", 70: "Trailer", 71: "Lo-Fi",
    72: "Tribal", 73: "Acid Punk", 74: "Acid Jazz", 75: "Polka", 76: "Retro",
    77: "Musical", 78: "Rock & Roll", 79: "Hard Rock", 80: "Folk", 81: "Folk-Rock",
    82: "National Folk", 83: "Swing", 84: "Fast Fusion", 85: "Bebob", 86: "Latin",
    87: "Revival", 88: "Celtic", 89: "Bluegrass", 90: "Avantgarde", 91: "Gothic Rock",
    92: "Progressive Rock", 93: "Psychedelic Rock", 94: "Symphonic Rock",
    95: "Slow Rock", 96: "Big Band", 97: "Chorus", 98: "Easy Listening",
    99: "Acoustic", 100: "Humour", 101: "Speech", 102: "Chanson", 103: "Opera",
    104: "Chamber Music", 105: "Sonata", 106: "Symphony", 107: "Booty Bass",
    108: "Primus", 109: "Porn Groove", 110: "Satire", 111: "Slow Jam", 112: "Club",
    113: "Tango", 114: "Samba", 115: "Folklore", 116: "Ballad", 117: "Power Ballad",
    118: "Rhythmic Soul", 119: "Freestyle", 120: "Duet", 121: "Punk Rock",
    122: "Drum Solo", 123: "A capella", 124: "Euro-House", 125: "Dance Hall",
    126: "Goa", 127: "Drum & Bass", 128: "Club-House", 129: "Hardcore", 130: "Terror",
    131: "Indie", 132: "BritPop", 133: "Afro-Punk", 134: "Polsk Punk", 135: "Beat",
    136: "Christian Gangsta Rap", 137: "Heavy Metal", 138: "Black Metal",
    139: "Crossover", 140: "Contemporary Christian", 141: "Christian Rock",
    142: "Merengue", 143: "Salsa", 144: "Thrash Metal", 145: "Anime", 146: "JPop",
    147: "Synthpop", 148: "Abstract", 149: "Art Rock", 150: "Baroque", 151: "Bhangra",
    152: "Big Beat", 153: "Breakbeat", 154: "Chillout", 155: "Downtempo", 156: "Dub",
    157: "EBM", 158: "Eclectic", 159: "Electro", 160: "Electroclash", 161: "Emo",
    162: "Experimental", 163: "Garage", 164: "Global", 165: "IDM", 166: "Illbient",
    167: "Industro-Goth", 168: "Jam Band", 169: "Krautrock", 170: "Leftfield",
    171: "Lounge", 172: "Math Rock", 173: "New Romantic", 174: "Nu-Breakz",
    175: "Post-Punk", 176: "Post-Rock", 177: "Psytrance", 178: "Shoegaze",
    179: "Space Rock", 180: "Trop Rock", 181: "World Music", 182: "Neoclassical",
    183: "Audiobook", 184: "Audio Theatre", 185: "Neue Deutsche Welle", 186: "Podcast",
    187: "Indie Rock", 188: "G-Funk", 189: "Dubstep", 190: "Garage Rock",
    191: "Psybient"
  };

  const latin1Decoder = (() => {
    try {
      return new TextDecoder("windows-1252");
    } catch (error) {
      return new TextDecoder();
    }
  })();

  function latin1(bytes) {
    if (!bytes || !bytes.length) return "";
    try {
      return latin1Decoder.decode(bytes);
    } catch (error) {
      let text = "";
      for (let i = 0; i < bytes.length; i += 1) text += String.fromCharCode(bytes[i]);
      return text;
    }
  }

  function utf8(bytes) {
    if (!bytes || !bytes.length) return "";
    try {
      return new TextDecoder("utf-8").decode(bytes);
    } catch (error) {
      return latin1(bytes);
    }
  }

  function utf16(bytes, bigEndian) {
    if (!bytes || bytes.length < 2) return "";
    try {
      return new TextDecoder(bigEndian ? "utf-16be" : "utf-16le").decode(bytes);
    } catch (error) {
      let text = "";
      for (let i = 0; i + 1 < bytes.length; i += 2) {
        const code = bigEndian ? (bytes[i] << 8) | bytes[i + 1] : bytes[i] | (bytes[i + 1] << 8);
        text += String.fromCharCode(code);
      }
      return text;
    }
  }

  function decodeId3Text(bytes, encoding) {
    let text;
    switch (encoding) {
      case 0:
        text = latin1(bytes);
        break;
      case 1:
        if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
          text = utf16(bytes.subarray(2), false);
        } else if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
          text = utf16(bytes.subarray(2), true);
        } else {
          text = utf16(bytes, false);
        }
        break;
      case 2:
        text = utf16(bytes, true);
        break;
      case 3:
      default:
        text = utf8(bytes);
        break;
    }
    return String(text || "")
      .replace(/^\uFEFF/, "")
      .replace(/\u0000+/g, " / ")
      .replace(/\s+\/\s*$/, "")
      .trim();
  }

  function readU16BE(bytes, offset) {
    return ((bytes[offset] << 8) | bytes[offset + 1]) >>> 0;
  }

  function readU32BE(bytes, offset) {
    return (
      ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0
    );
  }

  function readU32LE(bytes, offset) {
    return (
      (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0
    );
  }

  function readSyncSafe(bytes, offset) {
    return (
      ((bytes[offset] & 0x7f) << 21) |
      ((bytes[offset + 1] & 0x7f) << 14) |
      ((bytes[offset + 2] & 0x7f) << 7) |
      (bytes[offset + 3] & 0x7f)
    );
  }

  function ascii(bytes, start, end) {
    let text = "";
    for (let i = start; i < end && i < bytes.length; i += 1) text += String.fromCharCode(bytes[i]);
    return text;
  }

  function findTerminator(bytes, start, encoding) {
    if (encoding === 1 || encoding === 2) {
      for (let i = start; i + 1 < bytes.length; i += 2) {
        if (bytes[i] === 0 && bytes[i + 1] === 0) return i;
      }
      return -1;
    }
    for (let i = start; i < bytes.length; i += 1) {
      if (bytes[i] === 0) return i;
    }
    return -1;
  }

  function sniffImageType(bytes) {
    if (!bytes || bytes.length < 4) return "image/jpeg";
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
    if (ascii(bytes, 0, 4) === "GIF8") return "image/gif";
    if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return "image/webp";
    if (ascii(bytes, 0, 2) === "BM") return "image/bmp";
    return "image/jpeg";
  }

  function makeCover(bytes, mime) {
    if (!bytes || bytes.length < 24) return null;
    let type = String(mime || "").trim().toLowerCase();
    if (!type || type === "image/jpg" || type === "jpg" || type === "jpeg" || !type.includes("/")) {
      type = sniffImageType(bytes);
    }
    if (type === "-->") return null;
    try {
      return { blob: new Blob([bytes], { type }), mime: type };
    } catch (error) {
      return null;
    }
  }

  function parsePictureBlock(bytes, offset, end) {
    let pos = offset;
    if (pos + 8 > end) return null;
    const mimeLength = readU32BE(bytes, pos);
    pos += 4;
    if (mimeLength > 200 || pos + mimeLength > end) return null;
    const mime = latin1(bytes.subarray(pos, pos + mimeLength));
    pos += mimeLength;

    if (pos + 4 > end) return null;
    const pictureType = readU32BE(bytes, pos);
    pos += 4;

    const descriptionLength = readU32BE(bytes, pos);
    pos += 4;
    if (descriptionLength > end || pos + descriptionLength > end) return null;
    pos += descriptionLength;

    if (pos + 16 > end) return null;
    pos += 16;

    if (pos + 4 > end) return null;
    const dataLength = readU32BE(bytes, pos);
    pos += 4;
    if (!dataLength || pos + dataLength > end) return null;

    return {
      pictureType,
      cover: makeCover(bytes.subarray(pos, pos + dataLength), mime)
    };
  }

  function decodeBase64(value) {
    try {
      const binary = window.atob(String(value || "").replace(/\s+/g, ""));
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      return bytes;
    } catch (error) {
      return null;
    }
  }

  function parseId3Picture(data, isV22) {
    if (!data || data.length < 6) return null;
    const encoding = data[0];
    let pos = 1;
    let mime = "";

    if (isV22) {
      const format = ascii(data, 1, 4).toUpperCase();
      mime = format === "PNG" ? "image/png" : format === "GIF" ? "image/gif" : "image/jpeg";
      pos = 4;
    } else {
      let mimeEnd = -1;
      for (let i = pos; i < data.length; i += 1) {
        if (data[i] === 0) {
          mimeEnd = i;
          break;
        }
      }
      if (mimeEnd < 0) return null;
      mime = latin1(data.subarray(pos, mimeEnd));
      pos = mimeEnd + 1;
    }

    if (pos >= data.length) return null;
    pos += 1; // picture type

    const terminator = findTerminator(data, pos, encoding);
    if (terminator < 0) return null;
    pos = terminator + (encoding === 1 || encoding === 2 ? 2 : 1);

    if (pos >= data.length) return null;
    return makeCover(data.subarray(pos), mime);
  }

  function normalizeGenre(value) {
    const text = String(value || "").trim();
    if (!text) return "";
    const match = text.match(/^\((\d+)\)/);
    if (match) {
      const mapped = ID3_GENRES[Number(match[1])];
      if (mapped) return mapped;
    }
    const numeric = Number(text);
    if (String(numeric) === text && ID3_GENRES[numeric]) return ID3_GENRES[numeric];
    return text.replace(/^\(|\)$/g, "").trim();
  }

  function parseId3Lyrics(data) {
    if (!data || data.length < 5) return "";
    const encoding = data[0];
    // Lewati 3 byte bahasa, lalu descriptor yang diakhiri null.
    const terminator = findTerminator(data, 4, encoding);
    const step = encoding === 1 || encoding === 2 ? 2 : 1;
    const start = terminator >= 0 ? terminator + step : 4;
    if (start >= data.length) return "";
    return decodeId3Text(data.subarray(start), encoding);
  }

  function lrcTime(seconds) {
    const total = Math.max(0, Number(seconds) || 0);
    const minutes = Math.floor(total / 60);
    const secs = Math.floor(total % 60);
    const centis = Math.floor((total - Math.floor(total)) * 100);
    return (
      String(minutes).padStart(2, "0") +
      ":" +
      String(secs).padStart(2, "0") +
      "." +
      String(centis).padStart(2, "0")
    );
  }

  function parseId3SyncLyrics(data) {
    if (!data || data.length < 7) return "";
    const encoding = data[0];
    const timestampFormat = data[4];
    const step = encoding === 1 || encoding === 2 ? 2 : 1;
    let pos = 6;
    const descriptorEnd = findTerminator(data, pos, encoding);
    pos = descriptorEnd >= 0 ? descriptorEnd + step : pos;
    const rows = [];
    let guard = 0;

    while (pos < data.length && guard < 2000) {
      guard += 1;
      const textEnd = findTerminator(data, pos, encoding);
      if (textEnd < 0) break;
      const text = decodeId3Text(data.subarray(pos, textEnd), encoding);
      pos = textEnd + step;
      if (pos + 4 > data.length) break;
      const stamp = readU32BE(data, pos);
      pos += 4;
      if (!text) continue;
      const seconds = timestampFormat === 2 ? stamp / 1000 : stamp * 0.026;
      rows.push({ seconds, text });
    }

    if (!rows.length) return "";
    rows.sort((a, b) => a.seconds - b.seconds);
    return rows.map((row) => "[" + lrcTime(row.seconds) + "]" + row.text).join("\n");
  }

  function lyricsFromTags(tags) {
    if (!tags) return "";
    const keys = [
      "LYRICS",
      "UNSYNCEDLYRICS",
      "UNSYNCED_LYRICS",
      "SYNCEDLYRICS",
      "SYNCED_LYRICS",
      "LYRICS-ENG",
      "LYRICS_ENG"
    ];
    for (let i = 0; i < keys.length; i += 1) {
      const value = tags[keys[i]];
      if (value && String(value).trim()) return String(value).trim();
    }
    return "";
  }

  function parseId3v2(bytes) {
    if (bytes.length < 10 || ascii(bytes, 0, 3) !== "ID3") return null;

    const major = bytes[3];
    const flags = bytes[5];
    if (major !== 2 && major !== 3 && major !== 4) return null;

    const tagSize = readSyncSafe(bytes, 6);
    if (tagSize <= 0) return null;

    const tagEnd = Math.min(bytes.length, 10 + tagSize);
    let pos = 10;

    if (flags & 0x40) {
      if (pos + 4 > tagEnd) return null;
      if (major === 4) {
        const extSize = readSyncSafe(bytes, pos);
        pos += Math.max(extSize, 0);
      } else if (major === 3) {
        const extSize = readU32BE(bytes, pos);
        pos += 4 + extSize;
      } else {
        pos += 4;
      }
    }

    const frames = {};
    const textFrames = {};
    let cover = null;
    let lyrics = "";
    let guard = 0;

    while (pos < tagEnd && guard < 3000) {
      guard += 1;
      const headerSize = major === 2 ? 6 : 10;
      if (pos + headerSize > tagEnd) break;

      const id = major === 2 ? ascii(bytes, pos, pos + 3) : ascii(bytes, pos, pos + 4);
      if (!/^[A-Z0-9]+$/.test(id)) break;

      let frameSize;
      let frameFlags = 0;
      if (major === 2) {
        frameSize = (bytes[pos + 3] << 16) | (bytes[pos + 4] << 8) | bytes[pos + 5];
      } else if (major === 4) {
        frameSize = readSyncSafe(bytes, pos + 4);
        frameFlags = readU16BE(bytes, pos + 8);
      } else {
        frameSize = readU32BE(bytes, pos + 4);
        frameFlags = readU16BE(bytes, pos + 8);
      }

      if (frameSize <= 0) break;
      const dataStart = pos + headerSize;
      const dataEnd = dataStart + frameSize;
      if (dataEnd > tagEnd) break;

      let data = bytes.subarray(dataStart, dataEnd);
      pos = dataEnd;

      const encrypted = major === 3 ? (frameFlags & 0x0040) : major === 4 ? (frameFlags & 0x0004) : false;
      const compressed = major === 3 ? (frameFlags & 0x0080) : major === 4 ? (frameFlags & 0x0008) : false;
      if (encrypted || compressed) continue;

      if (major === 4 && frameFlags & 0x0001) {
        data = data.subarray(4);
      }

      if (major >= 3 && data.length) {
        if (flags & 0x80) {
          const clean = [];
          for (let i = 0; i < data.length; i += 1) {
            clean.push(data[i]);
            if (data[i] === 0xff && data[i + 1] === 0x00) i += 1;
          }
          data = new Uint8Array(clean);
        }
      }

      if (!data.length) continue;

      if (id === "APIC" || id === "PIC") {
        if (!cover) cover = parseId3Picture(data, id === "PIC");
        continue;
      }

      if (id === "USLT" || id === "ULT") {
        const value = parseId3Lyrics(data);
        if (value && !lyrics) lyrics = value;
        continue;
      }

      if (id === "SYLT" || id === "SLT") {
        const value = parseId3SyncLyrics(data);
        if (value) lyrics = value;
        continue;
      }

      if (id === "TXXX" || id === "TXX") {
        const encoding = data[0];
        const terminator = findTerminator(data, 1, encoding);
        const step = encoding === 1 || encoding === 2 ? 2 : 1;
        if (terminator >= 0) {
          const description = decodeId3Text(data.subarray(1, terminator), encoding);
          const value = decodeId3Text(data.subarray(terminator + step), encoding);
          if (value && /lyric/i.test(description)) lyrics = value;
        }
        continue;
      }

      if (id[0] === "T") {
        const encoding = data[0];
        const decoded = decodeId3Text(data.subarray(1), encoding);
        if (decoded) {
          textFrames[id] = decoded;
          frames[id] = decoded;
        }
      }
    }

    const read = (...ids) => {
      for (let i = 0; i < ids.length; i += 1) {
        const value = textFrames[ids[i]];
        if (value) return value;
      }
      return "";
    };

    return {
      title: read("TIT2", "TT2"),
      artist: read("TPE1", "TP1"),
      albumArtist: read("TPE2", "TP2"),
      album: read("TALB", "TAL"),
      genre: normalizeGenre(read("TCON", "TCO")),
      year: U.parseYear(read("TDRC", "TYER", "TYE")),
      trackNo: U.parseTrackNumber(read("TRCK", "TRK")),
      discNo: U.parseTrackNumber(read("TPOS", "TPA")),
      cover,
      lyrics,
      raw: frames
    };
  }

  function parseId3v1(bytes) {
    if (bytes.length < 128) return null;
    const offset = bytes.length - 128;
    if (ascii(bytes, offset, offset + 3) !== "TAG") return null;

    const clean = (start, length) => {
      let end = start;
      const limit = start + length;
      while (end < limit && bytes[end] !== 0) end += 1;
      return latin1(bytes.subarray(start, end)).trim();
    };

    return {
      title: clean(offset + 3, 30),
      artist: clean(offset + 33, 30),
      album: clean(offset + 63, 30),
      year: clean(offset + 93, 4),
      genre: ID3_GENRES[bytes[offset + 127]] || "",
      trackNo: bytes[offset + 125] === 0 ? 0 : bytes[offset + 126]
    };
  }

  /* ------------------------------------------------------------------------
     FLAC
     ------------------------------------------------------------------------ */

  function parseVorbisComments(bytes, offset, end) {
    const result = {};
    let cover = null;
    let pos = offset;
    if (pos + 8 > end) return { tags: result, cover };

    const vendorLength = readU32LE(bytes, pos);
    pos += 4;
    if (vendorLength > 0 && pos + vendorLength <= end) pos += vendorLength;
    if (pos + 4 > end) return { tags: result, cover };

    const count = readU32LE(bytes, pos);
    pos += 4;
    const safeCount = Math.min(count, 5000);

    for (let i = 0; i < safeCount && pos + 4 <= end; i += 1) {
      const length = readU32LE(bytes, pos);
      pos += 4;
      if (length > end - pos) break;
      const text = utf8(bytes.subarray(pos, pos + length));
      pos += length;
      const equals = text.indexOf("=");
      if (equals <= 0) continue;
      const key = text.slice(0, equals).toUpperCase();
      const value = text.slice(equals + 1);
      if (!value) continue;
      result[key] = value;

      if (key === "METADATA_BLOCK_PICTURE" && !cover) {
        const decoded = decodeBase64(value);
        if (decoded) {
          const parsed = parsePictureBlock(decoded, 0, decoded.length);
          if (parsed && parsed.cover) cover = parsed.cover;
        }
      }
    }

    return { tags: result, cover };
  }

  function parseFlac(bytes) {
    if (ascii(bytes, 0, 4) !== "fLaC") return null;

    let pos = 4;
    let tags = {};
    let cover = null;
    let durationHint = 0;
    let guard = 0;

    while (pos + 4 <= bytes.length && guard < 128) {
      guard += 1;
      const header = bytes[pos];
      const last = (header & 0x80) !== 0;
      const type = header & 0x7f;
      const length = (bytes[pos + 1] << 16) | (bytes[pos + 2] << 8) | bytes[pos + 3];
      pos += 4;
      if (length < 0 || pos + length > bytes.length) break;
      const data = bytes.subarray(pos, pos + length);

      if (type === 0 && data.length >= 18) {
        const sampleRate = (data[10] << 12) | (data[11] << 4) | (data[12] >> 4);
        const totalSamples =
          (data[13] & 0x0f) * 0x100000000 +
          data[14] * 0x1000000 +
          data[15] * 0x10000 +
          data[16] * 0x100 +
          data[17];
        if (sampleRate > 0 && totalSamples > 0) durationHint = totalSamples / sampleRate;
      } else if (type === 4) {
        const parsed = parseVorbisComments(bytes, pos, pos + length);
        tags = Object.assign(tags, parsed.tags);
        if (parsed.cover) cover = parsed.cover;
      } else if (type === 6) {
        const picture = parsePictureBlock(bytes, pos, pos + length);
        if (picture && picture.cover && (!cover || picture.pictureType === 3)) cover = picture.cover;
      }

      pos += length;
      if (last) break;
    }

    return {
      title: tags.TITLE || "",
      artist: tags.ARTIST || "",
      albumArtist: tags.ALBUMARTIST || tags.ALBUM_ARTIST || "",
      album: tags.ALBUM || "",
      genre: normalizeGenre(tags.GENRE || ""),
      year: U.parseYear(tags.DATE || tags.YEAR || ""),
      trackNo: U.parseTrackNumber(tags.TRACKNUMBER || ""),
      discNo: U.parseTrackNumber(tags.DISCNUMBER || ""),
      cover,
      lyrics: lyricsFromTags(tags),
      durationHint,
      raw: tags
    };
  }

  /* ------------------------------------------------------------------------
     MP4 / M4A
     ------------------------------------------------------------------------ */

  function walkAtoms(bytes, start, end, visit) {
    let pos = start;
    let guard = 0;
    while (pos + 8 <= end && guard < 6000) {
      guard += 1;
      let size = readU32BE(bytes, pos);
      const type = latin1(bytes.subarray(pos + 4, pos + 8));
      let headerSize = 8;

      if (size === 1) {
        if (pos + 16 > end) break;
        const high = readU32BE(bytes, pos + 8);
        const low = readU32BE(bytes, pos + 12);
        size = high * 4294967296 + low;
        headerSize = 16;
      } else if (size === 0) {
        size = end - pos;
      }

      if (size < headerSize || pos + size > end) break;
      visit(type, pos + headerSize, pos + size);
      pos += size;
    }
  }

  function findIlst(bytes, start, end, depth) {
    if (depth > 10 || start >= end) return null;
    let found = null;
    walkAtoms(bytes, start, end, (type, childStart, childEnd) => {
      if (found) return;
      if (type === "ilst") {
        found = { start: childStart, end: childEnd };
        return;
      }
      if (type === "meta") {
        found = findIlst(bytes, childStart + 4, childEnd, depth + 1);
        return;
      }
      if (["moov", "udta", "trak", "mdia", "minf", "stbl"].includes(type)) {
        found = findIlst(bytes, childStart, childEnd, depth + 1);
      }
    });
    return found;
  }

  function parseMp4Text(bytes) {
    if (!bytes || !bytes.length) return "";
    return utf8(bytes).replace(/\u0000+/g, "").trim();
  }

  function parseMp4(bytes) {
    if (ascii(bytes, 4, 8) !== "ftyp" && ascii(bytes, 0, 8) !== "ftypM4A ") return null;

    const ilst = findIlst(bytes, 0, bytes.length, 0);
    if (!ilst) return null;

    const result = {
      title: "",
      artist: "",
      albumArtist: "",
      album: "",
      genre: "",
      year: "",
      trackNo: 0,
      discNo: 0,
      cover: null,
      lyrics: "",
      raw: {}
    };

    walkAtoms(bytes, ilst.start, ilst.end, (type, itemStart, itemEnd) => {
      if (type === "----") return;
      let dataStart = -1;
      let dataEnd = -1;
      let dataType = 0;
      let extraStart = -1;
      let extraEnd = -1;

      walkAtoms(bytes, itemStart, itemEnd, (childType, childStart, childEnd) => {
        if (childType === "data" && dataStart < 0) {
          dataStart = childStart;
          dataEnd = childEnd;
          dataType = readU32BE(bytes, childStart);
        } else if (childType === "mean" && extraStart < 0) {
          extraStart = childStart;
          extraEnd = childEnd;
        }
      });

      if (dataStart < 0 || dataEnd - dataStart < 8) return;
      const payload = bytes.subarray(dataStart + 8, dataEnd);

      if (type === "©nam" || type === "©ART" || type === "aART" || type === "©alb" || type === "©gen" || type === "©day" || type === "©lyr") {
        const value = parseMp4Text(payload);
        if (!value) return;
        if (type === "©nam") result.title = value;
        else if (type === "©ART") result.artist = value;
        else if (type === "aART") result.albumArtist = value;
        else if (type === "©alb") result.album = value;
        else if (type === "©gen") result.genre = normalizeGenre(value);
        else if (type === "©day") result.year = U.parseYear(value);
        else if (type === "©lyr") result.lyrics = value;
        result.raw[type] = value;
      } else if (type === "trkn" && payload.length >= 4) {
        result.trackNo = readU16BE(payload, 2);
      } else if (type === "disk" && payload.length >= 4) {
        result.discNo = readU16BE(payload, 2);
      } else if (type === "gnre" && payload.length >= 2) {
        const index = readU16BE(payload, payload.length - 2) - 1;
        if (ID3_GENRES[index]) result.genre = ID3_GENRES[index];
      } else if (type === "covr" && !result.cover) {
        let mime = dataType === 14 ? "image/png" : dataType === 13 ? "image/jpeg" : sniffImageType(payload);
        if (dataType === 0) mime = sniffImageType(payload);
        result.cover = makeCover(payload, mime);
      }
    });

    return result;
  }

  /* ------------------------------------------------------------------------
     WAV
     ------------------------------------------------------------------------ */

  function parseWav(bytes) {
    if (ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 12) !== "WAVE") return null;

    const tags = {};
    let cover = null;
    let id3 = null;
    let byteRate = 0;
    let dataSize = 0;
    let pos = 12;

    while (pos + 8 <= bytes.length) {
      const id = ascii(bytes, pos, pos + 4);
      const size = readU32LE(bytes, pos + 4);
      const dataStart = pos + 8;
      const dataEnd = Math.min(bytes.length, dataStart + size);
      if (size < 0 || dataStart + size > bytes.length) break;

      if (id === "fmt " && size >= 12) {
        byteRate = readU32LE(bytes, dataStart + 8);
      } else if (id === "data") {
        dataSize = size;
      } else if (id === "LIST" && ascii(bytes, dataStart, dataStart + 4) === "INFO") {
        let infoPos = dataStart + 4;
        while (infoPos + 8 <= dataEnd) {
          const infoId = ascii(bytes, infoPos, infoPos + 4);
          const infoSize = readU32LE(bytes, infoPos + 4);
          const infoStart = infoPos + 8;
          const infoEnd = Math.min(dataEnd, infoStart + infoSize);
          if (infoSize < 0 || infoStart + infoSize > dataEnd) break;
          const value = latin1(bytes.subarray(infoStart, infoEnd)).replace(/\0+$/, "").trim();
          if (value) tags[infoId] = value;
          infoPos = infoStart + infoSize + (infoSize % 2);
        }
      } else if ((id === "id3 " || id === "ID3 ") && !id3) {
        id3 = parseId3v2(bytes.subarray(dataStart, dataEnd));
      }

      pos = dataStart + size + (size % 2);
    }

    const base = id3 || {};
    return {
      title: base.title || tags.INAM || "",
      artist: base.artist || tags.IART || "",
      albumArtist: base.albumArtist || "",
      album: base.album || tags.IPRD || "",
      genre: base.genre || normalizeGenre(tags.IGNR || ""),
      year: base.year || U.parseYear(tags.ICRD || ""),
      trackNo: base.trackNo || U.parseTrackNumber(tags.ITRK || ""),
      discNo: base.discNo || 0,
      cover: base.cover || cover,
      durationHint: byteRate > 0 && dataSize > 0 ? dataSize / byteRate : 0,
      raw: tags
    };
  }

  /* ------------------------------------------------------------------------
     OGG (Vorbis / Opus)
     ------------------------------------------------------------------------ */

  function concatenate(a, b) {
    if (!a.length) return b;
    if (!b.length) return a;
    const result = new Uint8Array(a.length + b.length);
    result.set(a, 0);
    result.set(b, a.length);
    return result;
  }

  function parseOgg(bytes) {
    if (ascii(bytes, 0, 4) !== "OggS") return null;

    const packets = [];
    let pending = new Uint8Array(0);
    let pos = 0;
    let guard = 0;

    while (pos + 27 <= bytes.length && guard < 40) {
      guard += 1;
      if (ascii(bytes, pos, pos + 4) !== "OggS") break;
      const segmentCount = bytes[pos + 26];
      if (pos + 27 + segmentCount > bytes.length) break;
      const tableStart = pos + 27;
      let dataPos = tableStart + segmentCount;
      let dataLength = 0;
      for (let i = 0; i < segmentCount; i += 1) dataLength += bytes[tableStart + i];
      if (dataPos + dataLength > bytes.length) break;

      let cursor = dataPos;
      for (let i = 0; i < segmentCount; i += 1) {
        const length = bytes[tableStart + i];
        const chunk = bytes.subarray(cursor, cursor + length);
        pending = concatenate(pending, chunk);
        cursor += length;
        if (length < 255) {
          packets.push(pending);
          pending = new Uint8Array(0);
          if (packets.length >= 4) break;
        }
      }

      if (packets.length >= 4) break;
      pos = dataPos + dataLength;
    }

    let tags = {};
    let cover = null;
    let foundComment = false;

    for (let i = 0; i < packets.length; i += 1) {
      const packet = packets[i];
      let offset = -1;
      if (ascii(packet, 0, 7) === "\x03vorbis") offset = 7;
      else if (ascii(packet, 0, 8) === "OpusTags") offset = 8;

      if (offset >= 0) {
        const parsed = parseVorbisComments(packet, offset, packet.length);
        tags = Object.assign(tags, parsed.tags);
        if (parsed.cover) cover = parsed.cover;
        foundComment = true;
        break;
      }
    }

    if (!foundComment) return null;

    return {
      title: tags.TITLE || "",
      artist: tags.ARTIST || "",
      albumArtist: tags.ALBUMARTIST || tags.ALBUM_ARTIST || "",
      album: tags.ALBUM || "",
      genre: normalizeGenre(tags.GENRE || ""),
      year: U.parseYear(tags.DATE || tags.YEAR || ""),
      trackNo: U.parseTrackNumber(tags.TRACKNUMBER || ""),
      discNo: U.parseTrackNumber(tags.DISCNUMBER || ""),
      cover,
      lyrics: lyricsFromTags(tags),
      raw: tags
    };
  }

  /* ------------------------------------------------------------------------
     Nama file
     ------------------------------------------------------------------------ */

  function parseFileName(fileName) {
    let base = String(fileName || "Lagu")
      .replace(/\.[^.]+$/, "")
      .replace(/_/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    base = base.replace(/^\s*\d{1,3}[\s._-]+/, "").trim();

    let artist = "";
    let title = base;
    const match = base.match(/^(.{1,120}?)\s+[-–—]\s+(.+)$/);
    if (match) {
      artist = match[1].trim();
      title = match[2].trim();
    }

    if (!title) title = base || "Lagu tanpa judul";
    return { title, artist, album: "" };
  }

  function cleanValue(value) {
    return String(value == null ? "" : value)
      .replace(/\u0000+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function cleanLyrics(value) {
    return String(value == null ? "" : value)
      .replace(/\u0000+/g, "")
      .replace(/\r\n?/g, "\n")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function mergeMetadata(primary, fallback) {
    const result = {
      title: cleanValue(primary.title) || cleanValue(fallback.title) || "Lagu tanpa judul",
      artist: cleanValue(primary.artist) || cleanValue(fallback.artist) || "",
      album: cleanValue(primary.album) || cleanValue(fallback.album) || "",
      albumArtist: cleanValue(primary.albumArtist) || cleanValue(fallback.albumArtist) || "",
      genre: cleanValue(primary.genre) || cleanValue(fallback.genre) || "",
      year: cleanValue(primary.year) || cleanValue(fallback.year) || "",
      trackNo: Number(primary.trackNo) || Number(fallback.trackNo) || 0,
      discNo: Number(primary.discNo) || Number(fallback.discNo) || 0,
      cover: primary.cover || fallback.cover || null,
      lyrics: cleanLyrics(primary.lyrics || fallback.lyrics || ""),
      durationHint: Number(primary.durationHint) || 0,
      raw: primary.raw || {}
    };
    return result;
  }

  function parseBuffer(buffer, fileName) {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    const name = String(fileName || "lagu");
    const fallback = parseFileName(name);
    let parsed = null;

    try {
      if (bytes.length >= 10 && ascii(bytes, 0, 3) === "ID3") {
        parsed = parseId3v2(bytes);
        if (parsed) {
          const v1 = parseId3v1(bytes);
          if (v1) {
            ["title", "artist", "album", "year", "genre"].forEach((key) => {
              if (!parsed[key] && v1[key]) parsed[key] = v1[key];
            });
            if (!parsed.trackNo && v1.trackNo) parsed.trackNo = v1.trackNo;
          }
        }
      } else if (ascii(bytes, 0, 4) === "fLaC") {
        parsed = parseFlac(bytes);
      } else if (ascii(bytes, 4, 8) === "ftyp") {
        parsed = parseMp4(bytes);
      } else if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WAVE") {
        parsed = parseWav(bytes);
      } else if (ascii(bytes, 0, 4) === "OggS") {
        parsed = parseOgg(bytes);
      }
    } catch (error) {
      parsed = null;
    }

    return mergeMetadata(parsed || {}, fallback);
  }

  async function parseFile(file) {
    if (!file) throw new Error("File tidak valid.");
    let buffer;
    try {
      buffer = await file.arrayBuffer();
    } catch (error) {
      throw new Error("Tidak dapat membaca file.");
    }
    return parseBuffer(buffer, file.name);
  }

  AM.Metadata = {
    parseFile,
    parseBuffer,
    parseFileName,
    sniffImageType
  };
})(window.AM = window.AM || {});
