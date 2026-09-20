'use strict';
const fs = require('node:fs');
const path = require('node:path');

const LOG_FILE_PATTERN = /^(refresh|live)-.*\.log$/;

// A scheduler runs the refresh with no console attached and captures no
// output, so the script keeps its own record: one file per run, named by the
// run's start time, in a directory the scheduler never needs to know
// about. `echo` mirrors every line to stdout/stderr for manual runs.
function createRunLog(logDir, { now = new Date(), echo = true, prefix = 'refresh' } = {}) {
  fs.mkdirSync(logDir, { recursive: true });
  const stamp = now.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/:/g, '-');
  const filePath = path.join(logDir, `${prefix}-${stamp}.log`);
  const fd = fs.openSync(filePath, 'a');

  function write(level, message) {
    const line = `${new Date().toISOString()} ${level.padEnd(5)} ${message}\n`;
    fs.writeSync(fd, line);
    if (echo) (level === 'ERROR' ? process.stderr : process.stdout).write(line);
  }

  return {
    path: filePath,
    info: (message) => write('INFO', message),
    error: (message) => write('ERROR', message),
    close: () => fs.closeSync(fd),
  };
}

// Deletes refresh logs whose last modification is older than maxAgeDays.
// Only files matching the refresh-*.log naming are candidates, so anything
// else placed in the directory is left alone. Returns the deleted paths.
function pruneOldLogs(logDir, { maxAgeDays, now = new Date() }) {
  if (!fs.existsSync(logDir)) return [];
  const cutoff = now.getTime() - maxAgeDays * 24 * 60 * 60 * 1000;
  const deleted = [];
  for (const name of fs.readdirSync(logDir)) {
    if (!LOG_FILE_PATTERN.test(name)) continue;
    const filePath = path.join(logDir, name);
    const { mtimeMs } = fs.statSync(filePath);
    if (mtimeMs < cutoff) {
      fs.unlinkSync(filePath);
      deleted.push(filePath);
    }
  }
  return deleted;
}

module.exports = { createRunLog, pruneOldLogs };
