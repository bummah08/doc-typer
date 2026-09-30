import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const repository = 'https://github.com/bummah08/docs-paced-typing.git';
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
export function safePath(root, name) {
  if (typeof name !== 'string' || !/^[a-zA-Z0-9_-][a-zA-Z0-9_./-]*$/.test(name) || name.split('/').some(part => !part || part === '..' || part === '.')) throw new Error(`Unsafe release path: ${name}`);
  const target = path.resolve(root, name);
  if (!target.startsWith(path.resolve(root) + path.sep)) throw new Error('Release path escaped target');
  // Do not follow junctions or symlinks in an installation path.
  for (let current = target; ; current = path.dirname(current)) {
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error(`Symlink/junction not supported: ${current}`);
    if (current === path.dirname(current)) break;
  }
  return target;
}
export function versionNumber(version) {
  if (typeof version !== 'string' || !/^\d+(\.\d+){0,3}$/.test(version)) throw new Error('Invalid manifest version');
  const parts = version.split('.').map(Number);
  if (parts.some(n => n > 65535)) throw new Error('Invalid manifest version component');
  return [...parts, ...Array(4 - parts.length).fill(0)].reduce((v, n) => v * 65536n + BigInt(n), 0n);
}
function writeAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.update-${process.pid}`;
  fs.writeFileSync(temp, data);
  fs.renameSync(temp, file);
}
function jsonWrite(file, data) { writeAtomic(file, JSON.stringify(data, null, 2) + '\n'); }

export function applyRelease({ target, backupRoot, stateFile, commit, files }) {
  const manifest = JSON.parse(files['manifest.json']);
  const installed = JSON.parse(fs.readFileSync(safePath(target, 'manifest.json'), 'utf8'));
  if (installed.name !== 'Docs Paced Typing' || manifest.name !== installed.name || manifest.manifest_version !== 3) throw new Error('This is not the expected extension');
  const existingState = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : null;
  if (existingState?.commit === commit) return 'Already current';
  const names = Object.keys(files);
  if (!names.includes(manifest.background?.service_worker) || !names.includes(manifest.action?.default_popup)) throw new Error('Missing required runtime files');
  for (const name of names) safePath(target, name);
  const comparison = versionNumber(manifest.version) - versionNumber(installed.version);
  if (comparison === 0n && names.every(name => fs.existsSync(safePath(target, name)) && hash(fs.readFileSync(safePath(target, name))) === hash(files[name]))) {
    jsonWrite(stateFile, { ...existingState, commit, version: manifest.version, hashes: Object.fromEntries(names.map(name => [name, hash(files[name])])) });
    return 'Already current';
  }
  if (comparison <= 0n) throw new Error(`Release ${manifest.version} is not newer than installed ${installed.version}; bump manifest.json before publishing runtime changes`);
  for (const [name, expected] of Object.entries(existingState?.hashes ?? {})) {
    const location = safePath(target, name);
    if (!fs.existsSync(location) || hash(fs.readFileSync(location)) !== expected) throw new Error(`Local edit detected: ${name}; update skipped to preserve it`);
  }
  const backup = path.join(backupRoot, `${Date.now()}-${installed.version}`);
  fs.mkdirSync(backup, { recursive: true });
  const marker = safePath(target, 'installed-update.json');
  const oldMarker = fs.existsSync(marker) ? fs.readFileSync(marker) : null;
  for (const name of names) {
    const location = safePath(target, name);
    if (fs.existsSync(location)) {
      const saved = safePath(backup, name);
      fs.mkdirSync(path.dirname(saved), { recursive: true });
      fs.copyFileSync(location, saved);
    }
  }
  jsonWrite(marker, { ready: false, commit, version: manifest.version });
  try {
    // Manifest and ready marker come last, after all assets are on disk.
    for (const name of [...names.filter(n => n !== 'manifest.json'), 'manifest.json']) writeAtomic(safePath(target, name), files[name]);
    jsonWrite(stateFile, { commit, version: manifest.version, backup, hashes: Object.fromEntries(names.map(name => [name, hash(files[name])])) });
    jsonWrite(marker, { ready: true, commit, version: manifest.version });
  } catch (error) {
    for (const name of names) {
      const saved = safePath(backup, name);
      if (fs.existsSync(saved)) writeAtomic(safePath(target, name), fs.readFileSync(saved));
    }
    if (oldMarker) writeAtomic(marker, oldMarker);
    else jsonWrite(marker, { ready: false, commit, version: installed.version });
    // Without a prior marker, leave ready=false so the browser cannot reload a partial update.
    if (existingState) jsonWrite(stateFile, existingState);
    else if (fs.existsSync(stateFile)) fs.unlinkSync(stateFile);
    throw error;
  }
  return `Installed ${manifest.version} (${commit.slice(0, 7)}). Backup: ${backup}`;
}

export function run(configPath) {
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const base = path.dirname(path.resolve(configPath));
  const log = path.join(base, 'update.log');
  const lockPath = path.join(base, 'update.lock');
  // Windows Task Scheduler also prevents overlap. Recover a stale lock after a crash.
  if (fs.existsSync(lockPath) && Date.now() - fs.statSync(lockPath).mtimeMs > 15 * 60 * 1000) fs.unlinkSync(lockPath);
  let lock;
  try { lock = fs.openSync(lockPath, 'wx'); } catch { return; }
  const cache = path.join(base, 'repository.git');
  const hooks = path.join(base, 'no-hooks');
  fs.mkdirSync(hooks, { recursive: true });
  const git = args => {
    const result = spawnSync(config.git, ['-c', `core.hooksPath=${hooks}`, ...args], {
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never' },
      windowsHide: true, timeout: 120000, maxBuffer: 25 * 1024 * 1024
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Git failed: ${result.stderr?.toString().trim()}`);
    return result.stdout;
  };
  try {
    if (!fs.existsSync(cache)) git(['init', '--bare', cache]);
    git(['--git-dir', cache, 'fetch', '--depth=1', repository, '+refs/heads/main:refs/heads/release']);
    const commit = git(['--git-dir', cache, 'rev-parse', 'refs/heads/release']).toString().trim();
    const stateFile = path.join(base, 'installed.json');
    if (fs.existsSync(stateFile) && JSON.parse(fs.readFileSync(stateFile)).commit === commit) return;
    const read = name => git(['--git-dir', cache, 'show', `${commit}:${name}`]);
    const list = JSON.parse(read('release-files.json'));
    if (!Array.isArray(list) || !list.length || list.length > 200 || new Set(list.map(n => String(n).toLowerCase())).size !== list.length) throw new Error('Invalid release-files.json');
    const files = Object.create(null);
    for (const name of list) {
      safePath(config.target, name);
      if (name === 'installed-update.json' || name.startsWith('updater/')) throw new Error('Release cannot replace updater state or helper');
      const tree = git(['--git-dir', cache, 'ls-tree', commit, '--', name]).toString();
      if (!/^100644 blob /.test(tree) && !/^100755 blob /.test(tree)) throw new Error(`Not a regular source file: ${name}`);
      files[name] = read(name);
      if (/\.(mjs|js)$/.test(name)) {
        const syntax = spawnSync(process.execPath, ['--input-type=module', '--check'], { input: files[name], windowsHide: true, timeout: 15000 });
        if (syntax.error || syntax.status !== 0) throw new Error(`Invalid JavaScript in ${name}; installation skipped`);
      }
    }
    const result = applyRelease({ target: config.target, backupRoot: path.join(base, 'backups'), stateFile, commit, files });
    fs.appendFileSync(log, `${new Date().toISOString()} ${result}\n`);
    console.log(result);
  } catch (error) {
    fs.appendFileSync(log, `${new Date().toISOString()} ERROR ${error.message}\n`);
    throw error;
  } finally {
    fs.closeSync(lock);
    fs.unlinkSync(lockPath);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { run(process.argv[2]); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
