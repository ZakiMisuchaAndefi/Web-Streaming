module.exports = (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ ytdlp: true, ffmpeg: false, mp3: false, downloads: false });
};
