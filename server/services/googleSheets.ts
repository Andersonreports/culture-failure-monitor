import { existsSync } from "jsr:@std/fs";
import { dirname } from "node:path";
import { google } from "googleapis";
import config from "../config.ts";
import { FAILURE_HEADERS, type FailureCategory, type FailureRow } from "../types.ts";

type OAuth2Client = InstanceType<typeof google.auth.OAuth2>;

const CATEGORIES: Record<FailureCategory, string> = {
  before: "Before Processing Failure",
  after: "After Processing Failure",
};

function loadCredentials() {
  if (!existsSync(config.google.credentialsPath)) {
    throw new Error(
      `Missing Google OAuth client file at ${config.google.credentialsPath}. ` +
        'Download it from Google Cloud Console (OAuth client, type "Desktop app") and save it there. See README.md.',
    );
  }
  return JSON.parse(Deno.readTextFileSync(config.google.credentialsPath));
}

function getOAuth2Client(): OAuth2Client {
  const creds = loadCredentials();
  const clientInfo = creds.installed || creds.web;
  const redirectUri = `http://localhost:${config.port}/auth/google/callback`;
  return new google.auth.OAuth2(clientInfo.client_id, clientInfo.client_secret, redirectUri);
}

function getAuthUrl(): string {
  const oAuth2Client = getOAuth2Client();
  return oAuth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: config.google.scopes,
  });
}

async function handleOAuthCallback(code: string) {
  const oAuth2Client = getOAuth2Client();
  const { tokens } = await oAuth2Client.getToken(code);
  Deno.mkdirSync(dirname(config.google.tokenPath), { recursive: true });
  Deno.writeTextFileSync(config.google.tokenPath, JSON.stringify(tokens, null, 2));
  return tokens;
}

function isAuthenticated(): boolean {
  return existsSync(config.google.tokenPath);
}

async function getAuthedClient(): Promise<OAuth2Client> {
  if (!isAuthenticated()) {
    throw new Error("Not authenticated with Google. Visit /auth/google to connect.");
  }
  const oAuth2Client = getOAuth2Client();
  const tokens = JSON.parse(Deno.readTextFileSync(config.google.tokenPath));
  oAuth2Client.setCredentials(tokens);
  oAuth2Client.on("tokens", (newTokens) => {
    const merged = { ...tokens, ...newTokens };
    Deno.writeTextFileSync(config.google.tokenPath, JSON.stringify(merged, null, 2));
  });
  return oAuth2Client;
}

interface SheetsHandle {
  sheets: ReturnType<typeof google.sheets>;
  spreadsheetId: string;
  auth: OAuth2Client;
}

// Concurrent callers (e.g. GET /api/failures reading both tabs at once) must
// never race to create two separate spreadsheets. Memoize the in-flight
// creation so every caller during a single server run awaits the same result.
let ensureSpreadsheetPromise: Promise<SheetsHandle> | null = null;

// Writes the current header row to both tabs. Safe to call every time a
// spreadsheet is created OR reused - it's how an already-existing sheet
// (created before new columns like BillImageLink were added) picks up the
// new columns without needing to be recreated. Only appends columns at the
// end, so existing row data never shifts.
async function syncHeaders(sheets: ReturnType<typeof google.sheets>, spreadsheetId: string) {
  await Promise.all(
    Object.values(CATEGORIES).map((tab) =>
      sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${tab}'!A1`,
        valueInputOption: "RAW",
        requestBody: { values: [[...FAILURE_HEADERS]] },
      })
    ),
  );
}

async function createSpreadsheet(sheets: ReturnType<typeof google.sheets>): Promise<string> {
  const createRes = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title: "Culture Failure Monitor - Failure Log" },
      sheets: [
        { properties: { title: CATEGORIES.before } },
        { properties: { title: CATEGORIES.after } },
      ],
    },
  });
  const spreadsheetId = createRes.data.spreadsheetId!;

  Deno.mkdirSync(dirname(config.google.sheetConfigPath), { recursive: true });
  Deno.writeTextFileSync(config.google.sheetConfigPath, JSON.stringify({ spreadsheetId }, null, 2));

  return spreadsheetId;
}

