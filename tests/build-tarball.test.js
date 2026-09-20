'use strict';
// scripts/build-tarball.sh is what CI ships. It must stamp the asset
// references the way the old deploy did, write build.json, and pack exactly
// the committed tree minus what the VMs never need.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'build-tarball.sh');

// Git Bash on Windows, bash anywhere else. WSL's bash.exe is not the shell
// this script is written for.
function bashPath() {
  if (process.platform !== 'win32') return 'bash';
  const gitBash = 'C:\\Program Files\\Git\\bin\\bash.exe';
  return fs.existsSync(gitBash) ? gitBash : null;
}
const BASH = bashPath();

// tar for the test's own listing and extraction. On Windows "tar" on PATH may
// be the system bsdtar or Git's GNU tar depending on the shell that started
// node, and the two disagree about "C:" in a path; running it inside Git Bash
// with converted paths behaves the same everywhere.
function tar(args) {
  if (process.platform !== 'win32') return execFileSync('tar', args, { encoding: 'utf8' });
  const words = args.map((a) => (a.startsWith('-') ? a : `"$(cygpath -u '${a}')"`)).join(' ');
  return execFileSync(BASH, ['-c', `tar ${words}`], { encoding: 'utf8' });
}

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

// A tiny committed repo shaped like the real one.
function fixtureRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phish-build-'));
  const w = (rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
  w('web.js', "'use strict';\n");
  w('package.json', '{"name":"x"}\n');
  w('assets/app.css', 'body{}\n');
  w('assets/app.js', 'x\n');
  w('assets/icon.svg', '<svg/>\n');
  w('templates/pages/song.html', '<link rel="stylesheet" href="/assets/app.css">\n<script src="/assets/app.js?v=old"></script>\n<img src="/assets/icon.svg">\n');
  w('.github/workflows/ci.yml', 'name: x\n');
  w('deploy/allowed_signers', 'x\n');
  w('tests/a.test.js', '\n');
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'add', '-A');
  git(dir, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-m', 'fixture');
  return dir;
}

// The stamp the previous deploy tool computed: SHA-256 of the concatenated
// UPPERCASE SHA-256 hex digests of assets/*.css and *.js in name order,
// first 8 hex, lowercase.
function expectedStamp(dir) {
  const files = fs.readdirSync(path.join(dir, 'assets')).filter((f) => /\.(css|js)$/.test(f)).sort();
  const joined = files.map((f) => crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, 'assets', f))).digest('hex').toUpperCase()).join('');
  return crypto.createHash('sha256').update(joined, 'utf8').digest('hex').slice(0, 8);
}

function build(dir) {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'phish-build-out-'));
  const stdout = execFileSync(BASH, [SCRIPT, dir, out], { encoding: 'utf8' });
  const lines = Object.fromEntries(stdout.trim().split('\n').map((l) => l.split('=')));
  const list = tar(['-tzf', path.join(out, 'app.tgz')]).trim().split('\n').map((l) => l.replace(/^\.\//, '')).filter((l) => l && l !== '.');
  return { out, lines, list };
}

test('the stamp matches the previous deploy tool and lands in every template reference', { skip: !BASH }, () => {
  const dir = fixtureRepo();
  const { out, lines } = build(dir);
  assert.equal(lines.assets, expectedStamp(dir));
  assert.equal(lines.commit, git(dir, 'rev-parse', '--short', 'HEAD'));
  const extracted = fs.mkdtempSync(path.join(os.tmpdir(), 'phish-build-x-'));
  tar(['-xzf', path.join(out, 'app.tgz'), '-C', extracted]);
  const html = fs.readFileSync(path.join(extracted, 'templates', 'pages', 'song.html'), 'utf8');
  assert.match(html, new RegExp(`/assets/app\\.css\\?v=${lines.assets}"`));
  assert.match(html, new RegExp(`/assets/app\\.js\\?v=${lines.assets}"`), 'an old stamp is replaced');
  assert.match(html, /\/assets\/icon\.svg"/, 'only css and js are stamped');
  const meta = JSON.parse(fs.readFileSync(path.join(extracted, 'build.json'), 'utf8'));
  assert.deepEqual(Object.keys(meta).sort(), ['assets', 'commit', 'deployedAt', 'dirty']);
  assert.equal(meta.commit, lines.commit);
  assert.equal(meta.assets, lines.assets);
  assert.equal(meta.dirty, false);
  assert.ok(!Number.isNaN(Date.parse(meta.deployedAt)));
});

test('the tarball holds the committed tree plus build.json and nothing the VMs never need', { skip: !BASH }, () => {
  const dir = fixtureRepo();
  const { list } = build(dir);
  const set = new Set(list.map((l) => l.replace(/\/$/, '')));
  for (const must of ['build.json', 'web.js', 'package.json', 'assets/app.css', 'templates/pages/song.html', 'tests/a.test.js']) {
    assert.ok(set.has(must), `${must} missing`);
  }
  for (const never of ['.git', '.github', '.github/workflows/ci.yml', 'deploy', 'deploy/allowed_signers']) {
    assert.ok(!set.has(never), `${never} must not ship`);
  }
});

test('an uncommitted edit does not ship: the tarball is the commit, not the working tree', { skip: !BASH }, () => {
  const dir = fixtureRepo();
  fs.writeFileSync(path.join(dir, 'web.js'), "'use strict'; // edited but not committed\n");
  const { out } = build(dir);
  const extracted = fs.mkdtempSync(path.join(os.tmpdir(), 'phish-build-y-'));
  tar(['-xzf', path.join(out, 'app.tgz'), '-C', extracted]);
  assert.equal(fs.readFileSync(path.join(extracted, 'web.js'), 'utf8'), "'use strict';\n");
});
