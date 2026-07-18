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
your behalf. No 2-Step Verification/App Password is needed for this — that
was only required by the old email-sending feature, which no longer exists.

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

## Using the dashboard

- **Role picker** (top right): switch between **Wet Lab** and **Coordinator**. This is a UI convenience only (stored in your browser, not real login) — Wet Lab sees the "Report Failure" button on each panel; Coordinator gets a read-only view of both.
- **Report Failure**: click the button on either panel.
  - Upload the **bill/report screenshot** (required) — the browser tries to auto-read details (Order ID, Sample ID, Patient Name, Test Methodology, Test Name) straight off the image using on-device OCR (no server/AI call). This is a head start, not gospel — **always check the fields it fills in before submitting**, especially on messy or unusual bill layouts.
  - Optionally attach any number of **reference images** (clotted blood, lysed blood, onco block, etc.) — these are just attached for documentation, not read for data.
  - Fill in Reason, Notes, and Reported By, then submit. This uploads the image(s) to the shared Drive folder, appends a row (with links to the images) to that category's tab in the live Google Sheet, and refreshes the list — no page reload needed.
- **Dashboard panels**: each side shows a Total and Today count (computed from your browser's local date) plus the full list of reported failures for that category, most recent first, with an **Images** column linking to the uploaded bill/reference photos. The list refreshes automatically about once a minute, or immediately after you submit a report.

## Auto-read (OCR) on the bill screenshot

The dashboard uses [Tesseract.js](https://github.com/naptha/tesseract.js) running entirely in the browser (loaded from a CDN) to read text off the uploaded bill screenshot and guess the Order ID/Sample ID/Patient Name/Test Methodology/Test Name fields via simple labeled-line matching (e.g. a line reading "Sample ID: 12345"). It requires internet access to load the OCR library the first time, and its accuracy depends heavily on image quality and how closely the bill's wording matches the expected labels — it will occasionally miss fields or misread text, which is why the fields stay editable and nothing is auto-submitted.

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
