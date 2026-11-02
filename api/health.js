module.exports = (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ innertube: true, ytdlp: false, ffmpeg: false, mp3: false, downloads: false });
};
