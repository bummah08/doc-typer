const nearby = {
  a: "sq", b: "vn", c: "xv", d: "sf", e: "wr", f: "dg", g: "fh",
  h: "gj", i: "uo", j: "hk", k: "jl", l: "ko", m: "nj", n: "bm",
  o: "ip", p: "ol", q: "wa", r: "et", s: "ad", t: "ry", u: "yi",
  v: "cb", w: "qe", x: "zc", y: "tu", z: "xa"
};

export function normalizeText(text) {
  if (typeof text !== "string" || !text.trim()) throw new Error("Paste some text first.");
  if (text.length > 100000) throw new Error("Use at most 100,000 characters per run.");
  // Tabs would move focus in Docs; use spaces. Reject nonprinting controls.
  const normalized = text.replace(/\r\n?/g, "\n").replace(/\t/g, "    ").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
  if (!normalized.trim()) throw new Error("Paste some printable text first.");
  return normalized;
}

export function settingsFrom(input = {}) {
  const wpm = Number(input.wpm ?? 45);
  const typoRate = Number(input.typoRate ?? 2);
  if (!Number.isFinite(wpm) || wpm < 10 || wpm > 150) throw new Error("Speed must be 10–150 WPM.");
  if (!Number.isFinite(typoRate) || typoRate < 0 || typoRate > 10) throw new Error("Typo rate must be 0–10%.");
  return { wpm, typoRate, pauses: input.pauses !== false };
}

export function characterPlan(character, settings, random = Math.random) {
  const base = 60000 / (settings.wpm * 5);
  const steps = [];
  const neighbors = nearby[character.toLowerCase()];
  if (neighbors && random() < settings.typoRate / 100) {
    let wrong = neighbors[Math.floor(random() * neighbors.length)];
    if (character === character.toUpperCase()) wrong = wrong.toUpperCase();
    steps.push({ kind: "text", text: wrong, delay: base * (0.6 + random()) });
    steps.push({ kind: "backspace", delay: 180 + random() * 420 });
  }
  let delay = base * (0.45 + random() * 1.1);
  if (settings.pauses) {
    if (/[.!?\n]/u.test(character)) delay += 400 + random() * 1200;
    else if (/[,;:]/u.test(character)) delay += 120 + random() * 420;
    else if (character === " " && random() < 0.08) delay += 350 + random() * 1100;
  }
  steps.push({ kind: "text", text: character, delay });
  return steps;
}

// Each run owns its counter. A literal full stop completes a sentence;
// other punctuation does not contribute to the longer break interval.
export function createSentencePauser(settings, random = Math.random) {
  const nextInterval = () => 2 + Math.floor(random() * 3);
  let remaining = settings.pauses ? nextInterval() : 0;
  return character => {
    if (!settings.pauses || character !== ".") return 0;
    if (--remaining > 0) return 0;
    const milliseconds = 3000 + random() * 4000;
    remaining = nextInterval();
    return milliseconds;
  };
}

export function isGoogleDoc(url) {
  try {
    const parsed = new URL(url);
    return parsed.origin === "https://docs.google.com" && /^\/document\/(?:u\/\d+\/)?d\/[\w-]+\/edit(?:\/|$)/.test(parsed.pathname);
  } catch { return false; }
}

export function keyEvents(text) {
  if (text === "\n") return [
    { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r", unmodifiedText: "\r" },
    { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 }
  ];
  if (text === "BACKSPACE") return [
    { type: "rawKeyDown", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 },
    { type: "keyUp", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 }
  ];
  if (!/^[\x20-\x7e]$/.test(text)) return null;
  const key = { key: text };
  if (/^[a-z]$/i.test(text)) Object.assign(key, { code: `Key${text.toUpperCase()}`, windowsVirtualKeyCode: text.toUpperCase().charCodeAt(0) });
  else if (/^\d$/.test(text)) Object.assign(key, { code: `Digit${text}`, windowsVirtualKeyCode: text.charCodeAt(0) });
  else if (text === " ") Object.assign(key, { code: "Space", windowsVirtualKeyCode: 32 });
  return [{ type: "keyDown", ...key, text, unmodifiedText: text }, { type: "keyUp", ...key }];
}
