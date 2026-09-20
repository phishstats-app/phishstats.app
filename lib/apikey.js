'use strict';

const PLACEHOLDER = 'YOUR_API_KEY_HERE';
const HELP = 'No Phish.net API key found. Set the PHISHNET_API_KEY environment variable, ' +
  'or copy scripts/apikey.example.js to scripts/apikey.js and fill in your key ' +
  '(request one at https://phish.net/api).';

// The key is only ever read server-side, by the scripts that sync data. It comes
// from the environment first so a scheduled task or shell can supply it
// without a file on disk, and falls back to the gitignored scripts/apikey.js
// for the original low-friction setup.
function loadApiKey({ env = process.env, fileLoader = () => require('../scripts/apikey') } = {}) {
  const fromEnv = (env.PHISHNET_API_KEY || '').trim();
  if (fromEnv) return fromEnv;

  let fromFile;
  try {
    fromFile = (fileLoader().apikey || '').trim();
  } catch (err) {
    if (err && err.code === 'MODULE_NOT_FOUND') throw new Error(HELP);
    throw err;
  }
  if (!fromFile || fromFile === PLACEHOLDER) throw new Error(HELP);
  return fromFile;
}

module.exports = { loadApiKey };
