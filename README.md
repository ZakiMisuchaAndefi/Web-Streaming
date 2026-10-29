# Musik

Pemutar musik bergaya Apple Music yang dibuat dengan HTML, CSS, dan JavaScript murni. Koleksi lokal tetap berada di perangkatmu — tidak ada server cloud, tidak ada unggahan, dan tidak ada akun. Kamu juga bisa memutar musik langsung dari internet tanpa mengimpor file.

Tema gelap dan terang dengan aksen merah khas Apple Music, lengkap dengan sampul prosedural untuk lagu tanpa artwork.

## Fitur

- **Perpustakaan pribadi** — impor MP3, M4A, FLAC, WAV, OGG, dan format audio lain yang didukung browser.
- **Impor fleksibel** — pilih beberapa file, pilih satu folder, atau seret file ke jendela aplikasi.
- **Metadata otomatis** — judul, artis, album, genre, tahun, nomor trek, dan sampul tertanam dibaca dari tag ID3, Vorbis, MP4, atau RIFF INFO.
- **Tersimpan lokal** — file audio dan sampul disimpan di IndexedDB browser, jadi tetap ada setelah halaman ditutup.
- **Pemutar lengkap** — putar, jeda, sebelumnya/berikutnya, geser posisi, volume, acak, ulangi semua/satu lagu, dan antrean.
- **Lanjut setelah muat ulang** — lagu, posisi, antrean, volume, acak, dan mode ulangi dipulihkan saat halaman dibuka lagi; pemutaran dimulai dalam keadaan jeda.
- **Riwayat pemutaran** — lagu yang diputar minimal 30 detik (atau selesai jika lebih pendek) masuk ke halaman **Riwayat**, terbaru di atas. Memutar ulang memindahkannya ke atas tanpa duplikat.
- **Musik dari YouTube tanpa impor** — cari lagu di YouTube lewat halaman **Pencarian** dengan kata kunci atau tempel tautan videonya; diputar sebagai audio lewat `yt-dlp` di server lokal, tanpa API key.
- **Pencarian langsung** — kotak pencarian mencari perpustakaan dan YouTube sekaligus dalam satu halaman.
- **Suka lintas sumber** — lagu lokal dan lagu YouTube sama-sama bisa ditandai hati. Lagu YouTube yang disukai tersimpan di perangkat ini dan tetap muncul di halaman **Suka** setelah halaman dimuat ulang.
- **Unduhan MP3** — simpan lagu YouTube sebagai `.mp3` dengan metadata judul, artis, album, dan sampul tertanam. Membutuhkan `ffmpeg.exe`.
- **Impor ke playlist** — impor file langsung dari halaman playlist; lagu baru masuk ke perpustakaan dan playlist sekaligus, sedangkan lagu yang sudah ada tetap ditambahkan ke playlist tanpa menduplikasi perpustakaan.
- **Timer tidur** — hentikan pemutaran setelah 5, 10, 15, 30, 45, atau 60 menit, atau di akhir lagu; volume menurun perlahan sebelum jeda.
- **Lirik tertanam** — lirik dari tag audio (ID3 `USLT`/`SYLT`, Vorbis `LYRICS`, MP4 `©lyr`) tampil di panel samping. Lirik LRC disinkronkan, disorot, dan digulir otomatis; teks biasa tampil sebagai fallback.
- **Romanisasi lirik** — baris non-Latin (Han, Hangul, kana, Arab, Kiril, Thai) otomatis diberi transliterasi di bawah baris aslinya. Diproses lokal, tanpa API berbayar.
- **Beranda streaming** — menu utama langsung menampilkan rekomendasi lagu, stasiun radio, dan lagu populer yang bisa diputar sekali klik, tanpa perlu impor.
- **Media Session** — kontrol pemutaran muncul di pusat media sistem saat browser mendukung.
- **Playlist & favorit** — buat playlist, tambahkan lagu dari menu konteks, ganti nama, hapus, dan tandai lagu favorit.
- **Jelajahi koleksi** — Jelajahi, Radio, Terbaru, Artis, Album, Lagu, Suka, genre, pencarian, dan halaman detail.
- **Tema** — gelap dan terang, dapat diganti dari sidebar atau halaman **Pengaturan**.
- **Pengaturan terpusat** — halaman khusus dengan nav bertanda ikon + teks, berisi tampilan, pemutaran, audio, data, dan info penyimpanan dalam satu kolom.
- **Perpustakaan demo** — 12 lagu yang dibuat secara prosedural untuk mencoba semua fitur tanpa file pribadi.
- **Responsif** — sidebar berubah menjadi laci di tablet, dan tata letak ponsel tetap nyaman digunakan.
- **Pintasan keyboard** — kendalikan pemutaran dan pencarian tanpa meninggalkan keyboard.

