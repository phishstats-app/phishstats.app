'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApiKey } = require('../lib/apikey');

test('loadApiKey prefers the PHISHNET_API_KEY environment variable', () => {
  const key = loadApiKey({ env: { PHISHNET_API_KEY: 'from-env' }, fileLoader: () => ({ apikey: 'from-file' }) });
  assert.equal(key, 'from-env');
});

test('loadApiKey falls back to scripts/apikey.js when the variable is unset', () => {
  const key = loadApiKey({ env: {}, fileLoader: () => ({ apikey: 'from-file' }) });
  assert.equal(key, 'from-file');
});

test('loadApiKey rejects the placeholder value and a missing file with one clear message', () => {
  assert.throws(
    () => loadApiKey({ env: {}, fileLoader: () => ({ apikey: 'YOUR_API_KEY_HERE' }) }),
    /PHISHNET_API_KEY|scripts\/apikey\.js/
  );
  assert.throws(
    () => loadApiKey({ env: {}, fileLoader: () => { throw Object.assign(new Error('nope'), { code: 'MODULE_NOT_FOUND' }); } }),
    /PHISHNET_API_KEY|scripts\/apikey\.js/
  );
});
