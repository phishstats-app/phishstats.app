'use strict';
// The stat card's markup is emitted by two renderers, and its CSS lives in one
// place. That pairing broke silently: assets/period.js emitted the season
// card's markup on the tour and era pages while every rule for it was scoped
// `.season .row`, a class only the landing page has. The tour page shipped to
// production reading "Shows19", with no test able to see it — a stylesheet
// selector that matches nothing is not a syntax error.
//
// So this checks the pairing rather than the appearance: every class the
// renderers put inside a stat card must have at least one rule that can reach
// it from `class="seg card"`.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
// Comments stripped first: a comment sitting above a rule would otherwise be
// swallowed into the selector this scans for.
const css = fs.readFileSync(path.join(ROOT, 'assets', 'app.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

// The inner classes of a stat card, as emitted by assets/landing.js
// (seasonCard) and assets/period.js (statsBlock, notablesBlock).
const INNER = ['rows', 'row', 'lines'];

// Selectors that mention `.<cls>`, with their scoping prefix intact.
function selectorsFor(cls) {
  const out = [];
  const re = new RegExp('^\\s*([^{}]*\\.' + cls + '\\b[^{}]*)\\{', 'gm');
  let m;
  while ((m = re.exec(css))) out.push(m[1].trim());
  return out;
}

test('every renderer of a stat card emits it as "seg card"', () => {
  // The test below only means anything while this is the wrapper in use.
  for (const file of ['landing.js', 'period.js']) {
    const src = fs.readFileSync(path.join(ROOT, 'assets', file), 'utf8');
    for (const cls of INNER) {
      if (!src.includes('class="' + cls + '"')) continue;
      assert.ok(
        src.includes('class="seg card"'),
        `assets/${file} emits .${cls} but no "seg card" wrapper for it`
      );
    }
  }
});

test('stat-card rules are not scoped to a class only one page has', () => {
  const stranded = [];
  for (const cls of INNER) {
    const selectors = selectorsFor(cls);
    assert.ok(selectors.length, `.${cls} is emitted but app.css has no rule for it`);
    // A rule reaches every stat card if it is scoped on .card, or on nothing
    // above the class itself. `.season .row` reaches only the landing page.
    const reachable = selectors.filter((s) =>
      s.split(',').some((one) => {
        const t = one.trim();
        return t.startsWith('.card ') || t.startsWith('.card.') || t.startsWith('.' + cls);
      })
    );
    if (!reachable.length) stranded.push(`.${cls}: ` + selectors.join(' / '));
  }
  assert.deepEqual(
    stranded,
    [],
    'these rules cannot reach the tour and era pages, which emit the same markup outside .season'
  );
});
