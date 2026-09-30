import { normalizeText, settingsFrom, characterPlan, createSentencePauser, isGoogleDoc, keyEvents } from "./typing.mjs";

let active = null;
let last = { phase: "idle", completed: 0, total: 0, message: "Ready" };
const ready = (async () => {
  const { updateBackup } = await chrome.storage.local.get("updateBackup");
  if (updateBackup) {
    await chrome.storage.session.set(updateBackup);
    await chrome.storage.local.remove("updateBackup");
  }
  const { status } = await chrome.storage.session.get("status");
  if (status) last = ["running", "countdown", "starting"].includes(status.phase)
    ? { ...status, phase: "stopped", message: "Session ended. Check the document before starting again." } : status;
})();

// The local updater writes this marker only after a complete installation.
// Never fetch or execute remote JavaScript inside the extension.
const updateAlarm = "check-installed-update";
async function reloadInstalledUpdate() {
  await ready;
  if (active) return;
  try {
    const response = await fetch(chrome.runtime.getURL("installed-update.json"), { cache: "no-store" });
    if (!response.ok) return;
    const update = await response.json();
    if (update.ready !== true || typeof update.version !== "string" || update.version === chrome.runtime.getManifest().version) return;
    const manifestResponse = await fetch(chrome.runtime.getURL("manifest.json"), { cache: "no-store" });
    if (!manifestResponse.ok) return;
    const manifest = await manifestResponse.json();
    const confirmation = await fetch(chrome.runtime.getURL("installed-update.json"), { cache: "no-store" });
    if (!confirmation.ok) return;
    const current = await confirmation.json();
    if (!active && current.ready === true && current.commit === update.commit && current.version === update.version && manifest.version === update.version) {
      const updateBackup = await chrome.storage.session.get(["draft", "status"]);
      await chrome.storage.local.set({ updateBackup });
      if (active) { await chrome.storage.local.remove("updateBackup"); return; }
      chrome.runtime.reload();
    }
  } catch {
    // A missing marker is normal when the local updater is not installed.
  }
}
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === updateAlarm) void reloadInstalledUpdate();
});
void chrome.alarms.create(updateAlarm, { periodInMinutes: 1 });

// Google Docs routes canvas-editor keyboard input through this editable frame.
// Fail closed when focus is in the title, menus, comments, or an unknown editor.
const editorFocus = `(() => {
  if (!document.hasFocus()) return false;
  let element = document.activeElement;
  let inEditor = false;
  for (let depth = 0; depth < 6 && element; depth++) {
    if (element.matches?.('.docs-texteventtarget-iframe, .docs-texteventtarget')) inEditor = true;
    if (element.tagName === 'IFRAME') {
      try { element = element.contentDocument?.activeElement; } catch { return false; }
    } else {
      return Boolean(inEditor && element.isContentEditable);
    }
  }
  return false;
})()`;

function state() {
  return active ? { phase: active.phase, completed: active.completed, total: active.characters.length, message: active.message } : last;
}

async function publish() {
  const status = state();
  await chrome.storage.session.set({ status });
  const text = status.phase === "countdown" ? "…" : status.phase === "running" ? `${Math.floor(status.completed / status.total * 100)}%` : "";
  await chrome.action.setBadgeBackgroundColor({ color: "#245c4f" });
  await chrome.action.setBadgeText({ text });
}

function assertLive(run) {
  if (active !== run || run.abort.signal.aborted) throw new Error(run.stopReason || "Stopped.");
}

function delay(run, milliseconds) {
  assertLive(run);
  return new Promise((resolve, reject) => {
    const finish = () => { run.abort.signal.removeEventListener("abort", cancel); resolve(); };
    const timer = setTimeout(finish, milliseconds);
    const cancel = () => { clearTimeout(timer); reject(new Error(run.stopReason || "Stopped.")); };
    run.abort.signal.addEventListener("abort", cancel, { once: true });
  });
}

async function command(run, method, params) {
  assertLive(run);
  return chrome.debugger.sendCommand({ tabId: run.tabId }, method, params);
}

async function checkFocus(run) {
  const result = await command(run, "Runtime.evaluate", { expression: editorFocus, returnByValue: true });
  if (result.exceptionDetails || result.result?.value !== true) {
    throw new Error("Stopped: click inside the document body before starting. Focus must stay in the editor.");
  }
}