## Menjalankan

### Windows — cara termudah

Klik dua kali **`Jalankan.bat`**. Skrip akan menyalakan server lokal di `http://127.0.0.1:4173/` dan membuka browser. Jendela PowerShell server diminimalkan; tutup jendela itu untuk menghentikan server.

### Manual dengan PowerShell

```powershell
cd "C:\Users\Kii\Documents\Default Project"
powershell -NoProfile -ExecutionPolicy Bypass -File .\server.ps1
```

Lalu buka **http://127.0.0.1:4173/**.

Tekan `Ctrl+C` di jendela PowerShell untuk menghentikan server.

> **Penting:** jalankan lewat server lokal agar IndexedDB aktif dan koleksi tersimpan permanen. Membuka `index.html` langsung lewat `file://` masih bisa dipakai, tetapi browser dapat menonaktifkan penyimpanan sehingga koleksi hanya bertahan selama tab terbuka.

### Endpoint server lokal

`server.ps1` hanya mendengarkan di `127.0.0.1` dan menyediakan:

| Endpoint | Fungsi |
| --- | --- |
| `GET /api/health` | Status `yt-dlp`, `ffmpeg`, `mp3`, dan unduhan. |
| `GET /api/resolve?id=VIDEO_ID&quality=high` | URL audio langsung dari YouTube (di-cache per video + kualitas). |
| `GET /api/radio?id=VIDEO_ID` | Daftar lagu radio YouTube untuk lagu terkait. |
| `GET /api/download?id=VIDEO_ID&quality=best&title=...` | Memulai job unduhan latar; mengembalikan `jobId`. |
| `GET /api/download-status?job=JOB_ID` | Status job: `running`, `done`, atau `error`. |
| `GET /api/download-file?job=JOB_ID` | Mengirim file hasil unduhan sebagai lampiran. |

## Beranda streaming

Halaman **Dengarkan Sekarang** tidak lagi hanya menampilkan perpustakaan lokal. Saat dibuka, aplikasi mencari saran lagu dari YouTube lalu menampilkan:

- **Ubin cepat** — Rekomendasi harian, Lagu galau, Akustik santai, Nostalgia 80–90an, Dangdut koplo, dan Pop internasional. Klik satu ubin untuk langsung memutar hasilnya.
- **Rekomendasi untukmu** — delapan lagu pilihan; tombol putar muncul saat kartu diarahkan kursor.
- **Stasiun untukmu** — radio yang dimulai dari sebuah lagu dan berjalan otomatis.
- **Lagu populer hari ini** — daftar lagu yang bisa diputar satu per satu atau sekaligus.
- **Bagian perpustakaan** — album baru, lagu yang terakhir diputar, mix genre, dan lagu Suka tetap tampil di bawahnya bila kamu sudah mengimpor musik.

Rekomendasi memakai pencarian YouTube yang sama dengan halaman **Pencarian**, jadi tidak perlu API key. Hasilnya disimpan sementara di tab (30 menit) supaya beranda tidak mencari ulang setiap kali dibuka. Tombol **Putar rekomendasi** dan **Acak** memutar seluruh daftar; setelah lagu terakhir, radio otomatis menambahkan lagu serupa seperti autoplay YouTube Music/Spotify.

## Mengimpor musik

1. Klik **Impor musik** di sidebar atau tombol **Impor** di kanan atas.
2. Pilih **Pilih file**, **Pilih folder**, atau seret file ke jendela aplikasi.
3. Tunggu proses selesai. Ringkasan akan menampilkan jumlah lagu yang ditambahkan, dilewati, atau gagal.

Catatan:

