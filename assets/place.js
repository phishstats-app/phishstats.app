// Venue and city pages share this renderer; the only difference is the
// scope: one venueid, or every venue in a city. Loaded after app.js.
(function () {
  'use strict';
  var P = window.Phish, api = P.api, esc = P.esc, n = P.n, fmtDate = P.fmtDate, mmss = P.mmss;

  // scope: { kind: 'venue', venueid } or { kind: 'city', city, state }
  // A venue is named by its id; a city by its name and state. The server
  // lower-cases the city and state exactly where this file used to.
  function scopeParams(scope) {
    return scope.kind === 'venue'
      ? { venue: scope.venueid }
      : { city: scope.city, state: scope.state || '' };
  }

  function renderPlace(scope, out) {
    var A = scopeParams(scope);
    out.innerHTML = '<div class="state"><h1>' + esc(scope.label || '') + '</h1><p>Pulling the history…</p></div>';
    // The tour list rides along so a venue page's tour column is a link on the
    // first paint. place/shows carries tourname but not tourid: it is one of
    // the statements the comparison harness proves unchanged, so the id comes
    // from catalog/tours instead of from a new column on it.
    Promise.all([api('place/core', A), api('place/venues', A), api('place/shows', A), api('place/songs', A), api('place/never', A), api('place/longest', A), api('place/debuts', A), P.loadTours().catch(function () { return null; })])
      .then(function (r) { render(scope, out, r[0][0], r[1], r[2], r[3], r[4], r[5], r[6], r[7]); })
      .catch(function (e) { out.innerHTML = P.errorState(e); });
  }

  function render(scope, out, core, venues, shows, songs, never, longest, debuts, tours) {
    if (!core || !core.shows) { out.innerHTML = '<div class="state"><h1>Nothing here</h1><p>No Phish shows on record for this place.</p></div>'; return; }
    var isVenue = scope.kind === 'venue';
    var name = isVenue ? core.venue : core.city + (core.state ? ', ' + core.state : '');
    document.title = name + ' · Phish.net local cache';
    P.crumbs(isVenue ? [{ text: core.city + (core.state ? ', ' + core.state : ''), href: P.cityPage(core.city, core.state) }, { text: core.venue }] : [{ text: name }]);

    // Favorites: songs that come out here at 1.5x their usual rate, over 3+ plays.
    var rated = songs.map(function (s) {
      var hereRate = s.here / core.shows, overall = s.times_played / Math.max(1, s.shows_since_debut);
      return Object.assign({ ratio: overall > 0 ? hereRate / overall : 0, hereRate: hereRate, overall: overall }, s);
    });
    var favorites = rated.filter(function (s) { return s.here >= 3 && s.ratio >= 1.5; }).sort(function (a, b) { return b.ratio - a.ratio; }).slice(0, 8);
    var most = rated.slice(0, 8);
    var totalBustouts = shows.reduce(function (a, s) { return a + Number(s.bustouts || 0); }, 0);
    var totalDebuts = debuts.length;
    var years = new Set(shows.map(function (s) { return s.showdate.slice(0, 4); }));
    var PAGE = 12, shown = PAGE;

    var badges = [];
    if (core.shows_this_year > 0 && P.yearOf(core.last_show) === P.yearOf(core.latest_show)) badges.push({ cls: 'cool', text: core.shows_this_year + (core.shows_this_year === 1 ? ' show' : ' shows') + ' this year', sub: 'latest ' + fmtDate(core.last_show) });
    if (core.shows >= 30) badges.push({ cls: 'gold', text: 'Staple', sub: n(core.shows) + ' shows over ' + years.size + ' years' });
    if (totalDebuts >= 5) badges.push({ cls: 'green', text: n(totalDebuts) + ' songs debuted here' });

    function showRow(s) {
      var bits = [];
      if (s.bustouts) bits.push('<span class="bo">' + n(s.bustouts) + ' bustout' + (s.bustouts > 1 ? 's' : '') + '</span>');
      if (s.debuts) bits.push('<span class="rec">' + n(s.debuts) + ' debut' + (s.debuts > 1 ? 's' : '') + '</span>');
      if (s.jamcharts) bits.push('<span class="jc">' + n(s.jamcharts) + ' jam chart</span>');
      if (s.longest_ms) bits.push('<span>' + mmss(s.longest_ms) + ' ' + esc(s.longest_song || '') + '</span>');
      return '<li><a class="date" href="' + P.showPage(s.showdate) + '">' + fmtDate(s.showdate) + '</a>' +
        '<span class="venue">' + (isVenue ? (s.tourname && s.tourname !== 'Not Part of a Tour' ? P.tourLink(tours, s.tourname) : '') : esc(s.venue)) + '</span>' +
        '<span class="gap">' + n(s.songs) + ' songs</span>' +
        (bits.length ? '<span class="slot">' + bits.join('') + '</span>' : '') + '</li>';
    }
    function songList(list, label, sub) {
      return '<div class="seg"><h3>' + esc(label) + '</h3><ol>' + list.map(function (s) {
        return '<li><a href="' + P.songPage(s.song) + '">' + esc(s.song) + '</a><span class="n">' + sub(s) + '</span></li>';
      }).join('') + '</ol></div>';
    }

    out.innerHTML =
      '<article class="song">' +
      '<header class="title">' +
        '<div class="eyebrow">' + (isVenue ? 'Venue' : 'City · ' + n(core.venues) + (core.venues === 1 ? ' venue' : ' venues')) + ' · ' + n(core.shows) + ' Phish shows, ' + P.yearOf(core.first_show) + ' to ' + P.yearOf(core.last_show) + '</div>' +
        '<h1>' + esc(name) + '</h1>' +
        (isVenue ? '<div class="by"><a href="' + P.cityPage(core.city, core.state) + '">' + esc(core.city + (core.state ? ', ' + core.state : '')) + '</a></div>' : '') +
      '</header>' +
      P.badgesHtml(badges) +
      '<div class="lead">' +
        '<div class="cell"><div class="num">' + n(core.shows) + '</div><div class="lab">Shows</div><div class="sub">' + P.pct(core.shows, core.all_shows) + ' of all Phish shows</div></div>' +
        '<div class="cell"><div class="num' + (totalBustouts ? ' hot' : '') + '">' + n(totalBustouts) + '</div><div class="lab">Bustouts</div><div class="sub">50+ show gaps</div></div>' +
        '<div class="cell"><div class="num">' + (longest[0] ? mmss(longest[0].ms) : '–') + '</div><div class="lab">Longest</div><div class="sub">' + (longest[0] ? esc(longest[0].song) : 'no lengths') + '</div></div>' +
      '</div>' +

      (!isVenue && venues.length > 1 ? '<section class="sec"><div class="head"><h2>Venues</h2></div><ol class="perf">' + venues.map(function (v) {
        return '<li><a class="date" href="' + P.venuePage(v.venueid) + '">' + esc(v.venue) + '</a><span class="venue">' + fmtDate(v.first_show) + ' to ' + fmtDate(v.last_show) + '</span><span class="gap">' + n(v.shows) + ' shows</span></li>';
      }).join('') + '</ol></section>' : '') +

      '<section class="sec"><div class="head"><h2>Shows</h2><span>newest first</span></div><ol class="perf" id="showList">' + shows.slice(0, PAGE).map(showRow).join('') + '</ol>' +
        (shows.length > PAGE ? '<button type="button" class="more" id="moreShows">Show ' + Math.min(PAGE, shows.length - PAGE) + ' more of ' + n(shows.length) + '</button>' : '') + '</section>' +

      '<section class="sec"><div class="head"><h2>Songs</h2><span>rates are plays per show</span></div><div class="segues">' +
        songList(favorites.length ? favorites : most.slice(0, 8), favorites.length ? (isVenue ? 'Comes out more here' : 'Comes out more in this city') : 'Most played here', function (s) { return favorites.length ? (Math.round(s.ratio * 10) / 10) + '× · ' + n(s.here) + ' of ' + n(core.shows) : n(s.here) + ' of ' + n(core.shows); }) +
        (never.length && core.shows >= 10 ? songList(never, 'Never played here', function (s) { return n(s.times_played) + '× elsewhere'; }) : songList(most.slice(0, 8), 'Most played here', function (s) { return n(s.here) + ' of ' + n(core.shows); })) +
      '</div></section>' +

      (longest.length ? '<section class="sec"><div class="head"><h2>Longest versions here</h2><span>LP LivePhish · PI phish.in</span></div><ol class="perf">' + longest.map(function (l) {
        return '<li><a class="date" href="' + P.showPage(l.show_date) + '">' + fmtDate(l.show_date) + '</a><span class="venue"><a href="' + P.songPage(l.song) + '">' + esc(l.song) + '</a>' + (!isVenue ? ' · ' + esc(l.venue) : '') + '</span><span class="gap"><span class="rec">' + mmss(l.ms) + ' <small>' + esc(l.source) + '</small></span></span></li>';
      }).join('') + '</ol></section>' : '') +

      (debuts.length ? '<section class="sec"><div class="head"><h2>Debuted here</h2><span>' + n(debuts.length) + ' songs</span></div><ol class="perf">' + debuts.slice(0, 10).map(function (d) {
        return '<li><a class="date" href="' + P.showPage(d.debut) + '">' + fmtDate(d.debut) + '</a><span class="venue"><a href="' + P.songPage(d.song) + '">' + esc(d.song) + '</a>' + (P.isCover(d.artist) ? ' · ' + esc(d.artist) : '') + '</span><span class="gap">' + n(d.times_played) + '× since</span></li>';
      }).join('') + '</ol>' + (debuts.length > 10 ? '<div class="more">' + n(debuts.length - 10) + ' more</div>' : '') + '</section>' : '') +
      '</article>';

    var more = document.getElementById('moreShows');
    if (more) more.addEventListener('click', function () {
      document.getElementById('showList').insertAdjacentHTML('beforeend', shows.slice(shown, shown + PAGE).map(showRow).join(''));
      shown += PAGE;
      if (shown >= shows.length) more.remove(); else more.textContent = 'Show ' + Math.min(PAGE, shows.length - shown) + ' more of ' + n(shows.length);
    });
  }

  window.Phish.renderPlace = renderPlace;
})();
