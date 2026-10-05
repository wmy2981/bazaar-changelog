# bazaar-changelog

[简体中文](README.zh-CN.md)

A SiYuan plugin that shows bazaar package release notes and repository changelogs in a native
"Changelog" dialog, and uses the same dialog to confirm bazaar package updates.

![preview](https://gcore.jsdelivr.net/gh/wmy2981/bazaar-changelog@dev/assets/preview.png)

## Features

- **The version on a bazaar package page opens the changelog**: Settings → Bazaar → any package
  → "Market info - Version".
- **Updates are confirmed in the changelog dialog**: Settings → Bazaar → Downloaded → Update, or the
  Update button on a package detail page. The update starts only after you confirm; SiYuan's own
  download progress, list refresh and error messages are unchanged.
- **Pick the source at the top of the dialog**: release notes (listed per version, switchable) or the
  repository CHANGELOG (one file, not per version).
- **"Latest" follows the bazaar**: only the version the bazaar index has seen counts as latest;
  releases that are newer on GitHub are not listed yet.
- **Falls back to the other source when one is missing**: if the bazaar version has no release notes
  at the moment you open the dialog, this open switches to the CHANGELOG; when the CHANGELOG is the
  preferred source but the repository has none, it switches back to the release notes. The next open
  follows the preferred source again.
- **GitHub acceleration switch**: off by default, so only `api.github.com` is requested. Turn it on and
  fill in one acceleration URL when you need it.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| Preferred source | Release notes | Which source the changelog dialog opens with. |
| GitHub acceleration | Off | When off, only `api.github.com` is requested. |
| Acceleration URL | Empty | A prefix proxy such as `https://gh-proxy.com/` . With acceleration on and an http(s) URL set, release notes requests are prepended with it. |
| Debug mode | Off | Print complete plugin logs to the console (request URLs, timings, version filtering, fallback reasons), prefixed with `[bazaar-changelog]`. |

## Data sources

- **Release notes**: the GitHub Releases API (`https://api.github.com/repos/<owner>/<repo>/releases`),
  at most 100 entries, drafts filtered out, newest first; one request per repository per 30 minutes.
  A timeout is not treated as a failure, so it can still be retried.
- **CHANGELOG**: `https://gcore.jsdelivr.net/gh/<owner>/<repo>/<path>` (jsDelivr's default
  `cdn.jsdelivr.net` is DNS-poisoned in mainland China, so only the Gcore endpoint is used), where
  `path` is one of `CHANGELOG.md`, `docs/CHANGELOG.md` and `doc/CHANGELOG.md`, all requested **in
  parallel**; the first one answering 200 wins and the remaining requests are cancelled (with no ref,
  jsDelivr resolves the repository's default branch). Only a `404` (or a 200 with an empty body) means
  "this path has no file"; `403` / `429` / `5xx` / network errors only mean this request did not get
  through and are never reported as "none". All three candidates answering 404 reports "this
  repository has no CHANGELOG" (on a cold cache those 404s wait for jsDelivr to reach the origin, so
  that verdict is waited for up to 8 seconds); anything else reports a timeout, with a second line
  saying "Poor network, or this repository has no CHANGELOG". A timeout does not switch sources on its
  own, because a slow route would be just as slow for the other source.
- **Bazaar latest version**: `available.version` from the kernel `/api/bazaar/getBazaarPackage`. It
  decides the "Latest" mark and filters out releases the bazaar index has not seen.
- **Markdown rendering**: the kernel `/api/lute/md2html`, the same Lute pipeline the bazaar README
  uses, followed by DOMPurify.

## Known limitations

- Only GitHub-hosted bazaar packages are supported (the SiYuan bazaar only indexes GitHub repositories).
- Release notes use GitHub's anonymous API, roughly 60 requests per hour per IP. When that is
  exhausted the dialog says the release notes are unavailable.
- Both the "Latest" mark and the version filter depend on the bazaar index, which refreshes every
  1–3 hours.
- Update confirmation relies on SiYuan's own bazaar update flow. If SiYuan changes that flow the
  plugin logs a console warning, stops replacing the update button, and does not implement an update
  path of its own.
- Code blocks in the dialog are rendered as plain text, without syntax highlighting.
- GitHub acceleration only affects the release notes API; the CHANGELOG comes from
  `gcore.jsdelivr.net` and is not affected by the switch.
- The CHANGELOG only uses the Gcore endpoint: when it is unreachable there is no second CDN to fall
  back on, so the dialog reports a timeout and offers a retry.

## Development

```bash
npm install
npm run typecheck   # static checks
npm run build       # writes dist/ and package.zip
npm run icon        # assets/icon.svg -> assets/icon.png
node scripts/build-preview-css.mjs <path to the siyuan repository>   # regenerate assets/preview.css
npm run preview     # assets/preview.html -> assets/preview.png (run npx playwright install chromium once)
```

Build artifacts (`dist/`, `package.zip`, and the repository-root `index.js` / `index.css` / `i18n/`)
are not committed.

## License

[MIT](LICENSE)
