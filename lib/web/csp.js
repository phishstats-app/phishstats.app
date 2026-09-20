'use strict';
// The Content-Security-Policy for each page, computed once at start.
//
// Every page has one inline <script> block, so the policy cannot be a fixed
// string at the edge: it names the SHA-256 of that block, which only the
// process that read the template knows. The hash is taken from the served
// bytes (after the LF normalisation and the footer splice in pages.js),
// because those are the bytes the browser hashes.
//
// What the policy says, and why each part is safe for these pages:
//   script-src   'self' plus the hashes. No 'unsafe-inline', no 'unsafe-eval':
//                the assets use neither, and there are no on*= attributes.
//   style-src    'self' 'unsafe-inline'. The pages set inline style= on bar
//                widths and margins, from JS and in the templates, and a hash
//                cannot cover an attribute. Styles are the low-value target;
//                the script hash is where the protection is.
//   connect-src  the outside services the browser calls itself: the Bluesky
//                feed and its Jetstream WebSocket for the live panel, and
//                open-meteo for the weather line.
//   img/font     'self' only - the icons and the fonts ship under /assets/.
//   The rest closes what the site does not do: no plugins, no <base>, no
//   framing by anyone, forms only to this origin.
//
// Caddy repeats nosniff, frame deny and the referrer policy at the edge; they
// are sent from here too so the LAN instance and a direct hit on the port get
// them, and so the tests can see them.

const crypto = require('node:crypto');

const CONNECT_HOSTS = [
  'https://public.api.bsky.app',
  // The live panel's WebSocket (song.html, jetstream()). Bluesky runs several
  // Jetstream instances (jetstream1/2, us-east/us-west) and the page may be
  // pointed at another one; the wildcard covers them without a redeploy.
  'wss://*.bsky.network',
  'https://api.open-meteo.com',
  'https://geocoding-api.open-meteo.com',
];

// Bare <script> blocks only. A <script src=...> is covered by 'self', and a
// hash of its (empty) body would be wrong anyway.
const INLINE_SCRIPT = /<script>([\s\S]*?)<\/script>/g;

function inlineScriptHashes(html) {
  return [...html.matchAll(INLINE_SCRIPT)].map(
    (m) => "'sha256-" + crypto.createHash('sha256').update(m[1], 'utf8').digest('base64') + "'"
  );
}

function pageCsp(html) {
  return [
    "default-src 'self'",
    ['script-src', "'self'", ...inlineScriptHashes(html)].join(' '),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self'",
    "font-src 'self'",
    ['connect-src', "'self'", ...CONNECT_HOSTS].join(' '),
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ].join('; ');
}

// On every response, whatever it is.
const COMMON_HEADERS = Object.freeze({ 'X-Content-Type-Options': 'nosniff' });

// On documents only.
function pageHeaders(html) {
  return {
    'Content-Security-Policy': pageCsp(html),
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  };
}

module.exports = { pageCsp, pageHeaders, inlineScriptHashes, COMMON_HEADERS, CONNECT_HOSTS };
