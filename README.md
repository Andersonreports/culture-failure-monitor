# Culture Failure Dashboard

Internal dashboard for tracking culture failures, split into two categories —
**Before Processing Failure** and **After Processing Failure**. The wet lab
team reports a failure on this page; it's saved to a live Google Sheet (one
tab per category) and the dashboard reads it straight back so both panels
stay current. Coordinator notification over WhatsApp is planned but not wired
up yet (see "WhatsApp notification" below).

## Requirements

- [Deno](https://deno.com/) 2.x
- A Google account (the live failure-log sheet lives in its Drive)

No Node.js, npm, or `node_modules` — this runs on Deno directly.

## Setup

### 1. Google Sheets (OAuth, your own Google login)

This is a one-time step so the app is allowed to read/write a Google Sheet on
your behalf. No 2-Step Verification/App Password is needed — the coordinator
notification email is sent separately by a Google Apps Script (see "Email
notification" below), not by this app.

1. Go to the [Google Cloud Console](https://console.cloud.google.com/), create a project (or reuse one).
2. Enable the **Google Sheets API** and the **Google Drive API** for that project (APIs & Services → Library) — Drive is used to store the bill/reference image uploads.
3. Go to APIs & Services → Credentials → Create Credentials → OAuth client ID.
   - Application type: **Desktop app**
   - If prompted, configure the OAuth consent screen first (External is fine; add your own Google account as a test user).
4. Download the resulting JSON and save it as:
   ```
   server/credentials/google-oauth-client.json
   ```
5. Start the app (step 2 below), open it in the browser, and click **Connect now** next to the Google Sheet status banner. This opens a Google consent screen — approve it (it will ask for both Sheets and Drive file access).
6. On first connect, the app automatically creates a new spreadsheet named **"Culture Failure Monitor - Failure Log"** with two tabs, **Before Processing Failure** and **After Processing Failure**, and remembers its ID in `server/data/failure-sheet-config.json`. It also creates a Drive folder named **"Culture Failure Monitor - Images"** for uploaded images. Every reported failure is appended as a row to the matching tab.

You only need to go through the consent screen once — the token is cached in `server/data/token.json`. If you had already connected before the Drive feature was added, delete `server/data/token.json` and click **Connect now** again to re-authorize with the added Drive permission.

### 2. Run it

```
deno task start
```

Open http://localhost:3000

### 3. (Optional) .env

Copy `.env.example` to `.env` if you want to set a custom `PORT`, or fill in
`COORDINATOR_WHATSAPP_NUMBER` — this is currently unused (see below) but
reserved for when the notification mechanism is chosen.

## Logging in (Wet Lab / Coordinator / Manager)

The dashboard requires signing in as one of the three roles before it loads.
Each role has its own password (not tied to any individual person), enforced
server-side — the server itself refuses `POST /api/failures` (reporting a
failure) unless the session is `wetlab`, and refuses
`PATCH /api/failures/:category/:rowNumber` (marking recollection
resolved/pending) unless the session is `coordinator`. `manager` is read-only.
This replaces the old role-picker buttons, which were a client-side-only
convenience that anyone could bypass from the browser's dev tools.

Before first use, set a password for each role (one-time, run from the
project root):

```
deno task set-password wetlab <password>
deno task set-password coordinator <password>
deno task set-password manager <password>
```

This stores a salted hash of each password in `server/data/auth-config.json`
(never the plaintext) — re-run the same command to change a password later.
Sessions last 12 hours, then that browser needs to sign in again.

## Distributing as a standalone .exe

To let someone else run this on their own Windows PC without installing
Deno, compile it into a single executable:

```
powershell -ExecutionPolicy Bypass -File scripts\package.ps1
```

This requires `server\data\auth-config.json` to already exist (see "Logging
in" above — set all three role passwords first; the script refuses to run
otherwise). It produces one file, `dist\culture-failure-monitor.exe` — the
login page, dashboard, styles, and your Google OAuth client are all baked
into it via `deno compile --include` (see `deno.json`'s `build` task), so
there's nothing else to send alongside it.

Whatever is currently in `server\data\token.json` /
`failure-sheet-config.json` at build time also gets baked in as a one-time
seed: the first time the exe runs on another PC, it copies them into that
PC's own `%APPDATA%\CultureFailureMonitor\` (which needs to be writable, so
it can't live inside the exe itself) — meaning everyone ends up sharing this
same already-connected Google Sheet automatically, no separate Google
sign-in needed. Treat that exe like a password: whoever has it can read/write
this Google account's Sheets and Drive upload folder, from any machine.
If you'd rather each recipient connect their own Google account instead,
clear out `server\data\token.json` and `failure-sheet-config.json` (leave
the folder empty) before building — recipients will then see a "Connect now"
prompt on first use (they'd need to be added as a test user in the OAuth
consent screen in Google Cloud Console first).

Just double-clicking the exe is enough — it hides its own console window and
opens the recipient's browser straight to the login page automatically.

### Building the exe in the cloud instead (GitHub Actions)

`.github/workflows/build-exe.yml` can also compile it on GitHub's Windows
runners (Actions → Build Windows exe → Run workflow → download the
`culture-failure-monitor-windows` artifact once it finishes) — useful mainly
to confirm the code compiles cleanly. It won't produce a real distributable
exe on its own: `server\credentials\*` and `server\data\*` are gitignored,
so GitHub's checkout never has your actual Google OAuth client, token, or
login passwords, and the CI-built exe embeds those folders empty. Getting a
working exe out of GitHub Actions would mean adding those files as encrypted
repo secrets and writing them into place before the build step — a bigger
step (and one that puts your credentials into GitHub's secret store) that
this workflow doesn't attempt. For an exe that actually works, build it
locally with `scripts\package.ps1` instead, where those files already exist.

## Using the dashboard

- **Login** (see "Logging in" above): pick your role and enter its password. Wet Lab sees the "Report Failure" button on each panel; Coordinator gets a read-only view of both plus the ability to mark recollections resolved; Manager gets the read-only table/chart view.
- **Report Failure**: click the button on either panel.
  - Upload the **bill/report screenshot** (required) — the browser tries to auto-read details (Order ID, Sample ID, Patient Name, Test Methodology, Test Name) straight off the image using on-device OCR (no server/AI call). This is a head start, not gospel — **always check the fields it fills in before submitting**, especially on messy or unusual bill layouts.
  - Optionally attach any number of **reference images** (clotted blood, lysed blood, onco block, etc.) — these are just attached for documentation, not read for data.
  - Fill in Reason, Notes, and Reported By, then submit. This uploads the image(s) to the shared Drive folder, appends a row (with links to the images) to that category's tab in the live Google Sheet, and refreshes the list — no page reload needed.
- **Dashboard panels**: each side shows a Total and Today count (computed from your browser's local date) plus the full list of reported failures for that category, most recent first, with an **Images** column linking to the uploaded bill/reference photos. The list refreshes automatically about once a minute, or immediately after you submit a report.

## Auto-read (OCR) on the bill screenshot

The dashboard uses [Tesseract.js](https://github.com/naptha/tesseract.js) running entirely in the browser (loaded from a CDN) to read text off the uploaded bill screenshot and guess the Order ID/Sample ID/Patient Name/Test Methodology/Test Name fields via simple labeled-line matching (e.g. a line reading "Sample ID: 12345"). It requires internet access to load the OCR library the first time, and its accuracy depends heavily on image quality and how closely the bill's wording matches the expected labels — it will occasionally miss fields or misread text, which is why the fields stay editable and nothing is auto-submitted.

## Email notification (Google Apps Script)

The coordinator is emailed the details of each failure — patient name,
PIN/Sample ID, Order ID, test name, client/hospital, failure stage & type,
reason, notes, who reported it, and when — plus links to the uploaded bill and
reference images.

This is handled **outside the app** by a Google Apps Script bound to the
failure-log spreadsheet: [`apps-script/FailureNotifier.gs`](apps-script/FailureNotifier.gs).
It runs on a time-driven trigger and emails rows added since its last run.

Why a time trigger and not `onEdit`/`onChange`: the app appends rows via the
Sheets API, and API writes do **not** fire edit/change triggers — only edits by
a human or by Apps Script itself do. So the script polls for new rows instead.

The mail goes **to** `COORDINATOR_EMAIL`, **cc** `CC_EMAIL` (both set at the top
of the script). When the initial mail is sent, the script stamps the send time
into a **`MailSent`** column on that row (shown in the dashboard tables), so you
can see at a glance which failures were notified.

**72-hour reminder:** on each run the script also checks every row whose mail was
sent but whose recollection is still not `Resolved`. If more than
`REMINDER_HOURS` (default 72) have passed since the failure was reported, it
sends a reminder email and records the time in a `ReminderSent` tracking column
so the reminder fires only once. Marking the row `Resolved` in the dashboard
before the 72 hours are up cancels the reminder.

Setup (one time):

1. From the **"Culture Failure Monitor - Failure Log"** spreadsheet, open
   **Extensions → Apps Script** (this binds the script to that sheet).
2. Paste in the contents of `apps-script/FailureNotifier.gs`.
3. Set the recipient — either the `COORDINATOR_EMAIL` constant at the top, or a
   Script Property named `COORDINATOR_EMAIL` (the property wins if both are set).
4. Run `installTrigger()` once and authorize when prompted. This creates the
   5-minute trigger **and** baselines the current rows, so you are not emailed
   the existing backlog — only failures reported from then on.

## WhatsApp notification (on hold)

Reporting a failure is meant to also notify the coordinator on WhatsApp — this
mirrors the current manual workflow (wet lab tells her over Telegram, she asks
for a repeat sample and forwards it on). The actual send mechanism is on hold
pending an IT decision between a few options (click-to-send `wa.me` link,
CallMeBot, or the official WhatsApp Business API/Twilio).

Until that's decided, `server/services/notifyService.ts` is a stub: every
report logs a line to the server console (and a `NotifyStatus` of
`stub-logged` in the sheet row) but no message is actually sent. Once a
mechanism is chosen, only that one file needs to change — nothing else in the
app depends on how the message gets sent.

## Image privacy

Uploaded images (bill screenshots and reference images) are stored in a Drive
folder and shared as **"anyone with the link can view"** — this is what lets
the coordinator open them straight from a WhatsApp message without needing to
be signed into a specific Google account. Since these images can contain
patient names, treat the links the same as you'd treat the sheet itself:
don't post them anywhere outside the intended recipients.

## Sheet schema

Both tabs share the same header row:

```
Timestamp | OrderID | SampleID | PatientName | TestMethodology | TestName | Reason | Notes | ReportedBy | BillImageLink | ReferenceImageLinks
```
