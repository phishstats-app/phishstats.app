'use strict';
// The three eras, asserted rather than derived.
//
// The boundaries do fall out of the data - the years with no shows are 2001
// and 2005-2008, exactly the hiatuses - but deriving them at runtime means one
// year off would silently renumber the eras and break every /era/ URL, and
// naming a new era is a human judgment anyway. tests/web-eras.test.js asserts
// every show falls inside exactly one of these, so a new year cannot slip out
// of the scheme unnoticed. When a real 4.0 arrives, add a row and name it.
//
// "1.0 / 2.0 / 3.0" are fan convention, not Phish.net data: this is the site's
// own framing of date ranges, not a relabelling of anyone's records.

const ERAS = [
  { name: '1.0', from: '1983-01-01', to: '2000-12-31', label: 'Phish 1.0' },
  { name: '2.0', from: '2002-01-01', to: '2004-12-31', label: 'Phish 2.0' },
  { name: '3.0', from: '2009-01-01', to: '9999-12-31', label: 'Phish 3.0' },
];

const eraByName = (name) => ERAS.find((e) => e.name === name);
const eraForDate = (date) => ERAS.find((e) => date >= e.from && date <= e.to);

module.exports = { ERAS, eraByName, eraForDate };
