// Shared helpers for the Phish.net local cache pages (song, show, venue,
// city). Loaded as a plain script; everything hangs off window.Phish.
(function () {
  'use strict';

  // ---- data access ---------------------------------------------------------
  // Every number on these pages comes from the site's own JSON endpoints over
  // the local mirror. Phish-only, exclude=0, matching phish.net's official
  // stats. Each endpoint is one fixed, prepared statement: the page names the
  // statement and its parameters, never the SQL - so the Phish-only filter
  // lives in lib/web/statements.js now, not here.

  function api(name, params) {
    var u = new URL('/api/' + name, location.origin);
    Object.keys(params || {}).forEach(function (k) { u.searchParams.set(k, params[k]); });
    return fetch(u).then(function (r) {
      if (!r.ok) return r.text().then(function (t) {
        var detail = t;
        // Endpoints answer failures as { "error": "..." }; show that rather
        // than the raw body, which is what the reader can act on.
        try { detail = JSON.parse(t).error || t; } catch (e) { /* not JSON */ }
        throw new Error('HTTP ' + r.status + ': ' + String(detail).slice(0, 200));
      });
      return r.json();
    });
  }


  // ---- formatting ------------------------------------------------------------
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function n(x) { return Number(x || 0).toLocaleString('en-US'); }
  function pct(a, b) { return b ? Math.round(100 * a / b) + '%' : '–'; }
  function yearOf(d) { return d ? Number(String(d).slice(0, 4)) : null; }
  function fmtDate(d) { if (!d) return '–'; var p = String(d).split('-'); return Number(p[1]) + '/' + Number(p[2]) + '/' + p[0].slice(2); }
  function longDate(d) { if (!d) return '–'; return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
  function fullDate(d) { if (!d) return '–'; return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }); }
  function shortMonth(d) { if (!d) return '–'; return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', year: '2-digit' }).replace(' ', " '"); }
  function yearsBetween(a, b) { if (!a || !b) return null; return (new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / (365.25 * 24 * 3600 * 1000); }
  function mmss(ms) { var s = Math.round(Number(ms) / 1000), m = Math.floor(s / 60); return m + ':' + String(s % 60).padStart(2, '0'); }
  function hmmss(ms) { var s = Math.round(Number(ms) / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s % 60).padStart(2, '0'); }
  function approxMin(sec) { return Math.round(Number(sec) / 60) + ' min'; }
  function ordinal(i) { var j = i % 10, k = i % 100; if (j === 1 && k !== 11) return i + 'st'; if (j === 2 && k !== 12) return i + 'nd'; if (j === 3 && k !== 13) return i + 'rd'; return i + 'th'; }
  function songUrl(slug) { return 'https://phish.net/song/' + slug; }
  function songPage(name) { return '/song?song=' + encodeURIComponent(name); }
  // LivePhish's short links are livephi.sh/phYYMMDD and resolve for every
  // show since 2003 (checked across a spread of years); before that the
  // official releases live on pages with no date-derived address. A stored
  // link (from the phish.com "now available" post) wins when there is one.
  function livePhishUrl(showdate, stored) {
    if (stored) return stored;
    var d = String(showdate || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || d < '2003-01-01') return null;
    return 'https://livephi.sh/ph' + d.slice(2, 4) + d.slice(5, 7) + d.slice(8, 10);
  }
  function showPage(date) { return '/show/' + date; }
  function venuePage(id) { return '/venue/' + id; }
  function citySlug(city, state) { return String(city + '-' + (state || '')).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
  function cityPage(city, state) { return '/city/' + citySlug(city, state); }
  function recTag(source) { return source ? '<small>' + esc(source) + '</small>' : ''; }
  // phish.net credits band-member side-project songs to the member; those
  // are originals for our purposes, not covers.
  var OWN = { 'phish': 1, 'trey anastasio': 1, 'mike gordon': 1, 'page mcconnell': 1, 'jon fishman': 1, 'ghosts of the forest': 1, 'vida blue': 1, 'amfibian': 1, 'new york!': 1 };
  function isCover(artist) { return !!artist && !OWN[String(artist).trim().toLowerCase()]; }
  function slotName(h) {
    if (h.encored || /^e/.test(String(h.set_label))) return 'encore';
    if (Number(h.position) === 1) return 'set 1 opener';
    if (h.set2_opened) return 'set 2 opener';
    return 'set ' + h.set_label + ' · #' + h.position;
  }

  // phish.net embeds a little HTML in notes; keep only harmless inline tags.
  function safeNote(html) {
    var t = document.createElement('div');
    t.innerHTML = String(html || '');
    t.querySelectorAll('script,style,iframe,object,embed,img').forEach(function (e) { e.remove(); });
    t.querySelectorAll('*').forEach(function (e) {
      if (!/^(A|B|I|EM|STRONG|SPAN|P|BR)$/.test(e.tagName)) { e.replaceWith(document.createTextNode(e.textContent)); return; }
      Array.prototype.slice.call(e.attributes).forEach(function (a) {
        if (e.tagName === 'A' && a.name === 'href' && /^https?:\/\//i.test(a.value)) { e.setAttribute('target', '_blank'); e.setAttribute('rel', 'noopener'); return; }
        e.removeAttribute(a.name);
      });
    });
    return t.innerHTML;
  }

  // ---- song name matching ---------------------------------------------------
  // Mirrors lib/bsky.js songKey: case, curly quotes, a leading article, "&",
  // and the phish.com account's own spellings all reduce to one key.
  var ALIASES = { '2001': 'also sprach zarathustra', 'axilla 2': 'axilla (part ii)', 'axilla ii': 'axilla (part ii)', 'sample in jar': 'sample in a jar', 'sneaking sally through the alley': "sneakin' sally thru the alley", "sneakin' sally through the alley": "sneakin' sally thru the alley", 'sneaking sally thru the alley': "sneakin' sally thru the alley", '...with': 'the curtain with', 'beneath a sea of stars': 'beneath a sea of stars part 1', 'rock & roll': 'rock and roll',
    "hailey's comet": "halley's comet", 'avenu makenu': 'avenu malkenu', 'bouncing round the room': 'bouncing around the room', 'axilla 1': 'axilla', 'axilla i': 'axilla', 'big black creature from mars': 'big black furry creature from mars', 'axis bold as love': 'bold as love', 'a life beyond a dream': 'a life beyond the dream', 'everything right': "everything's right" };
  function songKey(name) {
    var s = String(name || '').trim().toLowerCase().replace(/[‘’‛]/g, "'");
    if (ALIASES[s]) s = ALIASES[s];
    return s.replace(/&/g, ' and ').replace(/^(the|a|an)\s+/, '').replace(/[^a-z0-9]/g, '');
  }

  // ---- catalog (songs, venues, cities) for search boxes ----------------------
  var catalogPromise = null;
  function loadCatalog() {
    if (catalogPromise) return catalogPromise;
    catalogPromise = Promise.all([
      api('catalog/songs'),
      api('catalog/venues'),
    ]).then(function (res) {
      var songs = res[0].map(function (r) { var key = String(r.song).toLowerCase(); return { kind: 'song', id: r.songid, name: r.song, artist: r.artist, plays: r.times_played, gap: r.gap, key: key, compact: key.replace(/[^a-z0-9]/g, '') }; });
      var venues = res[1].map(function (v) { var key = (v.venue + ' ' + v.city + ' ' + v.state).toLowerCase(); return Object.assign({ kind: 'venue', name: v.venue, key: key, compact: key.replace(/[^a-z0-9]/g, '') }, v); });
      var cityMap = {};
      res[1].forEach(function (v) {
        var k = citySlug(v.city, v.state);
        var c = cityMap[k] || (cityMap[k] = { kind: 'city', slug: k, city: v.city, state: v.state, name: v.city + ', ' + v.state, shows: 0, venues: 0, first_show: v.first_show, last_show: v.last_show, key: (v.city + ' ' + v.state).toLowerCase(), compact: (v.city + v.state).toLowerCase().replace(/[^a-z0-9]/g, '') });
        c.shows += v.shows; c.venues += 1;
        if (v.first_show < c.first_show) c.first_show = v.first_show;
        if (v.last_show > c.last_show) c.last_show = v.last_show;
      });
      var cities = Object.keys(cityMap).map(function (k) { return cityMap[k]; }).sort(function (a, b) { return b.shows - a.shows; });
      var byId = {}; songs.forEach(function (s) { byId[s.id] = s; });
      var venueById = {}; venues.forEach(function (v) { venueById[v.venueid] = v; });
      return { songs: songs, venues: venues, cities: cities, songById: byId, venueById: venueById };
    });
    return catalogPromise;
  }

  // The tour list, loaded only by pages that link a tour name to its page.
  // Kept out of loadCatalog() so the song page does not pay for it.
  var toursPromise = null;
  function loadTours() {
    if (toursPromise) return toursPromise;
    toursPromise = api('catalog/tours').then(function (rows) {
      var byName = {};
      rows.forEach(function (t) { byName[t.tourname] = t; });
      return { list: rows, byName: byName };
    });
    return toursPromise;
  }

  // A tour's name as a link when we know its id, plain text when we do not.
  // "Not Part of a Tour" never resolves: it is a bucket, not a tour.
  function tourLink(tours, tourname) {
    var t = tours && tours.byName[tourname];
    return t ? '<a href="/tour/' + t.tourid + '">' + esc(tourname) + '</a>' : esc(tourname || '');
  }

  // A typed date in any common form -> YYYY-MM-DD, or null.
  function parseDate(text) {
    var t = text.trim();
    var m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
    if (m) return m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0');
    m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(t);
    if (m) { var y = m[3].length === 2 ? (Number(m[3]) > 60 ? 1900 : 2000) + Number(m[3]) : Number(m[3]); return y + '-' + m[1].padStart(2, '0') + '-' + m[2].padStart(2, '0'); }
    return null;
  }

  // Unified typeahead over songs, venues, cities and dates. `onPick(item)`
  // may return false to fall through to the default navigation.
  function mountSearch(opts) {
    var input = opts.input, suggest = opts.suggest, clearBtn = opts.clear;
    var current = [], active = -1, cat = null;
    var ready = loadCatalog().then(function (c) { cat = c; if (opts.onCatalog) opts.onCatalog(c); return c; });

    function match(term) {
      var t = term.trim().toLowerCase(), c = t.replace(/[^a-z0-9]/g, '');
      var out = [];
      var d = parseDate(term);
      if (d) out.push({ kind: 'show', name: fullDate(d), date: d, meta: 'show' });
      if (!c) return out;
      var byPlays = function (a, b) { return (b.plays || b.shows || 0) - (a.plays || a.shows || 0); };
      var starts = [], words = [], contains = [];
      cat.songs.forEach(function (s) {
        if (s.plays === 0) return;
        if (s.compact.indexOf(c) === 0) starts.push(s); else if (s.key.indexOf(' ' + t) >= 0) words.push(s); else if (s.compact.indexOf(c) >= 0) contains.push(s);
      });
      var songs = starts.sort(byPlays).concat(words.sort(byPlays), contains.sort(byPlays));
      var venues = cat.venues.filter(function (v) { return v.compact.indexOf(c) >= 0; }).sort(byPlays);
      var cities = cat.cities.filter(function (v) { return v.compact.indexOf(c) >= 0; }).sort(byPlays);
      // Songs first, then a few places, capped so the list stays thumb-sized.
      return out.concat(songs.slice(0, 6), venues.slice(0, 2), cities.slice(0, 2)).slice(0, 9);
    }
    function meta(it) {
      if (it.kind === 'song') return n(it.plays) + '×' + (it.artist && it.artist !== 'Phish' ? ' · ' + esc(it.artist) : '');
      if (it.kind === 'venue') return 'venue · ' + n(it.shows) + ' shows · ' + esc(it.city + ', ' + it.state);
      if (it.kind === 'city') return 'city · ' + n(it.shows) + ' shows';
      return it.meta || '';
    }
    function render(list, term) {
      current = list; active = -1;
      if (!list.length) { suggest.hidden = true; suggest.innerHTML = ''; return; }
      var re = new RegExp('(' + term.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'i');
      suggest.innerHTML = list.map(function (it, i) {
        return '<button type="button" role="option" data-i="' + i + '"><span class="s-name">' + esc(it.name).replace(re, '<em>$1</em>') + '</span><span class="s-meta">' + meta(it) + '</span></button>';
      }).join('');
      suggest.hidden = false;
    }
    function setActive(i) {
      var items = suggest.querySelectorAll('button');
      items.forEach(function (b) { b.classList.remove('active'); });
      active = i;
      if (i >= 0 && items[i]) { items[i].classList.add('active'); items[i].scrollIntoView({ block: 'nearest' }); }
    }
    function go(it) {
      suggest.hidden = true;
      if (opts.onPick && opts.onPick(it) !== false) return;
      if (it.kind === 'song') location.href = songPage(it.name);
      else if (it.kind === 'venue') location.href = venuePage(it.venueid);
      else if (it.kind === 'city') location.href = cityPage(it.city, it.state);
      else if (it.kind === 'show') location.href = showPage(it.date);
    }
    input.addEventListener('input', function () { if (clearBtn) clearBtn.hidden = !input.value; ready.then(function () { render(match(input.value), input.value); }); });
    input.addEventListener('keydown', function (e) {
      if (suggest.hidden) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive(Math.min(active + 1, current.length - 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(Math.max(active - 1, 0)); }
      else if (e.key === 'Escape') { suggest.hidden = true; }
    });
    input.form && input.form.addEventListener('submit', function (e) {
      e.preventDefault();
      var pick = active >= 0 ? current[active] : current[0];
      if (pick) go(pick);
    });
    suggest.addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) go(current[Number(b.dataset.i)]); });
    if (clearBtn) clearBtn.addEventListener('click', function () { input.value = ''; clearBtn.hidden = true; suggest.hidden = true; input.focus(); });
    document.addEventListener('click', function (e) { if (!e.target.closest('.search-row')) suggest.hidden = true; });
    input.addEventListener('focus', function () { if (input.value) ready.then(function () { render(match(input.value), input.value); }); });
    return { ready: ready, go: go };
  }

  // ---- shared UI fragments ---------------------------------------------------
  function badgesHtml(list) {
    if (!list.length) return '';
    return '<div class="badges">' + list.map(function (x) {
      var inner = esc(x.text) + (x.sub ? ' <small>' + esc(x.sub) + '</small>' : '');
      return x.href ? '<a class="badge ' + (x.cls || '') + '" href="' + esc(x.href) + '"><span class="dot"></span>' + inner + '</a>'
                    : '<span class="badge ' + (x.cls || '') + '"><span class="dot"></span>' + inner + '</span>';
    }).join('') + '</div>';
  }
  function stat(v, k, small) { return '<div class="stat"><div class="v">' + v + (small ? '<small>' + esc(small) + '</small>' : '') + '</div><div class="k">' + esc(k) + '</div></div>'; }
  // Breadcrumbs in the top bar: [{ text, href }] after Home; the last item is
  // the current page and gets no link.
  function crumbs(items) {
    var el = document.getElementById('crumbs'); if (!el) return;
    // No "Home" root: the brand to the left of this is the home link, and so
    // is the Home pill on the right. The trail starts at the page's own
    // context, and is empty on a page that has none.
    var parts = [];
    (items || []).forEach(function (it, i, all) {
      if (i) parts.push('<span class="sep">›</span>');
      parts.push(it.href && i < all.length - 1 ? '<a href="' + esc(it.href) + '">' + esc(it.text) + '</a>' : '<span class="here">' + esc(it.text) + '</span>');
    });
    el.innerHTML = parts.join('');
  }
  function errorState(e, title) {
    return '<div class="state"><h1>' + esc(title || 'Couldn’t load that') + '</h1><p>The site couldn’t reach its data. Try again in a moment.</p><div class="err">' + esc(e && e.message || e) + '</div></div>';
  }
  // Bustout tiers follow common phish.net usage.
  function gapBadge(gap, lastPlayed, latest) {
    gap = Number(gap || 0);
    if (gap < 20) return null;
    var yrs = yearsBetween(lastPlayed, latest);
    var yrsTxt = yrs != null && yrs >= 1 ? ' · ' + (Math.round(yrs * 10) / 10) + ' years' : '';
    var since = lastPlayed ? n(gap) + ' shows since ' + longDate(lastPlayed) + yrsTxt : n(gap) + ' shows';
    if (gap >= 250) return { cls: 'hot', text: 'Historic bustout', sub: since };
    if (gap >= 100) return { cls: 'hot', text: 'Major bustout', sub: since };
    if (gap >= 50) return { cls: 'hot', text: 'Bustout', sub: since };
    return { cls: 'gold', text: 'Overdue', sub: since };
  }

  window.Phish = {
    api: api, esc: esc, n: n, pct: pct, yearOf: yearOf, fmtDate: fmtDate, longDate: longDate, fullDate: fullDate, shortMonth: shortMonth,
    yearsBetween: yearsBetween, mmss: mmss, hmmss: hmmss, approxMin: approxMin, ordinal: ordinal, songUrl: songUrl, songPage: songPage, livePhishUrl: livePhishUrl, showPage: showPage,
    venuePage: venuePage, cityPage: cityPage, citySlug: citySlug, recTag: recTag, isCover: isCover, slotName: slotName, safeNote: safeNote, songKey: songKey,
    loadCatalog: loadCatalog, loadTours: loadTours, tourLink: tourLink, parseDate: parseDate, mountSearch: mountSearch, badgesHtml: badgesHtml, stat: stat, errorState: errorState, gapBadge: gapBadge, crumbs: crumbs,
  };
})();
