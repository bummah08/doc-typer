# Docs Paced Typing

A dependency-free Chrome extension that types supplied plain text into Google Docs. Includes adjustable speed (10–150 WPM), uneven key timing, optional punctuation/thinking pauses, and occasional adjacent-key typos followed by Backspace and the intended character. Set typos to 0 to disable them.

## Install

Updating from 1.0.0 or 1.1.0: replace the files in your existing unpacked extension folder with this version, then click its **Reload** button at `chrome://extensions` (or `opera://extensions`). Reloading ends any active typing session. Version 1.2.0 includes support for the optional Windows GitHub updater below.

1. Extract the ZIP to a permanent folder.
2. Open `chrome://extensions` in Chrome 118 or newer.
3. Enable **Developer mode**, select **Load unpacked**, and choose the `docs-paced-typing` folder containing `manifest.json`.
4. Pin **Docs Paced Typing** from Chrome's Extensions menu.

## Use

1. Open an editable Google Doc, preferably a blank test document for your first run. Close DevTools for that tab.
2. Click the extension, paste the text, and choose speed, typo percentage, and pauses.
3. Click **Start typing**. The popup closes. During the five-second countdown, click the exact insertion point in the document body. Avoid leaving a text selection unless you intend to replace it.
4. Keep the Doc focused. The extension badge shows progress. Switching tabs/windows or moving focus out of the editor stops typing.
5. To stop, press **Ctrl+Shift+.** on Windows/Linux or **Command+Shift+.** on Mac, reopen the extension and click **Stop**, or cancel Chrome's debugging banner. Opening the popup can itself trigger the focus stop. Shortcut assignments can be changed at `chrome://extensions/shortcuts`.

Stopping leaves the text already entered. There is no automatic resume or rollback. A stop during a correction can leave the temporary typo, so inspect the ending and paste only the remaining text for another run. The counter tracks completed character cycles; on interruption the last character may already have been inserted but not counted. Do not move the caret, type, or select text during a run.

## Behavior and limits

- WPM uses the conventional five characters per word. Pauses and corrections make the overall rate slower than the selected base speed.
- With pauses enabled, typing takes an extra 3–7 second break after every 2–4 full stops (`.`), choosing a new interval and duration each time. Each literal `.` counts, including dots in abbreviations, decimals, and ellipses; `!`, `?`, and line breaks do not count toward these sentence breaks. The break follows the full stop and its normal punctuation delay. No extra break is added after the final character. The counter starts fresh for each run, and Stop works during a break. Uncheck pauses to disable all optional pauses.
- Typo percentage is a probability per English letter, not an exact quota. Typos are corrected immediately; the extension does not revise earlier sentences.
- Line breaks press Enter. Tabs become four spaces. Emoji and other Unicode text use Chrome's text-insertion input path. Rich formatting is not transferred.
- Google Docs can apply its own autocorrections, smart quotes, substitutions, and list formatting. Disable unwanted automatic substitutions in Docs preferences if you need closer fidelity, and review the result.
- Typing proceeds at the current caret or selection. Read-only documents, comments, title fields, mobile layouts, and nonstandard editors are not supported. Focus detection depends on Google's current editor markup and may need an update if Google changes it.
- This simulates text entry; it does not verify human authorship or promise any particular appearance in revision history or detection systems.

## Privacy and permissions

The extension has no server, analytics, external dependencies, or remote network requests. Draft text and progress are kept in Chrome's session storage. During an automatic update, a temporary copy in local extension storage preserves the draft and status across reload; it is removed after the updated extension starts. Manual reloads or browser shutdown normally clear the session data. Text typed into Google Docs is handled by Google normally. The extension never reads the document's text. The optional local updater contacts GitHub to download code; it does not read or upload drafts or document contents.

- `activeTab`: identify the Doc you explicitly start from.
- `debugger`: send keyboard input to that tab and inspect editor focus. This is a powerful permission and Chrome displays a visible debugging banner. The implementation only attaches to an active `https://docs.google.com/document/.../edit` tab and detaches when the run ends.
- `storage`: hold the draft, settings, and progress for this browser session.
- `alarms`: check once a minute whether the local updater has installed a complete newer version. A running typing session postpones reload.

## Automatic updates on Windows

Unpacked extensions do not pull updates from GitHub on their own. The optional helper in `updater/` downloads the runtime files listed in `release-files.json` from the private repository `bummah08/docs-paced-typing`, branch `main`, using Git Credential Manager. No GitHub credential is stored in the extension or repository.

One-time setup requires Node.js 20+, Git with Git Credential Manager, and signing in to an account that can read the repository. Run the following in PowerShell, substituting the actual installed extension directory:

```powershell
git credential-manager github login --username bummah08 --device
./updater/install.ps1 -ExtensionPath 'C:\path\to\docs-paced-typing'
```

The installer validates and downloads the current release, backs up existing runtime files, and registers **Docs Paced Typing GitHub Updater** for the current Windows user. It runs silently at sign-in and every five minutes while that user is signed in. Reload the existing extension once in Opera/Chrome after the first installation. After that, the extension checks the completion marker once a minute and reloads when idle. New permissions in a future version may still require browser approval.

Every runtime change must have a higher `manifest.json` version. Failed downloads, incomplete releases, unsafe file paths, downgrades, and detected edits to previously managed local files are rejected. A backup is saved before every installation; a file-write failure restores previous files. The helper itself is installed separately and is not replaced automatically from GitHub. New runtime assets must be included in `release-files.json`.

Configuration, update log, Git cache, installed revision, and backups are stored in `%LOCALAPPDATA%\DocsPacedTypingUpdater`. If an update fails, inspect `update.log`. Disable the named task in Windows Task Scheduler to stop polling. For a manual check, run the installed `update.mjs` with Node and its `config.json` path. Keep the installed extension folder and the Node/Git installations in place.

Chrome documentation: [debugger API](https://developer.chrome.com/docs/extensions/reference/api/debugger), [keyboard input protocol](https://chromedevtools.github.io/devtools-protocol/tot/Input/), and [service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle). Chrome 118+ keeps a service worker alive during an active debugger session.

## Validation

Local automated checks cover typing plans, full-stop sentence breaks, input normalization, document URL restrictions, key events, session cancellation/error handling, and idle update reloads. Run `node tests/verify.mjs` and `node tests/updater.mjs` with Node.js 20+ from the repository folder.

A separate real Chrome test of version 1.0.0 with a local editable iframe reproduced the intended sample exactly using forced typos, Backspace, capitals, punctuation, line breaks, and Unicode. It also verified that the focus guard accepts the editor iframe and rejects a title input. This tests Chrome input and focus behavior, not Google's application logic.

Live Google Docs compatibility requires a signed-in browser smoke test; it has not been verified in this delivery. Start with a short sample in a blank Doc before longer runs.

Suggested sample: `Hello, world! This is a typing test.` followed by a newline and `Second paragraph: café 😊`.

## Source

`background.js` owns the session and Chrome input; `typing.mjs` handles pacing and keystrokes; `popup.html`, `popup.css`, and `popup.js` provide the controls. No build step is required.
