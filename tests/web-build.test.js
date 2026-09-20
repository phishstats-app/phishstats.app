'use strict';
// Which build is serving. The footer of every page and /api/version both say,
// so a phone showing something odd can be matched to a commit, and the two VMs
// behind the load balancer can be checked for drift with curl.
//
// The answer comes from git when the checkout is at hand (dev, the LAN
// instance), from the build.json the deploy script ships in the tarball when it is not
// (the VMs: .git is excluded from the tarball), and is "dev" otherwise.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { readBuild, formatBuild } = require('../lib/web/build');
const { loadPages } = require('../lib/web/pages');
const { createWebServer } = require('../web');
const { webFixtureHandle } = require('./helpers/fixtures');

const ROOT = path.join(__dirname, '..');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'phish-build-'));
}

// A checkout with at least one commit. A repository that was only just
// initialised has a .git and no HEAD, and readBuild falls back there.
function gitAvailable() {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
    if (!fs.existsSync(path.join(ROOT, '.git'))) return false;
    execFileSync('git', ['rev-parse', '--verify', 'HEAD'], { cwd: ROOT, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

test('a checkout answers from git, and says whether the tree is dirty', { skip: !gitAvailable() }, () => {
  const build = readBuild(ROOT);
  const head = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  assert.equal(build.source, 'git');
  assert.equal(build.commit, head);
  assert.equal(typeof build.dirty, 'boolean');
  assert.equal(build.deployedAt, null);
});

test('without a checkout, build.json from the deploy is the answer', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'build.json'), JSON.stringify({
    commit: 'abc1234', dirty: true, deployedAt: '2026-09-13T18:02:11Z', assets: 'deadbeef',
  }));
  const build = readBuild(dir);
  assert.equal(build.source, 'build.json');
  assert.equal(build.commit, 'abc1234');
  assert.equal(build.dirty, true);
  assert.equal(build.deployedAt, '2026-09-13T18:02:11Z');
  assert.equal(build.assets, 'deadbeef');
});

test('a build.json that cannot be read is not a startup failure', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'build.json'), '{not json');
  const build = readBuild(dir);
  assert.equal(build.source, 'none');
  assert.equal(build.commit, 'dev');
});

test('with neither, the build is "dev"', () => {
  const build = readBuild(tmpDir());
  assert.deepEqual(build, { commit: 'dev', dirty: false, deployedAt: null, assets: null, source: 'none' });
});

test('the footer line names the commit, marks a dirty tree, and dates a deploy', () => {
  assert.equal(formatBuild({ commit: 'abc1234', dirty: false, deployedAt: null }), 'build abc1234');
  assert.equal(formatBuild({ commit: 'abc1234', dirty: true, deployedAt: null }), 'build abc1234*');
  assert.equal(
    formatBuild({ commit: 'abc1234', dirty: true, deployedAt: '2026-09-13T18:02:11Z' }),
    'build abc1234* · deployed 2026-09-13 18:02 UTC'
  );
});

test('every page carries the build line after the compliance text', () => {
  const build = { commit: 'abc1234', dirty: true, deployedAt: '2026-09-13T18:02:11Z', assets: 'deadbeef', source: 'build.json' };
  const pages = loadPages(ROOT, build);
  for (const [name, html] of Object.entries(pages)) {
    const at = html.indexOf('build abc1234*');
    assert.ok(at > 0, `${name} is missing the build line`);
    assert.ok(at > html.indexOf('No cookies, no accounts, no analytics.'), `${name}: build line precedes the notice`);
  }
});

test('/api/version reports the same build, uncached', async () => {
  const db = webFixtureHandle();
  const build = { commit: 'abc1234', dirty: false, deployedAt: '2026-09-13T18:02:11Z', assets: 'deadbeef', source: 'build.json' };
  const server = createWebServer({ db, rootDir: ROOT, build });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const res = await fetch(base + '/api/version');
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await res.json(), build);
    const page = await (await fetch(base + '/song')).text();
    assert.ok(page.includes('build abc1234 · deployed 2026-09-13 18:02 UTC'));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  }
});
