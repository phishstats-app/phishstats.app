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

    // All three pages share one layout: what the scope is made of (a tour's
    // shows, a year's tours, an era's years), then the numbers, then every
    // all-time longest, top-five version, bustout and debut in full, each list
    // folding to its heading. The landing card's "and 23 more" lands on a
    // year's lists, so they cannot be samples.
    //
    // That is a real cost at era scale: era 1.0 is 816 top-five rows, 633
    // debuts and 519 bustouts, roughly 150 KB before gzip. The era statements
    // are warmed after every swap (lib/web/warm.js), so it is transfer, not
    // query time, that a reader waits on. period/tops replaces period/firsts
    // here, since the firsts are its #1 rows.
    var isEra = scope.kind === 'era';
    Promise.all([
      api('period/core', A),
      isTour ? api('period/shows', A) : null,
      isTour ? api('period/stats', A) : null,
      api('period/tops', A),
      isTour ? null : api('period/summary', A),
      null,
      api('period/songs', A),
      api('period/debuts', A),
      api('period/bustouts', A),
      isYear ? api('year/tours', { year: scope.year }) : null,
      isYear ? api('year/untoured', { year: scope.year }) : null,
      isEra ? api('era/years', { era: scope.era }) : null,
      // Three rows, so a year can name the era it belongs to in its crumbs
      // without this file keeping its own copy of the era boundaries.
      isYear ? api('eras/index') : null,
      // The era's superlatives (home court, longest run, favourite encore…),
      // the same statement the /eras page runs over the whole career.
      isEra ? api('period/notables', A) : null,
    ]).then(function (r) {
      var card = isTour ? cardFromRows(r[2], r[3]) : cardFromSummary(r[4] && r[4][0], firstsOf(r[3]));
      var tops = r[3];
      // A year lists the other years of its era, so you can step along them
      // without going back out to /eras. Which era that is only becomes known
      // when eras/index lands, so this one request follows the batch rather
      // than joining it; it is 18 rows at most, and the page is already
      // waiting on period/summary.
      var yearEra = isYear ? eraOfYear(r[12], scope.year) : null;
      var siblings = yearEra ? api('era/years', { era: yearEra.name }).catch(function () { return null; }) : null;
      return Promise.resolve(siblings).then(function (years) {
        render(scope, out, r[0][0], r[1], card, r[6], r[7], r[8], r[9], r[10], r[11], r[12], yearEra, years, tops, r[13] && r[13][0]);
      });
    }).catch(function (e) { out.innerHTML = P.errorState(e); });
  }

  // The all-time-longest versions among a year's top-five rows, longest first:
  // the order period/firsts returns them in.
  function firstsOf(tops) {
    return (tops || []).filter(function (t) { return t.rnk === 1; })
      .sort(function (a, b) { return b.ms - a.ms; });
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

  function render(scope, out, core, shows, card, songs, debuts, bustouts, tours, untoured, years, eras, era, eraYears, tops, notes) {
    if (!core || !core.shows) {
      out.innerHTML = '<div class="state"><h1>Nothing here</h1><p>No Phish shows on record for this.</p></div>';
      return;
    }
    var isYear = scope.kind === 'year';
    var isTour = scope.kind === 'tour';
    foldKind = scope.kind;
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
    // Links to the list it counts, like the numbers card's line does.
    if (st && st.firstsCount) badges.push({ cls: 'hot', text: n(st.firstsCount) + ' all-time longest', href: '#longest-ever' });

    var isEra = scope.kind === 'era';
    // A year and a tour put the links to their lists under The numbers; an
    // era puts them at the top, so its card links back up to nothing and
    // carries the era's superlatives instead.
    var parts = notables(st, core, tops, bustouts, debuts, songs,
      isEra ? notableLines(notes, true) : null, isEra);
    out.innerHTML =
      '<div class="title"><h1>' + esc(title) + '</h1>' +
      '<div class="by">' + esc(span) + ' · ' + n(core.shows) + ' shows · ' +
      n(core.venues) + ' venues in ' + n(core.cities) + ' cities</div>' +
      P.badgesHtml(badges) + '</div>' +
      (isYear ? yearStrip(scope.year, eras, yearEra, eraYears) : '') +
      // An era leads with links to everything below, under "Notable", then
      // its years: the page is long (era 1.0 lists 633 debuts), and the years
      // are where most readers are headed next.
      (isEra ? '<section class="sec"><div class="head"><h2>Notable</h2></div>' + parts.jumps + '</section>' : '') +
      // What the scope is made of leads, folding away so the lists are a
      // short scroll: a tour's shows, a year's tours, an era's years.
      (isTour ? showsBlock(shows) : '') +
      (isEra ? yearsBlock(years) : '') +
      (isYear ? toursBlock(tours, scope.year) : '') +
      (isYear ? untouredBlock(untoured) : '') +
      parts.stats + parts.lists;

    out.querySelectorAll('.sec-toggle').forEach(wireToggle);
    // A link to a section on this page (the jump list, the numbers card)
    // opens it first if it is folded, so the jump lands on a list.
    out.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('a[href^="#"]');
      if (a) unfold(a.getAttribute('href').slice(1));
    });

    // Centre the current year in the strip. An 18-year era overflows it, and
    // 2026 sat off the right edge with nothing on screen saying you were there.
    // Again whenever the pill or the strip changes size: measured before the
    // mono web font lands the pills are narrower, and the strip stopped 46px
    // short of 2026, cutting it in half. document.fonts.ready is not enough
    // on its own - it can resolve before the strip's font is even requested -
    // so the sizes themselves are watched, and the window as a fallback.
    var here = out.querySelector('.yearstrip .now');
    if (here) {
      var box = here.parentNode;
      var centre = function () {
        box.scrollLeft = Math.max(0, here.offsetLeft - (box.clientWidth - here.offsetWidth) / 2);
      };
      centre();
      if (window.ResizeObserver) {
        var ro = new ResizeObserver(centre);
        ro.observe(here);
        ro.observe(box);
      } else {
        window.addEventListener('resize', centre);
      }
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(centre);
    }

    // The landing card links to /year/2026#bustouts and so on. The sections
    // did not exist when the browser looked for the anchor, so look again.
    var target = location.hash.length > 1 ? document.getElementById(location.hash.slice(1)) : null;
    if (target) { unfold(target.id); target.scrollIntoView(); }
  }

  // The numbers, a row of links to each list below them, then the lists, each
  // folding to its heading. Only lists the scope has are linked. extra: more
  // lines for the numbers card. linksApart: the links are placed elsewhere
  // (an era's top), so they also lead to The numbers, and the card goes
  // without them.
  function notables(st, core, tops, bustouts, debuts, songs, extra, linksApart) {
    var blocks = [
      ['longest-ever', 'All-time longest', firstsBlock(tops)],
      ['top-five', 'Top-five versions', topFiveBlock(tops)],
      ['bustouts', 'Bustouts', bustoutsBlock(bustouts)],
      ['debuts', 'Debuts', debutsBlock(debuts)],
      ['most-played', 'Most played', songsBlock(songs, core)],
    ].filter(function (b) { return b[2]; });
    var links = (linksApart && st ? [['numbers', 'The numbers']] : []).concat(blocks);
    var jumps = links.length
      ? '<nav class="jumps" aria-label="On this page">' + links.map(function (b) {
        return '<a href="#' + b[0] + '">' + b[1] + '</a>';
      }).join('') + '</nav>'
      : '';
    return {
      jumps: jumps,
      stats: statsBlock(st, core, linksApart ? '' : jumps, extra),
      lists: blocks.map(function (b) { return b[2]; }).join(''),
    };
  }

  // What stood out, one line each, from a career/notables or period/notables
  // row. inEra drops the lines an era page already shows elsewhere: its most
  // played and biggest bustout head their own lists, and its card has a
  // longest-song line.
  function notableLines(r, inEra) {
    if (!r) return [];
    var song = function (name) { return '<a href="' + P.songPage(name) + '">' + esc(name) + '</a>'; };
    var show = function (date) { return '<a href="' + P.showPage(date) + '">' + fmtDate(date) + '</a>'; };
    var venue = function (id, name) { return '<a href="' + P.venuePage(id) + '">' + esc(name) + '</a>'; };
    var times = function (k) { return n(k) + (Number(k) === 1 ? ' time' : ' times'); };
    var lines = [];
    if (!inEra && r.top_song) lines.push('<b>Most played</b> ' + song(r.top_song) + ' · ' + n(r.top_song_shows) + ' shows');
    if (!inEra && r.bust_song) lines.push('<b class="red">Biggest bustout</b> ' + song(r.bust_song) + ' after ' + n(r.bust_gap) + ' shows · ' + show(r.bust_date));
    if (!inEra && r.long_song) {
      lines.push('<b class="gold">Longest version</b> ' + song(r.long_song) + ' ' + mmss(r.long_ms) + ' · ' + show(r.long_date) +
        (r.jam_ms > r.long_ms ? ' <small>(an untitled Jam ran ' + mmss(r.jam_ms) + ' on ' + show(r.jam_date) + ')</small>' : ''));
    }
    if (r.longshow_date) {
      lines.push('<b>Longest show</b> ' + show(r.longshow_date) + ' ' + esc(r.longshow_venue || '') + ' · ' +
        n(r.longshow_songs) + ' songs, ' + n(Math.round(r.longshow_ms / 60000)) + ' minutes of music');
    }
    if (r.home_venue) lines.push('<b>Home court</b> ' + venue(r.home_venueid, r.home_venue) + ' · ' + n(r.home_shows) + ' shows');
    if (r.run_shows > 1) {
      lines.push('<b>Longest run</b> ' + n(r.run_shows) + ' shows at ' + venue(r.run_venueid, r.run_venue) + ', ' +
        show(r.run_first) + ' – ' + show(r.run_last));
    }
    if (r.seg_from) lines.push('<b>Most common segue</b> ' + song(r.seg_from) + ' &gt; ' + song(r.seg_to) + ' · ' + times(r.seg_n));
    if (r.encore_song) lines.push('<b>Favorite encore</b> ' + song(r.encore_song) + ' · ' + times(r.encore_n));
    if (r.opener_song) lines.push('<b>Favorite opener</b> ' + song(r.opener_song) + ' · ' + times(r.opener_n));
    return lines;
  }

  // Open a folded section for this visit without changing the remembered
  // choice: following a link to a list is not a vote to keep it open.
  function unfold(id) {
    var body = document.getElementById('fold-' + id);
    if (!body || !body.hidden) return;
    body.hidden = false;
    var btn = document.querySelector('[data-fold="' + id + '"]');
    if (btn) { btn.textContent = 'Hide'; btn.setAttribute('aria-expanded', 'true'); }
  }

  // A section that folds to its heading. The choice is remembered in this
  // browser per kind of page and section (fold:era:debuts), not per year or
  // tour, so stepping along the year strip keeps it, while hiding an era's
  // 633 debuts does not hide a tour's three. An in-memory copy covers a
  // browser that blocks localStorage. foldKind is set by render().
  var folded = {}, foldKind = '';
  function store(key) { return 'fold:' + foldKind + ':' + key; }
  function isFolded(key) {
    if (key in folded) return folded[key];
    try { return localStorage.getItem(store(key)) === '1'; } catch (e) { return false; }
  }
  function foldHead(key, title, count) {
    var shut = isFolded(key);
    return '<div class="head"><h2>' + title + '</h2><span>' + count +
      ' <button type="button" class="sec-toggle" data-fold="' + key + '" aria-controls="fold-' + key + '" aria-expanded="' + !shut + '">' +
      (shut ? 'Show' : 'Hide') + '</button></span></div>';
  }
  function foldBody(key) {
    return ' id="fold-' + key + '"' + (isFolded(key) ? ' hidden' : '');
  }
  function wireToggle(btn) {
    btn.addEventListener('click', function () {
      var key = btn.getAttribute('data-fold'), body = document.getElementById('fold-' + key);
      var shut = !body.hidden;
      body.hidden = shut;
      btn.textContent = shut ? 'Show' : 'Hide';
      btn.setAttribute('aria-expanded', String(!shut));
      folded[key] = shut;
      try { localStorage.setItem(store(key), shut ? '1' : '0'); } catch (e) {}
    });
  }

  // A year's tours. A run that crosses a New Year appears under both years,
  // so say how many of its shows fall in this one.
  function toursBlock(tours, year) {
    if (!tours || !tours.length) return '';
    return '<section class="sec">' + foldHead('tours', 'Tours', n(tours.length)) +
      '<ol class="perf"' + foldBody('tours') + '>' + tours.map(function (t) {
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
    var out = '<section class="sec">' + foldHead('untoured', 'Not part of a tour',
      n(groups.length) + (groups.length === 1 ? ' entry' : ' entries')) + '<ol class="perf"' + foldBody('untoured') + '>';
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

  // The all-time longest and top-five versions are listed in full further
  // down, so the card links to them instead of naming a few. after: HTML
  // placed under the card, inside the section (the links to the lists).
  // extra: more lines for the card (an era's superlatives).
  function statsBlock(st, core, after, extra) {
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
      lines.push('<b>Longest song</b> ' + esc(st.longest.song) + ' ' + mmss(st.longest.ms) +
        ' <a href="' + P.showPage(st.longest.date) + '">' + fmtDate(st.longest.date) + '</a>');
    }
    if (st.firstsCount) {
      lines.push('<b class="gold">All-time longest</b> <a href="#longest-ever">' + n(st.firstsCount) +
        (st.firstsCount === 1 ? ' version' : ' versions') + '</a>');
    }
    if (st.topsCount) lines.push('<b>Top-five versions</b> <a href="#top-five">' + n(st.topsCount) + '</a>');

    lines = lines.concat(extra || []);

    return '<section class="sec" id="numbers"><div class="head"><h2>The numbers</h2></div>' +
      '<div class="seg card"><div class="rows">' +
      rows.map(function (r) { return '<div class="row"><span>' + r[0] + '</span><b>' + r[1] + '</b></div>'; }).join('') +
      '</div>' + (lines.length ? '<div class="lines">' + lines.map(function (l) { return '<div>' + l + '</div>'; }).join('') + '</div>' : '') +
      '</div>' + (after || '') + '</section>';
  }

  // A list section's opening: heading, count, the Hide/Show button and the id
  // the button controls. The key is also the section's id, so
  // /year/2026#bustouts both finds and opens it.
  function listOpen(key, title, count) {
    return '<section class="sec" id="' + key + '">' + foldHead(key, title, count) +
      '<ol class="perf"' + foldBody(key) + '>';
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
    return listOpen('most-played', 'Most played', 'of ' + n(songs.length) + ' different songs') + most.map(function (s) {
        return '<li><a class="date" href="' + P.songPage(s.song) + '">' + esc(s.song) + '</a>' +
          '<span class="venue">' + Math.round(100 * s.hereRate) + '% of shows</span>' +
          '<span class="gap">' + n(s.here) + '×</span></li>';
      }).join('') + '</ol></section>';
  }

  // Every one, biggest gap first.
  function bustoutsBlock(bustouts) {
    if (!bustouts || !bustouts.length) return '';
    return listOpen('bustouts', 'Bustouts', n(bustouts.length) + ', biggest gap first') +
      bustouts.map(function (b) {
        return '<li><a class="date" href="' + P.songPage(b.song) + '">' + esc(b.song) + '</a>' +
          '<span class="venue">' + esc(b.venue) + '</span>' +
          '<span class="gap hot">' + n(b.gap) + '-show gap</span>' +
          '<span class="slot"><a href="' + P.showPage(b.showdate) + '">' + fmtDate(b.showdate) + '</a></span></li>';
      }).join('') + '</ol></section>';
  }

  // Every version played in the scope that is still the longest ever timed,
  // longest first. tops is period/tops: versions ranking in their song's
  // all-time top five, among songs with ten or more timed versions.
  function firstsBlock(tops) {
    var rows = firstsOf(tops);
    if (!rows.length) return '';
    return listOpen('longest-ever', 'All-time longest',
      n(rows.length) + (rows.length === 1 ? ' version' : ' versions') + ' never beaten') + rows.map(function (t) {
        return '<li><a class="date" href="' + P.songPage(t.song) + '">' + esc(t.song) + '</a>' +
          '<span class="venue">longest of ' + n(t.cnt) + ' timed</span>' +
          '<span class="gap gold">' + mmss(t.ms) + '</span>' +
          '<span class="slot"><a href="' + P.showPage(t.show_date) + '">' + fmtDate(t.show_date) + '</a></span></li>';
      }).join('') + '</ol></section>';
  }

  // The rest of the top five: #2 to #5, best rank first, then longest. The #1s
  // are the list above, so they are not repeated here.
  function topFiveBlock(tops) {
    var all = tops || [];
    var rows = all.filter(function (t) { return t.rnk > 1; })
      .sort(function (a, b) { return a.rnk - b.rnk || b.ms - a.ms; });
    if (!rows.length) return '';
    var firsts = all.length - rows.length;
    return listOpen('top-five', 'Top-five versions',
      n(rows.length) + ' at #2 to #5' + (firsts ? ', plus the ' + n(firsts) + ' above' : '')) + rows.map(function (t) {
        return '<li><a class="date" href="' + P.songPage(t.song) + '">' + esc(t.song) + '</a>' +
          '<span class="venue">#' + t.rnk + ' of ' + n(t.cnt) + ' timed</span>' +
          '<span class="gap">' + mmss(t.ms) + '</span>' +
          '<span class="slot"><a href="' + P.showPage(t.show_date) + '">' + fmtDate(t.show_date) + '</a></span></li>';
      }).join('') + '</ol></section>';
  }

  // Every one, uncapped: era 1.0 debuted 633, which is long, but it folds,
  // and a list that stops at 40 would not be the list the count names.
  function debutsBlock(debuts) {
    if (!debuts || !debuts.length) return '';
    return listOpen('debuts', 'Debuts', n(debuts.length)) + debuts.map(function (d) {
        return '<li><a class="date" href="' + P.songPage(d.song) + '">' + esc(d.song) + '</a>' +
          (d.artist && d.artist !== 'Phish' ? '<span class="venue">' + esc(d.artist) + '</span>' : '<span class="venue"></span>') +
          '<span class="gap">' + n(d.times_played) + '× since</span>' +
          '<span class="slot"><a href="' + P.showPage(d.debut) + '">' + fmtDate(d.debut) + '</a></span></li>';
      }).join('') + '</ol></section>';
  }

  function showsBlock(shows) {
    if (!shows.length) return '';
    return listOpen('shows', 'Shows', n(shows.length)) + shows.map(function (s) {
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
    return listOpen('years', 'Years', n(years.length)) + years.map(function (y) {
        return '<li><a class="date" href="/year/' + y.year + '">' + y.year + '</a>' +
          '<span class="venue">' + n(y.tours) + (Number(y.tours) === 1 ? ' tour' : ' tours') +
          ' · ' + n(y.venues) + (Number(y.venues) === 1 ? ' venue' : ' venues') + '</span>' +
          '<span class="gap">' + n(y.shows) + (Number(y.shows) === 1 ? ' show' : ' shows') + '</span></li>';
      }).join('') + '</ol></section>';
  }

  // The index of eras. The names and ranges live in lib/web/eras.js, so this
  // page shows whatever is defined there rather than a hardcoded three.
  //
  // The eras lead, so the way into one is the first thing on the page; the
  // whole career follows, then the eras side by side. The list renders as
  // soon as eras/index lands and the career fills in after it.
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
        }).join('') + '</ol></section><div id="career"></div>';
      var slot = out.querySelector('#career');
      Promise.all([api('career/summary'), api('career/notables'), api('eras/compare')]).then(function (r) {
        slot.innerHTML = careerBlock(r[0][0], r[1][0]) + compareBlock(r[2], eras, r[0][0]);
      }).catch(function () { slot.innerHTML = ''; });
    }).catch(function (e) { out.innerHTML = P.errorState(e); });
  }

  // The whole career: the totals, then what stood out.
  function careerBlock(c, notes) {
    if (!c || !c.shows) return '';
    // [label, value, the /browse page listing what it counts]. Both the label
    // and the number link there; a row with no list behind it is plain.
    var a = function (href, text) { return '<a href="' + href + '">' + text + '</a>'; };
    var rows = [
      ['Shows', n(c.shows)],
      ['Years', n(c.years), '/browse/years'],
      ['Tours', n(c.tours), '/browse/tours'],
      ['Venues', n(c.venues), '/browse/venues'],
      ['Cities', n(c.cities), '/browse/cities'],
      ['US states', n(c.us_states), '/browse/states'],
      ['Countries', n(c.countries), '/browse/countries'],
      ['Different songs', a('/browse/songs', n(c.songs)) + ' <small>' + a('/browse/songs?only=originals', n(c.originals) + ' originals') +
        ' · ' + a('/browse/songs?only=covers', n(c.covers) + ' covers') + '</small>', '/browse/songs', true],
      ['Songs performed', n(c.performances)],
      ['Segues', n(c.segues)],
      ['Jam chart entries', n(c.jamcharts)],
      ['Songs played once', n(c.one_and_done), '/browse/once'],
      ['Timed music', n(Math.round(c.timed_ms / 3600000)) + ' hours <small>' + n(c.timed) + ' versions</small>'],
    ];
    var lines = notableLines(notes, false);
    return '<section class="sec"><div class="head"><h2>The career</h2><span>' +
      fmtDate(c.first_show) + ' – ' + fmtDate(c.last_show) + '</span></div>' +
      '<div class="seg card"><div class="rows">' +
      rows.map(function (r) {
        // r[3]: the value already carries its own links.
        var label = r[2] ? a(r[2], r[0]) : r[0], value = r[2] && !r[3] ? a(r[2], r[1]) : r[1];
        return '<div class="row"><span>' + label + '</span><b>' + value + '</b></div>';
      }).join('') +
      '</div>' + (lines.length ? '<div class="lines">' + lines.map(function (l) { return '<div>' + l + '</div>'; }).join('') + '</div>' : '') +
      '</div></section>';
  }

  // The eras side by side, each column linking into its era, then the whole
  // career in an "All" column. That column is built from career/summary
  // rather than by averaging the eras: an average of three per-show rates
  // would weigh 2.0's 63 shows the same as 1.0's 1,205.
  function compareBlock(rows, eras, c) {
    if (!rows || !rows.length) return '';
    var years = {};
    (eras || []).forEach(function (e) { years[e.name] = e.years; });
    var cols = rows.slice();
    if (c && c.shows) {
      cols.push({
        name: 'All', all: true, shows: c.shows, years: c.years,
        songs_per_show: c.performances / c.shows, segues_per_show: c.segues / c.shows,
        avg_ms: c.timed ? c.timed_ms / c.timed : 0, timed: c.timed,
        // The eras partition the career, so their debuts add up to it.
        debuts: rows.reduce(function (a, r) { return a + Number(r.debuts || 0); }, 0),
      });
    }
    var line = function (label, cell) {
      return '<tr><th scope="row">' + label + '</th>' + cols.map(function (r) {
        return '<td' + (r.all ? ' class="all"' : '') + '>' + cell(r) + '</td>';
      }).join('') + '</tr>';
    };
    return '<section class="sec"><div class="head"><h2>Across the eras</h2></div>' +
      '<div class="seg card"><table class="cmp"><thead><tr><th></th>' + cols.map(function (r) {
        return r.all
          ? '<th scope="col" class="all">All</th>'
          : '<th scope="col"><a href="/era/' + encodeURIComponent(r.name) + '">' + esc(r.name) + '</a></th>';
      }).join('') + '</tr></thead><tbody>' +
      line('Shows', function (r) { return n(r.shows); }) +
      line('Years', function (r) { return r.all ? n(r.years) : years[r.name] != null ? n(years[r.name]) : '–'; }) +
      line('Songs per show', function (r) { return Number(r.songs_per_show).toFixed(1); }) +
      line('Segues per show', function (r) { return Number(r.segues_per_show).toFixed(1); }) +
      line('Average song length', function (r) { return r.avg_ms ? mmss(r.avg_ms) + '<small>' + n(r.timed) + ' timed</small>' : '–'; }) +
      line('Songs debuted', function (r) { return n(r.debuts); }) +
      '</tbody></table></div>' +
      '<div class="none">Average length is over the versions with an official or phish.in time. 2.0 has far fewer of those, so its average rests on less.</div></section>';
  }

  window.Phish.renderPeriod = renderPeriod;
  window.Phish.renderEras = renderEras;
})();
