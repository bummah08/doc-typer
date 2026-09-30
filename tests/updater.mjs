import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyRelease, safePath, versionNumber } from '../updater/update.mjs';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-updater-test-'));
let checks = 0;
try {
  for (const name of ['../escape', '/abs', 'C:/outside', '.git/config', 'x/../../outside', 'x\\file', 'x//y']) assert.throws(() => safePath(root, name));
  assert.equal(safePath(root, 'sub/file.js'), path.join(root, 'sub', 'file.js'));
  checks++;
  assert.ok(versionNumber('1.10.0') > versionNumber('1.9.9'));
  for (const value of ['1.a', '1.2.3.4.5', '65536']) assert.throws(() => versionNumber(value));
  checks++;
  const target = path.join(root, 'extension'); fs.mkdirSync(target);
  const manifest = version => Buffer.from(JSON.stringify({ name: 'Docs Paced Typing', manifest_version: 3, version, background: { service_worker: 'background.js' }, action: { default_popup: 'popup.html' } }));
  fs.writeFileSync(path.join(target, 'manifest.json'), manifest('1.1.0'));
  fs.writeFileSync(path.join(target, 'background.js'), 'old');
  fs.writeFileSync(path.join(target, 'popup.html'), 'old popup');
  const args = { target, backupRoot: path.join(root, 'backups'), stateFile: path.join(root, 'state.json'), commit: 'release1', files: { 'manifest.json': manifest('1.2.0'), 'background.js': Buffer.from('new'), 'popup.html': Buffer.from('new popup') } };
  assert.match(applyRelease(args), /Installed 1.2.0/);
  assert.equal(fs.readFileSync(path.join(target, 'background.js'), 'utf8'), 'new');
  const state = JSON.parse(fs.readFileSync(args.stateFile));
  assert.equal(fs.readFileSync(path.join(state.backup, 'background.js'), 'utf8'), 'old');
  assert.equal(JSON.parse(fs.readFileSync(path.join(target, 'installed-update.json'))).ready, true);
  checks++;
  assert.equal(applyRelease(args), 'Already current');
  assert.throws(() => applyRelease({ ...args, commit: 'same-version', files: { ...args.files, 'background.js': Buffer.from('changed without version bump') } }), /not newer/);
  assert.equal(applyRelease({ ...args, commit: 'docs-only' }), 'Already current');
  checks++;
  fs.writeFileSync(path.join(target, 'background.js'), 'manual edit');
  assert.throws(() => applyRelease({ ...args, commit: 'release2', files: { ...args.files, 'manifest.json': manifest('1.3.0') } }), /Local edit detected/);
  assert.equal(fs.readFileSync(path.join(target, 'background.js'), 'utf8'), 'manual edit');
  checks++;
  fs.writeFileSync(path.join(target, 'background.js'), 'new');
  const rename = fs.renameSync; let failed = false;
  fs.renameSync = (from, to) => {
    if (!failed && to === path.join(target, 'popup.html')) { failed = true; throw new Error('Simulated disk write failure'); }
    return rename(from, to);
  };
  try {
    assert.throws(() => applyRelease({ ...args, commit: 'release3', files: { ...args.files, 'manifest.json': manifest('1.3.0'), 'background.js': Buffer.from('next') } }), /Simulated disk/);
  } finally { fs.renameSync = rename; }
  assert.equal(fs.readFileSync(path.join(target, 'background.js'), 'utf8'), 'new');
  assert.equal(JSON.parse(fs.readFileSync(path.join(target, 'manifest.json'))).version, '1.2.0');
  assert.equal(JSON.parse(fs.readFileSync(path.join(target, 'installed-update.json'))).version, '1.2.0');
  assert.equal(JSON.parse(fs.readFileSync(args.stateFile)).commit, 'docs-only');
  checks++;
  console.log(`${checks} updater checks passed.`);
} finally {
  const resolved = path.resolve(root);
  if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('docs-updater-test-')) throw new Error('Unsafe test cleanup target');
  fs.rmSync(resolved, { recursive: true });
}