- File dengan isi dan nama yang sama akan dilewati otomatis agar tidak duplikat.
- Dari halaman playlist, tombol **Impor file** menambahkan lagu baru ke perpustakaan **dan** playlist dalam satu langkah. Lagu yang sudah ada di perpustakaan tidak diduplikasi, tetapi tetap dimasukkan ke playlist.
- Dukungan kodek ditentukan oleh browser. Edge/Chrome umumnya mendukung MP3, AAC/M4A, FLAC, WAV, dan Opus/OGG; Safari memiliki dukungan kodek yang berbeda.
- Sampul album diambil dari artwork yang tertanam di file. Jika tidak ada, aplikasi membuat sampul bergradasi secara otomatis.
- Format file yang tidak didukung akan dilewati dan dilaporkan di ringkasan impor.
- File asli tidak diubah atau dipindahkan.

## Pencarian

Kotak pencarian — tombol **Cari** di sidebar, ikon cari di bilah atas, atau pintasan `/` — langsung mencari di perpustakaan **dan** YouTube dalam satu halaman.

- Hasil perpustakaan muncul di bagian **Di perpustakaanmu**.
- Setelah berhenti mengetik ±0,4 detik (minimal 2 huruf), aplikasi otomatis mencari di YouTube dan menampilkan bagian **Dari YouTube**. Lagu di sana bisa langsung diputar, disukai lewat ikon hati, dibuka menunya (`⋯`), atau diunduh.
- Tekan **Enter** untuk memutar hasil teratas. Jika perpustakaan tidak punya lagu yang cocok, Enter memutar hasil YouTube.
- Kalau yang kamu cari adalah **judul lagu** lalu memutar salah satu hasilnya, antrean dimulai dari lagu itu dan langsung diisi radio YouTube — bukan daftar unggahan lain yang judulnya sama. Kalau yang kamu cari adalah **nama artis**, hasil pencarian tetap menjadi antrean seperti biasa.
- Hasil YouTube tampil langsung di halaman ini; tidak ada halaman **Musik Online** terpisah.
- Kalau pencarian YouTube gagal, muncul tombol **Coba lagi**; hasil perpustakaan tetap tampil seperti biasa.
- Antrean dari hasil pencarian ini diberi label **Cari · YouTube** di panel antrean.

## Musik dari YouTube

Tidak perlu API key, akun, atau impor file. Cukup buka **Pencarian** dan ketik kata kunci, atau tempel tautan video.

| Sumber | Yang tersedia | Catatan |
| --- | --- | --- |
| **YouTube** | Streaming audio dari video YouTube | Cari dengan kata kunci, atau tempel tautan video (watch, youtu.be, Shorts, atau YouTube Music). Audio diambil lewat `yt-dlp.exe` lokal di `server.ps1` dan diputar dengan elemen audio biasa — tanpa tampilan video. |

### Cara memakai YouTube

1. Letakkan **`yt-dlp.exe`** di folder aplikasi (sejajar `server.ps1`). Unduh di <https://github.com/yt-dlp/yt-dlp/releases/latest>. Tanpa file ini, lagu YouTube tidak bisa diputar.
2. Buka **Pencarian**, lalu ketik judul lagu atau nama artis — atau tempel tautan video langsung. Bagian **Dari YouTube** muncul otomatis di bawah hasil perpustakaan.
3. Hasil pencarian bisa diputar lewat **Putar semua** atau **Acak**; satu video dari tautan langsung diputar sendiri.
4. Kendalikan dari bar pemutar aplikasi seperti biasa — putar/jeda, geser posisi, volume, antrean, acak, dan ulangi tetap berfungsi. Lagu YouTube tampil seperti lagu lain: hanya audio, tanpa video.
5. Saat sisa antrean tinggal ±5 lagu (dan ulangi = mati), aplikasi otomatis mengambil rekomendasi baru berdasarkan lagu yang sedang diputar lalu mengisi antrean sampai ±20 lagu. Sumbernya playlist Mix/Radio YouTube (`list=RD…`) yang diambil cepat lewat `--flat-playlist`, bukan pencarian judul — jadi lagu berikutnya berbeda judul tetapi mirip vibe, genre, era, dan bahasanya. Lagu yang ditambahkan manual tetap di atas rekomendasi otomatis.

Catatan:

