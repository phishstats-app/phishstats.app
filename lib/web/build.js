'use strict';
// Which build is serving, for the footer of every page and /api/version.
//
// The point is troubleshooting: a phone that shows something odd can be
// matched to a commit, and the two VMs behind the load balancer can be checked
// for drift with two curls. The commit alone is not enough for that, because
// this repo deploys from the working tree (see the deploy script's note on the ?v=
// stamp): an uncommitted edit ships under the last commit's hash. So a dirty
// tree is recorded too, and shown as a trailing "*".
//
// Three sources, in order:
//   1. git, when the checkout is at hand (dev, the LAN instance). Asked once at
//      start; always the live truth there.
//   2. build.json beside web.js, written by the deploy script into the tarball. The
//      tarball excludes .git, so on the VMs this is the only record. It is
//      generated outside the working tree so the LAN instance can never pick
//      up a stale one from a previous deploy.
//   3. "dev", so a checkout without git installed still starts.

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const NONE = Object.freeze({ commit: 'dev', dirty: false, deployedAt: null, assets: null, source: 'none' });

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).trim();
}

function fromGit(rootDir) {
  if (!fs.existsSync(path.join(rootDir, '.git'))) return null;
  try {
    const commit = git(['rev-parse', '--short', 'HEAD'], rootDir);
    // Untracked files are not "changes that shipped under this hash"; edits
    // to tracked files are.
    const dirty = git(['status', '--porcelain', '--untracked-files=no'], rootDir) !== '';
    return { commit, dirty, deployedAt: null, assets: null, source: 'git' };
  } catch {
    return null;
  }
}

function fromBuildJson(rootDir) {
  const file = path.join(rootDir, 'build.json');
  if (!fs.existsSync(file)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (typeof raw.commit !== 'string' || raw.commit === '') return null;
    return {
      commit: raw.commit,
      dirty: raw.dirty === true,
      deployedAt: typeof raw.deployedAt === 'string' ? raw.deployedAt : null,
      assets: typeof raw.assets === 'string' ? raw.assets : null,
      source: 'build.json',
    };
  } catch {
    return null;
  }
}

function readBuild(rootDir) {
  return fromGit(rootDir) || fromBuildJson(rootDir) || { ...NONE };
}

// "build e14b8b0* · deployed 2026-09-13 18:02 UTC". Minute precision is enough
// to tell two deploys apart, and UTC because the readers are on three clocks.
function formatBuild({ commit, dirty, deployedAt }) {
  let line = `build ${commit}${dirty ? '*' : ''}`;
  if (deployedAt) {
    const at = new Date(deployedAt);
    if (!Number.isNaN(at.getTime())) {
      line += ` · deployed ${at.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
    }
  }
  return line;
}

module.exports = { readBuild, formatBuild };
