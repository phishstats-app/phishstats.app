# phishstats

The code behind [phishstats.app](https://phishstats.app): Phish song statistics for people who want to know, in the middle of a show, how long it has been since a song was last played and what that means.

It is a zero-dependency Node program. A few scripts mirror setlist data from the [Phish.net API v5](https://docs.phish.net/) into a local SQLite file, and `web.js` serves the pages and a fixed set of JSON endpoints over that file. Nothing here accepts SQL from a browser: every endpoint is one prepared statement with validated parameters.

An unofficial, non-commercial fan project, not affiliated with or endorsed by Phish. It voluntarily complies with the [Phish fan web site policy](https://www.phish.com/faq/web-guidelines). No Phish music, audio, video, lyrics or photographs are stored or served.

## Data sources and attribution

| Data | Source | Terms |
|---|---|---|
| Setlists, shows, songs, gaps | [Phish.net](https://phish.net), a project of [The Mockingbird Foundation](https://mbird.org), via the API v5 | [Phish.net API terms of use](https://docs.phish.net/terms-of-use): non-commercial, attributed use. Every page links back to Phish.net. The setlist database is not offered for download. |
| Recorded song lengths | [phish.in](https://phish.in), via its public API | Community-run archive of audience recordings; no key needed. |
| Official song lengths | [LivePhish](https://www.livephish.com) release pages, read once per show | Running times only, always linked back to the release. |
| Live setlists during a show | The public [Bluesky](https://bsky.app/profile/phish.com) posts of @phish.com | Song names and posting times only; post text is not reproduced. |

Rights holders: takedown and correction requests to phishstats.perch752@simplelogin.fr. The full compliance statement is on the site's `/about` page and in `templates/pages/about.html`.

## What is here

| Path | What it does |
|---|---|
| `web.js` | The web server: the song lookup at `/song`, the show, venue, city, era, year, tour and about pages, `/assets/*`, and the `/api/*` endpoints the pages read. Read-only. |
| `lib/web/` | The server's parts: the statement registry, parameter validation, the read-only database handle with a result cache, page rendering, static files, the CSP and other headers, a warm-up after start. |
| `lib/` | The data pipeline: the Phish.net client, sync and backfill, phish.in, LivePhish and Bluesky ingest, time zones, run logging. |
| `db/` | The SQLite schema and the queries the scripts share. |
| `scripts/` | `backfill.js` (every year, once), `refresh.js` (daily: song catalog plus the current year), `ingest-live.js` (hourly: Bluesky and LivePhish), `seed.js`, `sync-age.js` (for a replica deciding whether the primary already ran), `make-icons.py` (the site icon). |
| `templates/`, `assets/` | The pages and their CSS, JavaScript, fonts and icons. |
| `tests/` | `node --test` suite: schema, sync, the API client, the ingest parsers, and the whole web server. |

## Running it

Requirements: Node 22.5 or newer (for `node:sqlite`). No `npm install`; there are no dependencies.

1. Get a Phish.net API key at <https://phish.net/api>. Either set `PHISHNET_API_KEY` in the environment, or copy `scripts/apikey.example.js` to `scripts/apikey.js` and paste the key in. The key is only ever read by the sync scripts; nothing served to a browser contains it.
2. Load the history, one API call per year:

   ```
   node scripts/backfill.js
   ```

   This writes `data/phish.db`.
3. Start the server:

   ```
   node web.js
   ```

   and open <http://127.0.0.1:8001/song>.
4. Keep the data current: run `node scripts/refresh.js` once a day and `node scripts/ingest-live.js` once an hour, from any scheduler. Each writes a log under `logs/` and exits non-zero on failure.

Environment variables the server and scripts read:

| Variable | Default | Meaning |
|---|---|---|
| `HOST` | `127.0.0.1` | Interface `web.js` binds. Set `0.0.0.0` only when a reverse proxy on another machine must reach it. |
| `PORT` | `8001` | Port `web.js` listens on. |
| `PHISH_DB_PATH` | `data/phish.db` | The SQLite file. `web.js` opens it read-only and reopens it on `SIGHUP`, so the file can be swapped underneath a running server. |
| `PHISH_CACHE_MS` | `60000` | How long a statement's rows are kept before it is run again. |
| `PHISH_LOG_DIR` | `logs` | Where the scripts write their per-run logs. |
| `PHISH_LOG_RETENTION_DAYS` | `1095` | Logs older than this are deleted at the end of a run. |
| `PHISHNET_API_KEY` | (none) | The Phish.net key, if not in `scripts/apikey.js`. |

The server sends a per-page `Content-Security-Policy` whose script source is `'self'` plus the hash of the page's one inline script, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, and strong `ETag`s on every asset. A reverse proxy in front of it should terminate TLS and may repeat the cache and security headers; the CSP hash is the application's to set.

## Tests

```
npm test
```

Two tests that physically replace the database file skip on Windows (SQLite's Windows VFS opens without `FILE_SHARE_DELETE`) and run on Linux.

## Deploying

Every push and pull request runs the suite in GitHub Actions. A push to `main` also builds the deployable tarball with `scripts/build-tarball.sh` (the committed tree, asset references stamped with a hash of the assets, a `build.json` at the root), signs it with an OpenSSH key, attests its build provenance, and publishes it as a GitHub Release (`deploy-<run>`, the newest thirty are kept). The site's servers poll the latest release every two minutes; each verifies the signature against `deploy/allowed_signers`, swaps the application directory, restarts, and rolls back on its own if the new build does not answer within 30 seconds. `/api/version` on the site shows the commit that is serving. Anyone can check a release's provenance with `gh attestation verify app.tgz --owner phishstats-app`.

To run your own copy, `bash scripts/build-tarball.sh <clone> <out>` produces the same `app.tgz`; unpack it wherever you like and start `web.js` there.

## History

The project started from Phish.net's API example repository and grew into its own thing; nothing of the original code remains. The code is under the MIT license (`LICENSE`). The data is not: it stays under its sources' terms, listed above. The bundled fonts (Fraunces, IBM Plex Mono, Work Sans) are under the SIL Open Font License; `assets/fonts/OFL.txt` has the notice and the license.
