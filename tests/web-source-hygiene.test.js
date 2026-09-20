'use strict';
// A literal control byte in source is invisible in review and in most diffs.
// While building lib/web/params.js two crept in: one inside a regex character
// class (where it happened to be correct) and one inside a test string, where
// it silently inverted an assertion — the test passed for the wrong reason.
// This catches the next one.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const DIRS = ['lib', 'db', 'scripts', 'tests', 'assets'];
const EXTENSIONS = new Set(['.js', '.json']);

function sourceFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'fonts') continue;
      sourceFiles(full, out);
    } else if (EXTENSIONS.has(path.extname(entry.name))) {
      out.push(full);
    }
  }
  return out;
}

test('no source file contains a literal control character', () => {
  const offenders = [];
  for (const dir of DIRS) {
    const full = path.join(ROOT, dir);
    if (!fs.existsSync(full)) continue;
    for (const file of sourceFiles(full)) {
      const text = fs.readFileSync(file, 'utf8');
      text.split(/\r?\n/).forEach((line, i) => {
        for (let j = 0; j < line.length; j++) {
          const code = line.charCodeAt(j);
          // Tab is ordinary whitespace; CR and LF are already split off.
          if ((code < 0x20 && code !== 0x09) || code === 0x7f) {
            offenders.push(
              `${path.relative(ROOT, file)}:${i + 1}:${j + 1} U+${code.toString(16).padStart(4, '0')}`
            );
          }
        }
      });
    }
  }
  assert.deepEqual(offenders, [], 'write these as escapes (\\x00) or char codes instead');
});
