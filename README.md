# Culture Failure Dashboard

Internal dashboard for tracking culture failures, split into **Before
Processing** and **After Processing**. The wet lab reports a failure; it's saved
to a live Google Sheet (one tab per category) and the dashboard reads it back so
both stay current. The coordinator is emailed each failure (and a 72-hour
reminder for anything still pending) by a Google Apps Script.

This is a **fully client-side app** — a single HTML page (`index.html`) that
talks directly to a Google Apps Script web app. There is no server of our own
to run or host.

## Layout

```
index.html              ← the whole app (inline CSS + JS)
background.jpg          ← faint page background
apps-script/
  Code.gs                ← the whole backend in one file: data API (web app) + coordinator email/reminders
  appsscript.json        ← OAuth scopes manifest
```

## Quick start

1. **Deploy the backend.** Paste [`apps-script/Code.gs`](apps-script/Code.gs)
   into the Apps Script project bound to the *"Culture Failure Monitor - Failure
   Log"* sheet, deploy it as a Web App, and copy the `/exec` URL. (The same file
   also holds the email notifier — run `installTrigger()` once to start it.)
2. **Point the page at it.** Set `APPS_SCRIPT_URL` near the top of the
   `<script>` in [`index.html`](index.html).
3. **Run it** — open the page over http(s), not `file://` (a `file://` origin
   can trip up the cross-origin fetch to Apps Script). See "Host on GitHub
   Pages" below, or for local testing:
   ```
   python -m http.server 8080      # then open http://localhost:8080/index.html
   ```
   …or drop `index.html` + `background.jpg` onto any static host.

## Deploying the backend (detail)

### 1. Deploy the Apps Script web app

1. Open the **"Culture Failure Monitor - Failure Log"** spreadsheet →
   **Extensions → Apps Script**.
2. Paste in the contents of [`apps-script/Code.gs`](apps-script/Code.gs)
   (replace the default `Code.gs`), and save. This one file is both the data
   API (web app) and the email notifier.
3. **Set the OAuth scopes explicitly** (avoids "You do not have permission to
   call DriveApp..." errors): Project Settings → tick *Show appsscript.json
   manifest file*, then open `appsscript.json` and replace it with
   [`apps-script/appsscript.json`](apps-script/appsscript.json). Save, then run
   the `authorize` function once and approve the consent. Image uploads use
   the Drive REST API on the narrow `drive.file` scope (not all-Drive), so the
   app can only touch files it creates.
4. **Deploy → New deployment → Web app.**
   - Execute as: **Me**
   - Who has access: **Anyone** (the page calls it without a Google login)
5. Authorize when prompted (Sheets + Drive + Gmail). Copy the **Web app URL** —
   it ends in `/exec`.
6. To start the emails, run `installTrigger()` once from the Apps Script
   editor (Select function → `installTrigger` → Run) and authorize.

> Re-deploy note: after editing `Code.gs` later, use **Deploy → Manage
> deployments → (edit) → New version** so the `/exec` URL keeps serving the
> latest code.

### 2. Point the page at it

Open `index.html` and set the constant near the top of the `<script>`:

```js
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/XXXXXXXX/exec';
```

Until this is set, the page shows an amber "Not connected yet" banner and
skips all network calls.

## Host on GitHub Pages

No build step needed — it's already static. Repo **Settings → Pages → Build
and deployment → Source → "Deploy from a branch"**, branch `main`, folder
`/ (root)`, Save. The page is then live at:

```
https://<your-username>.github.io/culture-failure-monitor/
```

This is a stopgap. The dashboard has **no login** — anyone with that URL gets
full read/write access to the same shared data (see "Roles" below).
Longer-term, this page moves into the role-gated CMC ONCO tracker portal
instead of standing alone (see "Merging into the onco tracker").

## Roles

The page has **no login** — the header has a "Viewing as" picker (Wet Lab /
Coordinator / Manager) so you can exercise all three UIs:

- **Wet Lab** — sees the *Report Failure* button.
- **Coordinator** — read-only + can toggle recollection Pending/Resolved, plus
  the "Latest Failure" panel.
- **Manager** — the filtered table + failure-type breakdown chart.

This is a client-side convenience only; it is **not** a security boundary
(anyone can switch roles, and `Code.gs` doesn't enforce them). Real access
control comes from the portal when this page is merged into the onco tracker.

## OCR

The bill-screenshot auto-read uses Tesseract.js from the jsDelivr CDN (loaded
in-browser, no server/AI call). It needs internet access the first time to
fetch the library.

## Merging into the onco tracker (later)

When ready, this becomes another tracker page in `cmc_onco_tracker/frontend/`:

1. Copy `index.html` (as `culture-failure.html`, or whatever this tracker's
   naming convention is) and `background.jpg` (or switch the CSS `body::before`
   to that project's asset convention) into `frontend/`.
2. Add a role-gated route in `backend/backend.py` (mirror `cmc_page`):
   `/culture-failure/` → `_serve("culture-failure.html")`.
3. Add a card linking to it on `frontend/cmc.html` (next to "CMC ONCO Tracker").
4. Optionally drop the in-page role picker and derive capabilities from the
   portal session role instead.

Keep the `APPS_SCRIPT_URL` constant — it works identically once served from
the portal.

## Sheet schema

Both tabs share the same header row:

```
Timestamp | OrderID | SampleID | PatientName | HospitalName | TestName | BillDate | Reason | Notes | ReportedBy | BillImageLink | ReferenceImageLinks | FailureType | RecollectionStatus | MailSent
```
