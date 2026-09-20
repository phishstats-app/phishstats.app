'use strict';
// Parameter validation for the public endpoints. Every value that reaches a
// prepared statement passes through here first.
const test = require('node:test');
const assert = require('node:assert/strict');
const { validate } = require('../lib/web/params');

const ok = (spec, query) => {
  const r = validate(spec, query);
  assert.ok(r.ok, `expected valid, got: ${r.message}`);
  return r.params;
};
const bad = (spec, query) => {
  const r = validate(spec, query);
  assert.ok(!r.ok, `expected invalid, got params: ${JSON.stringify(r.params)}`);
  return r.message;
};

test('date accepts a full ISO day and nothing else', () => {
  assert.deepEqual(ok({ d: 'date' }, { d: '2026-09-06' }), { d: '2026-09-06' });
  for (const d of ['2026-9-6', '2026-09-6', 'latest', '', '2026-09-06 ', "2026-09-06'",
    "2026-09-06'; DROP TABLE shows--", '9999-99-99x']) {
    bad({ d: 'date' }, { d });
  }
});

test('date rejects a well-formed but impossible day', () => {
  // The shape is right, so the regex alone would pass it; the value is not a day.
  bad({ d: 'date' }, { d: '2026-13-01' });
  bad({ d: 'date' }, { d: '2026-02-30' });
});

test('md accepts month-day only', () => {
  assert.deepEqual(ok({ md: 'md' }, { md: '12-31' }), { md: '12-31' });
  for (const md of ['1231', '1-1', '13-01', '02-30', '12-31-2026']) bad({ md: 'md' }, { md });
});

test('yearStart accepts only the first of January', () => {
  assert.deepEqual(ok({ y: 'yearStart' }, { y: '2026-01-01' }), { y: '2026-01-01' });
  for (const y of ['2026-06-01', '2026-01-02', '2026', '0000-01-01']) bad({ y: 'yearStart' }, { y });
});

test('int accepts a plain positive id and returns a number', () => {
  assert.deepEqual(ok({ v: 'int' }, { v: '961' }), { v: 961 });
  assert.equal(typeof ok({ v: 'int' }, { v: '1' }).v, 'number');
  for (const v of ['-1', '0961', '1e9', '12345678', '1.5', '', ' 1', '1 ', 'abc', '١٢٣']) {
    bad({ v: 'int' }, { v });
  }
});

test('int accepts zero-free ids up to seven digits', () => {
  assert.deepEqual(ok({ v: 'int' }, { v: '9999999' }), { v: 9999999 });
});

test('ids accepts one to thirty integers and returns numbers', () => {
  assert.deepEqual(ok({ ids: 'ids' }, { ids: '1,2,3' }), { ids: [1, 2, 3] });
  assert.equal(ok({ ids: 'ids' }, { ids: '7' }).ids.length, 1);
  const thirty = Array.from({ length: 30 }, (_, i) => i + 1).join(',');
  assert.equal(ok({ ids: 'ids' }, { ids: thirty }).ids.length, 30);
  const thirtyOne = Array.from({ length: 31 }, (_, i) => i + 1).join(',');
  bad({ ids: 'ids' }, { ids: thirtyOne });
  for (const ids of ['', '1,a', '1,,2', '1,2,', ',1', '1;2', '1, 2']) bad({ ids: 'ids' }, { ids });
});

test('slot accepts exactly the two set labels', () => {
  assert.deepEqual(ok({ slot: 'slot' }, { slot: 'set1' }), { slot: 'set1' });
  assert.deepEqual(ok({ slot: 'slot' }, { slot: 'set2' }), { slot: 'set2' });
  for (const slot of ['set3', 'SET1', 'drop', '']) bad({ slot: 'slot' }, { slot });
});

test('text80 accepts an ordinary place name and caps its length', () => {
  assert.deepEqual(ok({ city: 'text80' }, { city: 'New York' }), { city: 'New York' });
  assert.deepEqual(ok({ city: 'text80' }, { city: 'x'.repeat(80) }), { city: 'x'.repeat(80) });
  bad({ city: 'text80' }, { city: 'x'.repeat(81) });
  bad({ city: 'text80' }, { city: '' });
});

test('text80 rejects control characters, and only those', () => {
  // The rule is "no control characters", not a spelling check: a name that
  // matches no venue is still a valid request that returns no rows.
  assert.ok(validate({ city: 'text80' }, { city: 'NewYork' }).ok);
  assert.ok(validate({ city: 'text80' }, { city: 'Not A Real City' }).ok);
  for (const code of [0x00, 0x09, 0x0a, 0x0d, 0x1f, 0x7f]) {
    bad({ city: 'text80' }, { city: 'City' + String.fromCharCode(code) });
  }
});

test('text80 keeps accented and punctuated place names', () => {
  // Real venues: "Montréal", "Saint-Jean-sur-Richelieu", "Washington, D.C."
  for (const city of ['Montréal', 'Saint-Jean-sur-Richelieu', "Coeur d'Alene", 'Washington, D.C.']) {
    assert.deepEqual(ok({ city: 'text80' }, { city }), { city });
  }
});

test('a missing required parameter is rejected by name', () => {
  const message = bad({ d: 'date' }, {});
  assert.match(message, /\bd\b/);
});

test('unknown query parameters are ignored, not rejected', () => {
  assert.deepEqual(ok({ d: 'date' }, { d: '2026-09-06', _shape: 'array', sql: 'select 1' }),
    { d: '2026-09-06' });
});

test('an empty spec accepts a request with no parameters', () => {
  assert.deepEqual(ok({}, {}), {});
});

test('the failure message names the parameter but never echoes its value', () => {
  // The message is returned to the browser; it must not reflect user input back.
  const message = bad({ d: 'date' }, { d: '<script>alert(1)</script>' });
  assert.match(message, /\bd\b/);
  assert.ok(!message.includes('<script>'), 'message echoed the input');
});
