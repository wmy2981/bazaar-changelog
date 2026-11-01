# bazaar-changelog

[简体中文](README.zh-CN.md)

A SiYuan plugin that turns a bazaar package's GitHub release notes, the repository CHANGELOG and its
commit history into SiYuan's native "Changelog" dialog, and confirms bazaar package updates through the
same dialog.

![preview](https://gcore.jsdelivr.net/gh/wmy2981/bazaar-changelog@dev/assets/preview.png)

## Features

- Open the changelog from the version on a bazaar package page
- Confirm bazaar updates through the changelog dialog
- Several selectable sources
- Fall back to the CHANGELOG when the release notes are empty
- `#PR` / issue references and `@user` become GitHub links
- Open the current content on GitHub in one click
- GitHub acceleration

## Data sources

- **Release notes**: the GitHub Releases API
  (`https://api.github.com/repos/<owner>/<repo>/releases`), up to 100 entries, drafts filtered out and
  newest first; a repository is requested at most once every 30 minutes.
- **CHANGELOG**: fetched from `https://raw.githubusercontent.com/<owner>/<repo>/HEAD/<path>` (`HEAD` is
  resolved by GitHub to the repository's default branch); `CHANGELOG.md`, `docs/CHANGELOG.md` and
  `doc/CHANGELOG.md` are requested **concurrently** and whichever answers 200 first is used, the rest
  are cancelled.
- **Bazaar latest version**: `available.version` from the kernel's `/api/bazaar/getBazaarPackage`, used
  both as "latest" and to hide releases the bazaar index has not picked up yet.
- **Commits**: the GitHub Compare API
  (`https://api.github.com/repos/<owner>/<repo>/compare/<base>...<head>`); with the start set to "Any"
  it falls back to `/commits` for the newest 100 commits of that endpoint.

## Known limitations

- Release notes and commits use GitHub's anonymous API, so a rate-limited request just tells you it
  could not be read. Fill in a GitHub token to use your own quota (usually 5000 requests per hour).
- One commit range lists at most 250 commits (the Compare API limit); older ones have to be read on
  GitHub.
- With GitHub acceleration on, some proxies do not forward the `compare` endpoint, so commits cannot be
  fetched (the status code they return can be anything).
- "Latest" and the version filtering both depend on the bazaar index, which is refreshed every 1–3
  hours.
- Code blocks in the dialog are rendered as plain text, without syntax highlighting.
- The CHANGELOG has this one entry and no second CDN behind it: when it cannot be fetched the dialog
  reports a timeout and offers "Fetch again".

## Bazaar Stats Graph

![Bazaar stats graph](https://siyuan-bazaar-stats-graph.sr1.cc.cd/api/chart/wmy2981/bazaar-changelog?metrics=downloads,rating,ratings&range=all&area=true&lang=en)

## Development

```bash
npm install
npm run typecheck   # static checks
npm run build       # writes dist/ and package.zip
npm run icon        # assets/icon.svg -> assets/icon.png
node scripts/build-emoji-map.mjs                  # regenerate src/emoji-map.ts (gemoji's alias table)
node scripts/build-preview-css.mjs <siyuan repo>   # regenerate assets/preview.css
npm run preview     # assets/preview.html -> assets/preview.png (needs npx playwright install chromium once)
```

With "Debug mode" enabled in the settings, running `bazaarChangelogRenderTest()` in the developer tools
console opens the rendering test window: it puts a sample covering Markdown, GFM syntax and every
reference style (`#123`, `owner/repo#123`, `@user`, bare URLs, `:tada:` and so on) through the dialog's
real pipeline (kernel Lute → DOMPurify → reference linkification), so the typography and the
linkification can be checked by eye.

## License

[MIT](LICENSE)
