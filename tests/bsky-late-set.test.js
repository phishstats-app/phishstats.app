'use strict';
// A set after the encore, like the Woodlands Jam at Mondegreen (2024-08-16:
// phish.net records it as set 3, position 22, after a two-song encore, played
// hours later in the woods). phish.com may post it several ways, and the
// "now available" recap post usually lands first (a median 69 min after the
// last song). Every case runs through both parsers: the nightly ingest's
// (lib/bsky.js) and the live panel's (templates/pages/song.html).
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseFeed } = require('../lib/bsky');
const { pageParser } = require('./helpers/live-parse');

const PARSERS = { ingest: parseFeed, page: pageParser() };
const t = (hhmm, day = 17) => `2024-08-${day}T${hhmm}:00.000Z`;
const post = (i, at, text) => ({ uri: 'at://x/' + i, createdAt: at, text });
const MAIN = [
  post(1, t('00:05'), '8/16/24 Dover, DE'),
  post(2, t('00:10'), 'SET ONE: Sample in a Jar'),
  post(3, t('01:20'), 'SET TWO: Down with Disease'),
  post(4, t('03:00'), 'ENCORE: Wading in the Velvet Sea'),
  post(5, t('03:08'), 'Slave to the Traffic Light'),
];
const RECAP = post(6, t('04:30'), '8/16/24 from The Woodlands is now available for download & streaming via the LivePhish App. https://www.livephish.com/LP-1234.html');

// The parts both parsers return, in the same shape.
function shape(entries) {
  return entries.map((e) => ({
    set: e.set_label, song: e.song, name: e.set_name || null,
    secs: e.approx_seconds == null ? null : Math.round(e.approx_seconds / 60),
    ended: !!e.show_ended_at,
  }));
}
function both(posts, check) {
  for (const [name, parse] of Object.entries(PARSERS)) check(shape(parse(posts)), name);
}
const sets = (s) => s.map((e) => e.set + ':' + e.song);

test('"SET THREE:" after the encore is set 3, and the encore closer is a closer', () => {
  both([...MAIN, post(7, t('06:10'), 'SET THREE: Woodlands Jam')], (s, p) => {
    assert.deepEqual(sets(s), ['1:Sample in a Jar', '2:Down with Disease', 'e:Wading in the Velvet Sea', 'e:Slave to the Traffic Light', '3:Woodlands Jam'], p);
    assert.equal(s[3].secs, null, p + ': no post-to-post length across the gap');
  });
});

test('a bare song long after the encore starts the next set instead of joining the encore', () => {
  both([...MAIN, post(7, t('06:10'), 'Woodlands Jam')], (s, p) => {
    assert.deepEqual(sets(s).slice(3), ['e:Slave to the Traffic Light', '3:Woodlands Jam'], p);
    assert.equal(s[3].secs, null, p + ': not a 182-minute Slave');
  });
});

test('an encore whose songs are 20 minutes apart stays one encore', () => {
  both([...MAIN.slice(0, 4), post(5, t('03:20'), 'Slave to the Traffic Light')], (s, p) => {
    assert.deepEqual(s.slice(2).map((e) => e.set), ['e', 'e'], p);
    assert.equal(s[2].secs, 20, p);
  });
});

test('an all-caps prefix starts the next set and names it', () => {
  both([...MAIN, post(7, t('06:10'), 'SECRET SET: Woodlands Jam')], (s, p) => {
    assert.deepEqual(s[4], { set: '3', song: 'Woodlands Jam', name: 'Secret set', secs: null, ended: false }, p);
  });
  // After a real set 3 (NYE 2025 had one before the encore), the next is 4.
  both([
    post(1, t('00:05'), '12/31/25 New York, NY'), post(2, t('00:10'), 'SET ONE: Free'),
    post(3, t('01:00'), 'SET TWO: Sand'), post(4, t('02:00'), 'SET THREE: Harry Hood'),
    post(5, t('03:00'), 'ENCORE: Sincere'), post(6, t('04:30'), 'LATE NIGHT: Tweezer'),
  ], (s, p) => assert.deepEqual(s.map((e) => e.set), ['1', '2', '3', 'e', '4'], p));
});

test('a set after the recap post is kept, and the show is no longer marked ended', () => {
  both([...MAIN, RECAP, post(7, t('06:10'), 'SET THREE: Woodlands Jam')], (s, p) => {
    assert.deepEqual(sets(s).slice(4), ['3:Woodlands Jam'], p);
    assert.ok(s.every((e) => !e.ended), p + ': the recap was not the end after all');
  });
  // A second recap after the late set marks the end again.
  both([...MAIN, RECAP, post(7, t('06:10'), 'SET THREE: Woodlands Jam'), post(8, t('08:00'), RECAP.text)], (s, p) => {
    assert.ok(s.every((e) => e.ended), p);
  });
});

test('after the recap, a bare post is chatter, not a song', () => {
  both([...MAIN, RECAP, post(7, t('05:00'), 'Thank you Dover!')], (s, p) => {
    assert.equal(s.length, 4, p);
    assert.ok(s.every((e) => e.ended), p);
  });
});

test('the show closes twelve hours after its last song', () => {
  both([...MAIN, RECAP, post(7, t('15:30'), 'SET THREE: Not a late set')], (s, p) => {
    assert.equal(s.length, 4, p + ': twelve hours on, a set post belongs to no show without a date header');
  });
});
