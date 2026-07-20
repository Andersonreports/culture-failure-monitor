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

// Reads a tab's live header row (row 1) as an array of column names.
async function getSheetHeaders(
  sheets: ReturnType<typeof google.sheets>,
  spreadsheetId: string,
  tab: string,
): Promise<string[]> {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${tab}'!1:1`,
  });
  return (res.data.values && res.data.values[0] ? res.data.values[0] : []) as string[];
}

// Ensures every canonical field has a column, WITHOUT disturbing the existing
// layout. A brand-new (empty) tab gets the full header row; an existing tab
// keeps whatever column order it has (the user may have reordered/renamed to
// taste) and only gets genuinely-missing canonical fields appended at the end.
// Because all reads/writes match columns by NAME, existing data never shifts.
async function syncHeaders(sheets: ReturnType<typeof google.sheets>, spreadsheetId: string) {
  await Promise.all(
    Object.values(CATEGORIES).map(async (tab) => {
      const existing = await getSheetHeaders(sheets, spreadsheetId, tab);
      if (existing.length === 0) {
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `'${tab}'!A1`,
          valueInputOption: "RAW",
          requestBody: { values: [[...FAILURE_HEADERS]] },
        });
        return;
      }
      const missing = FAILURE_HEADERS.filter((h) => !existing.includes(h));
      if (missing.length) {
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `'${tab}'!A1`,
          valueInputOption: "RAW",
          requestBody: { values: [[...existing, ...missing]] },
        });
      }
    }),
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

// Appends a new failure. `values` is keyed by field name; the row is ordered
// to match the sheet's ACTUAL header row so each value lands in its column no
// matter how the columns are arranged.
async function appendFailureRow(
  category: FailureCategory,
  values: Record<string, string>,
): Promise<string> {
  const { sheets, spreadsheetId } = await ensureSpreadsheet();
  const tab = tabFor(category);
  const headers = await getSheetHeaders(sheets, spreadsheetId, tab);
  const order = headers.length ? headers : [...FAILURE_HEADERS];
  const row = order.map((name) => values[name] ?? "");
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `'${tab}'!A1`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [row] },
  });
  return spreadsheetId;
}

async function listFailures(category: FailureCategory): Promise<FailureRow[]> {
  const { sheets, spreadsheetId } = await ensureSpreadsheet();
  const tab = tabFor(category);
  // Read header + data together and map each cell by its column NAME, so
  // manually reordered/renamed columns still line up with the right field.
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${tab}'!A1:ZZ`,
  });
  const rows = res.data.values || [];
  const headers = (rows[0] || []) as string[];
  const knownHeaders = FAILURE_HEADERS as readonly string[];
  return rows.slice(1).map((r, i) => {
    const entry: Record<string, string | number> = { rowNumber: i + 2 };
    FAILURE_HEADERS.forEach((h) => {
      entry[h] = "";
    });
    headers.forEach((name, j) => {
      if (knownHeaders.includes(name)) entry[name] = r[j] || "";
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
  const tab = tabFor(category);
  // Resolve the column from the sheet's live header row (falling back to the
  // canonical order) so we write to the right cell even if columns moved.
  const headers = await getSheetHeaders(sheets, spreadsheetId, tab);
  let columnIndex = headers.indexOf(header);
  if (columnIndex === -1) columnIndex = FAILURE_HEADERS.indexOf(header);
  if (columnIndex === -1) throw new Error(`Unknown failure column: ${header}`);
  const col = columnLetter(columnIndex + 1);
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${tab}'!${col}${rowNumber}`,
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
