# VibeComics

Build and edit a comic (or graphic novel) in your browser. VibeComics is a
static site with no server or database of its own: your comic is stored as a
`project.json` plus artwork files somewhere you pick: either a folder on
**your Google Drive**, or a self-hosted [HTTP storage server](#run-your-own-storage-server-optional).

## Run it locally

```bash
npm install
npm run dev
```

Other scripts: `npm run build` (production build into `dist/`), `npm test`,
`npm run lint`, `npm run format`.

Open the printed URL and pick where to store your comic, then open an
existing project folder or create a new one. Changes are saved automatically
every minute (only when something changed), or immediately with the
floppy-disk button in the navbar.

The app's [privacy policy](public/pages/privacy.html) and
[terms of service](public/pages/tos.html) are plain, self-contained HTML pages,
served at `/pages/privacy.html` and `/pages/tos.html`. The logo is
`public/favicon.svg` (the tab icon) and `public/logo.png` (1024 px).

## Google Drive setup

The app talks to Drive through OAuth 2.0 entirely client-side, via the OAuth
device flow (the same "enter this code" style OAuth uses for TVs). That one
flow works from a real click in the browser or from an injected script, so
the same "Connect with Google Drive" button works for a human or an AI
assistant. You need one Google OAuth client.

### Step 1: Create a Google Cloud project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or select an existing one)
3. Enable the **Google Drive API**: [APIs & Services > Library > search "Drive API" > Enable](https://console.cloud.google.com/apis/api/drive.googleapis.com/) - ensure that the right project is selected

### Step 2: Create the "TVs and Limited Input devices" OAuth client

1. Go to APIs & Services > Credentials
2. Click ["Create Credentials" > "OAuth client ID"](https://console.cloud.google.com/auth/clients/create)
3. Select **TVs and Limited Input devices** as the application type
4. Click "Create" and copy both the **Client ID** and **Client secret**

### Step 3: Configure the dotenv file

Rename `.env.example` to `.env.local` (git ignored) and add your values. The
build reads only `.env` / `.env.local`; variables exported in your shell are
ignored, and there is no `VITE_` prefix.

```
GOOGLE_DEVICE_CLIENT_ID=your-device-client-id-here
GOOGLE_DEVICE_CLIENT_SECRET=your-device-client-secret-here
```

Then run `npm run dev`.

### For deployment

Store these values as GitHub repository secrets:

- `GOOGLE_DEVICE_CLIENT_ID`
- `GOOGLE_DEVICE_CLIENT_SECRET`

The deploy workflow writes these secrets into `.env.local` before building.

The device client secret ships in the app bundle by design—Google's device
flow model assumes distributed apps cannot keep secrets (same model used by
tools like rclone).

## Run your own storage server (optional)

Instead of Google Drive, VibeComics can store a comic through `http-storage/`,
a small standalone Node server bundled at build time into a single
dependency-free file, `http-storage/dist/http-storage.mjs`. It plays the same
role Drive does: one folder per project, a `project.json` with the same
optimistic-concurrency versioning, media files alongside it, over a plain
CORS-enabled REST API, so the app can talk to it with `fetch` from anywhere
you run it (`http://localhost:8081` by default, bound to every interface).

```bash
npm run http-storage
```

Configure it with environment variables: `HTTP_STORAGE_PATH` (where projects
are stored; defaults to a `data` folder next to the server), `HTTP_STORAGE_PORT`
(default 8081), `HTTP_STORAGE_HOST` (default `0.0.0.0`) and
`HTTP_STORAGE_CORS_ORIGIN` (default `*`).

On the app's connect screen, pick "Your own server" and enter its URL. It has
no login: the app just checks it answers `GET /health`, then uses it. The URL
is remembered (it is not a secret), so it prefills that field next time, but
every page load starts back at the connect screen: nothing connects on its own.

## Deploy

Pushing to `main` runs the `Deploy to GitHub Pages` workflow, which builds
`dist/` (including the service worker and build metadata) and publishes it.
The site uses relative URLs, so it works from any path (a project site such as
`https://<user>.github.io/<repo>/`, a custom domain, or a sub-folder).

One-time setup for a new repository:

1. Settings → Pages → Build and deployment → Source: **GitHub Actions**.
2. Add the two repository secrets listed above.

## For AI agents

Agents use the command line, `vibecomics.mjs`, which is deployed next to the
site (<https://nparashuram.github.io/vibecomics/vibecomics.mjs>; Node.js 20 or
newer; nothing to install, no browser needed):

```sh
node vibecomics.mjs help                    # every command
node vibecomics.mjs auth login              # prints a URL + code for the user to approve
node vibecomics.mjs auth status             # finishes the login once they have
node vibecomics.mjs storage createProject "My comic"
node vibecomics.mjs layers add <panelId> '{"prompt":"…"}'
```

It is the same API as `window.ComicBuilder` in the app (see below), one command
per function, printing JSON. The login (a refresh token) and the open project
are kept in `~/.vibecomics` (`VIBECOMICS_HOME` moves it); each command loads the
project from Drive, changes it and saves it back (the CLI only supports Drive,
not a storage server). Locally, `npm run cli -- help` builds and runs it (it
needs the device OAuth client in `.env.local`, same as the app's "Connect with
Google Drive" button).

In the running app's browser console, the same API is:

```js
ComicBuilder.help();
```

That prints the API reference: every action is documented via JSDoc-derived
`.toString()` docs on the runtime API. A static copy is generated to
`public/api.txt` and deployed with the site, next to `public/llms.txt`, the
step-by-step guide an agent follows to build a comic (workflow, visual style,
image formats, continuity), which is written by hand in `scripts/llms-guide.md`. The engineering design — architecture, data model,
Drive scope, autosave, service worker, build pipeline — is in `spec.md`.
