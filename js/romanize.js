/* ==========================================================================
   romanize.js — romanisasi lirik lokal (tanpa API)
   Mendukung: Han (pinyin-pro), Hangul, kana Jepang, Arab/Persia, Kiril, Thai.
   ========================================================================== */

(function (AM) {
  "use strict";

  const HANGUL = /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/;
  const KANA = /[\u3040-\u30ff\u31f0-\u31ff]/;
  const HAN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
  const ARABIC = /[\u0600-\u06ff\u0750-\u077f\ufb50-\ufdff\ufe70-\ufefc]/;
  const CYRILLIC = /[\u0400-\u04ff]/;
  const THAI = /[\u0e00-\u0e7f]/;

  const KANA_ROMAJI = {
    "きゃ": "kya", "きゅ": "kyu", "きょ": "kyo",
    "しゃ": "sha", "しゅ": "shu", "しょ": "sho",
    "ちゃ": "cha", "ちゅ": "chu", "ちょ": "cho",
    "にゃ": "nya", "にゅ": "nyu", "にょ": "nyo",
    "ひゃ": "hya", "ひゅ": "hyu", "ひょ": "hyo",
    "みゃ": "mya", "みゅ": "myu", "みょ": "myo",
    "りゃ": "rya", "りゅ": "ryu", "りょ": "ryo",
    "ぎゃ": "gya", "ぎゅ": "gyu", "ぎょ": "gyo",
    "じゃ": "ja", "じゅ": "ju", "じょ": "jo",
    "びゃ": "bya", "びゅ": "byu", "びょ": "byo",
    "ぴゃ": "pya", "ぴゅ": "pyu", "ぴょ": "pyo",
    "あ": "a", "い": "i", "う": "u", "え": "e", "お": "o",
    "か": "ka", "き": "ki", "く": "ku", "け": "ke", "こ": "ko",
    "さ": "sa", "し": "shi", "す": "su", "せ": "se", "そ": "so",
    "た": "ta", "ち": "chi", "つ": "tsu", "て": "te", "と": "to",
    "な": "na", "に": "ni", "ぬ": "nu", "ね": "ne", "の": "no",
    "は": "ha", "ひ": "hi", "ふ": "fu", "へ": "he", "ほ": "ho",
    "ま": "ma", "み": "mi", "む": "mu", "め": "me", "も": "mo",
    "や": "ya", "ゆ": "yu", "よ": "yo",
    "ら": "ra", "り": "ri", "る": "ru", "れ": "re", "ろ": "ro",
    "わ": "wa", "を": "wo", "ん": "n",
    "が": "ga", "ぎ": "gi", "ぐ": "gu", "げ": "ge", "ご": "go",
    "ざ": "za", "じ": "ji", "ず": "zu", "ぜ": "ze", "ぞ": "zo",
    "だ": "da", "ぢ": "ji", "づ": "zu", "で": "de", "ど": "do",
    "ば": "ba", "び": "bi", "ぶ": "bu", "べ": "be", "ぼ": "bo",
    "ぱ": "pa", "ぴ": "pi", "ぷ": "pu", "ぺ": "pe", "ぽ": "po",
    "ぁ": "a", "ぃ": "i", "ぅ": "u", "ぇ": "e", "ぉ": "o",
    "ゃ": "ya", "ゅ": "yu", "ょ": "yo", "ゎ": "wa",
    "ゔ": "vu", "ゐ": "i", "ゑ": "e"
  };

  // Kanji yang sangat sering muncul di lirik. Romanisasi kanji di luar daftar
  // ini dibiarkan apa adanya (kana tetap dibaca).
  const KANJI_ROMAJI = {
    "愛": "ai", "君": "kimi", "私": "watashi", "心": "kokoro", "夢": "yume",
    "空": "sora", "海": "umi", "光": "hikari", "夜": "yoru", "朝": "asa",
    "雨": "ame", "花": "hana", "風": "kaze", "月": "tsuki", "星": "hoshi",
    "人": "hito", "時": "toki", "会": "au", "行": "iku", "見": "miru",
    "言": "iu", "想": "omou", "恋": "koi", "好": "suki", "大": "dai",
    "小": "shou", "今": "ima", "明": "ake", "日": "hi", "世": "yo",
    "界": "kai", "永": "ei", "遠": "tooi", "涙": "namida", "笑": "warau",
    "歌": "uta", "声": "koe", "手": "te", "目": "me", "道": "michi",
    "旅": "tabi", "帰": "kaeru", "逢": "au", "別": "wakare", "赤": "aka",
    "青": "ao", "白": "shiro", "黒": "kuro", "金": "kin", "銀": "gin",
    "一": "ichi", "二": "ni", "三": "san", "千": "sen", "万": "man",
    "本": "hon", "火": "hi", "水": "mizu", "木": "ki", "山": "yama",
    "川": "kawa", "上": "ue", "下": "shita", "中": "naka", "前": "mae",
    "後": "ato", "新": "atarashii", "古": "furui", "長": "nagai",
    "高": "takai", "安": "yasui", "楽": "tanoshii", "悲": "kanashii",
    "寂": "sabishii", "美": "utsukushii", "静": "shizuka", "深": "fukai",
    "近": "chikai", "強": "tsuyoi", "弱": "yowai", "友": "tomo",
    "僕": "boku", "俺": "ore", "彼": "kare", "女": "onna", "男": "otoko",
    "子": "ko", "犬": "inu", "猫": "neko", "鳥": "tori", "魚": "sakana",
    "台": "dai", "所": "tokoro", "場": "ba", "間": "aida", "度": "do",
    "年": "toshi", "回": "kai", "分": "fun", "秒": "byou", "去": "saru",
    "来": "kuru", "出": "deru", "入": "hairu", "立": "tatsu", "待": "matsu",
    "聞": "kiku", "話": "hanasu", "読": "yomu", "書": "kaku", "思": "omou",
    "知": "shiru", "忘": "wasureru", "生": "ikiru", "死": "shinu",
    "続": "tsuzuku", "始": "hajimeru", "終": "owaru", "変": "kawaru"
  };

  const CYRILLIC_MAP = {
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "yo",
    "ж": "zh", "з": "z", "и": "i", "й": "y", "к": "k", "л": "l", "м": "m",
    "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t", "у": "u",
    "ф": "f", "х": "kh", "ц": "ts", "ч": "ch", "ш": "sh", "щ": "shch",
    "ъ": "", "ы": "y", "ь": "", "э": "e", "ю": "yu", "я": "ya",
    "і": "i", "ї": "yi", "є": "ye", "ґ": "g", "ў": "u", "ђ": "dj",
    "ј": "j", "љ": "lj", "њ": "nj", "ћ": "c", "џ": "dz", "ѕ": "dz"
  };

  const ARABIC_MAP = {
    "ا": "a", "أ": "a", "إ": "i", "آ": "a", "ٱ": "a", "ب": "b", "ت": "t",
    "ث": "th", "ج": "j", "ح": "h", "خ": "kh", "د": "d", "ذ": "dh",
    "ر": "r", "ز": "z", "س": "s", "ش": "sh", "ص": "s", "ض": "d",
    "ط": "t", "ظ": "z", "ع": "ʿ", "غ": "gh", "ف": "f", "ق": "q",
    "ك": "k", "ل": "l", "م": "m", "ن": "n", "ه": "h", "و": "w",
    "ي": "y", "ى": "a", "ة": "a", "ء": "", "ؤ": "u", "ئ": "i",
    "پ": "p", "چ": "ch", "ژ": "zh", "گ": "g", "ک": "k", "ی": "y"
  };

  const THAI_MAP = {
    "ก": "k", "ข": "kh", "ฃ": "kh", "ค": "kh", "ฅ": "kh", "ฆ": "kh",
    "ง": "ng", "จ": "ch", "ฉ": "ch", "ช": "ch", "ซ": "s", "ฌ": "ch",
    "ญ": "y", "ฎ": "d", "ฏ": "t", "ฐ": "th", "ฑ": "th", "ฒ": "th",
    "ณ": "n", "ด": "d", "ต": "t", "ถ": "th", "ท": "th", "ธ": "th",
    "น": "n", "บ": "b", "ป": "p", "ผ": "ph", "ฝ": "f", "พ": "ph",
    "ฟ": "f", "ภ": "ph", "ม": "m", "ย": "y", "ร": "r", "ฤ": "rue",
    "ล": "l", "ฦ": "lue", "ว": "w", "ศ": "s", "ษ": "s", "ส": "s",
    "ห": "h", "ฬ": "l", "อ": "o", "ฮ": "h",
    "ะ": "a", "ั": "a", "า": "a", "ำ": "am", "ิ": "i", "ี": "i",
    "ึ": "ue", "ื": "ue", "ุ": "u", "ู": "u", "เ": "e", "แ": "ae",
    "โ": "o", "ใ": "ai", "ไ": "ai", "ๅ": "a", "ๆ": "", "ฯ": ""
  };

  const HANGUL_INITIAL = [
    "g", "kk", "n", "d", "tt", "r", "m", "b", "pp", "s",
    "ss", "", "j", "jj", "ch", "k", "t", "p", "h"
  ];
  const HANGUL_MEDIAL = [
    "a", "ae", "ya", "yae", "eo", "e", "yeo", "ye", "o", "wa",
    "wae", "oe", "yo", "u", "wo", "we", "wi", "yu", "eu", "ui", "i"
  ];
  const HANGUL_FINAL = [
    "", "k", "k", "k", "n", "n", "n", "t", "l", "k", "m", "l", "l",
    "l", "p", "l", "m", "p", "p", "t", "t", "ng", "t", "t", "k",
    "t", "p", "h"
  ];

  function hasNonLatin(text) {
    const value = String(text || "");
    return (
      HANGUL.test(value) ||
      KANA.test(value) ||
      HAN.test(value) ||
      ARABIC.test(value) ||
      CYRILLIC.test(value) ||
      THAI.test(value)
    );
  }

  function romanizeChinese(text) {
    const P = window.pinyinPro;
    if (!P || typeof P.pinyin !== "function") return "";
    try {
      return String(
        P.pinyin(text, { toneType: "none", type: "string", nonZh: "consecutive" }) || ""
      )
        .replace(/\s+/g, " ")
        .trim();
    } catch (error) {
      return "";
    }
  }

  function romanizeJapanese(text) {
    let out = "";
    const chars = Array.from(String(text || ""));
    for (let i = 0; i < chars.length; i += 1) {
      let char = chars[i];
      const code = char.charCodeAt(0);
      // Katakana → hiragana.
      if (code >= 0x30a1 && code <= 0x30f6) {
        char = String.fromCharCode(code - 0x60);
      }

      if (char === "っ") {
        const next = chars[i + 1] || "";
        const nextKana = next.charCodeAt(0) >= 0x30a1 && next.charCodeAt(0) <= 0x30f6
          ? String.fromCharCode(next.charCodeAt(0) - 0x60)
          : next;
        const pair = KANA_ROMAJI[nextKana + (chars[i + 2] || "")];
        const base = pair || KANA_ROMAJI[nextKana] || "";
        const consonant = base.charAt(0);
        out += /[bcdfghjklmnpqrstvwxyz]/.test(consonant) ? consonant : "";
        continue;
      }

      if (char === "ー") {
        const vowel = out.match(/[aeiou](?!.*[aeiou])/);
        out += vowel ? vowel[0] : "";
        continue;
      }

      const pair = KANA_ROMAJI[char + (chars[i + 1] || "")];
      if (pair) {
        out += pair;
        i += 1;
        continue;
      }

      if (KANA_ROMAJI[char]) {
        out += KANA_ROMAJI[char];
        continue;
      }

      if (KANJI_ROMAJI[char]) {
        out += " " + KANJI_ROMAJI[char] + " ";
        continue;
      }

      out += char;
    }
    return out.replace(/\s+/g, " ").trim();
  }

  function romanizeKorean(text) {
    let out = "";
    const chars = Array.from(String(text || ""));
    chars.forEach((char) => {
      const code = char.charCodeAt(0);
      if (code >= 0xac00 && code <= 0xd7a3) {
        const index = code - 0xac00;
        const initial = Math.floor(index / 588);
        const medial = Math.floor((index % 588) / 28);
        const final = index % 28;
        out += HANGUL_INITIAL[initial] + HANGUL_MEDIAL[medial] + HANGUL_FINAL[final];
      } else {
        out += char;
      }
    });
    return out.replace(/\s+/g, " ").trim();
  }

  function romanizeArabic(text) {
    return Array.from(String(text || ""))
      .map((char) => {
        if (/[\u064b-\u065f\u0670\u06d6-\u06ed]/.test(char) || char === "\u0640") return "";
        return ARABIC_MAP[char] != null ? ARABIC_MAP[char] : char;
      })
      .join("")
      .replace(/\s+/g, " ")
      .trim();
  }

  function romanizeCyrillic(text) {
    return Array.from(String(text || ""))
      .map((char) => {
        const lower = char.toLowerCase();
        const mapped = CYRILLIC_MAP[lower];
        if (mapped == null) return char;
        if (char === lower) return mapped;
        return mapped.charAt(0).toUpperCase() + mapped.slice(1);
      })
      .join("");
  }

  function romanizeThai(text) {
    return Array.from(String(text || ""))
      .map((char) => {
        if (/[\u0e31\u0e34-\u0e3a\u0e47-\u0e4e]/.test(char)) {
          return THAI_MAP[char] != null ? THAI_MAP[char] : "";
        }
        return THAI_MAP[char] != null ? THAI_MAP[char] : char;
      })
      .join("")
      .replace(/\s+/g, " ")
      .trim();
  }

  function romanize(text) {
    const value = String(text || "");
    if (!value || !hasNonLatin(value)) return "";
    let out = "";
    if (HANGUL.test(value)) out = romanizeKorean(value);
    else if (KANA.test(value)) out = romanizeJapanese(value);
    else if (HAN.test(value)) out = romanizeChinese(value);
    else if (ARABIC.test(value)) out = romanizeArabic(value);
    else if (CYRILLIC.test(value)) out = romanizeCyrillic(value);
    else if (THAI.test(value)) out = romanizeThai(value);
    const clean = out.replace(/\s+/g, " ").trim();
    if (!clean || clean === value) return "";
    return clean;
  }

  AM.Romanize = {
    hasNonLatin,
    romanize
  };
})(window.AM = window.AM || {});
