# Docs Paced Typing maintenance

The user's installed unpacked extension is updated from `bummah08/docs-paced-typing`, branch `main`, by the local Windows updater. Local edits alone do not reach the installation.

For every requested change:

1. Preserve existing work and inspect the current `main` branch.
2. Increase the numeric version in `manifest.json` for any change to runtime files. Do not reuse or decrease a released version.
3. Add any new runtime assets to `release-files.json`. Paths must be repository-relative, with forward slashes, without `..`. Include `manifest.json` last. Do not put credentials, local paths, or updater configuration in the repository.
4. Run `node tests/verify.mjs` and relevant updater checks. Rebuild `docs-paced-typing.zip` from the extension source, excluding Git metadata and local updater state.
5. Commit and push the finished change to GitHub when authorized by the user's request. The updater polls `main` every five minutes; the extension reloads within about one further minute when no typing session is active.
6. Report whether GitHub publication and local installation were actually verified. Do not claim the extension updated just because the source changed.

The trusted updater scripts are installed separately and do not replace themselves from GitHub. Changes to those scripts require a deliberate local reinstall. The initial 1.2.0 setup requires one manual reload of the previously installed extension to activate its update watcher.
