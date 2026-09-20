'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { venueTimeZone, formatLocalTime } = require('../lib/timezone');

test('venueTimeZone maps US states, split-state cities, Canada, and abroad', () => {
  assert.equal(venueTimeZone({ state: 'CO' }), 'America/Denver');
  assert.equal(venueTimeZone({ state: 'NY' }), 'America/New_York');
  assert.equal(venueTimeZone({ state: 'NV', city: 'Las Vegas' }), 'America/Los_Angeles');
  assert.equal(venueTimeZone({ state: 'TN', city: 'Nashville' }), 'America/Chicago');
  assert.equal(venueTimeZone({ state: 'TN', city: 'Knoxville' }), 'America/New_York');
  assert.equal(venueTimeZone({ state: 'AZ' }), 'America/Phoenix');
  assert.equal(venueTimeZone({ state: 'HI' }), 'Pacific/Honolulu');
  assert.equal(venueTimeZone({ state: 'ON', country: 'Canada' }), 'America/Toronto');
  assert.equal(venueTimeZone({ state: 'BC' }), 'America/Vancouver');
  assert.equal(venueTimeZone({ country: 'Mexico', city: 'Cancún' }), 'America/Cancun');
  assert.equal(venueTimeZone({ country: 'Japan' }), 'Asia/Tokyo');
  assert.equal(venueTimeZone({ country: 'United Kingdom' }), 'Europe/London');
  assert.equal(venueTimeZone({}), null);
});

test('formatLocalTime renders a UTC instant on the venue clock with a zone label', () => {
  // 9/5/26 03:39:00Z is 9:39 PM the previous evening in Denver (MDT).
  assert.equal(formatLocalTime('2026-09-05T03:39:00.000Z', 'America/Denver'), '9:39 PM MDT');
  assert.equal(formatLocalTime('2026-09-05T03:39:00.000Z', 'America/New_York'), '11:39 PM EDT');
  assert.equal(formatLocalTime('2026-09-05T03:39:00.000Z', null), null);
});
