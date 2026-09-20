// Landing panels for the song page's empty state: "Today in history" and,
// on a show day before the first song is posted, "Call the openers".
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
  var state = { el: null, show: null, live: [], data: null, wx: '' };

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
  function candidates(rows, excluded, shows2y) {
    var pool = rows.map(function (r) {
      var score = Number(r.opens_2y) * 3 + Number(r.opens_5y);
      return Object.assign({ score: score, out: excluded[r.songid] || (Number(r.gap) === 0 ? 'played last show' : null) }, r);
    }).filter(function (r) { return !r.out && r.score > 0; });
    return weightedSample(pool, 8, function (r) { return r.score * r.score; })
      .sort(function (a, b) { return b.score - a.score; })
      .map(function (r) { r.rate = shows2y ? Math.round(100 * r.opens_2y / shows2y) : 0; return r; });
  }
  function songLink(name) { return '<a href="' + P.songPage(name) + '">' + esc(name) + '</a>'; }

  function renderTonight() {
    var el = state.el, show = state.show, d = state.data;
    if (!el || !show || !d) return;
    var tonight = state.live.filter(function (e) { return e.showdate === show.showdate; });
    var started = tonight.length > 0;
    var runNight = d.runShows.length + 1;
    var head = '<div class="head"><h2>Tonight</h2><span>' + esc(show.venue) + ' · ' + esc(show.city + (show.state ? ', ' + show.state : '')) + '</span></div>' +
      '<div class="venue-line">Phish’s <b>' + P.ordinal(d.priorHere + 1) + '</b> show at ' + esc(show.venue) + (runNight > 1 ? ', <b>night ' + runNight + '</b> of this run' : '') + '.' +
      (d.runSongs.length ? ' <span class="vs">' + n(d.runSongs.length) + ' songs already played this run are left out below.</span>' : '') + '</div>';

    // Before the first post: the likely openers. Once the phish.com account
    // has posted, the live panel above carries the setlist, so just show what
    // actually opened each set.
    function slotBlock(slot, title, actual) {
      if (started) {
        return '<div class="seg"><h3>' + esc(title) + '</h3>' +
          (actual ? '<div class="call-result"><b>' + songLink(actual.song) + '</b></div>' : '<div class="none">Not yet posted.</div>') + '</div>';
      }
      return '<div class="seg"><h3>' + esc(title) + '</h3><ol>' +
        d.cands[slot].map(function (c) {
          return '<li><span class="t">' + songLink(c.song) + '</span><span class="n">' + c.rate + '% · gap ' + n(c.gap) + '</span></li>';
        }).join('') + '</ol><div class="none">rate = how often it opened over the last two years (' + n(d.shows2y) + ' shows)</div></div>';
    }
    var set1Actual = tonight[0] || null;
    var set2Actual = tonight.filter(function (e) { return e.set_label === '2'; })[0] || null;

    function longshotBlock() {
      if (started) return '';
      return '<div class="seg"><h3>Long shots</h3><ol>' +
        d.longshots.map(function (c) {
          return '<li><span class="t">' + songLink(c.song) + (P.isCover(c.artist) ? '<span class="cover">' + esc(c.artist) + '</span>' : '') + '</span>' +
            '<span class="n">gap ' + n(c.gap) + ' · last ' + fmtDate(c.last_played) + '</span></li>';
        }).join('') + '</ol><div class="none">not played in 300+ shows, just for fun</div></div>';
    }

    el.innerHTML = '<section class="sec landing tonight">' + head + state.wx +
      '<div class="segues">' + slotBlock('set1', 'Set 1 opener', set1Actual) + slotBlock('set2', 'Set 2 opener', set2Actual) + longshotBlock() + '</div>' +
      (!started ? '<div class="none" style="margin-top:8px">The lists reshuffle on each load, weighted toward the likely picks. Tap a song for its page.</div>' : '') +
      '</section>';
  }

  function loadTonight(el) {
    var deviceToday = localDate(null);
    return api('landing/scheduled', { d: deviceToday }).then(function (rows) {
      // Pick the scheduled show whose date is "today" on its own venue clock.
      var show = rows.filter(function (s) {
        var tz = TZ ? TZ.venueTimeZone({ city: s.city, state: s.state, country: s.country }) : null;
        return s.showdate === localDate(tz);
      })[0];
      if (!show) { el.innerHTML = ''; state.show = null; return; }
      state.show = show; state.el = el; state.wx = '';
      loadWeather(show).then(function (html) { state.wx = html; renderTonight(); });
      var A = { d: show.showdate, v: show.venueid };
      return Promise.all([api('landing/venue-info', A), api('landing/run-shows', A), api('landing/run-songs', A), api('landing/shows-2y', { d: A.d }), api('landing/openers', { slot: 'set1', d: A.d }), api('landing/openers', { slot: 'set2', d: A.d }), api('landing/longshots')])
        .then(function (r) {
          var excluded = {}; r[2].forEach(function (s) { excluded[s.songid] = 'played ' + fmtDate(s.played); });
          state.data = { priorHere: r[0][0].prior_here, runShows: r[1], runSongs: r[2], shows2y: r[3][0].n, longshots: r[6],
            cands: { set1: candidates(r[4], excluded, r[3][0].n), set2: candidates(r[5], excluded, r[3][0].n) } };
          renderTonight();
        });
    }).catch(function () { el.innerHTML = ''; });
  }

  // Called by the page whenever the live feed updates.
  function landingLive(entries) { state.live = entries || []; if (state.show) renderTonight(); }

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
  function seasonCard(title, sub, st, ref, extra) {
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
    if (st.longest) lines.push('<b>Longest</b> ' + esc(st.longest.longest_song) + ' ' + mmss(st.longest.longest_ms) + ' <a href="' + P.showPage(st.longest.showdate) + '">' + fmtDate(st.longest.showdate) + '</a>');
    if (st.firsts.length) lines.push('<b class="gold">All-time longest</b> ' + st.firsts.slice(0, 6).map(function (t) { return esc(t.song) + ' <a href="' + P.showPage(t.show_date) + '">' + fmtDate(t.show_date) + '</a>'; }).join(', ') + (st.firsts.length > 6 ? ' and ' + n(st.firsts.length - 6) + ' more' : ''));
    if (st.tops.length) lines.push('<b>Top-five versions</b> ' + n(st.tops.length) + (st.tops.length > st.firsts.length && st.tops.length <= 8 ? ': ' + st.tops.filter(function (t) { return t.rnk > 1; }).map(function (t) { return esc(t.song) + ' #' + t.rnk; }).join(', ') : ''));
    if (st.bustouts.length) lines.push('<b class="red">Bustouts</b> ' + n(st.bustouts.length) + ': ' + st.bustouts.slice(0, 5).map(function (b) { return esc(b.song) + ' (' + n(b.gap) + ')'; }).join(', ') + (st.bustouts.length > 5 ? ', …' : ''));
    if (st.debuts.length) lines.push('<b class="green">Debuts</b> ' + st.debuts.slice(0, 6).map(function (d) { return esc(d.song); }).join(', ') + (st.debuts.length > 6 ? ' and ' + n(st.debuts.length - 6) + ' more' : ''));
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
      return Promise.all([api('season/shows', A), api('season/tops', A), review ? api('season/review', A) : null, review ? api('season/most-played', A) : null, P.loadTours().catch(function () { return null; })]).then(function (r) {
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
        var cards = [];
        if (run.length > 1) cards.push(seasonCard('This run', esc(last.venue) + ' · ' + n(run.length) + ' nights, ' + span(run), runSt, yearSt));
        if (tour.length > 1 && tour.length !== shows.length) cards.push(seasonCard(tourTitle(tourName), n(tour.length) + ' shows, ' + span(tour) + (run.length > 1 && tour.length > run.length ? ' · run included' : ''), tourSt, yearSt));
        var extra = [];
        if (review && r[2] && r[2][0]) {
          var rv = r[2][0];
          extra.push('<b>Breadth</b> ' + n(rv.distinct_songs) + ' different songs across ' + n(rv.venues) + ' venues in ' + n(rv.cities) + ' cities');
          if (r[3] && r[3].length) extra.push('<b>Most played</b> ' + r[3].map(function (m) { return esc(m.song) + ' ×' + m.n; }).join(', '));
        }
        cards.push(seasonCard(review ? year + ' in review' : year + ' so far', n(shows.length) + ' shows, ' + span(shows) + (review ? ' · the year is done' : ''), yearSt, null, extra));
        el.innerHTML = '<section class="sec landing season' + (review ? ' review' : '') + '"><div class="head"><h2>' + (review ? year + ' in review' : 'The season') + '</h2><span>run · tour · year, each against the year\u2019s average</span></div>' +
          '<div class="cards">' + cards.join('') + '</div>' +
          '<div class="none">Lengths are official LivePhish times where released, otherwise phish.in recordings; rankings are among timed versions. Jam chart entries arrive on phish.net later and are not counted here.</div></section>';
      });
    }).catch(function () { el.innerHTML = ''; });
  }

  function renderLanding(container) {
    container.innerHTML = '<div id="landingTonight"></div><div id="landingLatest"></div><div id="landingSeason"></div><div id="landingHistory"></div>';
    renderSeason(container.querySelector('#landingSeason'));
    Promise.all([api('landing/latest'), api('landing/latest-ranks')])
      .then(function (r) { renderLatest(container.querySelector('#landingLatest'), r[0][0], r[1]); })
      .catch(function () {});
    // ?history=MM-DD previews another date's panel.
    var md = (/^\d{2}-\d{2}$/.test(new URLSearchParams(location.search).get('history') || '') ? new URLSearchParams(location.search).get('history') : localDate(null).slice(5));
    loadTonight(container.querySelector('#landingTonight'));
    Promise.all([api('landing/history', { md: md }), api('landing/history-ranks', { md: md })])
      .then(function (r) { renderHistory(container.querySelector('#landingHistory'), md, r[0], r[1]); })
      .catch(function () {});
  }

  window.Phish.renderLanding = renderLanding;
  window.Phish.landingLive = landingLive;
})();
