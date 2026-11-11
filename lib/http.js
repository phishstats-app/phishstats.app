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

// A fetch whose answer has a size limit. The jobs run on a server with 1 GB
// of memory, and res.text() and res.json() read whatever the other side
// sends: a wrong link, a redirect to a download, or a site answering with
// something enormous would be read whole. The limit is on the decoded bytes,
// counted as they arrive, so the read stops at the limit rather than after
// it; a Content-Length over the limit fails before anything is read. Like
// the timeout, it surfaces as an ordinary error for the caller to handle.
function withMaxBytes(fetchImpl, maxBytes) {
  return async (url, opts) => capResponse(await fetchImpl(url, opts), maxBytes, url);
}

function capResponse(res, maxBytes, url) {
  let host = String(url);
  try { host = new URL(url).host; } catch (e) { /* keep the raw url */ }
  const tooBig = () => new Error(`${host} sent more than ${Math.round(maxBytes / 1024 / 1024)} MB`);

  async function text() {
    const declared = res.headers && typeof res.headers.get === 'function' ? Number(res.headers.get('content-length')) : NaN;
    if (declared > maxBytes) {
      if (res.body && typeof res.body.cancel === 'function') await res.body.cancel().catch(() => {});
      throw tooBig();
    }
    // A stand-in response in the tests has no stream; check what it returns.
    if (!res.body || typeof res.body.getReader !== 'function') {
      const whole = await res.text();
      if (Buffer.byteLength(whole) > maxBytes) throw tooBig();
      return whole;
    }
    const reader = res.body.getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw tooBig();
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString('utf8');
  }

  // Everything else (ok, status, url, headers) is the response's own.
  return new Proxy(res, {
    get(target, prop) {
      if (prop === 'text') return text;
      if (prop === 'json') return async () => JSON.parse(await text());
      const value = target[prop];
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

module.exports = { withTimeout, withMaxBytes };
