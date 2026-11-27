# vibecomics.github.io

The static marketing/legal/docs site for VibeComics, deployed at
`https://vibecomics.github.io/`. The app itself is a separate repo,
[vibecomics/app](https://github.com/vibecomics/app), deployed as a GitHub
Pages project site at `https://vibecomics.github.io/app/`.

- `index.html` — the landing page: the pitch and the starter prompt an AI
  agent copies to begin. Forwards old `#comic=...`/`#settings` bookmarks to
  `app/`.
- `llms.txt` — hand-written step-by-step guide an AI agent follows to build
  a comic. Points to `app/api.txt`, `app/vibecomics.mjs` and
  `app/vibecomics-generate.mjs` for the API reference and CLI.
- `pages/tos.html`, `pages/privacy.html` — terms of service and privacy
  policy.
- `favicon.svg`, `logo.png` — the app references these by absolute URL
  (`//vibecomics.github.io/...`) since it doesn't carry its own copy.

No build step: everything here is served as-is. Pushing to `main` runs the
`Deploy to GitHub Pages` workflow.

One-time setup for a new repository: Settings → Pages → Build and
deployment → Source: **GitHub Actions**.
