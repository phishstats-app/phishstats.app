'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createClient } = require('../lib/phishnet-client');

test('getSongs calls the songs endpoint with the api key and returns unwrapped data', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    return {
      ok: true,
      json: async () => ({ error: false, error_message: '', data: [{ songid: 1, song: 'Test Song' }] }),
    };
  };
  const client = createClient({ apiKey: 'KEY123', fetchImpl });

  const songs = await client.getSongs();

  assert.equal(calls[0], 'https://api.phish.net/v5/songs.json?apikey=KEY123');
  assert.deepEqual(songs, [{ songid: 1, song: 'Test Song' }]);
});

test('getSetlistsByYear calls the showyear endpoint for the given year', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    return { ok: true, json: async () => ({ error: false, error_message: '', data: [] }) };
  };
  const client = createClient({ apiKey: 'KEY123', fetchImpl });

  await client.getSetlistsByYear(1994);

  assert.equal(calls[0], 'https://api.phish.net/v5/setlists/showyear/1994.json?apikey=KEY123');
});

test('getSetlistsByTour calls the tourid endpoint for the given tour', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    return { ok: true, json: async () => ({ error: false, error_message: '', data: [] }) };
  };
  const client = createClient({ apiKey: 'KEY123', fetchImpl });

  await client.getSetlistsByTour(217);

  assert.equal(calls[0], 'https://api.phish.net/v5/setlists/tourid/217.json?apikey=KEY123');
});

test('rejects when the API responds with an error payload', async () => {
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({ error: true, error_message: 'bad key', data: [] }),
  });
  const client = createClient({ apiKey: 'BAD', fetchImpl });

  await assert.rejects(() => client.getSongs(), /bad key/);
});

test('rejects when the HTTP response is not ok', async () => {
  const fetchImpl = async () => ({ ok: false, status: 500, json: async () => ({}) });
  const client = createClient({ apiKey: 'KEY123', fetchImpl });

  await assert.rejects(() => client.getSongs(), /500/);
});
