# Culture Failure Dashboard

Internal dashboard for tracking culture failures, split into **Before
Processing** and **After Processing**. The wet lab reports a failure; it's saved
to a live Google Sheet (one tab per category) and the dashboard reads it back so
both stay current. The coordinator is emailed each failure (and a 72-hour
reminder for anything still pending) by a Google Apps Script.

This is a **fully client-side app** — a single HTML page that talks directly to
a Google Apps Script web app. There is no server of our own to run or host.
(The earlier Deno server implementation has been retired in favour of this.)

## Layout

```
standalone/
  culture-failure.html   ← the whole app (inline CSS + JS)
  serve.ts               ← tiny Deno static server, only used to build the .exe
  background.jpg         ← faint page background
  README.md              ← setup, deploy, exe build, and merge-into-portal steps
apps-script/
  Code.gs                ← the whole backend in one file: data API (web app) + coordinator email/reminders
scripts/
  package-standalone.ps1 ← builds the double-click .exe
deno.json                ← start-standalone / build-standalone tasks
```

## Quick start

1. **Deploy the backend.** Paste [`apps-script/Code.gs`](apps-script/Code.gs)
   into the Apps Script project bound to the *"Culture Failure Monitor - Failure
   Log"* sheet, deploy it as a Web App, and copy the `/exec` URL. (The same file
   also holds the email notifier — run `installTrigger()` once to start it.)
2. **Point the page at it.** Set `APPS_SCRIPT_URL` near the top of the `<script>`
   in [`standalone/culture-failure.html`](standalone/culture-failure.html).
3. **Run it** — open the page over http (not `file://`):
   ```
   deno task start-standalone      # serves it + opens the browser
   ```
   …or just host `standalone/culture-failure.html` on any static server.

Full details — deployment, roles, OCR, packaging as a `.exe`, and merging into
the CMC ONCO tracker portal — are in
[`standalone/README.md`](standalone/README.md).

## Build the .exe

```
powershell -ExecutionPolicy Bypass -File scripts\package-standalone.ps1
```

Produces `dist\culture-failure-dashboard.exe` — a single double-click file that
serves the dashboard locally and opens the browser (no console window).
Requires [Deno](https://deno.com) and `APPS_SCRIPT_URL` already set.

## Sheet schema

Both tabs share the same header row:

```
Timestamp | OrderID | SampleID | PatientName | HospitalName | TestName | BillDate | Reason | Notes | ReportedBy | BillImageLink | ReferenceImageLinks | FailureType | RecollectionStatus | MailSent
```
