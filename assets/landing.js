// Landing panels for the song page's empty state, which is the home page: the
// status strip (tonight, the tour, or the off-season, with chips under it),
// "Tonight's forecast" on a show day, "Lately", and "Today in history".
// Loaded after app.js (and timezones.js when available).
(function () {
  'use strict';
  var P = window.Phish, api = P.api, esc = P.esc, n = P.n, fmtDate = P.fmtDate, mmss = P.mmss;
  // One implementation, in assets/season-stats.js, shared with the era, year
  // and tour pages and with the parity test that checks they agree.
  var seasonStats = P.seasonStats;
  var TZ = window.PhishTimeZones;

  function localDate(tz) {
    // YYYY-MM-DD "today" on the venue's clock when known, else the device's.
    var d = new Date();
    if (tz) {
      var parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
      var m = {}; parts.forEach(function (p) { m[p.type] = p.value; });
      return m.year + '-' + m.month + '-' + m.day;
    }
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  // ---- Today in history --------------------------------------------------
  function historyNotes(show, ranks) {
    var notes = [];
    (show.bustouts || '').split(';').filter(Boolean).forEach(function (b) {
      var p = b.split('|'); notes.push({ cls: 'hot', text: esc(p[0]) + ' bustout, ' + n(p[1]) + '-show gap' });
    });
    (show.debuts || '').split(';').filter(Boolean).forEach(function (d) { notes.push({ cls: 'green', text: esc(d) + ' debut' }); });
    var r = ranks.filter(function (x) { return x.show_date === show.showdate && x.cnt >= 3 && x.rnk <= 5; }).sort(function (a, b) { return a.rnk - b.rnk || b.ms - a.ms; })[0];
    if (r) notes.push({ cls: 'gold', text: (r.rnk === 1 ? 'longest ever ' : '#' + r.rnk + ' longest ') + esc(r.song) + ', ' + mmss(r.ms) });
    else {
      var longest = ranks.filter(function (x) { return x.show_date === show.showdate; }).sort(function (a, b) { return b.ms - a.ms; })[0];
      if (longest && longest.ms >= 15 * 60000) notes.push({ cls: '', text: esc(longest.song) + ' ' + mmss(longest.ms) });
    }
    if (show.jamcharts) notes.push({ cls: 'gold', text: n(show.jamcharts) + ' jam chart' + (show.jamcharts > 1 ? ' entries' : ' entry') });
    return notes.slice(0, 3);
  }

  // Busy dates (New Year's Eve has 29 shows) lead with the most notable few
  // and tuck the rest behind a button. Notability: bustouts and records
  // weigh most, then debuts, then jam chart entries; ties go to newest.
  var HISTORY_SHOWN = 5;
  function historyWeight(notes) {
    return notes.reduce(function (a, x) { return a + (x.cls === 'hot' ? 3 : x.cls === 'gold' ? 2 : x.cls === 'green' ? 2 : 1); }, 0);
  }
  function renderHistory(el, md, shows, ranks) {
    if (!shows.length) { el.innerHTML = ''; return; }
    var label = new Date(new Date().getFullYear() + '-' + md + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
    var items = shows.map(function (s) { var notes = historyNotes(s, ranks); return { s: s, notes: notes, w: historyWeight(notes) }; })
      .sort(function (a, b) { return b.w - a.w || (a.s.showdate < b.s.showdate ? 1 : -1); });
    function row(it) {
      var s = it.s;
      return '<li><a class="date" href="' + P.showPage(s.showdate) + '">' + fmtDate(s.showdate) + '</a>' +
        '<span class="venue">' + esc(s.venue) + ' · ' + esc(s.city + (s.state ? ', ' + s.state : '')) + '</span>' +
        '<span class="gap">' + n(s.songs) + ' songs</span>' +
        (it.notes.length ? '<span class="slot">' + it.notes.map(function (x) { return '<span class="' + (x.cls === 'hot' ? 'bo' : x.cls === 'green' ? 'rec' : x.cls === 'gold' ? 'jc' : '') + '">' + x.text + '</span>'; }).join('') + '</span>' : '') +
        '</li>';
    }
    var hidden = items.length > HISTORY_SHOWN + 1 ? items.slice(HISTORY_SHOWN) : [];
    var shown = hidden.length ? items.slice(0, HISTORY_SHOWN) : items;
    el.innerHTML = '<section class="sec landing"><div class="head"><h2>Today in history</h2><span>' + esc(label) + ' · ' + n(shows.length) + (shows.length === 1 ? ' show' : ' shows') + (hidden.length ? ', most notable first' : '') + '</span></div>' +
      '<ol class="perf" id="historyList">' + shown.map(row).join('') + '</ol>' +
      (hidden.length ? '<button type="button" class="more" id="historyMore">Show all ' + n(shows.length) + '</button>' : '') + '</section>';
    var more = el.querySelector('#historyMore');
    if (more) more.addEventListener('click', function () {
      el.querySelector('#historyList').insertAdjacentHTML('beforeend', hidden.map(row).join(''));
      more.remove();
    });
  }

  // ---- Show-day weather -------------------------------------------------
  // Open-Meteo is free, keyless, and answers browsers directly. The venue's
  // city is geocoded once (kept in localStorage) and the hourly forecast for
  // the show date is read in the venue's own time zone. The geocoder returns
  // every "Commerce City" it knows; the one in the venue's time zone wins.
  var COUNTRY = { USA: 'US', Canada: 'CA', Mexico: 'MX', England: 'GB', Scotland: 'GB', 'United Kingdom': 'GB', Japan: 'JP', Italy: 'IT', Germany: 'DE', France: 'FR', Netherlands: 'NL', Denmark: 'DK', Spain: 'ES', 'Dominican Republic': 'DO', Belgium: 'BE', Ireland: 'IE' };
  var WMO = [[0, 'clear', '☀️'], [1, 'mostly clear', '🌤️'], [2, 'partly cloudy', '⛅'], [3, 'overcast', '☁️'], [45, 'fog', '🌫️'], [48, 'fog', '🌫️'], [51, 'drizzle', '🌦️'], [53, 'drizzle', '🌦️'], [55, 'drizzle', '🌧️'], [56, 'freezing drizzle', '🌧️'], [57, 'freezing drizzle', '🌧️'], [61, 'light rain', '🌦️'], [63, 'rain', '🌧️'], [65, 'heavy rain', '🌧️'], [66, 'freezing rain', '🌧️'], [67, 'freezing rain', '🌧️'], [71, 'light snow', '🌨️'], [73, 'snow', '🌨️'], [75, 'heavy snow', '❄️'], [77, 'snow grains', '🌨️'], [80, 'showers', '🌦️'], [81, 'showers', '🌧️'], [82, 'heavy showers', '⛈️'], [85, 'snow showers', '🌨️'], [86, 'snow showers', '🌨️'], [95, 'thunderstorm', '⛈️'], [96, 'thunderstorm, hail', '⛈️'], [99, 'thunderstorm, hail', '⛈️']];
  function wmo(code) { var m = WMO.filter(function (w) { return w[0] === code; })[0]; return m ? { text: m[1], icon: m[2] } : { text: '', icon: '' }; }
  function geocode(show) {
    var key = 'phish.geo.' + [show.city, show.state, show.country].join('|');
    try { var c = localStorage.getItem(key); if (c) return Promise.resolve(JSON.parse(c)); } catch (e) {}
    var tz = TZ ? TZ.venueTimeZone({ city: show.city, state: show.state, country: show.country }) : null;
    var cc = COUNTRY[show.country] || null;
    return fetch('https://geocoding-api.open-meteo.com/v1/search?name=' + encodeURIComponent(show.city) + '&count=10&language=en&format=json')
      .then(function (r) { return r.json(); })
      .then(function (j) {
        var res = (j.results || []).filter(function (r) { return !cc || r.country_code === cc; });
        var pick = res.filter(function (r) { return tz && r.timezone === tz; })[0] || res[0];
        if (!pick) throw new Error('no geocode');
        var geo = { lat: pick.latitude, lon: pick.longitude, tz: pick.timezone, name: pick.name + (pick.admin1 ? ', ' + pick.admin1 : '') };
        try { localStorage.setItem(key, JSON.stringify(geo)); } catch (e) {}
        return geo;
      });
  }
  function forecast(geo, date, us) {
    var q = 'latitude=' + geo.lat + '&longitude=' + geo.lon + '&hourly=temperature_2m,precipitation_probability,precipitation,wind_speed_10m,wind_gusts_10m,weather_code' +
      '&timezone=' + encodeURIComponent(geo.tz) + '&start_date=' + date + '&end_date=' + date +
      (us ? '&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch' : '');
    return fetch('https://api.open-meteo.com/v1/forecast?' + q).then(function (r) { return r.json(); });
  }
  function weatherHtml(show, geo, fc, us) {
    var h = fc.hourly || {}; if (!h.time) return '';
    var rows = h.time.map(function (t, i) { return { hour: Number(t.slice(11, 13)), temp: h.temperature_2m[i], pop: h.precipitation_probability[i], precip: h.precipitation[i], wind: h.wind_speed_10m[i], gust: h.wind_gusts_10m[i], code: h.weather_code[i] }; })
      .filter(function (r) { return r.hour >= 15; });
    if (!rows.length) return '';
    var deg = us ? '°' : '°', spd = us ? 'mph' : 'km/h';
    var link = us ? 'https://forecast.weather.gov/MapClick.php?lat=' + geo.lat + '&lon=' + geo.lon + '&unit=0&lg=english&FcstType=graphical'
                  : 'https://www.windy.com/' + geo.lat + '/' + geo.lon + '?' + geo.lat + ',' + geo.lon + ',10';
    var maxPop = Math.max.apply(null, rows.map(function (r) { return r.pop || 0; }));
    var maxGust = Math.max.apply(null, rows.map(function (r) { return r.gust || 0; }));
    var summary = rows.filter(function (r) { return r.hour >= 19 && r.hour <= 21; }).map(function (r) { return wmo(r.code).text; }).filter(Boolean)[0] || wmo(rows[0].code).text;
    var line = 'Showtime looks ' + esc(summary) + (maxPop >= 30 ? ', ' + maxPop + '% chance of rain at the wettest hour' : ', little chance of rain') + (maxGust >= 25 ? ', gusts to ' + Math.round(maxGust) + ' ' + spd : '') + '.';
    return '<div class="wx"><div class="wx-line">' + line + ' <a href="' + esc(link) + '" target="_blank" rel="noopener">Full forecast</a></div><div class="wx-strip">' +
      rows.map(function (r) {
        var w = wmo(r.code);
        return '<div class="wx-h' + (r.pop >= 50 ? ' wet' : '') + '" title="' + esc(w.text) + '"><div class="t">' + (r.hour % 12 || 12) + (r.hour >= 12 ? 'p' : 'a') + '</div><div class="i">' + w.icon + '</div><div class="d">' + Math.round(r.temp) + deg + '</div><div class="p">' + (r.pop || 0) + '%</div><div class="w">' + Math.round(r.wind) + '</div></div>';
      }).join('') + '</div><div class="none">hour · sky · temp · rain chance · wind ' + spd + ' at ' + esc(geo.name) + ', via Open-Meteo</div></div>';
  }
  function loadWeather(show) {
    var us = show.country === 'USA';
    return geocode(show).then(function (geo) { return forecast(geo, show.showdate, us).then(function (fc) { return weatherHtml(show, geo, fc, us); }); })
      .catch(function () { return ''; });
  }

  // ---- Tonight: likely openers ------------------------------------------
  var state = { el: null, show: null, live: [], overDate: null, data: null, wx: '' };

  // Weighted draw without replacement, weight = score squared, so the likely
  // songs show up nearly every time but the rest of the list changes on
  // each load instead of being the same fixed top eight.
  function weightedSample(pool, count, weightOf) {
    var left = pool.slice(), picked = [];
    while (left.length && picked.length < count) {
      var total = left.reduce(function (a, x) { return a + weightOf(x); }, 0);
      var roll = Math.random() * total, i = 0;
      for (; i < left.length - 1; i++) { roll -= weightOf(left[i]); if (roll <= 0) break; }
      picked.push(left.splice(i, 1)[0]);
    }
    return picked;
  }
  // The whole pool in one weighted random order, drawn once per load. The
  // list shown is the first eight of it not yet played tonight, so during the
  // show a song that gets played drops out and the next one moves up without
  // the rest reshuffling under the reader.
  function rankPool(rows, excluded) {
    var pool = rows.map(function (r) {
      var score = Number(r.opens_2y) * 3 + Number(r.opens_5y);
      return Object.assign({ score: score, out: excluded[r.songid] || (Number(r.gap) === 0 ? 'played last show' : null) }, r);
    }).filter(function (r) { return !r.out && r.score > 0; });
    return weightedSample(pool, pool.length, function (r) { return r.score * r.score; });
  }
  function picks(ranked, played, shows2y) {
    return ranked.filter(function (r) { return !played[P.songKey(r.song)]; }).slice(0, 8)
      .sort(function (a, b) { return b.score - a.score; })
      .map(function (r) { return Object.assign({ rate: shows2y ? Math.round(100 * r.opens_2y / shows2y) : 0 }, r); });
  }
  function songLink(name) { return '<a href="' + P.songPage(name) + '">' + esc(name) + '</a>'; }

  function renderTonight() {
    var el = state.el, show = state.show, d = state.data;
    if (!el || !show || !d) return;
    var tonight = state.live.filter(function (e) { return e.showdate === show.showdate; });
    var started = tonight.length > 0;
    var runNight = d.runShows.length + 1;
    var head = '<div class="head"><h2>Tonight’s forecast <small>(' + fmtDate(show.showdate) + ')</small></h2><span>' + esc(show.venue) + ' · ' + esc(show.city + (show.state ? ', ' + show.state : '')) + '</span></div>' +
      '<div class="venue-line">Phish’s <b>' + P.ordinal(d.priorHere + 1) + '</b> show at ' + esc(show.venue) + (runNight > 1 ? ', <b>night ' + runNight + '</b> of this run' : '') + '.' +
      (d.runSongs.length ? ' <span class="vs">' + n(d.runSongs.length) + ' songs already played this run are left out below.</span>' : '') + '</div>';

    // Each slot shows what actually opened it once the phish.com account has
    // posted it, and its likely openers until then, less everything played
    // so far tonight (the live feed re-renders this on every post).
    var played = {};
    tonight.forEach(function (e) { played[P.songKey(e.song)] = true; });
    function slotBlock(slot, title, actual, verb) {
      if (actual) return '<div class="seg"><h3>' + esc(title) + '</h3><div class="call-result"><b>' + songLink(actual.song) + '</b></div></div>';
      var list = picks(d.cands[slot], played, d.shows2y);
      return '<div class="seg"><h3>' + esc(title) + '</h3>' + (list.length ? '<ol>' +
        list.map(function (c) {
          return '<li><span class="t">' + songLink(c.song) + '</span><span class="n">' + c.rate + '% · gap ' + n(c.gap) + '</span></li>';
        }).join('') + '</ol>' : '') +
        '<div class="none">rate = how often it ' + verb + ' over the last two years (' + n(d.shows2y) + ' shows)' + (started ? '; songs played tonight are left out' : '') + '</div></div>';
    }
    var set1Actual = tonight[0] || null;
    var set2Actual = tonight.filter(function (e) { return e.set_label === '2'; })[0] || null;
    var encoreActual = tonight.filter(function (e) { return /^e/.test(e.set_label); })[0] || null;

    // Kept all show: one of these turning up is the best thing that can happen
    // to this list, so a played one is marked rather than dropped. Gone once
    // the show is over, unless one of them was played: that stays up.
    function longshotBlock() {
      var anyHit = d.longshots.some(function (c) { return played[P.songKey(c.song)]; });
      if (state.overDate === show.showdate && !anyHit) return '';
      return '<div class="seg"><h3>Long shots</h3><ol>' +
        d.longshots.map(function (c) {
          var hit = played[P.songKey(c.song)];
          return '<li' + (hit ? ' class="hit"' : '') + '><span class="t">' + songLink(c.song) + (P.isCover(c.artist) ? '<span class="cover">' + esc(c.artist) + '</span>' : '') + '</span>' +
            '<span class="n">' + (hit ? '<b>played tonight</b> · ' : '') + 'gap ' + n(c.gap) + ' · last ' + fmtDate(c.last_played) + '</span></li>';
        }).join('') + '</ol><div class="none">not played in 300+ shows, just for fun</div></div>';
    }

    // Two parts under one forecast: the weather, and the call-outs (the
    // projected openers and long shots). The call-outs collapse to their
    // heading; the choice is remembered in this browser.
    var collapsed = calloutsCollapsed();
    el.innerHTML = '<section class="sec landing tonight">' + head +
      (state.wx ? '<div class="subhead"><h3>Weather</h3></div>' + state.wx : '') +
      '<div class="subhead"><h3>Call-outs</h3><button type="button" class="sub-toggle" aria-expanded="' + !collapsed + '" aria-controls="callouts">' + (collapsed ? 'Show' : 'Hide') + '</button></div>' +
      '<div id="callouts"' + (collapsed ? ' hidden' : '') + '>' +
      '<div class="segues">' + slotBlock('set1', 'Set 1 opener', set1Actual, 'opened set 1') + slotBlock('set2', 'Set 2 opener', set2Actual, 'opened set 2') +
        slotBlock('encore', 'Encore opener', encoreActual, 'opened the encore') + longshotBlock() + '</div>' +
      (!encoreActual ? '<div class="none" style="margin-top:8px">The lists reshuffle on each load, weighted toward the likely picks. Tap a song for its page.</div>' : '') +
      '</div></section>';
    el.querySelector('.sub-toggle').addEventListener('click', function () {
      try { localStorage.setItem(CALLOUTS_KEY, collapsed ? '0' : '1'); } catch (e) {}
      calloutsMemory = collapsed ? '0' : '1';
      renderTonight();
    });
  }
  // Remembered in localStorage, with an in-memory copy for a browser that
  // blocks it, so the toggle still works for the life of the page.
  var CALLOUTS_KEY = 'callouts:collapsed', calloutsMemory = null;
  function calloutsCollapsed() {
    if (calloutsMemory !== null) return calloutsMemory === '1';
    try { return localStorage.getItem(CALLOUTS_KEY) === '1'; } catch (e) { return false; }
  }

  // The scheduled show whose date is "today" on its own venue clock, or null.
  // One request shared by the forecast and the status strip.
  function findTonight() {
    return api('landing/scheduled', { d: localDate(null) }).then(function (rows) {
      return rows.filter(function (s) {
        var tz = TZ ? TZ.venueTimeZone({ city: s.city, state: s.state, country: s.country }) : null;
        return s.showdate === localDate(tz);
      })[0] || null;
    });
  }

  function loadTonight(el, tonightP) {
    return tonightP.then(function (show) {
      if (!show) { el.innerHTML = ''; state.show = null; return; }
      state.show = show; state.el = el; state.wx = '';
      loadWeather(show).then(function (html) { state.wx = html; renderTonight(); });
      var A = { d: show.showdate, v: show.venueid };
      return Promise.all([api('landing/venue-info', A), api('landing/run-shows', A), api('landing/run-songs', A), api('landing/shows-2y', { d: A.d }), api('landing/openers', { slot: 'set1', d: A.d }), api('landing/openers', { slot: 'set2', d: A.d }), api('landing/longshots'), api('landing/encore-openers', { d: A.d })])
        .then(function (r) {
          var excluded = {}; r[2].forEach(function (s) { excluded[s.songid] = 'played ' + fmtDate(s.played); });
          state.data = { priorHere: r[0][0].prior_here, runShows: r[1], runSongs: r[2], shows2y: r[3][0].n, longshots: r[6],
            cands: { set1: rankPool(r[4], excluded), set2: rankPool(r[5], excluded), encore: rankPool(r[7], excluded) } };
          renderTonight();
        });
    }).catch(function () { el.innerHTML = ''; });
  }

  // Called by the page whenever the live feed updates.
  // opts.over: the live panel's judgement that its show is done (song.html).
  // It is kept with that show's date: after midnight the Tonight card is on
  // the next show while the panel still holds last night's for a few hours,
  // and "over" must not hide the new night's long shots (2026-10-04).
  function landingLive(entries, opts) {
    state.live = entries || [];
    state.overDate = opts && opts.over && state.live.length ? state.live[state.live.length - 1].showdate : null;
    if (state.show) renderTonight();
    now.live = state.live.length > 0 && !(opts && opts.over);
    now.overDate = state.overDate;
    // The live panel calls this before drawing itself: nothing in the strip
    // may throw into it.
    try { renderNow(); } catch (e) { if (now.el) now.el.innerHTML = ''; }
  }

  // The most recent show on file, with the same notes the history list uses.
  function renderLatest(el, show, ranks) {
    if (!show) { el.innerHTML = ''; return; }
    var notes = historyNotes(show, ranks);
    var ago = Math.round((Date.now() - new Date(show.showdate + 'T12:00:00')) / 86400000);
    el.innerHTML = '<section class="sec landing"><div class="head"><h2>Latest show</h2><span>' + (ago === 0 ? 'today' : ago === 1 ? 'yesterday' : ago + ' days ago') + '</span></div>' +
      '<ol class="perf"><li><a class="date" href="' + P.showPage(show.showdate) + '">' + fmtDate(show.showdate) + '</a>' +
      '<span class="venue">' + esc(show.venue) + ' · ' + esc(show.city + (show.state ? ', ' + show.state : '')) + '</span>' +
      '<span class="gap">' + n(show.songs) + ' songs</span>' +
      (notes.length ? '<span class="slot">' + notes.map(function (x) { return '<span class="' + (x.cls === 'hot' ? 'bo' : x.cls === 'green' ? 'rec' : x.cls === 'gold' ? 'jc' : '') + '">' + x.text + '</span>'; }).join('') + '</span>' : '') +
      '</li></ol></section>';
  }


  // ---- Season: this run, this tour, the year so far (or in review) ---------
  // Everything comes from two queries over the year of the latest show on
  // file, partitioned in the browser: per-show stats, and every version
  // that ranks in its song's all-time top five. "Year in review" replaces
  // "year so far" once the year's last scheduled show has been played.
  // year: the season's year, where the card's "and N more" links lead. The
  // run and tour cards use it too: their lists are subsets of the year's.
  function seasonCard(title, sub, st, ref, year, extra) {
    if (!st) return '';
    function cmp(v, ref, fmt, higherIsMore) {
      if (!ref || ref === v) return '';
      var d = v - ref, pct = Math.round(100 * d / ref);
      if (Math.abs(pct) < 5) return ' <small title="within 5% of the year average">≈ year</small>';
      return ' <small class="' + (d > 0 ? 'up' : 'down') + '" title="against the year average">' + (d > 0 ? '+' : '−') + Math.abs(pct) + '%</small>';
    }
    var rows = [
      ['Shows', n(st.shows), ''],
      ['Songs per show', st.songs.toFixed(1), cmp(st.songs, ref && ref.songs)],
      ['Average song length', st.avgMs ? mmss(st.avgMs) : '–', st.avgMs ? cmp(st.avgMs, ref && ref.avgMs) : ''],
      ['15+ minute songs per show', st.jams15.toFixed(1), cmp(st.jams15, ref && ref.jams15)],
      ['Segues per show', st.segues.toFixed(1), cmp(st.segues, ref && ref.segues)],
      ['Music per show', st.music ? Math.round(st.music / 60000) + ' min' : '–', '']
    ];
    var lines = [];
    // Each named version carries a link to its show, and a list too long for
    // the card ends in "and N more", which opens that list in full on the
    // year page.
    var on = function (date) { return ' <a href="' + P.showPage(date) + '">' + fmtDate(date) + '</a>'; };
    var more = function (rest, anchor) { return rest > 0 ? ' and <a href="/year/' + year + '#' + anchor + '">' + n(rest) + ' more</a>' : ''; };
    var others = st.tops.filter(function (t) { return t.rnk > 1; }).sort(function (a, b) { return a.rnk - b.rnk || b.ms - a.ms; });
    if (st.longest) lines.push('<b>Longest song</b> ' + esc(st.longest.longest_song) + ' ' + mmss(st.longest.longest_ms) + on(st.longest.showdate));
    if (st.firsts.length) lines.push('<b class="gold">All-time longest</b> ' + st.firsts.slice(0, 6).map(function (t) { return esc(t.song) + on(t.show_date); }).join(', ') + more(st.firsts.length - 6, 'longest-ever'));
    if (st.tops.length) lines.push('<b>Top-five versions</b> ' + n(st.tops.length) + (others.length ? ': ' + others.slice(0, 6).map(function (t) { return esc(t.song) + ' #' + t.rnk + on(t.show_date); }).join(', ') + more(others.length - 6, 'top-five') : ''));
    if (st.bustouts.length) lines.push('<b class="red">Bustouts</b> ' + n(st.bustouts.length) + ': ' + st.bustouts.slice(0, 5).map(function (b) { return esc(b.song) + ' (' + n(b.gap) + ')' + on(b.date); }).join(', ') + more(st.bustouts.length - 5, 'bustouts'));
    if (st.debuts.length) lines.push('<b class="green">Debuts</b> ' + st.debuts.slice(0, 6).map(function (d) { return esc(d.song) + on(d.date); }).join(', ') + more(st.debuts.length - 6, 'debuts'));
    (extra || []).forEach(function (x) { lines.push(x); });
    // title is HTML: the tour card's is a link. Callers escape their own.
    return '<div class="seg card"><h3>' + title + '</h3><div class="sub">' + sub + '</div>' +
      '<div class="rows">' + rows.map(function (r) { return '<div class="row"><span>' + r[0] + '</span><b>' + r[1] + r[2] + '</b></div>'; }).join('') + '</div>' +
      (lines.length ? '<div class="lines">' + lines.map(function (l) { return '<div>' + l + '</div>'; }).join('') + '</div>' : '') + '</div>';
  }
  // The season card's tour title links to its tour page once the tour list
  // has loaded; until then it is plain text, which is what it was before.
  var tourIndex = null;
  function tourTitle(name) {
    return tourIndex ? P.tourLink(tourIndex, name) : esc(name);
  }

  function renderSeason(el) {
    api('season/year').then(function (y) {
      var latest = y[0] && y[0].latest; if (!latest) { el.innerHTML = ''; return; }
      var year = latest.slice(0, 4), y0 = year + '-01-01';
      // "In review" once the year's last scheduled show is on file and played:
      // no scheduled dates left in that year, and it is December or a later
      // year. Before the fall dates are announced in summer it stays "so far".
      var review = Number(y[0].remaining) === 0 && localDate(null) > latest && (localDate(null).slice(0, 4) > year || latest >= year + '-12-01');
      var A = { y: y0 };
      // The tour list is awaited with the rest so the tour card's title is
      // either a link or plain text once, never rewritten under the reader.
      // It is cached in app.js, so this costs one request per page load.
      return Promise.all([api('season/shows', A), api('season/tops', A), review ? api('season/review', A) : null, review ? api('season/most-played', A) : null, P.loadTours().catch(function () { return null; }),
        api('landing/scheduled', { d: localDate(null) }).catch(function () { return []; })]).then(function (r) {
        var shows = r[0], tops = r[1];
        tourIndex = r[4];
        if (!shows.length) { el.innerHTML = ''; return; }
        var last = shows[shows.length - 1];
        // The run: the latest venue's consecutive nights (a gap of more than 3 days ends it).
        var run = [last];
        for (var i = shows.length - 2; i >= 0; i--) {
          var a = shows[i], b = run[0];
          if (a.venueid !== last.venueid || (new Date(b.showdate) - new Date(a.showdate)) / 86400000 > 3) break;
          run.unshift(a);
        }
        var tourName = last.tourname && last.tourname !== 'Not Part of a Tour' ? last.tourname : null;
        var tour = tourName ? shows.filter(function (s) { return s.tourname === tourName; }) : [];
        var yearSt = seasonStats(shows, tops), runSt = seasonStats(run, tops), tourSt = seasonStats(tour, tops);
        var span = function (rows) { return rows.length > 1 ? fmtDate(rows[0].showdate) + ' – ' + fmtDate(rows[rows.length - 1].showdate) : fmtDate(rows[0].showdate); };
        // A run is still going when the venue has another date scheduled
        // after the latest show (landing/scheduled is yesterday..tomorrow), so
        // night 1 of a run already gets its card instead of waiting for two.
        var upcoming = (r[5] || []).filter(function (s) { return s.showdate > last.showdate; });
        var runOngoing = upcoming.some(function (s) { return Number(s.venueid) === Number(last.venueid); });
        var showRun = run.length > 1 || runOngoing;
        // The latest show's tour is the current tour from its first night. When
        // its shows are exactly the run's (a tour that opens with this run),
        // one card says both.
        var tourIsRun = tour.length === run.length && run.every(function (s) { return s.tourname === tourName; });
        var nights = function (k) { return n(k) + (k === 1 ? ' night' : ' nights'); };
        var cards = [];
        if (showRun) cards.push(seasonCard('This run', esc(last.venue) + ' · ' + nights(run.length) + (runOngoing ? ' so far' : '') + ', ' + span(run) + (tourIsRun && tourName ? ' · opens ' + tourTitle(tourName) : ''), runSt, yearSt, year));
        if (tour.length && tour.length !== shows.length && !(tourIsRun && showRun)) cards.push(seasonCard(tourTitle(tourName), n(tour.length) + (tour.length === 1 ? ' show' : ' shows') + ', ' + span(tour) + (showRun && tour.length > run.length ? ' · run included' : ''), tourSt, yearSt, year));
        var extra = [];
        if (review && r[2] && r[2][0]) {
          var rv = r[2][0];
          extra.push('<b>Breadth</b> ' + n(rv.distinct_songs) + ' different songs across ' + n(rv.venues) + ' venues in ' + n(rv.cities) + ' cities');
          if (r[3] && r[3].length) extra.push('<b>Most played</b> ' + r[3].map(function (m) { return esc(m.song) + ' ×' + m.n; }).join(', '));
        }
        cards.push(seasonCard(review ? year + ' in review' : year + ' so far', n(shows.length) + ' shows, ' + span(shows) + (review ? ' · the year is done' : ''), yearSt, null, year, extra));
        el.innerHTML = '<section class="sec landing season' + (review ? ' review' : '') + '"><div class="head"><h2>' + (review ? year + ' in review' : 'The season') + '</h2><span>run · tour · year, each against the year\u2019s average</span></div>' +
          '<div class="cards">' + cards.join('') + '</div>' +
          '<div class="none">Lengths are official LivePhish times where released, otherwise phish.in recordings; rankings are among timed versions. Jam chart entries arrive on phish.net later and are not counted here.</div></section>';
      });
    }).catch(function () { el.innerHTML = ''; });
  }

  // ---- Status strip: what is happening now ---------------------------------
  // The top of the home page changes with the calendar: tonight's show, the
  // tour between shows, or the off-season, each with a jump to the section
  // that answers it. Under it, labelled chip rows: on a show day the latest
  // show's notables and the regulars that are due; between shows the tour's
  // notables, the due list and links; in the off-season the day's picks.
  // While a show is live the strip and chips step aside for the live panel.
  var now = { el: null, data: null, live: false, overDate: null };
  function validTour(name) { return !!name && name !== 'Not Part of a Tour'; }
  function daysBetween(a, b) { return Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 86400000); }
  function where(city, st) { return city + (st ? ', ' + st : ''); }
  // "Oct 6", with the year only when it is not this year.
  function day(d) {
    var o = { month: 'short', day: 'numeric' };
    if (d.slice(0, 4) !== localDate(null).slice(0, 4)) o.year = 'numeric';
    return new Date(d + 'T12:00:00').toLocaleDateString('en-US', o);
  }
  function chip(href, text, note) { return '<a href="' + esc(href) + '">' + esc(text) + (note ? '<small>' + esc(note) + '</small>' : '') + '</a>'; }
  function songChip(name, note) { return chip(P.songPage(name), name, note); }
  function chipRow(label, chips) { return chips.length ? '<div class="row"><span class="lab">' + esc(label) + '</span>' + chips.join('') + '</div>' : ''; }

  // Bustouts (biggest gap first), debuts, then the show's best-ranked length.
  // The "song|gap;..." and "song;..." lists are bustouts and debuts in
  // landing/latest, but bustout_names and debut_names in season/shows, whose
  // bustouts and debuts are counts.
  function notableChips(shows, ranks, max) {
    var seen = {}, out = [];
    function add(song, note) { var k = P.songKey(song); if (seen[k]) return; seen[k] = true; out.push(songChip(song, note)); }
    var bust = [], deb = [];
    shows.forEach(function (s) {
      String(('bustout_names' in s ? s.bustout_names : s.bustouts) || '').split(';').filter(Boolean).forEach(function (b) { var p = b.split('|'); bust.push({ song: p[0], gap: Number(p[1]) }); });
      String(('debut_names' in s ? s.debut_names : s.debuts) || '').split(';').filter(Boolean).forEach(function (d) { deb.push(d); });
    });
    bust.sort(function (a, b) { return b.gap - a.gap; }).forEach(function (b) { add(b.song, n(b.gap) + '-show gap'); });
    deb.forEach(function (d) { add(d, 'debut'); });
    var r = (ranks || []).filter(function (x) { return x.cnt >= 3 && x.rnk <= 5; }).sort(function (a, b) { return a.rnk - b.rnk || b.ms - a.ms; })[0];
    if (r) add(r.song, r.rnk === 1 ? 'longest ever' : '#' + r.rnk + ' longest');
    else {
      var long = shows.filter(function (s) { return s.longest_ms >= 15 * 60000; }).sort(function (a, b) { return b.longest_ms - a.longest_ms; })[0];
      if (long) add(long.longest_song, mmss(long.longest_ms));
    }
    return out.slice(0, max);
  }
  function dueChips(due, max) { return (due || []).slice(0, max).map(function (s) { return songChip(s.song, 'gap ' + n(s.gap)); }); }
  // The same songs all day for every visitor, a different handful tomorrow:
  // a hash of the date seeds the draw from songs played 100+ times.
  function todaysPicks(catalog, count) {
    var pool = (catalog ? catalog.songs : []).filter(function (s) { return s.plays >= 100; });
    var seed = localDate(null), h = 2166136261;
    for (var i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
    var out = [];
    while (pool.length && out.length < count) {
      h ^= h << 13; h ^= h >>> 17; h ^= h << 5;
      out.push(pool.splice((h >>> 0) % pool.length, 1)[0]);
    }
    return out.map(function (s) { return songChip(s.name); });
  }

  // tonight: on a show day; tour: mid-tour, a tour just ended, or one about to
  // start; off: everything else.
  function modeOf(st, today) {
    if (!st) return 'off';
    var since = daysBetween(st.last_date, today), to = st.next_date ? daysBetween(today, st.next_date) : Infinity;
    return (validTour(st.tourname) && st.tour_left > 0) || since <= 7 || to <= 14 ? 'tour' : 'off';
  }

  function renderNow() {
    var el = now.el, d = now.data;
    if (!el || !d) return;
    if (now.live) { el.innerHTML = ''; return; }
    var st = d.status, strip, rows = [];
    if (d.mode === 'tonight') {
      var t = d.tonight, isFinal = now.overDate === t.showdate;
      var night = d.runBefore + 1, nights = night + d.runLeft;
      var tourOk = st && validTour(t.tourname) && st.tourname === t.tourname;
      var bits = [where(t.city, t.state)];
      if (nights > 1) bits.push('night ' + night + ' of ' + nights);
      if (tourOk) bits.push('show ' + (st.last_date < t.showdate ? st.tour_played + 1 : st.tour_played) + ' of ' + (st.tour_played + st.tour_left) + ', ' + t.tourname);
      strip = ['tonight', isFinal ? 'Tonight · final' : 'Tonight', t.venue, bits.join(' · '), isFinal ? ['#live', 'Setlist ↑'] : ['#landingTonight', 'Forecast ↓']];
      var L = d.latest;
      if (L) {
        var ago = daysBetween(L.show.showdate, t.showdate);
        rows.push(chipRow(ago === 0 ? 'Tonight' : ago === 1 ? 'Last night' : 'Last show', notableChips([L.show], L.ranks, 3)));
      }
      rows.push(chipRow('Due', dueChips(d.due, 3)));
    } else if (d.mode === 'tour') {
      var tv = validTour(st.tourname);
      var k = !tv ? 'Between shows' : st.tour_left > 0 ? st.tourname + ' · ' + n(st.tour_played) + ' of ' + n(st.tour_played + st.tour_left) + ' shows' : st.tourname + ' · done, ' + n(st.tour_played) + ' shows';
      strip = ['tour', k,
        st.next_date ? 'Next: ' + day(st.next_date) + ', ' + st.next_venue : 'Last show: ' + day(st.last_date) + ', ' + st.last_venue,
        st.next_date ? where(st.next_city, st.next_state) + ' · last show ' + day(st.last_date) + ' at ' + st.last_venue : where(st.last_city, st.last_state),
        ['#landingLatest', 'Latest show ↓']];
      if (tv) rows.push(chipRow('This tour', notableChips(d.tourShows, d.tourRanks, 3)));
      rows.push(chipRow('Due', dueChips(d.due, 3)));
      var browse = [];
      if (tv) browse.push(chip('/tour/' + st.tourid, st.tourname));
      browse.push(chip(P.venuePage(st.last_venueid), st.last_venue));
      if (st.next_venueid && st.next_venueid !== st.last_venueid) browse.push(chip(P.venuePage(st.next_venueid), st.next_venue));
      rows.push(chipRow('Browse', browse));
    } else {
      strip = ['off', 'Off-season',
        st && st.next_date ? 'Next: ' + day(st.next_date) + ', ' + st.next_venue : st ? 'Last show: ' + day(st.last_date) + ', ' + st.last_venue : 'Phish stats',
        st && st.next_date ? where(st.next_city, st.next_state) + ' · last show ' + day(st.last_date) + ' at ' + st.last_venue : st ? where(st.last_city, st.last_state) : '',
        ['#landingSeason', 'The season ↓']];
      rows.push(chipRow('Today’s picks', todaysPicks(d.catalog, 4)));
      var links = [];
      if (st) links.push(chip('/year/' + st.last_date.slice(0, 4), st.last_date.slice(0, 4)));
      if (st && validTour(st.tourname)) links.push(chip('/tour/' + st.tourid, st.tourname));
      links.push(chip('/show/random', 'Random show'));
      rows.push(chipRow('Browse', links));
    }
    var body = rows.join('');
    el.innerHTML = '<div class="now-strip ' + strip[0] + '"><span class="pip"></span><div class="txt"><div class="k">' + esc(strip[1]) + '</div>' +
      '<div class="v">' + esc(strip[2]) + '</div>' + (strip[3] ? '<div class="s">' + esc(strip[3]) + '</div>' : '') + '</div>' +
      '<a class="go" href="' + strip[4][0] + '">' + esc(strip[4][1]) + '</a></div>' +
      (body ? '<div class="now-picks">' + body + '</div>' : '');
  }

  function loadNow(el, tonightP, latestP) {
    now.el = el;
    var today = localDate(null), soft = function (p) { return p ? p.catch(function () { return null; }) : null; };
    return Promise.all([api('landing/status', { d: today }), soft(api('landing/due', { d: today })), soft(tonightP), soft(latestP)]).then(function (r) {
      var st = r[0][0] || null, tonight = r[2];
      var mode = tonight ? 'tonight' : modeOf(st, today);
      var tourY = st && st.last_date.slice(0, 4) + '-01-01';
      return Promise.all([
        tonight ? soft(api('landing/run-shows', { v: tonight.venueid, d: tonight.showdate })) : null,
        tonight ? soft(api('landing/run-left', { v: tonight.venueid, d: tonight.showdate })) : null,
        mode === 'tour' && validTour(st.tourname) ? soft(api('season/shows', { y: tourY })) : null,
        mode === 'tour' && validTour(st.tourname) ? soft(api('season/tops', { y: tourY })) : null,
        mode === 'off' ? soft(P.loadCatalog()) : null
      ]).then(function (x) {
        var tourShows = (x[2] || []).filter(function (s) { return s.tourname === st.tourname; });
        var inTour = {}; tourShows.forEach(function (s) { inTour[s.showdate] = true; });
        now.data = {
          mode: mode, status: st, due: r[1], tonight: tonight,
          latest: r[3] && r[3][0][0] ? { show: r[3][0][0], ranks: r[3][1] } : null,
          runBefore: x[0] ? x[0].length : 0, runLeft: x[1] && x[1][0] ? Number(x[1][0].n) : 0,
          tourShows: tourShows,
          // season/tops: versions in their song's all-time top five, as rnk and cnt.
          tourRanks: (x[3] || []).filter(function (t) { return inTour[t.show_date]; }),
          catalog: x[4]
        };
        renderNow();
        var hint = document.getElementById('hintRight');
        if (hint && st) hint.textContent = 'Data through ' + day(st.last_date);
      });
    }).catch(function () { el.innerHTML = ''; });
  }

  function renderLanding(container) {
    // "Lately" holds the latest show and the season, each still its own section.
    container.innerHTML = '<div id="landingNow"></div><div id="landingTonight"></div>' +
      '<div class="umbrella"><h2 class="umbrella-h">Lately</h2><div id="landingLatest"></div><div id="landingSeason"></div></div>' +
      '<div id="landingHistory"></div>';
    renderSeason(container.querySelector('#landingSeason'));
    var latestP = Promise.all([api('landing/latest'), api('landing/latest-ranks')]);
    latestP.then(function (r) { renderLatest(container.querySelector('#landingLatest'), r[0][0], r[1]); })
      .catch(function () {});
    // ?history=MM-DD previews another date's panel.
    var md = (/^\d{2}-\d{2}$/.test(new URLSearchParams(location.search).get('history') || '') ? new URLSearchParams(location.search).get('history') : localDate(null).slice(5));
    var tonightP = findTonight();
    loadTonight(container.querySelector('#landingTonight'), tonightP);
    loadNow(container.querySelector('#landingNow'), tonightP, latestP);
    Promise.all([api('landing/history', { md: md }), api('landing/history-ranks', { md: md })])
      .then(function (r) { renderHistory(container.querySelector('#landingHistory'), md, r[0], r[1]); })
      .catch(function () {});
  }

  window.Phish.renderLanding = renderLanding;
  window.Phish.landingLive = landingLive;
})();
