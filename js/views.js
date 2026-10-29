/* ==========================================================================
   views.js — semua tampilan halaman & komponen daftar lagu
   ========================================================================== */

(function (AM) {
  "use strict";

  const U = AM.Utils;
  const L = AM.Library;

  /* ------------------------------------------------------------------------
     Helper umum
     ------------------------------------------------------------------------ */

  function esc(value) {
    return U.esc(value);
  }

  function icon(name, className) {
    return U.svgIcon(name, className);
  }

  function plural(count, word) {
    return count + " " + word;
  }

  function totalDuration(tracks) {
    return (tracks || []).reduce((sum, track) => sum + (track.duration || 0), 0);
  }

  function trackTime(track) {
    return track && track.duration ? U.fmtTime(track.duration) : "--:--";
  }

  function pageHead(title, options) {
    const opts = options || {};
    return (
      '<header class="page-head">' +
      '<div class="page-head__text">' +
      (opts.eyebrow ? '<p class="page-head__eyebrow eyebrow">' + esc(opts.eyebrow) + "</p>" : "") +
      "<h1>" +
      esc(title) +
      "</h1>" +
      (opts.sub ? '<p class="page-head__sub">' + opts.sub + "</p>" : "") +
      "</div>" +
      (opts.actions ? '<div class="page-head__actions">' + opts.actions + "</div>" : "") +
      "</header>"
    );
  }

  function section(title, body, options) {
    const opts = options || {};
    return (
      '<section class="section' +
      (opts.tight ? " section--tight" : "") +
      '">' +
      '<div class="section__head">' +
      "<div>" +
      '<h2 class="section__title">' +
      esc(title) +
      "</h2>" +
      (opts.sub ? '<p class="section__sub">' + esc(opts.sub) + "</p>" : "") +
      "</div>" +
      (opts.actions ? '<div class="section__actions">' + opts.actions + "</div>" : "") +
      "</div>" +
      body +
      "</section>"
    );
  }

  function emptyState(options) {
    const opts = options || {};
    return (
      '<div class="empty' +
      (opts.inline ? " empty--inline" : "") +
      '">' +
      '<span class="empty__icon">' +
      icon(opts.icon || "music") +
      "</span>" +
      "<h2>" +
      esc(opts.title || "Belum ada apa-apa di sini") +
      "</h2>" +
      (opts.text ? "<p>" + esc(opts.text) + "</p>" : "") +
      (opts.actions ? '<div class="empty__actions">' + opts.actions + "</div>" : "") +
      "</div>"
    );
  }

  function playButton(label, action, attributes, primary) {
    return (
      '<button class="btn ' +
      (primary === false ? "btn--secondary" : "btn--primary") +
      '" type="button" data-action="' +
      esc(action) +
      '" ' +
      (attributes || "") +
      ">" +
      icon("play") +
      "<span>" +
      esc(label) +
      "</span>" +
      "</button>"
    );
  }

  function shuffleButton(label, action, attributes) {
    return (
      '<button class="btn btn--secondary" type="button" data-action="' +
      esc(action) +
      '" ' +
      (attributes || "") +
      ">" +
      icon("shuffle") +
      "<span>" +
      esc(label) +
      "</span></button>"
    );
  }

  function artStyle(url) {
    return " style=\"--art:url('" + esc(url) + "')\"";
  }

  function queueAttrs(queue) {
    const q = queue || {};
    let attrs = ' data-queue-type="' + esc(q.type || "track") + '"';
    if (q.key != null) attrs += ' data-queue-key="' + esc(q.key) + '"';
    if (q.query != null) attrs += ' data-query="' + esc(q.query) + '"';
    if (q.provider != null) attrs += ' data-queue-provider="' + esc(q.provider) + '"';
    if (q.label != null) attrs += ' data-queue-label="' + esc(q.label) + '"';
    return attrs;
  }

  /* ------------------------------------------------------------------------
     Kartu
     ------------------------------------------------------------------------ */

  function albumCard(album) {
    return (
      '<article class="card" data-action="open-album" data-key="' +
      esc(album.key) +
      '" tabindex="0" role="button" aria-label="' +
      esc(album.name + " oleh " + album.artist) +
      '">' +
      '<div class="card__art">' +
      '<img src="' +
      esc(L.albumArt(album)) +
      '" alt="" loading="lazy" draggable="false">' +
      '<button class="card__play" type="button" data-action="play-album" data-key="' +
      esc(album.key) +
      '" title="Putar album" aria-label="Putar ' +
      esc(album.name) +
      '">' +
      icon("play") +
      "</button>" +
      "</div>" +
      '<div class="card__text">' +
      '<div class="card__title">' +
      esc(album.name) +
      "</div>" +
      '<div class="card__sub">' +
      esc(album.artist) +
      (album.year ? " · " + esc(album.year) : "") +
      "</div>" +
      "</div>" +
      "</article>"
    );
  }

  function artistCard(artist) {
    return (
      '<article class="card card--artist" data-action="open-artist" data-key="' +
      esc(artist.key) +
      '" tabindex="0" role="button" aria-label="' +
      esc(artist.name) +
      '">' +
      '<div class="card__art">' +
      '<img src="' +
      esc(L.artistArt(artist)) +
      '" alt="" loading="lazy" draggable="false">' +
      '<button class="card__play" type="button" data-action="shuffle-artist" data-key="' +
      esc(artist.key) +
      '" title="Acak artis" aria-label="Acak ' +
      esc(artist.name) +
      '">' +
      icon("shuffle") +
      "</button>" +
      "</div>" +
      '<div class="card__text">' +
      '<div class="card__title">' +
      esc(artist.name) +
      "</div>" +
      '<div class="card__sub">' +
      (artist.albumCount ? plural(artist.albumCount, "album") : plural(artist.tracks.length, "lagu")) +
      "</div>" +
      "</div>" +
      "</article>"
    );
  }

  function playlistCard(playlist) {
    const tracks = L.playlistTracks(playlist);
    return (
      '<article class="card" data-action="open-playlist" data-key="' +
      esc(playlist.id) +
      '" tabindex="0" role="button" aria-label="' +
      esc(playlist.name) +
      '">' +
      '<div class="card__art">' +
      '<img src="' +
      esc(L.playlistArt(playlist)) +
      '" alt="" loading="lazy" draggable="false">' +
      '<button class="card__play" type="button" data-action="play-playlist" data-key="' +
      esc(playlist.id) +
      '" title="Putar playlist" aria-label="Putar ' +
      esc(playlist.name) +
      '">' +
      icon("play") +
      "</button>" +
      "</div>" +
      '<div class="card__text">' +
      '<div class="card__title">' +
      esc(playlist.name) +
      "</div>" +
      '<div class="card__sub">' +
      plural(tracks.length, "lagu") +
      "</div>" +
      "</div>" +
      "</article>"
    );
  }

  function mixCard(mix) {
    const palette = U.paletteFor(mix.title);
    return (
      '<article class="mix-card" data-action="play-genre" data-key="' +
      esc(mix.genre) +
      '" tabindex="0" role="button" aria-label="Putar ' +
      esc(mix.title) +
      '">' +
      '<div class="mix-card__art" style="--mix-a:' +
      palette[0] +
      ";--mix-b:" +
      palette[1] +
      '">' +
      '<span class="mix-card__kicker">' +
      esc(mix.kicker || "MIX") +
      "</span>" +
      '<div class="mix-card__title">' +
      esc(mix.title) +
      "</div>" +
      '<div class="mix-card__foot">' +
      "<span>" +
      esc(mix.sub || "") +
      "</span>" +
      '<span class="mix-card__play">' +
      icon("play") +
      "</span>" +
      "</div>" +
      "</div>" +
      "</article>"
    );
  }

  function artistRow(artist) {
    return (
      '<button class="artist-row" type="button" data-action="open-artist" data-key="' +
      esc(artist.key) +
      '">' +
      '<span class="artist-row__art"><img src="' +
      esc(L.artistArt(artist)) +
      '" alt="" loading="lazy" draggable="false"></span>' +
      '<span class="artist-row__text">' +
      '<span class="artist-row__name">' +
      esc(artist.name) +
      "</span>" +
      '<span class="artist-row__meta">' +
      plural(artist.albumCount, "album") +
      " · " +
      plural(artist.tracks.length, "lagu") +
      "</span>" +
      "</span>" +
      icon("chevron-right", "artist-row__chev") +
      "</button>"
    );
  }

  function genreTile(genre) {
    const palette = U.paletteFor(genre.name);
    return (
      '<button class="tile" type="button" data-action="open-genre" data-key="' +
      esc(genre.name) +
      '" style="--tile-a:' +
      palette[0] +
      ";--tile-b:" +
      palette[1] +
      '">' +
      '<span class="tile__icon">' +
      icon("music") +
      "</span>" +
      '<span class="tile__name">' +
      esc(genre.name) +
      "</span>" +
      '<span class="tile__meta">' +
      plural(genre.count, "lagu") +
      "</span>" +
      "</button>"
    );
  }

  function stationCard(genre) {
    const palette = U.paletteFor("radio-" + genre.name);
    return (
      '<button class="station" type="button" data-action="shuffle-genre" data-key="' +
      esc(genre.name) +
      '" style="--tile-a:' +
      palette[0] +
      ";--tile-b:" +
      palette[1] +
      '">' +
      '<span class="station__top">' +
      '<span class="station__badge">' +
      icon("radio") +
      "Stasiun</span>" +
      '<span class="station__play">' +
      icon("play") +
      "</span>" +
      "</span>" +
      "<span>" +
      '<span class="station__name">Radio ' +
      esc(genre.name) +
      "</span>" +
      '<span class="station__meta">' +
      plural(genre.count, "lagu") +
      " · acak tanpa henti</span>" +
      "</span>" +
      "</button>"
    );
  }

  /* ------------------------------------------------------------------------
     Daftar lagu
     ------------------------------------------------------------------------ */

  function sortHeaderCell(label, field, options) {
    const className = "th-" + field;
    if (!options.sortable) return '<span class="' + className + '">' + esc(label) + "</span>";
    const sorted = options.sort === field;
    return (
      '<span class="' +
      className +
      '"><button class="th-sort' +
      (sorted ? " is-sorted" : "") +
      '" type="button" data-action="sort-songs" data-sort="' +
      esc(field) +
      '">' +
      esc(label) +
      icon("chevron-down") +
      "</button></span>"
    );
  }

  function trackRow(track, index, options) {
    const opts = options || {};
    const playerState = AM.Player.state;
    const current = playerState.currentId === track.id;
    const playing = current && playerState.isPlaying;
    const query = opts.query || "";
    const numbering =
      opts.numbering === "track" && track.trackNo
        ? track.trackNo
        : String(index + 1);
    const mobileParts = [];
    if (opts.showArtist !== false) mobileParts.push(track.artist);
    else if (opts.showAlbum !== false) mobileParts.push(track.album);
    const mobileSub = mobileParts.filter(Boolean).join(" · ");
    return (
      '<div class="track-row' +
      (current ? " is-current" : "") +
      (playing ? " is-playing" : "") +
      '" data-track-id="' +
      esc(track.id) +
      '"' +
      queueAttrs(opts.queue) +
      (opts.playlistId ? ' data-playlist-id="' + esc(opts.playlistId) + '"' : "") +
      ' role="row">' +
      '<div class="track-row__index">' +
      '<span class="track-row__num">' +
      esc(numbering) +
      "</span>" +
      '<button class="track-row__index-play" type="button" data-action="play-track" data-id="' +
      esc(track.id) +
      '" title="Putar ' +
      esc(track.title) +
      '" aria-label="Putar ' +
      esc(track.title) +
      '">' +
      icon("play") +
      "</button>" +
      '<span class="track-row__eq" aria-hidden="true"><i></i><i></i><i></i></span>' +
      "</div>" +
      '<div class="track-row__title-cell">' +
      '<div class="track-row__art"><img src="' +
      esc(L.trackArt(track)) +
      '" alt="" loading="lazy" draggable="false"></div>' +
      '<div class="track-row__text">' +
      '<button class="track-row__name" type="button" data-action="play-track" data-id="' +
      esc(track.id) +
      '" title="' +
      esc(track.title) +
      '">' +
      (query ? U.highlight(track.title, query) : esc(track.title)) +
      "</button>" +
      (mobileSub ? '<div class="track-row__mobile-sub">' + esc(mobileSub) + "</div>" : "") +
      "</div>" +
      "</div>" +
      (opts.showArtist === false
        ? ""
        : '<div class="track-row__artist"><button type="button" data-action="open-artist" data-key="' +
          esc(track.artistKey) +
          '" title="' +
          esc(track.artist) +
          '">' +
          (query ? U.highlight(track.artist, query) : esc(track.artist)) +
          "</button></div>") +
      (opts.showAlbum === false
        ? ""
        : '<div class="track-row__album"><button type="button" data-action="open-album" data-key="' +
          esc(track.albumKey) +
          '" title="' +
          esc(track.album || "Singel") +
          '">' +
          (query ? U.highlight(track.album || "Singel", query) : esc(track.album || "Singel")) +
          "</button></div>") +
      '<div class="track-row__time">' +
      trackTime(track) +
      "</div>" +
      '<button class="icon-btn track-row__like' +
      (track.liked ? " is-liked" : "") +
      '" type="button" data-action="toggle-like" data-id="' +
      esc(track.id) +
      '" title="' +
      (track.liked ? "Hapus dari suka" : "Sukai") +
      '" aria-label="' +
      (track.liked ? "Hapus dari suka" : "Sukai") +
      '" aria-pressed="' +
      (track.liked ? "true" : "false") +
      '">' +
      icon(track.liked ? "heart-fill" : "heart") +
      "</button>" +
      '<button class="icon-btn track-row__more" type="button" data-action="track-menu" data-id="' +
      esc(track.id) +
      '" title="Opsi lain" aria-label="Opsi lain untuk ' +
      esc(track.title) +
      '">' +
      icon("more") +
      "</button>" +
      "</div>"
    );
  }

  function tracklist(tracks, options) {
    const opts = Object.assign({ showArtist: true, showAlbum: true }, options || {});
    const rows = tracks || [];
    const titleOnly = opts.showArtist === false && opts.showAlbum === false;
    const noAlbum = opts.showAlbum === false && !titleOnly;
    const noArtist = opts.showArtist === false && !titleOnly;
    let variant = "";
    if (titleOnly) variant = " tracklist--title-only";
    else if (noAlbum) variant = " tracklist--no-album";
    else if (noArtist) variant = " tracklist--no-artist";

    let head =
      '<span class="th-index">#</span>' +
      sortHeaderCell("Judul", "title", opts);
    if (opts.showArtist !== false) head += sortHeaderCell("Artis", "artist", opts);
    if (opts.showAlbum !== false) head += sortHeaderCell("Album", "album", opts);
    head +=
      '<span class="th-time">' +
      (opts.sortable
        ? '<button class="th-sort' +
          (opts.sort === "duration" ? " is-sorted" : "") +
          '" type="button" data-action="sort-songs" data-sort="duration">Waktu' +
          icon("chevron-down") +
          "</button>"
        : "Waktu") +
      "</span>" +
      '<span class="th-like"></span><span class="th-more"></span>';

    if (!rows.length) {
      return (
        '<div class="tracklist' +
        variant +
        '"><div class="tracklist__head">' +
        head +
        '</div><div class="tracklist-empty">Belum ada lagu di sini.</div></div>'
      );
    }

    return (
      '<div class="tracklist' +
      variant +
      '" role="table" aria-label="Daftar lagu">' +
      '<div class="tracklist__head' +
      (opts.sortable ? "" : " tracklist__head--plain") +
      '" role="row">' +
      head +
      "</div>" +
      rows.map((track, index) => trackRow(track, index, opts)).join("") +
      "</div>"
    );
  }

  /* ------------------------------------------------------------------------
     Daftar lagu online
     ------------------------------------------------------------------------ */

  function onlineBadge(track) {
    return (
      '<span class="online-badge online-badge--youtube" title="Video streaming dari YouTube">' +
      "Video</span>"
    );
  }

  function onlineTrackRow(track, index, options) {
    const opts = options || {};
    const playerState = AM.Player.state;
    const current = playerState.currentId === track.id;
    const playing = current && playerState.isPlaying;
    const query = opts.query || "";
    const mobileSub = track.artist;
    return (
      '<div class="track-row track-row--online' +
      (current ? " is-current" : "") +
      (playing ? " is-playing" : "") +
      '" data-track-id="' +
      esc(track.id) +
      '"' +
      queueAttrs(opts.queue) +
      ' role="row">' +
      '<div class="track-row__index">' +
      '<span class="track-row__num">' +
      esc(String(index + 1)) +
      "</span>" +
      '<button class="track-row__index-play" type="button" data-action="play-track" data-id="' +
      esc(track.id) +
      '" title="Putar ' +
      esc(track.title) +
      '" aria-label="Putar ' +
      esc(track.title) +
      '">' +
      icon("play") +
      "</button>" +
      '<span class="track-row__eq" aria-hidden="true"><i></i><i></i><i></i></span>' +
      "</div>" +
      '<div class="track-row__title-cell">' +
      '<div class="track-row__art"><img src="' +
      esc(L.trackArt(track)) +
      '" alt="" loading="lazy" draggable="false"></div>' +
      '<div class="track-row__text">' +
      '<button class="track-row__name" type="button" data-action="play-track" data-id="' +
      esc(track.id) +
      '" title="' +
      esc(track.title) +
      '">' +
      (query ? U.highlight(track.title, query) : esc(track.title)) +
      "</button>" +
      '<div class="track-row__mobile-sub">' +
      esc(mobileSub) +
      "</div>" +
      "</div>" +
      "</div>" +
      '<div class="track-row__artist"><span title="' +
      esc(track.artist) +
      '">' +
      (query ? U.highlight(track.artist, query) : esc(track.artist)) +
      "</span></div>" +
      '<div class="track-row__album">' +
      onlineBadge(track) +
      '<span class="online-badge__label">' +
      esc(track.providerLabel || "YouTube") +
      "</span></div>" +
      '<div class="track-row__time">' +
      trackTime(track) +
      "</div>" +
      '<button class="icon-btn track-row__like' +
      (track.liked ? " is-liked" : "") +
      '" type="button" data-action="toggle-like" data-id="' +
      esc(track.id) +
      '" title="' +
      (track.liked ? "Hapus dari suka" : "Sukai") +
      '" aria-label="' +
      (track.liked ? "Hapus dari suka" : "Sukai") +
      '" aria-pressed="' +
      (track.liked ? "true" : "false") +
      '">' +
      icon(track.liked ? "heart-fill" : "heart") +
      "</button>" +
      '<button class="icon-btn track-row__more" type="button" data-action="online-menu" data-id="' +
      esc(track.id) +
      '" title="Opsi lain" aria-label="Opsi lain untuk ' +
      esc(track.title) +
      '">' +
      icon("more") +
      "</button>" +
      "</div>"
    );
  }

  function onlineTracklist(tracks, options) {
    const opts = options || {};
    const rows = tracks || [];
    const head =
      '<span class="th-index">#</span>' +
      '<span class="th-title">Judul</span>' +
      '<span class="th-artist">Artis</span>' +
      '<span class="th-album">Sumber</span>' +
      '<span class="th-time">Waktu</span>' +
      '<span class="th-like"></span>' +
      '<span class="th-more"></span>';
    return (
      '<div class="tracklist tracklist--online" role="table" aria-label="Lagu online">' +
      '<div class="tracklist__head tracklist__head--plain" role="row">' +
      head +
      "</div>" +
      rows.map((track, index) => onlineTrackRow(track, index, opts)).join("") +
      "</div>"
    );
  }

  function trackSection(title, tracks, queue, options) {
    if (!tracks || !tracks.length) return "";
    const opts = options || {};
    return section(
      title,
      tracklist(
        tracks,
        Object.assign(
          {
            queue,
            showAlbum: opts.showAlbum !== false,
            showArtist: opts.showArtist !== false
          },
          opts
        )
      ),
      { actions: opts.actions, sub: opts.sub }
    );
  }

  /* ------------------------------------------------------------------------
     Hero & detail
     ------------------------------------------------------------------------ */

  function mosaicArt(tracks, fallbackSeed, label) {
    const covers = (tracks || []).filter((track) => track.coverId).slice(0, 4);
    if (!covers.length) {
      return '<img src="' + esc(U.generatedArt(fallbackSeed, { label: label })) + '" alt="" draggable="false">';
    }
    if (covers.length === 1) {
      return (
        '<div class="mosaic mosaic--1"><img src="' +
        esc(L.coverURL(covers[0].coverId)) +
        '" alt="" draggable="false"></div>'
      );
    }
    return (
      '<div class="mosaic mosaic--' +
      Math.min(covers.length, 4) +
      '">' +
      covers
        .map((track) => '<img src="' + esc(L.coverURL(track.coverId)) + '" alt="" draggable="false">')
        .join("") +
      "</div>"
    );
  }

  function albumHero(album) {
    return (
      '<section class="detail-hero"' +
      artStyle(L.albumArt(album)) +
      ">" +
      '<div class="detail-hero__bg"></div><div class="detail-hero__scrim"></div>' +
      '<div class="detail-hero__inner">' +
      '<div class="detail-hero__art"><img src="' +
      esc(L.albumArt(album)) +
      '" alt="Sampul ' +
      esc(album.name) +
      '" draggable="false"></div>' +
      '<div class="detail-hero__info">' +
      '<p class="detail-hero__type eyebrow">Album</p>' +
      "<h1>" +
      esc(album.name) +
      "</h1>" +
      '<div class="detail-hero__meta">' +
      '<button class="link-btn" type="button" data-action="open-artist" data-key="' +
      esc(album.artistKey) +
      '">' +
      esc(album.artist) +
      "</button>" +
      (album.year ? '<span class="dot">' + esc(album.year) + "</span>" : "") +
      '<span class="dot">' +
      plural(album.tracks.length, "lagu") +
      "</span>" +
      '<span class="dot">' +
      U.fmtLongDuration(album.duration) +
      "</span>" +
      "</div>" +
      '<div class="detail-hero__actions">' +
      '<button class="btn btn--primary" type="button" data-action="play-album" data-key="' +
      esc(album.key) +
      '">' +
      icon("play") +
      "<span>Putar</span></button>" +
      '<button class="btn btn--secondary" type="button" data-action="shuffle-album" data-key="' +
      esc(album.key) +
      '">' +
      icon("shuffle") +
      "<span>Acak</span></button>" +
      '<button class="icon-btn' +
      (album.tracks.every((track) => track.liked) ? " is-active" : "") +
      '" type="button" data-action="like-album" data-key="' +
      esc(album.key) +
      '" title="Sukai album" aria-label="Sukai album">' +
      icon(album.tracks.every((track) => track.liked) ? "heart-fill" : "heart") +
      "</button>" +
      '<button class="icon-btn" type="button" data-action="queue-album" data-key="' +
      esc(album.key) +
      '" title="Tambahkan ke antrean" aria-label="Tambahkan album ke antrean">' +
      icon("plus") +
      "</button>" +
      '<button class="icon-btn" type="button" data-action="album-menu" data-key="' +
      esc(album.key) +
      '" title="Opsi lain" aria-label="Opsi album">' +
      icon("more") +
      "</button>" +
      "</div>" +
      "</div></div></section>"
    );
  }

  function artistHero(artist) {
    const genres = artist.genres.slice(0, 2).join(", ");
    return (
      '<section class="detail-hero"' +
      artStyle(L.artistArt(artist)) +
      ">" +
      '<div class="detail-hero__bg"></div><div class="detail-hero__scrim"></div>' +
      '<div class="detail-hero__inner">' +
      '<div class="detail-hero__art detail-hero__art--round"><img src="' +
      esc(L.artistArt(artist)) +
      '" alt="' +
      esc(artist.name) +
      '" draggable="false"></div>' +
      '<div class="detail-hero__info">' +
      '<p class="detail-hero__type eyebrow">Artis</p>' +
      "<h1>" +
      esc(artist.name) +
      "</h1>" +
      '<div class="detail-hero__meta">' +
      '<span>' +
      plural(artist.albumCount, "album") +
      "</span>" +
      '<span class="dot">' +
      plural(artist.tracks.length, "lagu") +
      "</span>" +
      (genres ? '<span class="dot">' + esc(genres) + "</span>" : "") +
      "</div>" +
      '<div class="detail-hero__actions">' +
      '<button class="btn btn--primary" type="button" data-action="play-artist" data-key="' +
      esc(artist.key) +
      '">' +
      icon("play") +
      "<span>Putar</span></button>" +
      '<button class="btn btn--secondary" type="button" data-action="shuffle-artist" data-key="' +
      esc(artist.key) +
      '">' +
      icon("shuffle") +
      "<span>Acak</span></button>" +
      '<button class="icon-btn" type="button" data-action="queue-artist" data-key="' +
      esc(artist.key) +
      '" title="Tambahkan ke antrean" aria-label="Tambahkan ke antrean">' +
      icon("plus") +
      "</button>" +
      "</div></div></div></section>"
    );
  }

  function playlistHero(playlist) {
    const tracks = L.playlistTracks(playlist);
    return (
      '<section class="detail-hero"' +
      artStyle(L.playlistArt(playlist)) +
      ">" +
      '<div class="detail-hero__bg"></div><div class="detail-hero__scrim"></div>' +
      '<div class="detail-hero__inner">' +
      '<div class="detail-hero__art">' +
      mosaicArt(tracks, playlist.id, playlist.name) +
      "</div>" +
      '<div class="detail-hero__info">' +
      '<p class="detail-hero__type eyebrow">Playlist</p>' +
      "<h1>" +
      esc(playlist.name) +
      "</h1>" +
      (playlist.description ? '<p class="detail-hero__desc">' + esc(playlist.description) + "</p>" : "") +
      '<div class="detail-hero__meta">' +
      '<span>' +
      plural(tracks.length, "lagu") +
      "</span>" +
      (tracks.length ? '<span class="dot">' + U.fmtLongDuration(totalDuration(tracks)) + "</span>" : "") +
      '<span class="dot">Diperbarui ' +
      esc(U.fmtDate(playlist.updatedAt)) +
      "</span>" +
      "</div>" +
      '<div class="detail-hero__actions">' +
      '<button class="btn btn--primary" type="button" data-action="play-playlist" data-key="' +
      esc(playlist.id) +
      '"' +
      (tracks.length ? "" : " disabled") +
      ">" +
      icon("play") +
      "<span>Putar</span></button>" +
      '<button class="btn btn--secondary" type="button" data-action="shuffle-playlist" data-key="' +
      esc(playlist.id) +
      '"' +
      (tracks.length ? "" : " disabled") +
      ">" +
      icon("shuffle") +
      "<span>Acak</span></button>" +
      '<button class="btn btn--secondary" type="button" data-action="playlist-add" data-key="' +
      esc(playlist.id) +
      '">' +
      icon("plus") +
      "<span>Tambah lagu</span></button>" +
      '<button class="btn btn--secondary" type="button" data-action="playlist-import" data-key="' +
      esc(playlist.id) +
      '">' +
      icon("upload") +
      "<span>Impor file</span></button>" +
      '<button class="icon-btn" type="button" data-action="playlist-menu" data-key="' +
      esc(playlist.id) +
      '" title="Opsi playlist" aria-label="Opsi playlist">' +
      icon("more") +
      "</button>" +
      "</div></div></div></section>"
    );
  }

  /* ------------------------------------------------------------------------
     Halaman: Dengarkan Sekarang
     ------------------------------------------------------------------------ */

  function mixList() {
    const genres = L.genres()
      .slice()
      .sort((a, b) => b.count - a.count)
      .slice(0, 4);
    return genres.map((genre, index) => ({
      title: "Mix " + genre.name,
      genre: genre.name,
      kicker: index === 0 ? "MIX HARIAN" : "MIX",
      sub: plural(genre.count, "lagu")
    }));
  }

  function greetingText() {
    const hour = new Date().getHours();
    if (hour < 11) return "Selamat pagi";
    if (hour < 15) return "Selamat siang";
    if (hour < 19) return "Selamat sore";
    return "Selamat malam";
  }

  function homeHero(hasLibrary) {
    return (
      '<section class="home-hero">' +
      '<div class="home-hero__glow" aria-hidden="true"></div>' +
      '<div class="home-hero__content">' +
      '<p class="home-hero__eyebrow eyebrow">Dengarkan sekarang</p>' +
      "<h1>" +
      esc(greetingText()) +
      ".</h1>" +
      '<p class="home-hero__desc">Rekomendasi lagu, stasiun radio, dan playlist yang dibuat untukmu — langsung diputar tanpa impor.</p>' +
      '<div class="home-hero__actions">' +
      '<button class="btn btn--primary" type="button" data-action="home-play-section" data-section="rekomendasi">' +
      icon("play") +
      "<span>Putar rekomendasi</span></button>" +
      '<button class="btn btn--secondary" type="button" data-action="home-play-section" data-section="rekomendasi" data-shuffle="true">' +
      icon("shuffle") +
      "<span>Acak</span></button>" +
      '<a class="btn btn--secondary" href="#/search">' +
      icon("search") +
      "<span>Cari lagu</span></a>" +
      (hasLibrary
        ? ""
        : '<button class="btn btn--secondary" type="button" data-action="open-import">' +
          icon("upload") +
          "<span>Impor koleksi</span></button>") +
      "</div></div></section>"
    );
  }

  function homeTiles() {
    const tiles = AM.Home && typeof AM.Home.tiles === "function" ? AM.Home.tiles() : [];
    if (!tiles.length) return "";
    return (
      '<div class="quick-grid" aria-label="Pilihan cepat">' +
      tiles
        .map((tile) => {
          const palette = U.paletteFor("home-" + tile.key);
          return (
            '<button class="quick-card" type="button" data-action="home-seed" data-query="' +
            esc(tile.query) +
            '" style="--quick-a:' +
            palette[0] +
            ";--quick-b:" +
            palette[1] +
            '">' +
            '<span class="quick-card__art">' +
            icon(tile.icon || "music") +
            "</span>" +
            '<span class="quick-card__title">' +
            esc(tile.title) +
            "</span>" +
            '<span class="quick-card__play">' +
            icon("play") +
            "</span></button>"
          );
        })
        .join("") +
      "</div>"
    );
  }

  function homeLoadingHTML() {
    let cards = "";
    for (let i = 0; i < 6; i += 1) {
      cards +=
        '<div class="home-skeleton-card" aria-hidden="true">' +
        '<span class="home-skeleton-card__art"></span>' +
        '<span class="home-skeleton-card__line"></span>' +
        '<span class="home-skeleton-card__line home-skeleton-card__line--short"></span>' +
        "</div>";
    }
    return section(
      "Rekomendasi untukmu",
      '<div class="home-loading" role="status" aria-live="polite"><span class="spinner"></span><span>Menyiapkan rekomendasi dari YouTube…</span></div>' +
        '<div class="home-grid">' +
        cards +
        "</div>",
      { sub: "Lagu pilihan berdasarkan yang sedang populer" }
    );
  }

  function homeErrorHTML(message) {
    return section(
      "Rekomendasi untukmu",
      emptyState({
        inline: true,
        icon: "globe",
        title: "Rekomendasi belum bisa dimuat",
        text: message || "Periksa koneksi internet lalu coba lagi.",
        actions:
          '<button class="btn btn--secondary btn--small" type="button" data-action="home-refresh">' +
          icon("repeat") +
          "<span>Coba lagi</span></button>"
      })
    );
  }

  function homeCard(track, sectionKey) {
    const art = track.art || L.trackArt(track);
    return (
      '<article class="home-card" data-id="' +
      esc(track.id) +
      '">' +
      '<button class="home-card__art" type="button" data-action="home-play" data-section="' +
      esc(sectionKey) +
      '" data-id="' +
      esc(track.id) +
      '" title="Putar ' +
      esc(track.title) +
      '" aria-label="Putar ' +
      esc(track.title) +
      '">' +
      '<img src="' +
      esc(art) +
      '" alt="" loading="lazy" draggable="false">' +
      '<span class="home-card__play">' +
      icon("play") +
      "</span>" +
      '<span class="home-card__badge">YouTube</span></button>' +
      '<div class="home-card__text">' +
      '<button class="home-card__title" type="button" data-action="home-play" data-section="' +
      esc(sectionKey) +
      '" data-id="' +
      esc(track.id) +
      '" title="' +
      esc(track.title) +
      '">' +
      esc(track.title) +
      "</button>" +
      '<div class="home-card__sub">' +
      esc(track.artist || "YouTube") +
      "</div></div>" +
      '<button class="icon-btn home-card__queue" type="button" data-action="home-queue" data-id="' +
      esc(track.id) +
      '" title="Tambahkan ke antrean" aria-label="Tambahkan ' +
      esc(track.title) +
      ' ke antrean">' +
      icon("plus") +
      "</button></article>"
    );
  }

  function homeStationCard(station) {
    const palette = U.paletteFor("station-" + station.id);
    const art = station.art || "";
    return (
      '<button class="home-station" type="button" data-action="home-station" data-id="' +
      esc(station.id) +
      '" title="Mulai ' +
      esc(station.label) +
      '" style="--tile-a:' +
      palette[0] +
      ";--tile-b:" +
      palette[1] +
      '">' +
      '<span class="home-station__art">' +
      (art
        ? '<img src="' + esc(art) + '" alt="" loading="lazy" draggable="false">'
        : '<span class="home-station__glyph">' + icon("radio") + "</span>") +
      '<span class="home-station__play">' +
      icon("play") +
      "</span></span>" +
      '<span class="home-station__text">' +
      '<span class="home-station__name">' +
      esc(station.label) +
      "</span>" +
      '<span class="home-station__meta">' +
      esc(station.artist || "Stasiun radio") +
      " · diputar tanpa henti</span></span></button>"
    );
  }

  function homeSongRow(track, index, sectionKey) {
    const art = track.art || L.trackArt(track);
    return (
      '<div class="home-song" data-id="' +
      esc(track.id) +
      '">' +
      '<span class="home-song__index">' +
      esc(String(index + 1)) +
      "</span>" +
      '<button class="home-song__art" type="button" data-action="home-play" data-section="' +
      esc(sectionKey) +
      '" data-id="' +
      esc(track.id) +
      '" title="Putar ' +
      esc(track.title) +
      '" aria-label="Putar ' +
      esc(track.title) +
      '">' +
      '<img src="' +
      esc(art) +
      '" alt="" loading="lazy" draggable="false">' +
      '<span class="home-song__play">' +
      icon("play") +
      "</span></button>" +
      '<div class="home-song__text">' +
      '<button class="home-song__title" type="button" data-action="home-play" data-section="' +
      esc(sectionKey) +
      '" data-id="' +
      esc(track.id) +
      '" title="' +
      esc(track.title) +
      '">' +
      esc(track.title) +
      "</button>" +
      '<span class="home-song__artist">' +
      esc(track.artist || "YouTube") +
      "</span></div>" +
      '<span class="home-song__source">YouTube</span>' +
      '<span class="home-song__time">' +
      trackTime(track) +
      "</span>" +
      '<button class="icon-btn home-song__queue" type="button" data-action="home-queue" data-id="' +
      esc(track.id) +
      '" title="Tambahkan ke antrean" aria-label="Tambahkan ' +
      esc(track.title) +
      ' ke antrean">' +
      icon("plus") +
      "</button></div>"
    );
  }

  function homeFeedHTML(snapshot) {
    const snap = snapshot || (AM.Home ? AM.Home.snapshot() : null) || {};
    if (
      (snap.status === "loading" || snap.status === "idle") &&
      (!snap.sections || !snap.sections.length)
    ) {
      return homeLoadingHTML();
    }
    if (!snap.sections || !snap.sections.length) return homeErrorHTML(snap.error);

    let html = "";
    snap.sections.forEach((block) => {
      if (block.variant === "cards") {
        html += section(
          block.title,
          '<div class="home-grid">' +
            block.tracks.map((track) => homeCard(track, block.key)).join("") +
            "</div>",
          { sub: block.sub }
        );
        const stations = block.stations || [];
        if (stations.length) {
          html += section(
            "Stasiun untukmu",
            '<div class="home-stations">' + stations.map(homeStationCard).join("") + "</div>",
            { sub: "Radio yang dimulai dari sebuah lagu — terus berjalan otomatis" }
          );
        }
      } else if (block.variant === "rows") {
        html += section(
          block.title,
          '<div class="home-songs">' +
            block.tracks.map((track, index) => homeSongRow(track, index, block.key)).join("") +
            "</div>",
          {
            sub: block.sub,
            actions:
              '<button class="text-btn" type="button" data-action="home-play-section" data-section="' +
              esc(block.key) +
              '">Putar semua</button>'
          }
        );
      }
    });
    return html;
  }

  function updateHomeFeed(snapshot) {
    const container = document.getElementById("homeFeed");
    if (!container) return false;
    container.innerHTML = homeFeedHTML(snapshot);
    return true;
  }

  function homeView(route) {
    const tracks = L.tracksByAdded();
    const hasLibrary = tracks.length > 0;
    const albums = L.albums()
      .slice()
      .sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
    const recentTracks = L.recent().slice(0, 5);
    const favorites = L.favorites().slice(0, 5);
    const mixes = mixList();
    const freshAlbums = albums.slice(0, 7);

    return {
      title: "Dengarkan Sekarang",
      html:
        '<div class="page home-page">' +
        homeHero(hasLibrary) +
        homeTiles() +
        '<div id="homeFeed" class="home-feed">' +
        homeFeedHTML(AM.Home ? AM.Home.snapshot() : null) +
        "</div>" +
        (freshAlbums.length
          ? section(
              "Baru ditambahkan di perpustakaanmu",
              '<div class="grid">' + freshAlbums.map(albumCard).join("") + "</div>",
              { actions: '<a class="text-btn" href="#/albums">Lihat semua</a>' }
            )
          : "") +
        (recentTracks.length
          ? section(
              "Kembali diputar",
              tracklist(recentTracks, { queue: { type: "recent" }, showAlbum: true }),
              {
                sub: "Lagu lokal yang terakhir kamu dengarkan",
                actions: '<a class="text-btn" href="#/recent">Lihat semua</a>'
              }
            )
          : "") +
        (mixes.length
          ? section(
              "Mix untukmu",
              '<div class="grid grid--mixes">' + mixes.map(mixCard).join("") + "</div>",
              { sub: "Kumpulan lagu berdasarkan genre di perpustakaanmu" }
            )
          : "") +
        (favorites.length
          ? section(
              "Disukai",
              tracklist(favorites, { queue: { type: "favorites" }, showAlbum: true }),
              { actions: '<a class="text-btn" href="#/favorites">Lihat semua</a>' }
            )
          : "") +
        "</div>"
    };
  }

  /* ------------------------------------------------------------------------
     Halaman: Jelajahi
     ------------------------------------------------------------------------ */

  function browseView(route) {
    const albums = L.albums();
    const artists = L.artists();
    const genres = L.genres();
    if (!L.allTracks().length) {
      return {
        title: "Jelajahi",
        html:
          '<div class="page">' +
          pageHead("Jelajahi", {
            eyebrow: "Perpustakaan",
            sub: "Temukan album, artis, dan genre dari koleksimu."
          }) +
          emptyState({
            icon: "compass",
            title: "Belum ada yang bisa dijelajahi",
            text: "Impor beberapa lagu terlebih dahulu, atau muat perpustakaan demo untuk melihat aplikasi bekerja.",
            actions:
              '<button class="btn btn--primary" type="button" data-action="open-import">' +
              icon("upload") +
              "<span>Impor musik</span></button>" +
              '<button class="btn btn--secondary" type="button" data-action="load-demo">' +
              icon("sparkles") +
              "<span>Muat demo</span></button>" +
              '<a class="btn btn--secondary" href="#/search">' +
              icon("search") +
              "<span>Cari lagu</span></a>"
          }) +
          "</div>"
      };
    }

    return {
      title: "Jelajahi",
      html:
        '<div class="page">' +
        pageHead("Jelajahi", {
          eyebrow: "Perpustakaan",
          sub: plural(L.allTracks().length, "lagu") + " · " + plural(albums.length, "album") + " · " + plural(artists.length, "artis"),
          actions:
            '<button class="btn btn--secondary btn--small" type="button" data-action="shuffle-library">' +
            icon("shuffle") +
            "<span>Acak semua</span></button>"
        }) +
        (genres.length
          ? section("Genre", '<div class="genre-grid">' + genres.map(genreTile).join("") + "</div>")
          : "") +
        (albums.length
          ? section("Album", '<div class="grid">' + albums.map(albumCard).join("") + "</div>", {
              actions: '<a class="text-btn" href="#/albums">Lihat semua</a>'
            })
          : "") +
        (artists.length
          ? section("Artis", '<div class="artist-grid">' + artists.map(artistRow).join("") + "</div>", {
              actions: '<a class="text-btn" href="#/artists">Lihat semua</a>'
            })
          : "") +
        "</div>"
    };
  }

  /* ------------------------------------------------------------------------
     Halaman: Radio
     ------------------------------------------------------------------------ */

  function radioView(route) {
    const genres = L.genres()
      .slice()
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
    if (!L.allTracks().length) {
      return {
        title: "Radio",
        html:
          '<div class="page">' +
          pageHead("Radio", {
            eyebrow: "Stasiun tanpa henti",
            sub: "Stasiun pintar dari koleksi musikmu sendiri."
          }) +
          emptyState({
            icon: "radio",
            title: "Radio belum mengudara",
            text: "Tambahkan lagu ke perpustakaan untuk membuat stasiun acak berdasarkan genre dan artis.",
            actions:
              '<button class="btn btn--primary" type="button" data-action="open-import">' +
              icon("upload") +
              "<span>Impor musik</span></button>"
          }) +
          "</div>"
      };
    }

    const allStation =
      '<button class="station" type="button" data-action="shuffle-library" style="--tile-a:#fa2d48;--tile-b:#5e5ce6">' +
      '<span class="station__top"><span class="station__badge">' +
      icon("radio") +
      "Stasiun utama</span><span class=\"station__play\">" +
      icon("play") +
      "</span></span>" +
      "<span><span class=\"station__name\">Radio Musik</span><span class=\"station__meta\">" +
      plural(L.allTracks().length, "lagu") +
      " · semua genre, acak</span></span></button>";

    return {
      title: "Radio",
      html:
        '<div class="page">' +
        pageHead("Radio", {
          eyebrow: "Stasiun tanpa henti",
          sub: "Stasiun pintar dari koleksi musikmu sendiri.",
          actions:
            '<button class="btn btn--secondary btn--small" type="button" data-action="shuffle-library">' +
            icon("shuffle") +
            "<span>Acak semua</span></button>"
        }) +
        '<div class="info-banner">' +
        icon("info") +
        "<div><strong>Radio lokal.</strong> Stasiun di bawah memilih lagu acak dari genre yang tersedia. Tidak ada data yang dikirim keluar perangkat.</div>" +
        "</div>" +
        section(
          "Stasiun pilihan",
          '<div class="station-grid">' + allStation + genres.map(stationCard).join("") + "</div>",
          { tight: true }
        ) +
        "</div>"
    };
  }

  /* ------------------------------------------------------------------------
     Halaman: Terbaru
     ------------------------------------------------------------------------ */

  function historyTrack(entry) {
    return (
      L.getTrack(entry.id) ||
      (entry.online && AM.Online && typeof AM.Online.getTrack === "function"
        ? AM.Online.getTrack(entry.id)
        : null)
    );
  }

  function historyArt(entry, track) {
    if (track) return L.trackArt(track);
    if (entry.art) return entry.art;
    if (entry.coverId) {
      const cover = L.coverURL(entry.coverId);
      if (cover) return cover;
    }
    return U.generatedArt(entry.album || entry.title || "musik", {
      label: entry.album || entry.title || "Musik"
    });
  }

  function historyRow(entry, index) {
    const track = historyTrack(entry);
    const available = !!track;
    const playerState = AM.Player.state;
    const current = playerState.currentId === entry.id;
    const playing = current && playerState.isPlaying;
    const liked = !!(track && track.liked);
    const online = !!(entry.online || (AM.Online && AM.Online.isOnlineId(entry.id)));
    const title = (track && track.title) || entry.title;
    const artist = (track && track.artist) || entry.artist;
    const menuAction = online ? "online-menu" : "track-menu";
    return (
      '<div class="track-row' +
      (current ? " is-current" : "") +
      (playing ? " is-playing" : "") +
      (available ? "" : " is-unavailable") +
      '" data-track-id="' +
      esc(entry.id) +
      '"' +
      queueAttrs({ type: "recent" }) +
      ' role="row">' +
      '<div class="track-row__index">' +
      '<span class="track-row__num">' +
      esc(String(index + 1)) +
      "</span>" +
      '<button class="track-row__index-play" type="button" data-action="play-track" data-id="' +
      esc(entry.id) +
      '" title="Putar ' +
      esc(title) +
      '" aria-label="Putar ' +
      esc(title) +
      '"' +
      (available ? "" : " disabled") +
      ">" +
      icon("play") +
      "</button>" +
      '<span class="track-row__eq" aria-hidden="true"><i></i><i></i><i></i></span>' +
      "</div>" +
      '<div class="track-row__title-cell">' +
      '<div class="track-row__art"><img src="' +
      esc(historyArt(entry, track)) +
      '" alt="" loading="lazy" draggable="false"></div>' +
      '<div class="track-row__text">' +
      '<button class="track-row__name" type="button" data-action="play-track" data-id="' +
      esc(entry.id) +
      '" title="' +
      esc(title) +
      '"' +
      (available ? "" : " disabled") +
      ">" +
      esc(title) +
      "</button>" +
      '<div class="track-row__mobile-sub">' +
      esc(artist) +
      "</div>" +
      "</div>" +
      "</div>" +
      '<div class="track-row__artist"><span title="' +
      esc(artist) +
      '">' +
      esc(artist) +
      "</span></div>" +
      '<div class="track-row__album"><span title="' +
      esc(U.fmtDate(entry.playedAt)) +
      '">' +
      esc(U.fmtRelative(entry.playedAt)) +
      "</span></div>" +
      '<div class="track-row__time">' +
      trackTime(track || entry) +
      "</div>" +
      '<button class="icon-btn track-row__like' +
      (liked ? " is-liked" : "") +
      '" type="button" data-action="toggle-like" data-id="' +
      esc(entry.id) +
      '" title="' +
      (liked ? "Hapus dari suka" : "Sukai") +
      '" aria-label="' +
      (liked ? "Hapus dari suka" : "Sukai") +
      '" aria-pressed="' +
      (liked ? "true" : "false") +
      '"' +
      (available ? "" : " disabled") +
      ">" +
      icon(liked ? "heart-fill" : "heart") +
      "</button>" +
      '<button class="icon-btn track-row__more" type="button" data-action="' +
      menuAction +
      '" data-id="' +
      esc(entry.id) +
      '" title="Opsi lain" aria-label="Opsi lain untuk ' +
      esc(title) +
      '"' +
      (available ? "" : " disabled") +
      ">" +
      icon("more") +
      "</button>" +
      "</div>"
    );
  }

  function historyList(entries) {
    return (
      '<div class="tracklist tracklist--history" role="table" aria-label="Riwayat pemutaran">' +
      '<div class="tracklist__head tracklist__head--plain" role="row">' +
      '<span class="th-index">#</span>' +
      '<span class="th-title">Judul</span>' +
      '<span class="th-artist">Artis</span>' +
      '<span class="th-album">Diputar</span>' +
      '<span class="th-time">Waktu</span>' +
      '<span class="th-like"></span>' +
      '<span class="th-more"></span>' +
      "</div>" +
      entries.map(historyRow).join("") +
      "</div>"
    );
  }

  function recentView(route) {
    const entries = L.history();
    const recentTracks = L.recent();
    const albums = L.albums()
      .slice()
      .sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0))
      .slice(0, 10);
    if (!entries.length) {
      return {
        title: "Riwayat Pemutaran",
        html:
          '<div class="page">' +
          pageHead("Riwayat Pemutaran", {
            eyebrow: "Perpustakaan",
            sub: "Lagu yang kamu dengarkan minimal 30 detik akan muncul di sini."
          }) +
          emptyState({
            icon: "clock",
            title: "Belum ada riwayat pemutaran",
            text: L.allTracks().length
              ? "Mulai putar satu lagu, lalu kembali ke halaman ini."
              : "Impor koleksi musikmu untuk mulai membangun riwayat.",
            actions:
              '<button class="btn btn--primary" type="button" data-action="shuffle-library">' +
              icon("shuffle") +
              "<span>Putar acak</span></button>" +
              (albums.length ? '<a class="btn btn--secondary" href="#/albums">Lihat album</a>' : "")
          }) +
          (albums.length
            ? section("Baru ditambahkan", '<div class="grid">' + albums.slice(0, 7).map(albumCard).join("") + "</div>")
            : "") +
          "</div>"
      };
    }

    return {
      title: "Riwayat Pemutaran",
      html:
        '<div class="page">' +
        pageHead("Riwayat Pemutaran", {
          eyebrow: "Perpustakaan",
          sub: plural(entries.length, "lagu") + " dalam riwayat · terbaru di atas",
          actions:
            (recentTracks.length
              ? '<button class="btn btn--secondary btn--small" type="button" data-action="shuffle-recent">' +
                icon("shuffle") +
                "<span>Acak riwayat</span></button>"
              : "") +
            '<button class="btn btn--ghost btn--small" type="button" data-action="clear-history">' +
            icon("trash") +
            "<span>Hapus riwayat</span></button>"
        }) +
        historyList(entries) +
        (albums.length
          ? section(
              "Baru ditambahkan",
              '<div class="grid">' + albums.slice(0, 7).map(albumCard).join("") + "</div>",
              { actions: '<a class="text-btn" href="#/albums">Lihat semua</a>' }
            )
          : "") +
        "</div>"
    };
  }

  /* ------------------------------------------------------------------------
     Halaman: Artis
     ------------------------------------------------------------------------ */

  function artistsView(route) {
    const artists = L.artists();
    return {
      title: "Artis",
      html:
        '<div class="page">' +
        pageHead("Artis", {
          eyebrow: "Perpustakaan",
          sub: plural(artists.length, "artis") + " di koleksimu",
          actions:
            '<button class="btn btn--secondary btn--small" type="button" data-action="shuffle-library">' +
            icon("shuffle") +
            "<span>Acak semua</span></button>"
        }) +
        (artists.length
          ? '<div class="artist-grid">' + artists.map(artistRow).join("") + "</div>"
          : emptyState({
              icon: "user",
              title: "Belum ada artis",
              text: "Impor musik dengan tag artis, atau muat demo untuk melihat contoh.",
              actions:
                '<button class="btn btn--primary" type="button" data-action="open-import">' +
                icon("upload") +
                "<span>Impor musik</span></button>"
            })) +
        "</div>"
    };
  }

  /* ------------------------------------------------------------------------
     Halaman: Album
     ------------------------------------------------------------------------ */

  function albumsView(route) {
    const sort = (route.query && route.query.sort) || "recent";
    const albums = L.albums().slice();
    if (sort === "name") albums.sort((a, b) => U.byText(a.name, b.name));
    else if (sort === "artist") albums.sort((a, b) => U.byText(a.artist, b.artist) || U.byText(a.name, b.name));
    else albums.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));

    const sortButtons =
      '<div class="segmented">' +
      '<button class="segmented__btn' +
      (sort === "recent" ? " is-active" : "") +
      '" type="button" data-action="sort-albums" data-sort="recent">Terbaru</button>' +
      '<button class="segmented__btn' +
      (sort === "name" ? " is-active" : "") +
      '" type="button" data-action="sort-albums" data-sort="name">A–Z</button>' +
      '<button class="segmented__btn' +
      (sort === "artist" ? " is-active" : "") +
      '" type="button" data-action="sort-albums" data-sort="artist">Artis</button>' +
      "</div>";

    return {
      title: "Album",
      html:
        '<div class="page">' +
        pageHead("Album", {
          eyebrow: "Perpustakaan",
          sub: plural(albums.length, "album"),
          actions: sortButtons
        }) +
        (albums.length
          ? '<div class="grid grid--wide">' + albums.map(albumCard).join("") + "</div>"
          : emptyState({
              icon: "disc",
              title: "Belum ada album",
              text: "Album dibentuk otomatis dari tag album pada file musikmu.",
              actions:
                '<button class="btn btn--primary" type="button" data-action="open-import">' +
                icon("upload") +
                "<span>Impor musik</span></button>"
            })) +
        "</div>"
    };
  }

  /* ------------------------------------------------------------------------
     Halaman: Semua lagu
     ------------------------------------------------------------------------ */

  function sortTracks(tracks, sort) {
    const list = tracks.slice();
    if (sort === "artist") {
      list.sort((a, b) => U.byText(a.artist, b.artist) || U.byText(a.album, b.album) || U.byText(a.title, b.title));
    } else if (sort === "album") {
      list.sort((a, b) => U.byText(a.album || "Singel", b.album || "Singel") || a.trackNo - b.trackNo);
    } else if (sort === "duration") {
      list.sort((a, b) => (b.duration || 0) - (a.duration || 0));
    } else {
      list.sort((a, b) => U.byText(a.title, b.title));
    }
    return list;
  }

  function songsView(route) {
    const sort = (route.query && route.query.sort) || "title";
    const tracks = L.tracksByAdded();
    const sorted = sortTracks(tracks, sort);
    return {
      title: "Lagu",
      html:
        '<div class="page">' +
        pageHead("Lagu", {
          eyebrow: "Perpustakaan",
          sub: plural(tracks.length, "lagu") + (tracks.length ? " · " + U.fmtLongDuration(totalDuration(tracks)) : ""),
          actions:
            '<button class="btn btn--primary btn--small" type="button" data-action="play-songs"' +
            (tracks.length ? "" : " disabled") +
            ">" +
            icon("play") +
            "<span>Putar</span></button>" +
            '<button class="btn btn--secondary btn--small" type="button" data-action="shuffle-library"' +
            (tracks.length ? "" : " disabled") +
            ">" +
            icon("shuffle") +
            "<span>Acak</span></button>"
        }) +
        (tracks.length
          ? tracklist(sorted, {
              queue: { type: "songs" },
              showAlbum: true,
              showArtist: true,
              sortable: true,
              sort
            })
          : emptyState({
              icon: "music",
              title: "Belum ada lagu",
              text: "Impor file audio untuk mulai mengisi perpustakaan.",
              actions:
                '<button class="btn btn--primary" type="button" data-action="open-import">' +
                icon("upload") +
                "<span>Impor musik</span></button>"
            })) +
        "</div>"
    };
  }

  /* ------------------------------------------------------------------------
     Halaman: Suka
     ------------------------------------------------------------------------ */

  function favoritesView(route) {
    const localTracks = L.favorites();
    const onlineTracks =
      AM.Online && typeof AM.Online.likedTracks === "function"
        ? AM.Online.likedTracks()
        : [];
    const total = localTracks.length + onlineTracks.length;
    return {
      title: "Suka",
      html:
        '<div class="page">' +
        pageHead("Suka", {
          eyebrow: "Perpustakaan",
          sub: plural(total, "lagu") + " yang kamu tandai",
          actions: total
            ? '<button class="btn btn--primary btn--small" type="button" data-action="play-favorites">' +
              icon("play") +
              "<span>Putar</span></button>" +
              '<button class="btn btn--secondary btn--small" type="button" data-action="shuffle-favorites">' +
              icon("shuffle") +
              "<span>Acak</span></button>"
            : ""
        }) +
        (localTracks.length
          ? section(
              "Dari perpustakaan",
              tracklist(localTracks, {
                queue: { type: "favorites" },
                showAlbum: true
              }),
              { sub: plural(localTracks.length, "lagu") }
            )
          : "") +
        (onlineTracks.length
          ? section(
              "Dari YouTube",
              onlineTracklist(onlineTracks, {
                queue: {
                  type: "online-favorites",
                  provider: "youtube",
                  label: "Suka · YouTube"
                }
              }),
              {
                sub:
                  plural(onlineTracks.length, "lagu") +
                  " · tersimpan di perangkat ini"
              }
            )
          : "") +
        (total
          ? ""
          : emptyState({
              icon: "heart",
              title: "Belum ada lagu yang disukai",
              text: "Tekan ikon hati pada lagu mana pun — termasuk lagu YouTube — untuk menyimpannya di sini.",
              actions:
                '<a class="btn btn--primary" href="#/songs">Jelajahi lagu</a>' +
                '<a class="btn btn--secondary" href="#/search">' +
                icon("search") +
                "<span>Cari lagu</span></a>"
            })) +
        "</div>"
    };
  }

  /* ------------------------------------------------------------------------
     Halaman: Pencarian
     ------------------------------------------------------------------------ */

  function searchEmptyContent() {
    const genres = L.genres();
    const artists = L.artists().slice(0, 6);
    if (!L.allTracks().length) {
      return emptyState({
        icon: "search",
        title: "Cari lagu apa pun",
        text: "Ketik judul lagu atau nama artis. Hasil dari perpustakaan dan YouTube langsung muncul di sini.",
        actions:
          '<button class="btn btn--primary" type="button" data-action="open-import">' +
          icon("upload") +
          "<span>Impor musik</span></button>"
      });
    }
    return (
      (genres.length
        ? section("Jelajahi genre", '<div class="genre-grid">' + genres.slice(0, 8).map(genreTile).join("") + "</div>", {
            tight: true
          })
        : "") +
      (artists.length
        ? section("Artis", '<div class="artist-grid">' + artists.map(artistRow).join("") + "</div>", {
            tight: true
          })
        : "")
    );
  }

  function searchView(route) {
    const query = (route.query && route.query.q) || "";
    const genres = L.genres().slice(0, 6);
    const chips = genres
      .map(
        (genre) =>
          '<button class="chip" type="button" data-action="set-search" data-q="' +
          esc(genre.name) +
          '">' +
          esc(genre.name) +
          "</button>"
      )
      .join("");
    return {
      title: "Cari",
      html:
        '<div class="page">' +
        '<div class="search-hero">' +
        "<h1>Cari</h1>" +
        "<p>Cari lagu langsung di perpustakaanmu dan YouTube — tanpa pindah halaman.</p>" +
        '<div class="search-box" role="search">' +
        icon("search") +
        '<input class="search-box__input" id="searchInput" type="search" autocomplete="off" spellcheck="false" placeholder="Lagu, artis, album…" value="' +
        esc(query) +
        '" aria-label="Cari musik">' +
        '<button class="icon-btn search-box__clear" type="button" data-action="clear-search" title="Bersihkan" aria-label="Bersihkan pencarian"' +
        (query ? "" : " hidden") +
        ">" +
        icon("x") +
        "</button>" +
        "</div>" +
        (chips ? '<div class="search-chips">' + chips + "</div>" : "") +
        "</div>" +
        '<div class="search-results" id="searchResults">' +
        (query ? "" : searchEmptyContent()) +
        "</div>" +
        "</div>"
    };
  }

  function normalizeSearchText(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function onlineSearchState(value) {
    const idle = { active: false, status: "idle", results: [], error: "" };
    if (!AM.Online || typeof AM.Online.snapshot !== "function") return idle;
    const snapshot = AM.Online.snapshot();
    if (!snapshot) return idle;
    const active = normalizeSearchText(snapshot.query) === value;
    return {
      active,
      status: active ? snapshot.status : "idle",
      results: active && Array.isArray(snapshot.results) ? snapshot.results : [],
      error: active ? snapshot.error || "" : ""
    };
  }

  function searchYouTubeSection(value, online) {
    const busy = !online.active || online.status === "loading" || online.status === "idle";
    if (busy) {
      return section(
        "Dari YouTube",
        '<div class="online-loading" role="status" aria-live="polite"><span class="spinner"></span><span>Mencari \u201c' +
          esc(value) +
          "\u201d di YouTube.</span></div>",
        { tight: true }
      );
    }

    if (online.status === "error") {
      return section(
        "Dari YouTube",
        '<div class="info-banner search-online-state">' +
          icon("alert") +
          "<div><strong>Tidak dapat mencari di YouTube.</strong> " +
          esc(online.error || "Periksa koneksi internet lalu coba lagi.") +
          "</div>" +
          '<button class="text-btn" type="button" data-action="search-online-retry" data-query="' +
          esc(value) +
          '">Coba lagi</button>' +
          "</div>",
        { tight: true }
      );
    }

    if (!online.results.length) {
      return section(
        "Dari YouTube",
        '<p class="search-online-empty">Tidak ada hasil YouTube untuk \u201c' +
          esc(value) +
          "\u201d.</p>",
        { tight: true }
      );
    }

    const total = online.results.length;
    return section(
      "Dari YouTube",
      onlineTracklist(online.results.slice(0, 10), {
        queue: {
          type: "online",
          provider: "youtube",
          query: value,
          label: "Cari · YouTube"
        },
        query: value
      }),
      {
        sub: plural(total, "lagu") + " · streaming penuh"
      }
    );
  }

  function updateSearch(query) {
    const container = document.getElementById("searchResults");
    if (!container) return;
    const clear = document.querySelector('.search-box__clear[data-action="clear-search"]');
    if (clear) clear.hidden = !query;
    const input = document.getElementById("searchInput");
    if (input && input.value !== query) input.value = query;
    const value = normalizeSearchText(query);
    if (!value) {
      container.innerHTML = searchEmptyContent();
      return;
    }

    const results = L.search(value, 24);
    const canSearchOnline = value.length >= 2;
    const online = canSearchOnline ? onlineSearchState(value) : null;
    const onlineReady = !!(online && online.active && online.status === "ready");
    const onlineCount = onlineReady ? online.results.length : 0;
    const onlineBusy = !!(
      online &&
      (!online.active || online.status === "loading" || online.status === "idle")
    );
    const onlineFailed = !!(online && online.active && online.status === "error");
    const total = results.total + onlineCount;

    if (!results.total && !onlineCount) {
      if (onlineBusy || onlineFailed) {
        container.innerHTML = searchYouTubeSection(value, online);
        return;
      }
      container.innerHTML = emptyState({
        icon: "search",
        title: "Tidak ditemukan",
        text: canSearchOnline
          ? 'Tidak ada hasil untuk "' +
            value +
            '" di perpustakaan maupun YouTube. Coba kata kunci lain atau periksa ejaan.'
          : 'Tidak ada hasil untuk "' +
            value +
            '" di perpustakaan. Ketik minimal 2 huruf untuk mencari di YouTube.',
        actions:
          (canSearchOnline
            ? '<button class="btn btn--secondary btn--small" type="button" data-action="search-online-retry" data-query="' +
              U.esc(value) +
              '">' +
              icon("repeat") +
              "<span>Cari lagi di YouTube</span></button>"
            : "") +
          '<button class="text-btn" type="button" data-action="clear-search">Bersihkan pencarian</button>'
      });
      return;
    }

    let html =
      '<div class="search-summary"><p><strong>' +
      total +
      "</strong> hasil untuk \u201c" +
      esc(value) +
      "\u201d</p>" +
      '<button class="text-btn" type="button" data-action="clear-search">Bersihkan</button></div>';

    if (online) html += searchYouTubeSection(value, online);

    if (results.tracks.length) {
      html += section(
        "Di perpustakaanmu",
        tracklist(results.tracks.slice(0, 10), {
          queue: { type: "search", query: value },
          query: value,
          showAlbum: true
        }),
        {
          actions:
            '<button class="text-btn" type="button" data-action="play-search" data-query="' +
            esc(value) +
            '">Putar semua hasil</button>'
        }
      );
    }
    if (results.albums.length) {
      html += section("Album", '<div class="grid">' + results.albums.map(albumCard).join("") + "</div>");
    }
    if (results.artists.length) {
      html += section(
        "Artis",
        '<div class="artist-grid">' + results.artists.map(artistRow).join("") + "</div>"
      );
    }
    if (results.playlists.length) {
      html += section(
        "Playlist",
        '<div class="grid grid--small">' + results.playlists.map(playlistCard).join("") + "</div>"
      );
    }
    container.innerHTML = html;
  }

  /* ------------------------------------------------------------------------
     Halaman: Detail album
     ------------------------------------------------------------------------ */

  function albumView(route) {
    const album = L.getAlbum(route.params.key);
    if (!album) return notFoundView(route);
    const other = L.albums()
      .filter((item) => item.artistKey === album.artistKey && item.key !== album.key)
      .slice(0, 6);
    return {
      title: album.name,
      html:
        '<div class="page">' +
        albumHero(album) +
        '<div class="detail-body">' +
        tracklist(album.tracks, {
          queue: { type: "album", key: album.key },
          showArtist: false,
          showAlbum: false,
          numbering: "track"
        }) +
        (other.length
          ? section(
              "Album lainnya oleh " + album.artist,
              '<div class="grid">' + other.map(albumCard).join("") + "</div>"
            )
          : "") +
        '<p class="detail-note">' +
        esc(
          plural(album.tracks.length, "lagu") +
            " · " +
            U.fmtLongDuration(album.duration) +
            (album.year ? " · " + album.year : "") +
            " · Ditambahkan " +
            U.fmtDate(album.addedAt)
        ) +
        "</p>" +
        "</div></div>"
    };
  }

  /* ------------------------------------------------------------------------
     Halaman: Detail artis
     ------------------------------------------------------------------------ */

  function artistView(route) {
    const artist = L.getArtist(route.params.key);
    if (!artist) return notFoundView(route);
    const albums = L.albums().filter((album) => album.artistKey === artist.key);
    const top = artist.tracks.slice(0, 10);
    const rest = artist.tracks.slice(10);
    return {
      title: artist.name,
      html:
        '<div class="page">' +
        artistHero(artist) +
        '<div class="detail-body">' +
        trackSection("Lagu teratas", top, { type: "artist", key: artist.key }, {
          showArtist: false,
          showAlbum: true,
          sub: "Diurutkan berdasarkan jumlah pemutaran"
        }) +
        (albums.length
          ? section("Album", '<div class="grid">' + albums.map(albumCard).join("") + "</div>")
          : "") +
        (rest.length
          ? trackSection("Semua lagu", artist.tracks, { type: "artist", key: artist.key }, {
              showArtist: false,
              showAlbum: true
            })
          : "") +
        "</div></div>"
    };
  }

  /* ------------------------------------------------------------------------
     Halaman: Detail playlist
     ------------------------------------------------------------------------ */

  function playlistView(route) {
    const playlist = L.getPlaylist(route.params.key);
    if (!playlist) return notFoundView(route);
    const tracks = L.playlistTracks(playlist);
    return {
      title: playlist.name,
      html:
        '<div class="page">' +
        playlistHero(playlist) +
        '<div class="detail-body">' +
        (tracks.length
          ? tracklist(tracks, {
              queue: { type: "playlist", key: playlist.id },
              showAlbum: true,
              showArtist: true,
              playlistId: playlist.id
            })
          : emptyState({
              icon: "playlist",
              title: "Playlist ini masih kosong",
              text: "Tambahkan lagu dari perpustakaanmu untuk mulai menyusun playlist.",
              actions:
                '<button class="btn btn--primary" type="button" data-action="playlist-add" data-key="' +
                esc(playlist.id) +
                '">' +
                icon("plus") +
                "<span>Tambah lagu</span></button>" +
                '<button class="btn btn--secondary" type="button" data-action="playlist-import" data-key="' +
                esc(playlist.id) +
                '">' +
                icon("upload") +
                "<span>Impor file</span></button>"
            })) +
        (tracks.length
          ? '<p class="detail-note">' + plural(tracks.length, "lagu") + " · " + U.fmtLongDuration(totalDuration(tracks)) + "</p>"
          : "") +
        "</div></div>"
    };
  }

  /* ------------------------------------------------------------------------
     Halaman: Genre
     ------------------------------------------------------------------------ */

  function genreView(route) {
    const name = route.params.key;
    const genre = L.genres().find((item) => item.name === name);
    if (!genre) return notFoundView(route);
    const albumsByGenre = L.albums().filter((album) =>
      album.tracks.some((track) => (track.genre || "Lainnya") === name)
    );
    return {
      title: genre.name,
      html:
        '<div class="page">' +
        pageHead(genre.name, {
          eyebrow: "Genre",
          sub: plural(genre.count, "lagu") + " · " + U.fmtLongDuration(totalDuration(genre.tracks)),
          actions:
            '<button class="btn btn--primary btn--small" type="button" data-action="play-genre" data-key="' +
            esc(genre.name) +
            '">' +
            icon("play") +
            "<span>Putar</span></button>" +
            '<button class="btn btn--secondary btn--small" type="button" data-action="shuffle-genre" data-key="' +
            esc(genre.name) +
            '">' +
            icon("shuffle") +
            "<span>Acak</span></button>"
        }) +
        (albumsByGenre.length
          ? section("Album", '<div class="grid">' + albumsByGenre.map(albumCard).join("") + "</div>", {
              tight: true
            })
          : "") +
        section(
          "Lagu",
          tracklist(genre.tracks, {
            queue: { type: "genre", key: genre.name },
            showAlbum: true
          }),
          { tight: true }
        ) +
        "</div>"
    };
  }

  /* ------------------------------------------------------------------------
     Halaman: Pengaturan
     ------------------------------------------------------------------------ */

  function settingsView() {
    const body = AM.SettingsPage ? AM.SettingsPage.render() : "";
    return {
      title: "Pengaturan",
      html:
        '<div class="page page--settings">' +
        pageHead("Pengaturan", {
          eyebrow: "Musik",
          sub: "Tampilan, pemutaran, audio, dan data perpustakaan dalam satu tempat."
        }) +
        '<div class="settings-page" id="settingsRoot">' +
        body +
        "</div></div>"
    };
  }

  /* ------------------------------------------------------------------------
     Halaman: tidak ditemukan
     ------------------------------------------------------------------------ */

  function notFoundView() {
    return {
      title: "Tidak ditemukan",
      html:
        '<div class="page">' +
        emptyState({
          icon: "search",
          title: "Halaman tidak ditemukan",
          text: "Tautan yang kamu buka mungkin sudah tidak tersedia, atau album/playlist telah dihapus.",
          actions:
            '<a class="btn btn--primary" href="#/home">Kembali ke Dengarkan Sekarang</a>' +
            '<a class="btn btn--secondary" href="#/songs">Lihat semua lagu</a>'
        }) +
        "</div>"
    };
  }

  /* ------------------------------------------------------------------------
     Antrean
     ------------------------------------------------------------------------ */

  function queueItem(track, options) {
    const opts = options || {};
    const current = opts.current;
    return (
      '<div class="queue-item' +
      (current ? " is-current" : "") +
      '" data-track-id="' +
      esc(track.id) +
      '" data-queue-id="' +
      esc(track.id) +
      '">' +
      '<button class="queue-item__art" type="button" data-action="queue-jump" data-id="' +
      esc(track.id) +
      '" title="Putar ' +
      esc(track.title) +
      '" aria-label="Putar ' +
      esc(track.title) +
      '" style="border:0;padding:0">' +
      '<img src="' +
      esc(L.trackArt(track)) +
      '" alt="" loading="lazy" draggable="false"></button>' +
      '<div class="queue-item__text">' +
      '<div class="queue-item__title">' +
      esc(track.title) +
      "</div>" +
      '<div class="queue-item__sub">' +
      esc(track.artist) +
      "</div>" +
      "</div>" +
      (current
        ? '<span class="queue-item__eq" aria-label="Sedang diputar"><i></i><i></i><i></i></span>'
        : "") +
      '<button class="icon-btn queue-item__remove" type="button" data-action="queue-remove" data-id="' +
      esc(track.id) +
      '" title="Hapus dari antrean" aria-label="Hapus ' +
      esc(track.title) +
      ' dari antrean">' +
      icon("x") +
      "</button>" +
      "</div>"
    );
  }

  function queueHTML() {
    const queue = AM.Player.getQueue();
    if (!queue.queue.length) {
      return (
        '<div class="queue-empty">' +
        icon("list") +
        "<p><strong>Antrean kosong.</strong><br>Pilih lagu atau album untuk mulai memutar musik.</p>" +
        "</div>"
      );
    }
    const current = queue.queue[queue.cursor] || null;
    const rest = queue.queue.slice(queue.cursor + 1);
    let html = "";
    if (current) {
      html +=
        '<div class="queue-section"><div class="queue-section__title">Sekarang diputar</div>' +
        queueItem(current, { current: true }) +
        "</div>";
    }
    if (rest.length) {
      html +=
        '<div class="queue-section"><div class="queue-section__title">Berikutnya · ' +
        rest.length +
        " lagu</div>" +
        rest.map((track) => queueItem(track)).join("") +
        "</div>";
    }
    return html;
  }

  /* ------------------------------------------------------------------------
     Render
     ------------------------------------------------------------------------ */

  const views = {
    home: homeView,
    browse: browseView,
    radio: radioView,
    recent: recentView,
    settings: settingsView,
    artists: artistsView,
    albums: albumsView,
    songs: songsView,
    favorites: favoritesView,
    search: searchView,
    album: albumView,
    artist: artistView,
    playlist: playlistView,
    genre: genreView,
    notfound: notFoundView
  };

  function render(container, route) {
    const name = route && route.name ? route.name : "home";
    const view = views[name] || notFoundView;
    const result = view(route);
    container.innerHTML = result.html;
    return result;
  }

  AM.Views = {
    render,
    updateSearch,
    updateHomeFeed,
    homeFeedHTML,
    queueHTML,
    tracklist,
    albumCard,
    artistCard,
    playlistCard,
    artistRow,
    genreTile,
    emptyState,
    pageHead,
    section,
    icon,
    esc,
    plural
  };
})(window.AM = window.AM || {});
