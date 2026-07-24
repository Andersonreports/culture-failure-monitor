import "jsr:@std/dotenv/load";
import { join } from "node:path";
import type { AppConfig } from "./types.ts";
import { embeddedRoot, writableDataDir } from "./appRoot.ts";

// Read-only assets baked into the compiled exe via `deno compile --include`
// (or plain on-disk files in dev mode) — never written to at runtime.
const embeddedServerDir = join(embeddedRoot, "server");

const config: AppConfig = {
  port: Deno.env.get("PORT") ?? "3000",

  google: {
    credentialsPath: join(embeddedServerDir, "credentials", "google-oauth-client.json"),
    tokenPath: join(writableDataDir, "token.json"),
    sheetConfigPath: join(writableDataDir, "failure-sheet-config.json"),
    scopes: [
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/drive.file",
    ],
  },

  whatsapp: {
    coordinatorNumber: Deno.env.get("COORDINATOR_WHATSAPP_NUMBER") ?? "",
  },

  auth: {
    configPath: join(embeddedServerDir, "data", "auth-config.json"),
    cookieName: "cfm_session",
    sessionTtlMs: 12 * 60 * 60 * 1000,
  },
};

export default config;