- Pencarian memakai **instance API publik Piped** (sekumpulan instance diuji bergantian, hasilnya disimpan sementara 5 menit). Jika semua instance sedang tidak bisa diakses, coba lagi beberapa saat atau tempel tautan video langsung.
- Video yang tidak bisa diambil `yt-dlp` akan dilewati otomatis; aplikasi menawarkan tautan ke YouTube.
- Radio otomatis butuh `yt-dlp.exe` dan koneksi internet; hasilnya disimpan sementara agar tidak berulang kali mengambil daftar yang sama. Kandidat disaring: judul sama/mirip dengan lagu acuan dibuang, duplikat unggahan dirapikan, durasi wajib 1–10 menit, maksimal 2 lagu per artis dalam 10 lagu, dan artis yang sama tidak muncul dua kali berturut-turut. Cover, karaoke, dan remix dilewati kecuali lagu acuannya memang cover/remix.
- Tautan playlist bisa ditempel, tetapi hanya video utamanya yang diputar.

### Suka lagu YouTube

- Tekan ikon hati di bar pemutar atau di baris lagu untuk menyukai lagu YouTube. Hati yang menyala menandakan lagu tersimpan.
- Lagu YouTube yang disukai disimpan di `localStorage` (kunci `musik.online.likes.v1`) dan **tetap ada setelah halaman dimuat ulang**.
- Halaman **Suka** memisahkan dua bagian: **Dari perpustakaan** (favorit file lokal) dan **Dari YouTube** (lagu yang disukai dari internet). Tombol **Putar** dan **Acak** memutar keduanya dalam satu antrean.
- Menghapus hati pada lagu YouTube akan menghapusnya dari halaman **Suka**. Ini tidak memengaruhi file lokal atau playlist.

### Unduhan MP3

- Tekan tombol unduh di bar pemutar saat lagu YouTube diputar, atau pilih **Unduh audio** dari menu `⋯` pada baris lagu online.
- Hasil unduhan selalu berupa **`.mp3`**, dengan tag judul, artis, album, dan sampul tertanam.
- Kualitas unduhan mengikuti **Pengaturan → Audio → Kualitas unduhan**: **Hemat** (hingga 96 kbps), **Standar** (hingga 128 kbps), **Tinggi** (hingga 192 kbps), dan **Terbaik** (VBR terbaik yang didukung sumber).
- **`ffmpeg.exe` wajib ada** untuk konversi MP3. Letakkan di folder aplikasi, di `tools\ffmpeg\bin\ffmpeg.exe`, atau di `PATH`, lalu jalankan ulang server. Tanpa FFmpeg, tombol unduh menampilkan pesan yang jelas dan `/api/health` melaporkan `mp3: false`.
- Server menjalankan `yt-dlp` sebagai proses latar sehingga pemutaran tidak terhenti saat mengunduh. Setelah selesai, browser otomatis menawarkan file; jika tidak muncul, tekan **Simpan** pada notifikasi.
- File disimpan di folder **`downloads/`** di folder aplikasi dan dinamai `Judul [ID].mp3`. Server membersihkan file unduhan yang lebih lama dari 7 hari dan mengabaikan file `.webm` lama.
- **Lossless/FLAC tidak tersedia** karena sumber audio YouTube sudah berupa audio lossy. Tombol **Lossless** ditampilkan nonaktif dengan penjelasan ini.

### Kualitas streaming

- **Pengaturan → Audio → Kualitas streaming** mengatur bitrate audio YouTube yang diambil `yt-dlp`: **Hemat**, **Standar**, **Tinggi**, atau **Terbaik**.
- Jika diubah saat lagu YouTube sedang diputar, aplikasi membersihkan cache audio dan memuat ulang lagu pada posisi yang sama.

Umum:

- Lagu online tidak masuk ke perpustakaan lokal atau playlist. Yang bertahan setelah muat ulang adalah **antrean lokal** dan **daftar Suka dari YouTube**.
- Pemutaran online memerlukan koneksi internet. Jika penyedia sedang tidak dapat diakses, coba beberapa saat lagi.

### Kenapa bukan YouTube Data API atau Spotify?

Pemutaran YouTube di aplikasi ini memakai **resolver lokal `yt-dlp.exe`** yang dijalankan `server.ps1` (hanya mendengarkan di `127.0.0.1`), lalu URL audio hasilnya diputar dengan elemen `<audio>`. Aplikasi ini untuk **pemakaian pribadi di localhost**; tidak ada server Node/npm — semuanya PowerShell 5.1, HTML, CSS, dan JavaScript. Pencarian kata kunci melalui API publik Piped, bukan YouTube Data API, sehingga **tanpa API key sama sekali dan tanpa tampilan video**.

