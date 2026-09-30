import { normalizeText } from "./typing.mjs";
const $ = id => document.getElementById(id);
const fields = ["text", "wpm", "typoRate", "pauses"];
let saveTimer;

function estimate() {
  const length = [...$("text").value].length;
  const seconds = length * 60 / (Math.max(10, Number($("wpm").value) || 45) * 5);
  $("estimate").textContent = length ? `${length.toLocaleString()} characters · ~${Math.max(1, Math.ceil(seconds / 60))} min plus pauses and corrections` : "Plain text · line breaks supported";
}

async function save() {
  await chrome.storage.session.set({ draft: { text: $("text").value, wpm: $("wpm").value, typoRate: $("typoRate").value, pauses: $("pauses").checked } });
}

function render(status) {
  const busy = ["starting", "countdown", "running"].includes(status.phase);
  $("start").disabled = busy;
  $("stop").disabled = !busy;
  for (const id of fields) $(id).disabled = busy;
  $("status").textContent = status.message;
  $("progress").max = status.total || 1;
  $("progress").value = status.completed || 0;
  $("counts").textContent = status.total ? `${status.completed.toLocaleString()} / ${status.total.toLocaleString()} characters` : "";
}

async function refresh() {
  const response = await chrome.runtime.sendMessage({ type: "status" });
  if (response.ok) render(response.status);
}

for (const id of fields) $(id).addEventListener("input", () => {
  estimate();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => save().catch(showError), 150);
});

function showError(error) { $("status").textContent = error.message; }

$("form").addEventListener("submit", async event => {
  event.preventDefault();
  $("start").disabled = true;
  try {
    const text = normalizeText($("text").value);
    clearTimeout(saveTimer);
    await save();
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const response = await chrome.runtime.sendMessage({ type: "start", tabId: tab?.id, text,
      settings: { wpm: Number($("wpm").value), typoRate: Number($("typoRate").value), pauses: $("pauses").checked } });
    if (!response.ok) throw new Error(response.error);
    window.close();
  } catch (error) { showError(error); $("start").disabled = false; }
});

$("stop").addEventListener("click", async () => {
  try { await chrome.runtime.sendMessage({ type: "stop" }); await refresh(); }
  catch (error) { showError(error); }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "session" && changes.status) render(changes.status.newValue);
});

async function init() {
  const { draft } = await chrome.storage.session.get("draft");
  if (draft) for (const id of fields) {
    if (id === "pauses") $(id).checked = draft[id];
    else $(id).value = draft[id];
  }
  const commands = await chrome.commands.getAll();
  $("shortcut").textContent = commands.find(command => command.name === "stop-typing")?.shortcut || "Set one at chrome://extensions/shortcuts";
  estimate();
  await refresh();
}
init().catch(showError);
