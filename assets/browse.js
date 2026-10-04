// The /browse pages: the lists behind the numbers on the /eras career card.
// One renderer per kind, all from four statements (browse/years, browse/venues,
// browse/songs, browse/once) plus catalog/tours and eras/index. Venues, cities,
// US states and countries are one list (browse/venues) grouped four ways, so
// their counts cannot disagree with each other or with career/summary.
// Loaded after app.js.
(function () {
  'use strict';
  var P = window.Phish, api = P.api, esc = P.esc, n = P.n, fmtDate = P.fmtDate;

  // Every kind, in the order the switcher shows them. The server's
  // BROWSE_KINDS in web.js is the same set.
  var KINDS = [
    ['years', 'Years'], ['tours', 'Tours'], ['venues', 'Venues'], ['cities', 'Cities'],
    ['states', 'US states'], ['countries', 'Countries'], ['songs', 'Songs'], ['once', 'Played once'],
  ];

  // An id-safe slug for anchors: /browse/venues#s-usa-vt.
  function slug(text) { return String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'none'; }
  function plural(k, one, many) { return n(k) + ' ' + (Number(k) === 1 ? one : many); }
  function years(a, b) { var x = String(a).slice(0, 4), y = String(b).slice(0, 4); return x === y ? x : x + '–' + y; }
  function byText(a, b) { return String(a).localeCompare(String(b), 'en', { sensitivity: 'base' }); }

  function header(kind, title, by) {
    return '<div class="title"><h1>' + esc(title) + '</h1><div class="by">' + by + '</div></div>' +
      '<nav class="jumps switch" aria-label="Browse">' + KINDS.map(function (k) {
        return k[0] === kind
          ? '<span class="now" aria-current="page">' + k[1] + '</span>'
          : '<a href="/browse/' + k[0] + '">' + k[1] + '</a>';
      }).join('') + '</nav>';
  }
  function section(id, title, count, body) {
    return '<section class="sec"' + (id ? ' id="' + id + '"' : '') + '><div class="head"><h2>' + title + '</h2>' +
      (count ? '<span>' + count + '</span>' : '') + '</div>' + body + '</section>';
  }
  function list(rows, row) { return '<ol class="perf">' + rows.map(row).join('') + '</ol>'; }
  // Links to each group further down, as on the era, year and tour pages.
  function jumps(groups) {
    return groups.length > 1
      ? '<nav class="jumps" aria-label="On this page">' + groups.map(function (g) {
        return '<a href="#' + g.id + '">' + esc(g.label) + '</a>';
      }).join('') + '</nav>'
      : '';
  }
  // The era a year falls in, from eras/index; null if that did not load.
  function eraOf(eras, year) {
    var y = String(year);
    for (var i = 0; eras && i < eras.length; i++) {
      if (y >= eras[i].first_show.slice(0, 4) && y <= eras[i].last_show.slice(0, 4)) return eras[i];
    }
    return null;
  }
  // Rows grouped by era, in era order. Rows with no era (eras/index failed)
  // become one unnamed group.
  function byEra(rows, eras, yearOf) {
    var groups = [], at = {};
    rows.forEach(function (r) {
      var e = eraOf(eras, yearOf(r)), key = e ? e.name : '';
      if (!(key in at)) { at[key] = groups.length; groups.push({ id: e ? 'era-' + slug(e.name) : 'all', label: e ? 'Phish ' + e.name : 'All', rows: [] }); }
      groups[at[key]].rows.push(r);
    });
    return groups;
  }

  // ---- years and tours ----------------------------------------------------
  function renderYears(out) {
    return Promise.all([api('browse/years'), api('eras/index').catch(function () { return null; })]).then(function (r) {
      var rows = r[0], groups = byEra(rows, r[1], function (y) { return y.year; });
      var shows = rows.reduce(function (a, y) { return a + y.shows; }, 0);
      out.innerHTML = header('years', 'Years', n(rows.length) + ' years with shows, ' + rows[0].year + ' – ' + rows[rows.length - 1].year +
        ' · ' + n(shows) + ' shows') + jumps(groups) +
        groups.map(function (g) {
          return section(g.id, g.label, plural(g.rows.length, 'year', 'years'), list(g.rows, function (y) {
            return '<li><a class="date" href="/year/' + y.year + '">' + y.year + '</a>' +
              '<span class="venue">' + plural(y.tours, 'tour', 'tours') + ' · ' + plural(y.venues, 'venue', 'venues') + '</span>' +
              '<span class="gap">' + plural(y.shows, 'show', 'shows') + '</span></li>';
          }));
        }).join('');
    });
  }

  function renderTours(out) {
    return Promise.all([api('catalog/tours'), api('eras/index').catch(function () { return null; })]).then(function (r) {
      var rows = r[0].slice().sort(function (a, b) { return byText(a.first_show, b.first_show) || a.tourid - b.tourid; });
      var groups = byEra(rows, r[1], function (t) { return t.first_show.slice(0, 4); });
      out.innerHTML = header('tours', 'Tours', n(rows.length) + ' tours, in the order they started') + jumps(groups) +
        groups.map(function (g) {
          return section(g.id, g.label, plural(g.rows.length, 'tour', 'tours'), list(g.rows, function (t) {
            return '<li><a class="date" href="/tour/' + t.tourid + '">' + esc(t.tourname) + '</a>' +
              '<span class="venue">' + (t.first_show === t.last_show ? fmtDate(t.first_show) : fmtDate(t.first_show) + ' – ' + fmtDate(t.last_show)) + '</span>' +
              '<span class="gap">' + plural(t.shows, 'show', 'shows') + '</span></li>';
          }));
        }).join('') +
        '<div class="none">Shows Phish.net files under no tour (festivals, one-offs) are on their year pages instead.</div>';
    });
  }

  // ---- places -------------------------------------------------------------
  // browse/venues grouped by country, then state, alphabetically, the way
  // the venues and cities pages both lay out. pick(rows) turns a state's
  // venues into the rows that page lists.
  function countries(venues) {
    var map = {};
    venues.forEach(function (v) {
      var c = v.country || 'Unknown', s = v.state || '';
      var C = map[c] || (map[c] = { country: c, states: {}, shows: 0, venues: 0, cities: {} });
      (C.states[s] || (C.states[s] = [])).push(v);
      C.shows += v.shows; C.venues += 1; C.cities[v.city + '|' + v.state] = 1;
    });
    return Object.keys(map).sort(byText).map(function (c) {
      var C = map[c];
      C.id = 'c-' + slug(c);
      C.stateList = Object.keys(C.states).sort(byText).map(function (s) {
        return { state: s, id: 's-' + slug(c) + '-' + slug(s), venues: C.states[s] };
      });
      return C;
    });
  }

  function placesPage(out, kind, title, by, cs, rowsOf, row) {
    out.innerHTML = header(kind, title, by) +
      jumps(cs.map(function (c) { return { id: c.id, label: c.country }; })) +
      cs.map(function (c) {
        return '<section class="sec" id="' + c.id + '"><div class="head"><h2>' + esc(c.country) + '</h2><span>' +
          plural(c.shows, 'show', 'shows') + '</span></div>' +
          c.stateList.map(function (s) {
            var rows = rowsOf(s.venues);
            return (s.state ? '<h3 class="group" id="' + s.id + '">' + esc(s.state) + '</h3>' : '') + list(rows, row);
          }).join('') + '</section>';
      }).join('');
  }

  function renderVenues(out) {
    return api('browse/venues').then(function (venues) {
      var cs = countries(venues);
      placesPage(out, 'venues', 'Venues', n(venues.length) + ' venues in ' + plural(cs.length, 'country', 'countries') +
        ', by country, state and city', cs,
        function (vs) { return vs.slice().sort(function (a, b) { return byText(a.city, b.city) || byText(a.venue, b.venue); }); },
        function (v) {
          return '<li><a class="date" href="' + P.venuePage(v.venueid) + '">' + esc(v.venue) + '</a>' +
            '<span class="venue"><a href="' + P.cityPage(v.city, v.state) + '">' + esc(v.city) + '</a></span>' +
            '<span class="gap">' + plural(v.shows, 'show', 'shows') + '</span>' +
            '<span class="slot">' + (v.first_show === v.last_show ? fmtDate(v.first_show) : fmtDate(v.first_show) + ' – ' + fmtDate(v.last_show)) + '</span></li>';
        });
    });
  }

  // A state's venues folded into its cities.
  function citiesOf(vs) {
    var map = {};
    vs.forEach(function (v) {
      var k = v.city + '|' + v.state;
      var c = map[k] || (map[k] = { city: v.city, state: v.state, shows: 0, venues: 0, first: v.first_show, last: v.last_show });
      c.shows += v.shows; c.venues += 1;
      if (v.first_show < c.first) c.first = v.first_show;
      if (v.last_show > c.last) c.last = v.last_show;
    });
    return Object.keys(map).map(function (k) { return map[k]; }).sort(function (a, b) { return byText(a.city, b.city); });
  }

  function renderCities(out) {
    return api('browse/venues').then(function (venues) {
      var cs = countries(venues);
      var total = cs.reduce(function (a, c) { return a + Object.keys(c.cities).length; }, 0);
      placesPage(out, 'cities', 'Cities', n(total) + ' cities in ' + plural(cs.length, 'country', 'countries') + ', by country and state', cs,
        citiesOf,
        function (c) {
          return '<li><a class="date" href="' + P.cityPage(c.city, c.state) + '">' + esc(c.city) + '</a>' +
            '<span class="venue">' + plural(c.venues, 'venue', 'venues') + ' · ' + years(c.first, c.last) + '</span>' +
            '<span class="gap">' + plural(c.shows, 'show', 'shows') + '</span></li>';
        });
    });
  }

  function renderStates(out) {
    return api('browse/venues').then(function (venues) {
      var us = countries(venues).filter(function (c) { return c.country === 'USA'; })[0];
      var rows = us ? us.stateList.map(function (s) {
        var cities = citiesOf(s.venues);
        return {
          state: s.state, id: s.id, cities: cities.length, venues: s.venues.length,
          shows: s.venues.reduce(function (a, v) { return a + v.shows; }, 0),
          first: s.venues.reduce(function (a, v) { return v.first_show < a ? v.first_show : a; }, '9999'),
          last: s.venues.reduce(function (a, v) { return v.last_show > a ? v.last_show : a; }, '0000'),
        };
      }) : [];
      out.innerHTML = header('states', 'US states', n(rows.length) + ' states, alphabetically') +
        section('', 'States', '', list(rows, function (s) {
          return '<li><a class="date" href="/browse/venues#' + s.id + '">' + esc(s.state || '–') + '</a>' +
            '<span class="venue">' + plural(s.cities, 'city', 'cities') + ' · ' + plural(s.venues, 'venue', 'venues') + ' · ' + years(s.first, s.last) + '</span>' +
            '<span class="gap">' + plural(s.shows, 'show', 'shows') + '</span>' +
            '<span class="slot"><a href="/browse/cities#' + s.id + '">its cities</a><a href="/browse/venues#' + s.id + '">its venues</a></span></li>';
        })) +
        '<div class="none">Shows outside the US are on the countries page, with their provinces and regions on the venues and cities pages.</div>';
    });
  }

  function renderCountries(out) {
    return api('browse/venues').then(function (venues) {
      var cs = countries(venues);
      out.innerHTML = header('countries', 'Countries', plural(cs.length, 'country', 'countries') + ', alphabetically') +
        section('', 'Countries', '', list(cs, function (c) {
          var first = '9999', last = '0000';
          venues.forEach(function (v) { if ((v.country || 'Unknown') === c.country) { if (v.first_show < first) first = v.first_show; if (v.last_show > last) last = v.last_show; } });
          return '<li><a class="date" href="/browse/venues#' + c.id + '">' + esc(c.country) + '</a>' +
            '<span class="venue">' + plural(Object.keys(c.cities).length, 'city', 'cities') + ' · ' + plural(c.venues, 'venue', 'venues') + ' · ' + years(first, last) + '</span>' +
            '<span class="gap">' + plural(c.shows, 'show', 'shows') + '</span>' +
            '<span class="slot"><a href="/browse/cities#' + c.id + '">its cities</a><a href="/browse/venues#' + c.id + '">its venues</a></span></li>';
        }));
    });
  }

  // ---- songs --------------------------------------------------------------
  // Originals are Phish and the members' own projects (P.isCover), as
  // everywhere on the site. Seven songs carry no artist credit at all; they
  // are in "All" and in neither half.
  function kindOf(s) {
    if (!s.artist || !String(s.artist).trim()) return 'uncredited';
    return P.isCover(s.artist) ? 'covers' : 'originals';
  }
  // Sort key: a title's first letter or digit, so "(I Can't Get No)
  // Satisfaction" files under I and '"Hey" Stranger' under H.
  function titleKey(t) { return String(t).replace(/^[^a-z0-9]+/i, ''); }
  function letterOf(t) { var c = titleKey(t).charAt(0).toUpperCase(); return /[A-Z]/.test(c) ? c : '#'; }

  function renderSongs(out) {
    return api('browse/songs').then(function (songs) {
      var q = new URLSearchParams(location.search);
      var only = { originals: 1, covers: 1 }[q.get('only')] ? q.get('only') : 'all';
      var sort = { plays: 1, debut: 1 }[q.get('sort')] ? q.get('sort') : 'az';
      var counts = { all: songs.length, originals: 0, covers: 0, uncredited: 0 };
      songs.forEach(function (s) { counts[kindOf(s)] += 1; });

      var rows = songs.filter(function (s) { return only === 'all' || kindOf(s) === only; });
      rows.sort(sort === 'plays' ? function (a, b) { return b.times_played - a.times_played || byText(titleKey(a.song), titleKey(b.song)); }
        : sort === 'debut' ? function (a, b) { return byText(a.debut || '', b.debut || '') || byText(titleKey(a.song), titleKey(b.song)); }
        : function (a, b) { return byText(titleKey(a.song), titleKey(b.song)); });

      var link = function (o, s) {
        var p = new URLSearchParams();
        if (o !== 'all') p.set('only', o);
        if (s !== 'az') p.set('sort', s);
        var qs = p.toString();
        return '/browse/songs' + (qs ? '?' + qs : '');
      };
      var pill = function (on, href, text) { return on ? '<span class="now" aria-current="true">' + text + '</span>' : '<a href="' + href + '">' + text + '</a>'; };
      var controls = '<nav class="jumps" aria-label="Which songs">' +
        pill(only === 'all', link('all', sort), 'All ' + n(counts.all)) +
        pill(only === 'originals', link('originals', sort), 'Originals ' + n(counts.originals)) +
        pill(only === 'covers', link('covers', sort), 'Covers ' + n(counts.covers)) + '</nav>' +
        '<nav class="jumps" aria-label="Order">' +
        pill(sort === 'az', link(only, 'az'), 'A–Z') +
        pill(sort === 'plays', link(only, 'plays'), 'Most played') +
        pill(sort === 'debut', link(only, 'debut'), 'By debut') + '</nav>';

      // A–Z gets a letter index and one list per letter.
      var body;
      if (sort === 'az') {
        var groups = [], at = {};
        rows.forEach(function (s) {
          var L = letterOf(s.song);
          if (!(L in at)) { at[L] = groups.length; groups.push({ id: 'l-' + (L === '#' ? 'num' : L.toLowerCase()), label: L, rows: [] }); }
          groups[at[L]].rows.push(s);
        });
        body = jumps(groups) + groups.map(function (g) { return '<h3 class="group" id="' + g.id + '">' + g.label + '</h3>' + list(g.rows, songRow); }).join('');
      } else {
        body = list(rows, songRow);
      }

      out.innerHTML = header('songs', 'Songs', n(counts.all) + ' songs Phish has played: ' + n(counts.originals) + ' originals, ' +
        n(counts.covers) + ' covers' + (counts.uncredited ? ', ' + n(counts.uncredited) + ' with no artist credited' : '')) +
        controls + '<section class="sec">' + body + '</section>' +
        '<div class="none">Originals are Phish songs and the band members’ own projects, which Phish.net credits to the member.</div>';
    });
  }
  function songRow(s) {
    var k = kindOf(s);
    return '<li><a class="date" href="' + P.songPage(s.song) + '">' + esc(s.song) + '</a>' +
      '<span class="venue">' + (k === 'covers' ? esc(String(s.artist).trim()) : k === 'uncredited' ? 'no artist credited' : '') + '</span>' +
      '<span class="gap">' + n(s.times_played) + '×</span>' +
      '<span class="slot">' + (s.debut ? 'debut <a href="' + P.showPage(s.debut) + '">' + fmtDate(s.debut) + '</a>' : '') +
      (s.last_played && s.last_played !== s.debut ? 'last <a href="' + P.showPage(s.last_played) + '">' + fmtDate(s.last_played) + '</a>' : '') + '</span></li>';
  }

  function renderOnce(out) {
    return Promise.all([api('browse/once'), api('eras/index').catch(function () { return null; })]).then(function (r) {
      var rows = r[0], groups = byEra(rows, r[1], function (s) { return s.showdate.slice(0, 4); });
      out.innerHTML = header('once', 'Played once', n(rows.length) + ' songs Phish has played exactly once, by date') + jumps(groups) +
        groups.map(function (g) {
          return section(g.id, g.label, plural(g.rows.length, 'song', 'songs'), list(g.rows, function (s) {
            return '<li><a class="date" href="' + P.songPage(s.song) + '">' + esc(s.song) + '</a>' +
              '<span class="venue">' + (P.isCover(s.artist) ? esc(String(s.artist).trim()) : '') + '</span>' +
              '<span class="gap"><a href="' + P.showPage(s.showdate) + '">' + fmtDate(s.showdate) + '</a></span>' +
              '<span class="slot"><a href="' + P.venuePage(s.venueid) + '">' + esc(s.venue) + '</a></span></li>';
          }));
        }).join('');
    });
  }

  var RENDER = { years: renderYears, tours: renderTours, venues: renderVenues, cities: renderCities,
    states: renderStates, countries: renderCountries, songs: renderSongs, once: renderOnce };

  function renderBrowse(kind, out) {
    var name = (KINDS.filter(function (k) { return k[0] === kind; })[0] || [])[1];
    if (!name || !RENDER[kind]) { out.innerHTML = P.errorState(new Error('Nothing to browse here'), 'Not found'); return; }
    document.title = name + ' · Phish Stats App';
    P.crumbs([{ text: 'Eras', href: '/eras' }, { text: name }]);
    out.innerHTML = '<div class="state"><h1>' + esc(name) + '</h1><p>Gathering the list…</p></div>';
    RENDER[kind](out).then(function () {
      // Anchors (/browse/venues#s-usa-vt) point into a list that did not
      // exist when the browser looked, so look again now that it does.
      var target = location.hash.length > 1 ? document.getElementById(decodeURIComponent(location.hash.slice(1))) : null;
      if (target) target.scrollIntoView();
    }).catch(function (e) { out.innerHTML = P.errorState(e); });
  }

  window.Phish.renderBrowse = renderBrowse;
})();