Pemutaran Spotify penuh juga memerlukan akun **Spotify Premium**, OAuth, dan Spotify Web Playback SDK — arsitektur yang berbeda dari pemutar `<audio>` ini.

## Riwayat pemutaran

- Lagu dicatat setelah diputar **minimal 30 detik**, atau saat selesai jika durasinya lebih pendek dari 30 detik.
- Halaman **Riwayat** menampilkan lagu terbaru di atas dan diperbarui langsung saat kamu memutar lagu.
- Memutar ulang lagu yang sudah ada akan memindahkannya ke atas, bukan membuat entri duplikat.
- Riwayat disimpan permanen di IndexedDB (maksimal 500 entri) dan mencakup lagu lokal maupun YouTube.
- Tombol **Hapus riwayat** membersihkan daftar tanpa menyentuh perpustakaan atau file asli.

## Timer tidur

- Buka dari tombol bulan di bar pemutar atau **Pengaturan → Pemutaran → Timer tidur**.
- Pilihan: **5, 10, 15, 30, 45, atau 60 menit**, atau **Akhir lagu**.
- Hitung mundur tampil di tombol pemutar dan di halaman Pengaturan.
- Saat waktu habis, volume menurun perlahan selama ±5 detik lalu pemutaran dijeda; volume awal dipulihkan otomatis.
- Pilih **Batalkan timer** untuk menghentikan hitung mundur kapan saja.

## Lirik & romanisasi

- Lirik dibaca dari tag audio: ID3 `USLT`/`SYLT`/`TXXX`, Vorbis `LYRICS`/`UNSYNCEDLYRICS`, dan MP4 `©lyr`.
- Buka panel lirik lewat tombol lirik di bar pemutar atau bilah atas.
- Lirik berformat **LRC** (`[mm:ss.xx]`) disinkronkan dengan pemutaran: baris aktif disorot dan panel menggulir otomatis. Ketuk baris untuk melompat ke waktunya.
- Lirik tanpa timestamp tampil sebagai teks biasa. Jika lagu tidak punya lirik, panel menampilkan **“Lirik tidak tersedia”** tanpa error.
- Baris dengan aksara non-Latin otomatis mendapat **transliterasi** di bawahnya: Han (pinyin), Hangul, kana/kanji Jepang, Arab/Persia, Kiril, dan Thai. Baris Latin tidak diberi transliterasi.
- Semua romanisasi diproses **lokal di browser** — tidak ada panggilan API atau layanan berbayar.

## Penyimpanan & privasi

- Data disimpan di **IndexedDB** milik browser, bukan di server.
- Kapasitas bergantung pada kuota browser (biasanya beberapa GB). Pengaturan menampilkan perkiraan pemakaian.
- Semua file lokal tetap di perangkat ini dan tidak pernah diunggah ke internet.
- Saat memakai pencarian YouTube, kata kunci pencarian atau tautan yang kamu tempel dan metadata video dikirim ke YouTube (via instance Piped dan oEmbed). URL audio diambil oleh `yt-dlp.exe` di komputer ini, lalu aliran audionya diunduh langsung dari server YouTube. Tidak ada data perpustakaan lokal yang ikut dikirim.
- **Daftar Suka dari YouTube** disimpan di `localStorage` browser. **File hasil unduhan** disimpan sebagai file biasa di folder `downloads/` dan tidak diunggah ke mana pun.
- **Pengaturan → Hapus semua data** menghapus lagu, sampul, playlist, dan favorit lokal dari aplikasi. File asli di folder musikmu dan file di folder `downloads/` tidak terhapus.
- Menghapus data situs di browser juga akan menghapus koleksi Musik, antrean, pengaturan, dan daftar Suka dari YouTube.

## Pintasan keyboard

| Tombol | Fungsi |
| --- | --- |
| `Space` | Putar / jeda |
| `←` / `→` | Geser 5 detik |
| `M` | Bisukan / bunyikan |
| `S` | Acak aktif/mati |
| `R` | Ganti mode ulangi |
| `L` | Sukai / batal sukai lagu yang diputar |
| `Q` | Buka / tutup antrean |
| `/` atau `Shift` + `/` | Buka pencarian |
| `Ctrl` + `K` / `⌘` + `K` | Buka pencarian |
| `Esc` | Tutup modal, menu, antrean, panel lirik, atau sidebar |

