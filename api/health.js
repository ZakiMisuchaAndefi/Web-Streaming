module.exports = (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({
    innertube: true,
    ytdlp: false,
    ffmpeg: false,
    mp3: false,
    downloads: false,
    // Di Vercel, audio YouTube diputar lewat IFrame API resmi di browser
    // karena permintaan video dari IP datacenter diblokir YouTube.
    engine: "iframe"
  });
};