async function ensureSpreadsheet(): Promise<SheetsHandle> {
  if (!ensureSpreadsheetPromise) {
    ensureSpreadsheetPromise = (async () => {
      const auth = await getAuthedClient();
      const sheets = google.sheets({ version: "v4", auth });

      let spreadsheetId: string;
      if (existsSync(config.google.sheetConfigPath)) {
        ({ spreadsheetId } = JSON.parse(Deno.readTextFileSync(config.google.sheetConfigPath)));
      } else {
        spreadsheetId = await createSpreadsheet(sheets);
      }

      await syncHeaders(sheets, spreadsheetId);
      return { sheets, spreadsheetId, auth };
    })().catch((err) => {
      // Don't cache a failed attempt (e.g. not authenticated yet) - let the next call retry.
      ensureSpreadsheetPromise = null;
      throw err;
    });
  }
  return ensureSpreadsheetPromise;
}

function tabFor(category: FailureCategory): string {
  const tab = CATEGORIES[category];
  if (!tab) throw new Error(`Unknown failure category: ${category}`);
  return tab;
}

async function appendFailureRow(category: FailureCategory, row: unknown[]): Promise<string> {
  const { sheets, spreadsheetId } = await ensureSpreadsheet();
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `'${tabFor(category)}'!A1`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [row] },
  });
  return spreadsheetId;
}

async function listFailures(category: FailureCategory): Promise<FailureRow[]> {
  const { sheets, spreadsheetId } = await ensureSpreadsheet();
  // Generous column bound so adding more headers later doesn't silently
  // truncate rows again (this previously stopped at M and clipped 2 columns).
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${tabFor(category)}'!A2:ZZ`,
  });
  const rows = res.data.values || [];
  return rows.map((r, i) => {
    const entry: Record<string, string | number> = { rowNumber: i + 2 };
    FAILURE_HEADERS.forEach((header, j) => {
      entry[header] = r[j] || "";
    });
    return entry as unknown as FailureRow;
  });
}

// 1-based column index -> spreadsheet column letter(s) (1 -> A, 27 -> AA, ...).
function columnLetter(oneBasedIndex: number): string {
  let n = oneBasedIndex;
  let letters = "";
  while (n > 0) {
    const remainder = (n - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

async function updateFailureField(
  category: FailureCategory,
  rowNumber: number,
  header: (typeof FAILURE_HEADERS)[number],
  value: string,
): Promise<void> {
  const { sheets, spreadsheetId } = await ensureSpreadsheet();
  const columnIndex = FAILURE_HEADERS.indexOf(header);
  if (columnIndex === -1) throw new Error(`Unknown failure column: ${header}`);
  const col = columnLetter(columnIndex + 1);
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${tabFor(category)}'!${col}${rowNumber}`,
    valueInputOption: "RAW",
    requestBody: { values: [[value]] },
  });
}

async function getSheetUrl(): Promise<string | null> {
  if (!isAuthenticated()) return null;
  const { spreadsheetId } = await ensureSpreadsheet();
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
}

// Shared OAuth2Client for anything else that needs to call a Google API on
// this user's behalf (e.g. Drive uploads in routes/failures.ts) - reuses the
// same memoized session instead of re-authenticating separately.
async function getAuthClient(): Promise<OAuth2Client> {
  const { auth } = await ensureSpreadsheet();
  return auth;
}

export default {
  getAuthUrl,
  handleOAuthCallback,
  isAuthenticated,
  appendFailureRow,
  listFailures,
  updateFailureField,
  getSheetUrl,
  getAuthClient,
  CATEGORIES,
};
