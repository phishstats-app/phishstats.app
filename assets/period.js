// Era, year and tour pages share this renderer; the only difference is the
// scope. Loaded after app.js and season-stats.js.
//
// The statistics are seasonStats(), the same function the landing page's
// season cards use - so a tour page and the "this tour" card on the landing
// page are the same numbers by construction, which
// tests/web-period-parity.test.js asserts.
(function () {
  'use strict';
  var P = window.Phish, api = P.api, esc = P.esc, n = P.n, fmtDate = P.fmtDate, mmss = P.mmss;

  // scope: { kind: 'tour', tour } | { kind: 'year', year } | { kind: 'era', era }
  function scopeParams(scope) {
    if (scope.kind === 'tour') return { tour: scope.tour };
    if (scope.kind === 'year') return { year: scope.year };
    return { era: scope.era };
  }

  // The stat card, in one shape whichever way it was computed.
  //
  // A tour fetches the per-show rows and reduces them here with the same
  // seasonStats() the landing page uses. A year or an era asks the server for
  // the answer instead: at era scale the rows are 81 KB gzipped to produce a
  // dozen numbers. tests/web-period-parity.test.js asserts the two paths agree.
  function cardFromRows(statRows, tops) {
    var st = P.seasonStats(statRows, tops);
    if (!st) return null;
    return {
      shows: st.shows, songs: st.songs, avgMs: st.avgMs, jams15: st.jams15,
      segues: st.segues, music: st.music,
      longest: st.longest
        ? { ms: st.longest.longest_ms, song: st.longest.longest_song, date: st.longest.showdate }
        : null,
      topsCount: st.tops.length,
      firsts: st.firsts, firstsCount: st.firsts.length,
    };
  }

  function cardFromSummary(row, firsts) {
    if (!row || !row.shows) return null;
    return {
      shows: row.shows, songs: row.songs_per_show, avgMs: row.avg_ms, jams15: row.jams15,
      segues: row.segues, music: row.music,
      longest: row.longest_ms
        ? { ms: row.longest_ms, song: row.longest_song, date: row.longest_date }
        : null,
      topsCount: row.tops,
      firsts: firsts || [], firstsCount: row.firsts,
    };
  }

  function renderPeriod(scope, out) {
    var A = scopeParams(scope);
    out.innerHTML = '<div class="state"><h1>' + esc(scope.label || '') + '</h1><p>Pulling the shows…</p></div>';
    var isTour = scope.kind === 'tour';
    var isYear = scope.kind === 'year';

    // A tour is the leaf of the hierarchy and the only page that lists shows,
    // so it is the one that gets the full stat treatment. A year and an era are
    // for getting somewhere: a short header, what is inside them, and - for an
    // era - a few notables. That is why neither fetches the song, debut or
    // per-show lists; on era 1.0 those were 19 KB gzipped to render a page
    // nobody reads that way.
    var isEra = scope.kind === 'era';
    Promise.all([
      api('period/core', A),
      isTour ? api('period/shows', A) : null,
      isTour ? api('period/stats', A) : null,
      isTour ? api('period/tops', A) : null,
      isTour ? null : api('period/summary', A),
      isTour ? null : api('period/firsts', A),
      isTour ? api('period/songs', A) : null,
      isTour ? api('period/debuts', A) : null,
      isTour || isEra ? api('period/bustouts', A) : null,
      isYear ? api('year/tours', { year: scope.year }) : null,
      isYear ? api('year/untoured', { year: scope.year }) : null,
      isEra ? api('era/years', { era: scope.era }) : null,
      // Three rows, so a year can name the era it belongs to in its crumbs
      // without this file keeping its own copy of the era boundaries.
      isYear ? api('eras/index') : null,
    ]).then(function (r) {
      var card = isTour ? cardFromRows(r[2], r[3]) : cardFromSummary(r[4] && r[4][0], r[5]);
      var summary = isTour ? null : (r[4] && r[4][0]);
      // A year lists the other years of its era, so you can step along them
      // without going back out to /eras. Which era that is only becomes known
      // when eras/index lands, so this one request follows the batch rather
      // than joining it; it is 18 rows at most, and the page is already
      // waiting on period/summary.
      var yearEra = isYear ? eraOfYear(r[12], scope.year) : null;
      var siblings = yearEra ? api('era/years', { era: yearEra.name }).catch(function () { return null; }) : null;
      return Promise.resolve(siblings).then(function (years) {
        render(scope, out, r[0][0], r[1], card, summary, r[6], r[7], r[8], r[9], r[10], r[11], r[12], yearEra, years);
      });
    }).catch(function (e) { out.innerHTML = P.errorState(e); });
  }

  // The era a year sits in, from the eras/index rows rather than a second copy
  // of the boundaries. Null if the list did not load; the crumb then stops at
  // the era index, which is where it pointed before.
  function eraOfYear(eras, year) {
    var y = String(year);
    for (var i = 0; eras && i < eras.length; i++) {
      if (y >= eras[i].first_show.slice(0, 4) && y <= eras[i].last_show.slice(0, 4)) return eras[i];
    }
    return null;
  }

  // Every year of this year's era, so the next one is a click rather than a
  // trip back out to /eras. The arrows step to the neighbouring year, and at
  // an era's edge they cross into the next era rather than dead-ending: 2000
  // steps forward to 2002, because 2001 has no shows to show.
  function yearStrip(year, eras, era, eraYears) {
    if (!era || !eraYears || !eraYears.length) return '';
    var ys = eraYears.map(function (r) { return Number(r.year); });
    var i = ys.indexOf(Number(year));
    var at = eras ? eras.indexOf(era) : -1;
    var before = at > 0 ? eras[at - 1] : null;
    var after = at >= 0 && at < eras.length - 1 ? eras[at + 1] : null;
    var prev = i > 0 ? ys[i - 1] : before ? Number(before.last_show.slice(0, 4)) : null;
    var next = i >= 0 && i < ys.length - 1 ? ys[i + 1] : after ? Number(after.first_show.slice(0, 4)) : null;
    var step = function (y, cls, glyph) {
      return y
        ? '<a class="step" href="/year/' + y + '" rel="' + cls + '" aria-label="' + y + '" title="' + y + '">' + glyph + '</a>'
        : '<span class="step off" aria-hidden="true">' + glyph + '</span>';
    };
    return '<nav class="yearstrip" aria-label="Years in Phish ' + esc(era.name) + '">' +
      step(prev, 'prev', '←') +
      '<span class="ys">' + ys.map(function (y) {
        return y === Number(year)
          ? '<span class="y now" aria-current="page">' + y + '</span>'
          : '<a class="y" href="/year/' + y + '">' + y + '</a>';
      }).join('') + '</span>' +
      step(next, 'next', '→') +
      '</nav>';
  }

  function render(scope, out, core, shows, card, summary, songs, debuts, bustouts, tours, untoured, years, eras, era, eraYears) {
    if (!core || !core.shows) {
      out.innerHTML = '<div class="state"><h1>Nothing here</h1><p>No Phish shows on record for this.</p></div>';
      return;
    }
    var isYear = scope.kind === 'year';
    var isTour = scope.kind === 'tour';
    // core.tourname is MIN(tourname) over the scope, which only means anything
    // for a tour: on era 1.0 it is "1983 Tour", the alphabetically first.
    var title = isTour ? (core.tourname || '') : (scope.label || '');
    document.title = title + ' · Phish.net local cache';
    // Era › year › tour, the way the pages nest. A tour's parent is the year
    // it starts in, a year's is its era, and an era's is the index.
    var yearEra = era || (isYear ? eraOfYear(eras, scope.year) : null);
    P.crumbs(isTour
      ? [{ text: String(core.first_year), href: '/year/' + core.first_year }, { text: title }]
      : isYear && yearEra
        ? [{ text: 'Eras', href: '/eras' }, { text: 'Phish ' + yearEra.name, href: '/era/' + yearEra.name }, { text: title }]
        : [{ text: 'Eras', href: '/eras' }, { text: title }]);

    var st = card;
    var span = core.first_show === core.last_show
      ? fmtDate(core.first_show)
      : fmtDate(core.first_show) + ' – ' + fmtDate(core.last_show);

    var badges = [];
    if (isTour && core.shows >= 40) badges.push({ cls: 'gold', text: 'Long tour', sub: n(core.shows) + ' shows' });
    if (isTour && debuts && debuts.length) badges.push({ cls: 'green', text: n(debuts.length) + ' debut' + (debuts.length === 1 ? '' : 's') });
    if (st && st.firstsCount) badges.push({ cls: 'hot', text: n(st.firstsCount) + ' all-time longest' });

    out.innerHTML =
      '<div class="title"><h1>' + esc(title) + '</h1>' +
      '<div class="by">' + esc(span) + ' · ' + n(core.shows) + ' shows · ' +
      n(core.venues) + ' venues in ' + n(core.cities) + ' cities</div>' +
      P.badgesHtml(badges) + '</div>' +
      (isYear ? yearStrip(scope.year, eras, yearEra, eraYears) : '') +
      // Tour: the full treatment. Era and year: brief, and what is inside them.
      // The show list leads. A tour page is reached to find out what the tour
      // played and when, the same way a year page leads with its tours; the
      // statistics are what you read once you are there.
      (isTour ? showsBlock(shows) : '') +
      (isTour ? statsBlock(st, core) : '') +
      (isTour ? songsBlock(songs, core) : '') +
      (isTour ? bustoutsBlock(bustouts) : '') +
      (isTour ? debutsBlock(debuts) : '') +
      (scope.kind === 'era' ? notablesBlock(st, summary, bustouts) : '') +
      (scope.kind === 'era' ? yearsBlock(years) : '') +
      (isYear ? toursBlock(tours, scope.year) : '') +
      (isYear ? untouredBlock(untoured) : '');

    // Centre the current year in the strip. An 18-year era overflows it, and
    // 2026 sat off the right edge with nothing on screen saying you were there.
    var here = out.querySelector('.yearstrip .now');
    if (here) {
      var box = here.parentNode;
      box.scrollLeft = Math.max(0, here.offsetLeft - (box.clientWidth - here.offsetWidth) / 2);
    }
  }

  // What made an era an era, in a dozen lines rather than a page of lists.
  // Everything here comes from period/summary plus the capped firsts and
  // bustout lists, so the whole era page is a couple of KB.
  function notablesBlock(st, summary, bustouts) {
    if (!st || !summary) return '';
    var lines = [];

    if (st.longest) {
      lines.push(['Longest version', esc(st.longest.song) + ' ' + mmss(st.longest.ms) +
        ' <a href="' + P.showPage(st.longest.date) + '">' + fmtDate(st.longest.date) + '</a>']);
    }
    if (st.firstsCount) {
      lines.push(['Still the longest ever', n(st.firstsCount) + ' version' +
        (st.firstsCount === 1 ? ' played here has' : 's played here have') + ' never been beaten' +
        (st.firsts.length ? ' — ' + st.firsts.slice(0, 4).map(function (t) {
          return esc(t.song) + ' <a href="' + P.showPage(t.show_date) + '">' + fmtDate(t.show_date) + '</a>';
        }).join(', ') : '')]);
    }
    if (summary.top_song) {
      lines.push(['Most played', esc(summary.top_song) + ' · ' + n(summary.top_song_plays) + ' times']);
    }
    if (summary.debut_count) {
      lines.push(['Songs debuted', n(summary.debut_count)]);
    }
    if (bustouts && bustouts.length) {
      var b = bustouts[0];
      lines.push(['Biggest bustout', esc(b.song) + ' after ' + n(b.gap) + ' shows · ' +
        '<a href="' + P.showPage(b.showdate) + '">' + fmtDate(b.showdate) + '</a>']);
    }
    lines.push(['Songs per show', st.songs.toFixed(1) +
      (st.avgMs ? ' · average length ' + mmss(st.avgMs) : '')]);

    if (!lines.length) return '';
    return '<section class="sec"><div class="head"><h2>Notable</h2></div>' +
      '<div class="seg card"><div class="lines">' + lines.map(function (l) {
        return '<div><b>' + l[0] + '</b> ' + l[1] + '</div>';
      }).join('') + '</div></div></section>';
  }

  // A year's tours. A run that crosses a New Year appears under both years,
  // so say how many of its shows fall in this one.
  function toursBlock(tours, year) {
    if (!tours || !tours.length) return '';
    return '<section class="sec"><div class="head"><h2>Tours</h2><span>' + n(tours.length) + '</span></div>' +
      '<ol class="perf">' + tours.map(function (t) {
        var crossed = Number(t.shows_this_year) !== Number(t.shows);
        return '<li><a class="date" href="/tour/' + t.tourid + '">' + esc(t.tourname) + '</a>' +
          '<span class="venue">' + fmtDate(t.first_show) + ' – ' + fmtDate(t.last_show) +
          ' · ' + n(t.venues) + (Number(t.venues) === 1 ? ' venue' : ' venues') + '</span>' +
          '<span class="gap">' + n(t.shows) + ' shows' +
          (crossed ? ' <small>' + n(t.shows_this_year) + ' in ' + year + '</small>' : '') + '</span></li>';
      }).join('') + '</ol></section>';
  }

  // Shows Phish.net files under no tour: festivals, television and studio
  // dates, one-offs. Grouped by venue and date on the server; never named,
  // because a name is a label their data does not carry.
  function untouredBlock(groups) {
    if (!groups || !groups.length) return '';
    var runs = groups.filter(function (g) { return g.shows.length > 1; });
    var singles = groups.filter(function (g) { return g.shows.length === 1; });
    var out = '<section class="sec"><div class="head"><h2>Not part of a tour</h2><span>' +
      n(groups.length) + (groups.length === 1 ? ' entry' : ' entries') + '</span></div><ol class="perf">';
    out += runs.map(function (g) {
      return '<li><a class="date" href="' + P.showPage(g.first) + '">' + fmtDate(g.first) + '</a>' +
        '<span class="venue">' + esc(g.label) + '</span>' +
        '<span class="gap">' + fmtDate(g.first) + ' – ' + fmtDate(g.last) + '</span>' +
        '<span class="slot">' + g.shows.map(function (s) {
          return '<a href="' + P.showPage(s.showdate) + '">' + fmtDate(s.showdate) + '</a>';
        }).join(' · ') + '</span></li>';
    }).join('');
    out += singles.map(function (g) {
      var s = g.shows[0];
      return '<li><a class="date" href="' + P.showPage(s.showdate) + '">' + fmtDate(s.showdate) + '</a>' +
        '<span class="venue"><a href="' + P.venuePage(s.venueid) + '">' + esc(s.venue) + '</a> · ' +
        esc(s.city + (s.state ? ', ' + s.state : '')) + '</span>' +
        '<span class="gap">' + n(s.songs) + ' songs</span></li>';
    }).join('');
    return out + '</ol></section>';
  }

  function statsBlock(st, core) {
    if (!st) return '';
    var rows = [
      ['Shows', n(st.shows)],
      ['Songs per show', st.songs.toFixed(1)],
      ['Average song length', st.avgMs ? mmss(st.avgMs) : '–'],
      ['15+ minute songs per show', st.jams15.toFixed(1)],
      ['Segues per show', st.segues.toFixed(1)],
      ['Music per show', st.music ? Math.round(st.music / 60000) + ' min' : '–'],
      ['Different songs', n(core.distinct_songs)],
    ];
    var lines = [];
    if (st.longest) {
      lines.push('<b>Longest</b> ' + esc(st.longest.song) + ' ' + mmss(st.longest.ms) +
        ' <a href="' + P.showPage(st.longest.date) + '">' + fmtDate(st.longest.date) + '</a>');
    }
    if (st.firstsCount) {
      lines.push('<b class="gold">All-time longest</b> ' + st.firsts.slice(0, 6).map(function (t) {
        return esc(t.song) + ' <a href="' + P.showPage(t.show_date) + '">' + fmtDate(t.show_date) + '</a>';
      }).join(', ') + (st.firstsCount > 6 ? ' and ' + n(st.firstsCount - 6) + ' more' : ''));
    }
    if (st.topsCount) lines.push('<b>Top-five versions</b> ' + n(st.topsCount));

    return '<section class="sec"><div class="head"><h2>The numbers</h2></div>' +
      '<div class="seg card"><div class="rows">' +
      rows.map(function (r) { return '<div class="row"><span>' + r[0] + '</span><b>' + r[1] + '</b></div>'; }).join('') +
      '</div>' + (lines.length ? '<div class="lines">' + lines.map(function (l) { return '<div>' + l + '</div>'; }).join('') + '</div>' : '') +
      '</div></section>';
  }

  // Songs that came out more here than they do everywhere, on the same
  // plays-per-show basis assets/place.js uses for a venue.
  function songsBlock(songs, core) {
    if (!songs.length) return '';
    var rated = songs.map(function (s) {
      var here = s.here / core.shows, overall = s.times_played / Math.max(1, s.shows_since_debut);
      return Object.assign({ ratio: overall > 0 ? here / overall : 0, hereRate: here }, s);
    });
    var most = rated.slice(0, 10);
    return '<section class="sec"><div class="head"><h2>Most played</h2><span>of ' + n(songs.length) + ' different songs</span></div>' +
      '<ol class="perf">' + most.map(function (s) {
        return '<li><a class="date" href="' + P.songPage(s.song) + '">' + esc(s.song) + '</a>' +
          '<span class="venue">' + Math.round(100 * s.hereRate) + '% of shows</span>' +
          '<span class="gap">' + n(s.here) + '×</span></li>';
      }).join('') + '</ol></section>';
  }

  function bustoutsBlock(bustouts) {
    if (!bustouts.length) return '';
    return '<section class="sec"><div class="head"><h2>Biggest bustouts</h2></div>' +
      '<ol class="perf">' + bustouts.slice(0, 10).map(function (b) {
        return '<li><a class="date" href="' + P.songPage(b.song) + '">' + esc(b.song) + '</a>' +
          '<span class="venue">' + esc(b.venue) + '</span>' +
          '<span class="gap hot">' + n(b.gap) + '-show gap</span>' +
          '<span class="slot"><a href="' + P.showPage(b.showdate) + '">' + fmtDate(b.showdate) + '</a></span></li>';
      }).join('') + '</ol></section>';
  }

  // Capped at 40. A modern tour debuts nothing or a handful; the 1990 Tour
  // debuted 39 and era 1.0 debuted 633, which is a wall of text rather than a
  // list. The count in the header is the real one.
  var DEBUTS_SHOWN = 40;

  function debutsBlock(debuts) {
    if (!debuts || !debuts.length) return '';
    var shown = debuts.slice(0, DEBUTS_SHOWN);
    return '<section class="sec"><div class="head"><h2>Debuts</h2><span>' + n(debuts.length) +
      (debuts.length > DEBUTS_SHOWN ? ', first ' + n(DEBUTS_SHOWN) : '') + '</span></div>' +
      '<ol class="perf">' + shown.map(function (d) {
        return '<li><a class="date" href="' + P.songPage(d.song) + '">' + esc(d.song) + '</a>' +
          (d.artist && d.artist !== 'Phish' ? '<span class="venue">' + esc(d.artist) + '</span>' : '<span class="venue"></span>') +
          '<span class="gap">' + n(d.times_played) + '× since</span>' +
          '<span class="slot"><a href="' + P.showPage(d.debut) + '">' + fmtDate(d.debut) + '</a></span></li>';
      }).join('') + '</ol></section>';
  }

  function showsBlock(shows) {
    if (!shows.length) return '';
    return '<section class="sec"><div class="head"><h2>Shows</h2><span>' + n(shows.length) + '</span></div>' +
      '<ol class="perf">' + shows.map(function (s) {
        var notes = [];
        if (s.bustouts) notes.push('<span class="bo">' + n(s.bustouts) + ' bustout' + (s.bustouts > 1 ? 's' : '') + '</span>');
        if (s.debuts) notes.push('<span class="rec">' + n(s.debuts) + ' debut' + (s.debuts > 1 ? 's' : '') + '</span>');
        if (s.jamcharts) notes.push('<span class="jc">' + n(s.jamcharts) + ' jam chart</span>');
        return '<li><a class="date" href="' + P.showPage(s.showdate) + '">' + fmtDate(s.showdate) + '</a>' +
          '<span class="venue"><a href="' + P.venuePage(s.venueid) + '">' + esc(s.venue) + '</a> · ' +
          esc(s.city + (s.state ? ', ' + s.state : '')) + '</span>' +
          '<span class="gap">' + n(s.songs) + ' songs</span>' +
          (notes.length ? '<span class="slot">' + notes.join('') + '</span>' : '') + '</li>';
      }).join('') + '</ol></section>';
  }

  // An era page lists its years and its tours rather than its shows: era 1.0
  // holds 1,205 of them, and listing those would defeat the drill-down the
  // hierarchy exists for.
  function yearsBlock(years) {
    if (!years || !years.length) return '';
    return '<section class="sec"><div class="head"><h2>Years</h2><span>' + n(years.length) + '</span></div>' +
      '<ol class="perf">' + years.map(function (y) {
        return '<li><a class="date" href="/year/' + y.year + '">' + y.year + '</a>' +
          '<span class="venue">' + n(y.tours) + (Number(y.tours) === 1 ? ' tour' : ' tours') +
          ' · ' + n(y.venues) + (Number(y.venues) === 1 ? ' venue' : ' venues') + '</span>' +
          '<span class="gap">' + n(y.shows) + (Number(y.shows) === 1 ? ' show' : ' shows') + '</span></li>';
      }).join('') + '</ol></section>';
  }

  // The index of eras. The names and ranges live in lib/web/eras.js, so this
  // page shows whatever is defined there rather than a hardcoded three.
  function renderEras(out) {
    out.innerHTML = '<div class="state"><h1>Eras</h1><p>Counting…</p></div>';
    api('eras/index').then(function (eras) {
      document.title = 'Eras · Phish.net local cache';
      P.crumbs([{ text: 'Eras' }]);
      out.innerHTML = '<div class="title"><h1>Eras</h1>' +
        '<div class="by">Phish stopped twice. The gaps are where the eras divide.</div></div>' +
        '<section class="sec"><ol class="perf">' + eras.map(function (e) {
          return '<li><a class="date" href="/era/' + encodeURIComponent(e.name) + '">Phish ' + esc(e.name) + '</a>' +
            '<span class="venue">' + fmtDate(e.first_show) + ' – ' + fmtDate(e.last_show) +
            ' · ' + n(e.years) + ' years · ' + n(e.tours) + ' tours</span>' +
            '<span class="gap">' + n(e.shows) + ' shows</span></li>';
        }).join('') + '</ol></section>';
    }).catch(function (e) { out.innerHTML = P.errorState(e); });
  }

  window.Phish.renderPeriod = renderPeriod;
  window.Phish.renderEras = renderEras;
})();