async function sendStep(run, step) {
  await checkFocus(run);
  const text = step.kind === "backspace" ? "BACKSPACE" : step.text;
  const events = keyEvents(text);
  if (events) {
    await command(run, "Input.dispatchKeyEvent", events[0]);
    // Release a pressed key even if a stop arrives between keydown and keyup.
    if (run.attached) await chrome.debugger.sendCommand({ tabId: run.tabId }, "Input.dispatchKeyEvent", events[1]);
  } else await command(run, "Input.insertText", { text });
}

async function execute(run) {
  let phase = "done", message = "Finished. Review the document for any Docs autocorrections.";
  try {
    for (let seconds = 5; seconds > 0; seconds--) {
      run.phase = "countdown";
      run.message = `Starting in ${seconds}s — click your insertion point in the document.`;
      await publish();
      await delay(run, 1000);
    }
    run.phase = "running";
    run.message = "Typing. Use the extension or stop shortcut to stop.";
    await publish();
    await checkFocus(run);
    const sentencePause = createSentencePauser(run.settings);
    for (const character of run.characters) {
      for (const step of characterPlan(character, run.settings)) {
        await sendStep(run, step);
        await delay(run, step.delay);
      }
      run.completed++;
      const pauseMilliseconds = sentencePause(character);
      if (pauseMilliseconds && run.completed < run.characters.length) {
        run.message = `Taking a sentence break for ${(pauseMilliseconds / 1000).toFixed(1)}s…`;
        await publish();
        await delay(run, pauseMilliseconds);
        await checkFocus(run);
        run.message = "Typing. Use the extension or stop shortcut to stop.";
        await publish();
      }
      if (Date.now() - run.lastPublished > 500) {
        run.lastPublished = Date.now();
        await publish();
      }
    }
  } catch (error) {
    phase = "stopped";
    message = run.stopReason || error.message;
  } finally {
    if (run.attached) {
      run.attached = false;
      await chrome.debugger.detach({ tabId: run.tabId }).catch(() => {});
    }
    if (active === run) {
      last = { phase, completed: run.completed, total: run.characters.length, message };
      active = null;
      await publish();
    }
  }
}

async function start(message) {
  await ready;
  if (active) throw new Error("A typing session is already active.");
  const text = normalizeText(message.text);
  const settings = settingsFrom(message.settings);
  // Reserve the single session before asynchronous tab lookup or attachment.
  const run = { tabId: message.tabId, abort: new AbortController(), attached: false,
    characters: [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)].map(item => item.segment),
    settings, completed: 0, phase: "starting", message: "Connecting…", lastPublished: 0 };
  active = run;
  try {
    const tab = await chrome.tabs.get(run.tabId);
    assertLive(run);
    if (!tab.active || !isGoogleDoc(tab.url)) throw new Error("Open an editable Google Doc in the active tab first.");
    run.windowId = tab.windowId;
    run.url = tab.url.split("#")[0];
    await chrome.debugger.attach({ tabId: run.tabId }, "1.3");
    run.attached = true;
    assertLive(run);
    void execute(run);
    return { ok: true };
  } catch (error) {
    if (run.attached) await chrome.debugger.detach({ tabId: run.tabId }).catch(() => {});
    if (active === run) active = null;
    throw error;
  }
}

function stop(reason = "Stopped. Review the last few characters before starting again.") {
  if (active) {
    active.stopReason = reason;
    active.abort.abort();
  }
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return;
  (async () => {
    await ready;
    if (message.type === "status") return { ok: true, status: state() };
    if (message.type === "start") return start(message);
    if (message.type === "stop") { stop(); return { ok: true }; }
    throw new Error("Unknown request.");
  })().then(respond, error => respond({ ok: false, error: error.message }));
  return true;
});

chrome.commands.onCommand.addListener(name => { if (name === "stop-typing") stop(); });
chrome.tabs.onActivated.addListener(({ tabId }) => {
  if (active && tabId !== active.tabId) stop("Stopped because the active tab changed.");
});
chrome.windows.onFocusChanged.addListener(windowId => {
  if (active && active.windowId !== undefined && windowId !== active.windowId) stop("Stopped because the browser window lost focus.");
});
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (active?.tabId === tabId && (change.status === "loading" || (change.url && change.url.split("#")[0] !== active.url))) stop("Stopped because the document navigated or reloaded.");
});
chrome.tabs.onRemoved.addListener(tabId => { if (active?.tabId === tabId) stop("The document tab was closed."); });
chrome.debugger.onDetach.addListener(({ tabId }) => {
  if (active?.tabId === tabId && active.attached) {
    active.attached = false;
    stop("Chrome disconnected the typing session.");
  }
});