Pintasan selain `Esc` tidak aktif saat kamu sedang mengetik di kolom input.

## Struktur proyek

```text
.
├── index.html
├── Jalankan.bat
├── server.ps1
├── README.md
├── downloads/          # hasil unduhan MP3 YouTube (dibuat otomatis)
├── css/
│   ├── base.css        # variabel warna, tipografi, tombol, form
│   ├── layout.css      # kerangka aplikasi, topbar, area konten
│   ├── sidebar.css     # sidebar dan laci navigasi
│   ├── content.css     # hero, kartu, daftar lagu, pencarian
│   ├── player.css      # pemutar bawah, antrean, timer tidur, panel lirik
│   ├── overlays.css    # modal, menu konteks, toast, pengaturan
│   └── responsive.css  # tablet, ponsel, dan perangkat sentuh
└── js/
    ├── utils.js        # helper, format, sampul prosedural
    ├── vendor/
    │   └── pinyin-pro.js  # pustaka pinyin lokal (MIT)
    ├── romanize.js     # deteksi aksara + romanisasi lirik lokal
    ├── db.js           # pembungkus IndexedDB (termasuk riwayat)
    ├── metadata.js     # pembaca tag audio dan lirik tertanam
    ├── demo.js         # generator perpustakaan demo
    ├── online.js       # sumber musik online (YouTube), cache & daftar Suka
    ├── youtube.js      # pencarian YouTube + resolver audio yt-dlp
    ├── downloads.js    # unduhan MP3 YouTube lewat job server
    ├── home.js         # feed streaming untuk beranda
    ├── library.js      # state perpustakaan, impor, playlist, riwayat
    ├── player.js       # antrean, pemutaran, snapshot, timer tidur
    ├── ui.js           # modal, menu, toast, prompt
    ├── views.js        # renderer setiap halaman
    └── app.js          # router, event, impor, pengaturan, lirik
```

## Tips

- Gunakan **Jelajahi** untuk melihat genre dan album, atau **Radio** untuk memutar stasiun acak dari genre tertentu.
- Klik ikon putar di kolom nomor, atau klik judul lagu, untuk mulai memutar.
- Buka album lewat nama album di baris lagu atau melalui menu konteks.
- Klik kanan (atau tombol `⋯`) pada baris lagu untuk membuka aksi cepat.
- Tekan `Ctrl` + `K` dari halaman mana pun untuk langsung mencari.
- Ketik langsung di kotak pencarian untuk mencari di perpustakaan sekaligus YouTube — semuanya di satu halaman **Pencarian**.
- Untuk koleksi besar, impor per folder agar mudah dilacak. Proses durasi berjalan otomatis di latar belakang.
- Di **Pencarian**, gunakan kata kunci singkat (judul/artis) atau tempel tautan video agar hasil lebih relevan.
- Lagu online bisa diputar bersamaan dengan lagu lokal dalam satu antrean.
- Buka panel lirik saat lagu diputar; jika liriknya LRC, baris aktif akan mengikuti posisi lagu.
- Gunakan timer tidur sebelum tidur agar pemutaran berhenti sendiri tanpa perlu membuka aplikasi.

## Kompatibilitas

Diuji pada Microsoft Edge di Windows. Aplikasi juga berjalan di browser modern lain yang mendukung IndexedDB, File API, dan elemen `<audio>`. Tampilan memakai font sistem. Musik lokal tidak memerlukan internet; pemutaran dan pencarian YouTube memerlukan koneksi internet.

## Lisensi

Proyek ini dibuat untuk penggunaan pribadi. Lagu demo dihasilkan secara prosedural oleh aplikasi dan bukan rekaman berhak cipta. Video yang diputar lewat YouTube tetap milik pencipta dan pemegang haknya; aplikasi hanya menautkan ke aliran resmi dari penyedia tersebut.

Romanisasi Han memakai [pinyin-pro](https://github.com/zh-lx/pinyin-pro) 3.26.0 (lisensi MIT), dibundel lokal di `js/vendor/pinyin-pro.js`. Pustaka lain adalah kode proyek ini sendiri.
