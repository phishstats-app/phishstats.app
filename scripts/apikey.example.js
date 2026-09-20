'use strict';
// Copy this file to scripts/apikey.js and paste your own key from
// https://phish.net/api. The PHISHNET_API_KEY environment variable, when set,
// takes precedence over the file.
var apikey = 'YOUR_API_KEY_HERE';
if (typeof module !== 'undefined') module.exports = { apikey };
