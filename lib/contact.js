'use strict';
// The takedown and correction address, kept out of plain text so that address
// harvesters reading the pages (or this public repository) do not find it.
// Encoded as base64 of the address reversed: trivial for a person, invisible
// to a scraper that looks for something@something. The pages carry the same
// value in a data-c attribute and assets/site.js turns it back into a
// mailto link in the browser; tests/site.test.js holds the templates to
// this value. To change the alias, change ENCODED here and in those
// templates, nowhere else.
const ENCODED = 'cmYubmlnb2xlbHBtaXNAMjU3aGNyZXAuc3RhdHNoc2locA==';

function decodeContact(encoded = ENCODED) {
  return Buffer.from(encoded, 'base64').toString('utf8').split('').reverse().join('');
}

module.exports = { ENCODED, decodeContact };
