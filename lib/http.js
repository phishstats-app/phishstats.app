'use strict';
// A fetch that gives up. The jobs' outside calls (phish.net, Bluesky,
// LivePhish, phish.in) had no limit but Node's own, five minutes for headers
// per try, and the jobs hold a lock on the database while they run, so that
// no sync swaps the file mid-job; a site that stopped answering held every
// sync behind it: phish.in on
// 2026-10-04 06:26 UTC kept the refresh in its first request for two minutes.
// The abort surfaces as an ordinary fetch error, so each caller's existing
// handling (phish.in's retries, the logged-and-continue syncs) applies.
function withTimeout(fetchImpl, ms) {
  return (url, opts = {}) => {
    const signal = AbortSignal.timeout(ms);
    return fetchImpl(url, { ...opts, signal }).catch((err) => {
      if (signal.aborted) {
        let host = String(url);
        try { host = new URL(url).host; } catch (e) { /* keep the raw url */ }
        throw new Error(`${host} did not answer within ${ms / 1000} s`);
      }
      throw err;
    });
  };
}

module.exports = { withTimeout };
