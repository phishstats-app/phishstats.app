'use strict';
// The rules behind a set closer's clock on the live panel: when the set
// usually ends, when the clock stops by itself, and what a visitor's "Set's
// over" press does. The rules live in assets/live-end.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../assets/live-end');

const MIN = 60 * 1000;
const S = new Date('2026-10-03T23:38:00Z'); // set 1 start
const at = (min) => new Date(S.getTime() + min * MIN);
const fig1 = { p10: 74 * 60, p25: 79 * 60, median: 83 * 60, p75: 88 * 60, p90: 91 * 60 };

test('figures come from the endpoint when there are enough sets, else the built-in defaults', () => {
  const rows = [{ set_label: '1', n: 12, p10: 1, p25: 2, median: 3, p75: 4, p90: 5 }, { set_label: '2', n: 3, p10: 1, p25: 2, median: 3, p75: 4, p90: 5 }];
  assert.deepEqual(L.setFigures(rows, '1'), { p10: 1, p25: 2, median: 3, p75: 4, p90: 5 });
  assert.deepEqual(L.setFigures(rows, '2'), L.DEFAULTS['2'], 'three sets is too few');
  assert.deepEqual(L.setFigures([], '3'), L.DEFAULTS['2'], 'set 3 reads as a second set');
  assert.deepEqual(L.setFigures(null, 'e2'), L.DEFAULTS.e, 'a second encore reads as an encore');
});

test('the window runs from the set start, unless the closer itself starts late', () => {
  const w = L.endWindow({ setStart: S, postedAt: at(72), songMedianMs: 9 * MIN, figures: fig1 });
  assert.deepEqual([w.expectedEnd, w.windowFrom, w.windowTo, w.capAt, w.earlyBefore], [at(83), at(79), at(91), at(91), at(74)]);

  const late = L.endWindow({ setStart: S, postedAt: at(88), songMedianMs: 12 * MIN, figures: fig1 });
  assert.deepEqual(late.expectedEnd, at(100), 'a closer posted at 88 cannot end at 83');
  assert.deepEqual(late.capAt, at(93), 'never caps a song in its first five minutes');

  const unknown = L.endWindow({ setStart: S, postedAt: at(80), songMedianMs: null, figures: fig1 });
  assert.deepEqual(unknown.expectedEnd, at(88), 'an untimed song is taken as eight minutes');
});

function state(minNow, opts = {}) {
  const entry = { posted_at: at(72), official_seconds: null, approx_seconds: null, ...opts.entry };
  const window = L.endWindow({ setStart: S, postedAt: entry.posted_at, songMedianMs: 9 * MIN, figures: fig1 });
  return L.closerState(entry, { now: at(minNow), window, press: opts.press || null, nextSetStart: opts.nextSetStart || null, over: !!opts.over });
}

test('the clock runs until the cap, then stops at the cap', () => {
  assert.deepEqual(state(85), { kind: 'running', seconds: 13 * 60 });
  assert.deepEqual(state(120), { kind: 'capped', seconds: 19 * 60 });
});

test('once the next set has started, the closer gets an upper bound', () => {
  assert.deepEqual(state(150, { nextSetStart: at(125) }), { kind: 'bounded', seconds: 53 * 60 });
});

test('a press in the normal window ends the song for that visitor, and beats the cap and the bound', () => {
  const press = { at: at(88), confirmed: false };
  assert.deepEqual(state(90, { press }), { kind: 'pressed', seconds: 16 * 60 });
  assert.deepEqual(state(120, { press }), { kind: 'pressed', seconds: 16 * 60 });
  assert.deepEqual(state(150, { press, nextSetStart: at(125) }), { kind: 'pressed', seconds: 16 * 60 });
});

test('an early press counts only once confirmed; until then the clock and the cap carry on', () => {
  const early = { at: at(52), confirmed: false };
  const entry = { posted_at: at(45) };
  assert.deepEqual(state(60, { entry, press: early }), { kind: 'running', seconds: 15 * 60, earlyPress: 7 * 60 });
  assert.deepEqual(state(130, { entry, press: early }), { kind: 'capped', seconds: 46 * 60, earlyPress: 7 * 60 });
  assert.deepEqual(state(60, { entry, press: { ...early, confirmed: true } }), { kind: 'pressed', seconds: 7 * 60 });
});

test('a later post in the same set overrides a press, and an official length overrides everything', () => {
  const press = { at: at(88), confirmed: true };
  assert.deepEqual(state(95, { press, entry: { approx_seconds: 900 } }), { kind: 'post', seconds: 900 });
  assert.deepEqual(state(95, { press, entry: { approx_seconds: 900, official_seconds: 1000 } }), { kind: 'official', seconds: 1000 });
});

test('a show that is over stops the clock without a press', () => {
  assert.deepEqual(state(95, { over: true }), { kind: 'over', seconds: null });
});

test('presses are stored per song post, survive a broken storage, and expire', () => {
  const mem = {};
  const storage = {
    getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; },
    key: (i) => Object.keys(mem)[i], get length() { return Object.keys(mem).length; },
  };
  const e = { showdate: '2026-10-03', set_label: '1', posted_at: at(72) };
  const k = L.storageKey(e, 'antelope');
  assert.equal(k, 'endset:2026-10-03:1:antelope:2026-10-04T00:50:00.000Z');

  L.writePress(storage, k, { at: at(88), confirmed: false });
  assert.deepEqual(L.readPress(storage, k), { at: at(88), confirmed: false });
  L.clearPress(storage, k);
  assert.equal(L.readPress(storage, k), null);

  L.writePress(storage, k, { at: at(88), confirmed: true });
  L.writePress(storage, 'endset:old', { at: new Date('2026-09-01T00:00:00Z'), confirmed: true });
  mem.unrelated = 'kept';
  L.prunePresses(storage, at(100), 8 * 3600 * 1000);
  assert.deepEqual(Object.keys(mem).sort(), [k, 'unrelated']);

  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } };
  assert.equal(L.readPress(broken, k), null);
  assert.doesNotThrow(() => L.writePress(broken, k, { at: at(88), confirmed: true }));
  assert.doesNotThrow(() => L.prunePresses(broken, at(100), 1));
  assert.equal(L.readPress(null, k), null);
});
