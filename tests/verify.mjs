import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const coreURL = pathToFileURL(path.join(root, 'typing.mjs')).href;
const { normalizeText, settingsFrom, characterPlan, createSentencePauser, isGoogleDoc, keyEvents } = await import(coreURL);
let checks = 0;
function check(name, fn) { fn(); checks++; console.log(`PASS ${name}`); }
check('normalizes CRLF, tabs, and controls', () => assert.equal(normalizeText('a\r\nb\rc\t\u0000d'), 'a\nb\nc    d'));
check('rejects empty and oversized drafts', () => {
  assert.throws(() => normalizeText('  ')); assert.throws(() => normalizeText('a'.repeat(100001)));
});
check('validates numeric settings', () => {
  for (const wpm of [0, 151, NaN, Infinity]) assert.throws(() => settingsFrom({ wpm }));
  for (const typoRate of [-1, 11, NaN]) assert.throws(() => settingsFrom({ typoRate }));
});
check('restricts document URLs', () => {
  assert.ok(isGoogleDoc('https://docs.google.com/document/d/abc-123/edit'));
  assert.ok(isGoogleDoc('https://docs.google.com/document/u/0/d/abc/edit?tab=t.0'));
  for (const url of ['https://docs.google.com.evil.test/document/d/a/edit', 'http://docs.google.com/document/d/a/edit', 'https://docs.google.com/spreadsheets/d/a/edit', 'https://docs.google.com/document/d/a/preview', 'https://docs.google.com/document/d/a/editing']) assert.equal(isGoogleDoc(url), false);
});
check('corrected typo preserves uppercase', () => {
  const steps = characterPlan('A', settingsFrom({ typoRate: 10 }), () => 0);
  assert.deepEqual(steps.map(s => [s.kind, s.text]), [['text', 'S'], ['backspace', undefined], ['text', 'A']]);
});
check('zero typo setting inserts only intended character', () => assert.equal(characterPlan('a', settingsFrom({ typoRate: 0 }), () => 0).length, 1));
check('Unicode graphemes never get English typos', () => {
  for (const char of ['é', '👩‍💻', '中', 'e\u0301']) assert.equal(characterPlan(char, settingsFrom(), () => 0).length, 1);
});
check('a forced-typo stream reconstructs the source exactly', () => {
  const input = 'The QUICK brown fox!\nCafé 😊'; let output = '';
  for (const char of input) for (const step of characterPlan(char, settingsFrom({ typoRate: 10 }), () => 0)) {
    if (step.kind === 'backspace') output = output.slice(0, -1); else output += step.text;
  }
  assert.equal(output, input);
});
check('Enter, Backspace, and Unicode use correct input paths', () => {
  assert.equal(keyEvents('\n')[0].text, '\r');
  assert.equal(keyEvents('BACKSPACE')[0].windowsVirtualKeyCode, 8);
  assert.equal(keyEvents('a')[1].type, 'keyUp'); assert.equal(keyEvents('😊'), null);
});
check('sentence breaks count full stops only and repeat after two at the lower bound', () => {
  const pause = createSentencePauser(settingsFrom(), () => 0);
  for (const char of 'Hello!?\n…') assert.equal(pause(char), 0);
  assert.equal(pause('.'), 0);
  for (const char of ' Next!?\n') assert.equal(pause(char), 0);
  assert.equal(pause('.'), 3000);
  assert.equal(pause('.'), 0);
  assert.equal(pause('.'), 3000);
});
check('upper bound is four full stops and just under seven seconds', () => {
  const pause = createSentencePauser(settingsFrom(), () => 0.999999);
  for (let i = 0; i < 3; i++) assert.equal(pause('.'), 0);
  const duration = pause('.');
  assert.ok(duration > 6999 && duration < 7000);
});
check('sentence interval and duration are redrawn after each break', () => {
  const values = [0, 0.5, 0.5, 0.25, 0.999999];
  const pause = createSentencePauser(settingsFrom(), () => values.shift());
  assert.deepEqual(Array.from({ length: 2 }, () => pause('.')), [0, 5000]);
  assert.deepEqual(Array.from({ length: 3 }, () => pause('.')), [0, 0, 4000]);
});
check('disabling pauses prevents every sentence break', () => {
  const pause = createSentencePauser(settingsFrom({ pauses: false }), () => { throw new Error('Unexpected randomness'); });
  for (const char of 'One. Two. Three. Four. Five.') assert.equal(pause(char), 0);
});
check('each session starts with a fresh full-stop count', () => {
  const first = createSentencePauser(settingsFrom(), () => 0);
  first('.');
  const second = createSentencePauser(settingsFrom(), () => 0);
  assert.equal(second('.'), 0);
  assert.equal(first('.'), 3000);
});
const source = (await fs.readFile(path.join(root, 'background.js'), 'utf8')).replace('"./typing.mjs"', JSON.stringify(coreURL));
const originalSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (callback, milliseconds, ...args) => originalSetTimeout(callback, Math.min(milliseconds, 1), ...args);
let moduleId = 0;
async function harness(options = {}) {
  const listeners = {}, calls = [], saved = {}, breaks = [];
  globalThis.setTimeout = (callback, milliseconds, ...args) => {
    if (milliseconds >= 3000) breaks.push({ milliseconds, status: { ...saved.status }, inputs: calls.filter(c => c.method === 'Input.dispatchKeyEvent' && c.params.type === 'keyDown').map(c => c.params.text).join('') });
    return originalSetTimeout(callback, milliseconds >= 3000 && options.holdBreak ? 10000 : Math.min(milliseconds, 1), ...args);
  };
  const event = name => ({ addListener: fn => { listeners[name] = fn; } });
  globalThis.chrome = {
    storage: { session: { get: async key => Array.isArray(key) ? Object.fromEntries(key.filter(k => saved[k] !== undefined).map(k => [k, saved[k]])) : ({ [key]: saved[key] }), set: async object => Object.assign(saved, object) }, local: { get: async () => ({}), set: async object => { saved.local = object; }, remove: async () => { delete saved.local; } } },
    action: { setBadgeBackgroundColor: async () => {}, setBadgeText: async () => {} },
    runtime: { id: 'test-extension', onMessage: event('message'), getURL: name => `https://extension.test/${name}`, getManifest: () => ({ version: '1.2.0' }), reload: () => calls.push('reload') },
    alarms: { create: async () => {}, onAlarm: event('alarm') },
    tabs: { get: async () => ({ active: true, windowId: 1, url: options.url || 'https://docs.google.com/document/d/test/edit' }), onActivated: event('activated'), onUpdated: event('updated'), onRemoved: event('removed') },
    windows: { onFocusChanged: event('focus') }, commands: { onCommand: event('command') },
    debugger: {
      attach: async () => { calls.push('attach'); if (options.attachGate) await options.attachGate; },
      detach: async () => { calls.push('detach'); }, onDetach: event('detach'),
      sendCommand: async (_target, method, params) => {
        calls.push({ method, params });
        if (method === 'Runtime.evaluate') return { result: { value: options.focus !== false } };
      }
    }
  };
  await import(`data:text/javascript;base64,${Buffer.from(source + `\n// instance ${moduleId++}`).toString('base64')}`);
  const message = payload => new Promise(resolve => listeners.message(payload, { id: 'test-extension' }, resolve));
  return { calls, saved, listeners, breaks, message, start: text => message({ type: 'start', tabId: 7, text, settings: { wpm: 150, typoRate: 0, pauses: options.pauses ?? false } }) };
}
async function until(fn) {
  for (let index = 0; index < 500; index++) {
    if (fn()) return;
    await new Promise(resolve => originalSetTimeout(resolve, 2));
  }
  throw new Error('Timed out waiting for session');
}
async function integration(name, fn) { await fn(); checks++; console.log(`PASS ${name}`); }
await integration('normal session sends text, newline, Unicode and detaches', async () => {
  const h = await harness(); assert.equal((await h.start('a\n😊')).ok, true);
  await until(() => h.saved.status?.phase === 'done');
  assert.equal(h.saved.status.completed, 3);
  assert.equal(h.calls.filter(c => c === 'detach').length, 1);
  assert.ok(h.calls.some(c => c.method === 'Input.insertText' && c.params.text === '😊'));
});
await integration('focus loss sends no input and detaches', async () => {
  const h = await harness({ focus: false }); await h.start('abc');
  await until(() => h.saved.status?.phase === 'stopped');
  assert.equal(h.calls.some(c => c.method?.startsWith('Input.')), false);
  assert.ok(h.calls.includes('detach'));
});
await integration('non-Docs targets never attach', async () => {
  const h = await harness({ url: 'https://example.com' });
  assert.equal((await h.start('abc')).ok, false); assert.equal(h.calls.length, 0);
});
await integration('stop during countdown prevents all typing', async () => {
  const h = await harness(); await h.start('abc'); await h.message({ type: 'stop' });
  await until(() => h.saved.status?.phase === 'stopped');
  assert.equal(h.calls.some(c => c.method?.startsWith('Input.')), false);
});
await integration('concurrent start is rejected and abort during attachment detaches', async () => {
  let release; const attachGate = new Promise(resolve => { release = resolve; });
  const h = await harness({ attachGate }); const first = h.start('abc');
  await until(() => h.calls.includes('attach'));
  assert.equal((await h.start('def')).ok, false);
  await h.message({ type: 'stop' }); release(); assert.equal((await first).ok, false);
  assert.ok(h.calls.includes('detach'));
});
await integration('tab switch cancels session', async () => {
  const h = await harness(); await h.start('abc'); h.listeners.activated({ tabId: 8 });
  await until(() => h.saved.status?.phase === 'stopped');
  assert.match(h.saved.status.message, /tab changed/);
});
await integration('navigation cancels session', async () => {
  const h = await harness(); await h.start('abc'); h.listeners.updated(7, { status: 'loading' });
  await until(() => h.saved.status?.phase === 'stopped');
  assert.match(h.saved.status.message, /reloaded/);
});
await integration('sentence breaks occur after full stops and resume with exact text', async () => {
  const h = await harness({ pauses: true });
  const text = 'A. B. C. D. E. F. G. H. I.';
  await h.start(text);
  await until(() => h.saved.status?.phase === 'done');
  assert.ok(h.breaks.length >= 2);
  let previousCount = 0;
  for (const entry of h.breaks) {
    assert.ok(entry.milliseconds >= 3000 && entry.milliseconds <= 7000);
    assert.equal(entry.status.phase, 'running');
    assert.match(entry.status.message, /sentence break/);
    assert.ok(entry.inputs.endsWith('.'));
    assert.equal(entry.status.completed, entry.inputs.length);
    const count = entry.inputs.split('.').length - 1;
    assert.ok(count - previousCount >= 2 && count - previousCount <= 4);
    previousCount = count;
  }
  const typed = h.calls.filter(c => c.method === 'Input.dispatchKeyEvent' && c.params.type === 'keyDown').map(c => c.params.text).join('');
  assert.equal(typed, text);
});
await integration('disabled pauses never schedule a long break', async () => {
  const h = await harness(); await h.start('A. B. C. D. E.');
  await until(() => h.saved.status?.phase === 'done');
  assert.equal(h.breaks.length, 0);
});
await integration('final full stop does not delay completion with a sentence break', async () => {
  const originalRandom = Math.random;
  Math.random = () => 0;
  try {
    const h = await harness({ pauses: true }); await h.start('A. B.');
    await until(() => h.saved.status?.phase === 'done');
    assert.equal(h.breaks.length, 0);
  } finally { Math.random = originalRandom; }
});
await integration('stop shortcut cancels a sentence break without further input', async () => {
  const h = await harness({ pauses: true, holdBreak: true }); await h.start('A. B. C. D. E.');
  await until(() => h.breaks.length > 0);
  const inputCount = h.calls.filter(c => c.method?.startsWith('Input.')).length;
  h.listeners.command('stop-typing');
  await until(() => h.saved.status?.phase === 'stopped');
  assert.equal(h.calls.filter(c => c.method?.startsWith('Input.')).length, inputCount);
  assert.equal(h.calls.filter(c => c === 'detach').length, 1);
});
await integration('focus loss after a sentence break prevents further typing', async () => {
  const options = { pauses: true };
  const h = await harness(options); await h.start('A. B. C. D. E.');
  // Change focus synchronously when the break is published, before its timer runs.
  const save = chrome.storage.session.set;
  chrome.storage.session.set = async object => {
    await save(object);
    if (object.status?.message.includes('sentence break')) options.focus = false;
  };
  await until(() => h.saved.status?.phase === 'stopped');
  assert.ok(h.breaks.length > 0);
  const typed = h.calls.filter(c => c.method === 'Input.dispatchKeyEvent' && c.params.type === 'keyDown').map(c => c.params.text).join('');
  assert.equal(typed, h.breaks[0].inputs);
  assert.match(h.saved.status.message, /Focus must stay/);
});
const originalFetch = globalThis.fetch;
await integration('complete local update reloads an idle extension', async () => {
  const h = await harness();
  h.saved.draft = { text: 'Keep this draft', wpm: 45 };
  globalThis.fetch = async url => ({ ok: true, json: async () => url.endsWith('manifest.json') ? { version: '1.3.0' } : { ready: true, version: '1.3.0', commit: 'new' } });
  h.listeners.alarm({ name: 'check-installed-update' });
  await until(() => h.calls.includes('reload'));
  assert.deepEqual(h.saved.local.updateBackup.draft, h.saved.draft);
});
await integration('partial, missing, or unchanged updates never reload', async () => {
  for (const marker of [null, { ready: false, version: '1.3.0' }, { ready: true, version: '1.2.0' }]) {
    const h = await harness();
    globalThis.fetch = async () => ({ ok: marker !== null, json: async () => marker });
    h.listeners.alarm({ name: 'check-installed-update' });
    await new Promise(resolve => originalSetTimeout(resolve, 5));
    assert.equal(h.calls.includes('reload'), false);
  }
});
await integration('an update cannot reload during a typing session', async () => {
  const h = await harness({ pauses: true, holdBreak: true }); await h.start('A. B. C. D. E.');
  await until(() => h.breaks.length > 0);
  let fetched = false;
  globalThis.fetch = async () => { fetched = true; throw new Error('Should not fetch'); };
  h.listeners.alarm({ name: 'check-installed-update' });
  assert.equal(fetched, false);
  assert.equal(h.calls.includes('reload'), false);
  await h.message({ type: 'stop' });
  await until(() => h.saved.status?.phase === 'stopped');
});
await integration('a typing session started during the update check prevents reload', async () => {
  const h = await harness({ pauses: true, holdBreak: true });
  let release; const gate = new Promise(resolve => { release = resolve; });
  globalThis.fetch = async url => {
    await gate;
    return { ok: true, json: async () => url.endsWith('manifest.json') ? { version: '1.3.0' } : { ready: true, version: '1.3.0', commit: 'new' } };
  };
  h.listeners.alarm({ name: 'check-installed-update' });
  await h.start('A. B. C. D. E.');
  release();
  await until(() => h.breaks.length > 0);
  assert.equal(h.calls.includes('reload'), false);
  await h.message({ type: 'stop' });
  await until(() => h.saved.status?.phase === 'stopped');
});
await integration('a changed update marker or mismatched manifest prevents reload', async () => {
  for (const mismatch of ['commit', 'manifest']) {
    const h = await harness(); let reads = 0;
    globalThis.fetch = async url => ({ ok: true, json: async () => url.endsWith('manifest.json') ? { version: mismatch === 'manifest' ? '1.4.0' : '1.3.0' } : { ready: true, version: '1.3.0', commit: ++reads === 2 && mismatch === 'commit' ? 'other' : 'new' } });
    h.listeners.alarm({ name: 'check-installed-update' });
    await new Promise(resolve => originalSetTimeout(resolve, 5));
    assert.equal(h.calls.includes('reload'), false);
  }
});
globalThis.fetch = originalFetch;
globalThis.setTimeout = originalSetTimeout;
console.log(`${checks} checks passed.`);
