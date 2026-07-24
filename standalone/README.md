# Culture Failure Dashboard — standalone (static HTML + Apps Script)

This folder is a **self-contained, serverless** version of the Culture Failure
Dashboard. Instead of the Deno server (`../server`) reading/writing Google
Sheets over OAuth, a single HTML page talks directly to a **Google Apps Script
web app** bound to the failure-log spreadsheet — the same pattern the CMC ONCO
tracker uses.

Use this to trial and refine the dashboard on its own. When it's ready, the one
HTML file drops into `cmc_onco_tracker/frontend/` and gets wired into that
portal's routing/auth (see "Merging into the onco tracker" below).

```
standalone/
  culture-failure.html   ← the whole app (inline CSS + JS)
  serve.ts               ← tiny Deno static server, only used to build the .exe
  background.jpg          ← faint page background (optional; page still works without it)
  README.md              ← you are here
../apps-script/
  Code.gs                ← the whole backend in one file: data API (web app) + email notifier
```

## What changed vs. the Deno app

| Deno server endpoint                         | Standalone replacement (Apps Script)                    |
| -------------------------------------------- | ------------------------------------------------------- |
| `GET /api/failures`                          | `GET  ?action=getAll`                                   |
| `POST /api/failures` (multipart + images)    | `POST {action:'report', …, billImage, referenceImages}` (images sent as base64 JSON) |
| `PATCH /api/failures/:cat/:row`              | `POST {action:'setRecollection', category, rowNumber, recollectionStatus}` |
| `GET /auth/google/status`                    | `GET  ?action=status`                                   |
| Server-side role login (wetlab/coord/mgr)    | **Client-side role picker** in the header (see "Roles") |

The sheet schema, tab names, Drive image folder, and `/file/d/<id>/view` link
format are all identical, so the email automation (Part 2 of `Code.gs`) keeps
working unchanged.

## Setup

### 1. Deploy the Apps Script web app

1. Open the **"Culture Failure Monitor - Failure Log"** spreadsheet →
   **Extensions → Apps Script**.
2. Paste in the contents of [`../apps-script/Code.gs`](../apps-script/Code.gs)
   (replace the default `Code.gs`), and save. This one file is both the data
   API (web app) and the email notifier.
3. **Deploy → New deployment → Web app.**
   - Execute as: **Me**
   - Who has access: **Anyone** (the page calls it without a Google login;
     this matches the CMC ONCO tracker's deployment)
4. Authorize when prompted (Sheets + Drive + Gmail). Copy the **Web app URL** —
   it ends in `/exec`.
5. To start the emails, run `installTrigger()` once from the Apps Script editor
   (Select function → `installTrigger` → Run) and authorize.

> Re-deploy note: after editing `Code.gs` later, use **Deploy → Manage
> deployments → (edit) → New version** so the `/exec` URL keeps serving the
> latest code.

### 2. Point the page at it

Open `culture-failure.html` and set the constant near the top of the `<script>`:

```js
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/XXXXXXXX/exec';
```

Until this is set, the page shows an amber "Not connected yet" banner and skips
all network calls.

### 3. Open it

Because the browser talks to Apps Script cross-origin, **open the page over
http(s), not `file://`** (a `file://` origin can trip up some setups). Any
static server works, e.g. from this folder:

```
python -m http.server 8080      # then open http://localhost:8080/culture-failure.html
```

…or just drop the file onto any static host. No backend of your own is needed.

## Package as a .exe

To hand this to someone who won't run a server, compile it into one
double-click file (requires [Deno](https://deno.com)):

```
powershell -ExecutionPolicy Bypass -File ../scripts/package-standalone.ps1
```

This produces `dist/culture-failure-dashboard.exe`. That exe is a tiny local
static server (`serve.ts`) with the whole `standalone/` folder embedded:
double-clicking it serves the dashboard on `http://localhost` and opens the
browser, with no console window. It still calls your Apps Script web app, so
`APPS_SCRIPT_URL` must be set **before** building — the packaging script refuses
to build while it's still the placeholder, so you can't ship a "Not connected"
exe by accident. To try the launcher without compiling: `deno task
start-standalone`.

## Roles

The standalone page has **no login** — the header has a "Viewing as" picker
(Wet Lab / Coordinator / Manager) so you can exercise all three UIs while
testing:

- **Wet Lab** — sees the *Report Failure* button.
- **Coordinator** — read-only + can toggle recollection Pending/Resolved, plus
  the "Latest Failure" panel.
- **Manager** — the filtered table + failure-type breakdown chart.

This is a client-side convenience only; it is **not** a security boundary
(anyone can switch roles, and `Code.gs` doesn't enforce them). That's fine
for standalone trialling. Real access control comes from the portal when this
page is merged into the onco tracker.

## OCR

The bill-screenshot auto-read still uses Tesseract.js from the jsDelivr CDN
(loaded in-browser, no server/AI call), exactly as before. It needs internet
access the first time to fetch the library.

## Merging into the onco tracker (later)

When ready, this becomes another tracker page in
`cmc_onco_tracker/frontend/`:

1. Copy `culture-failure.html` (and `background.jpg`, or switch the CSS
   `body::before` to that project's asset convention) into `frontend/`.
2. Add a role-gated route in `backend/backend.py` (mirror `cmc_page`):
   `/culture-failure/` → `_serve("culture-failure.html")`.
3. Add a card linking to it on `frontend/cmc.html` (next to "CMC ONCO Tracker").
4. Optionally drop the in-page role picker and derive capabilities from the
   portal session role instead.

Keep the `APPS_SCRIPT_URL` constant — it works identically once served from the
portal.
