import "jsr:@std/dotenv/load";
import { join } from "node:path";
import type { AppConfig } from "./types.ts";

const dir = import.meta.dirname!;

const config: AppConfig = {
  port: Deno.env.get("PORT") ?? "3000",

  google: {
    credentialsPath: join(dir, "credentials", "google-oauth-client.json"),
    tokenPath: join(dir, "data", "token.json"),
    sheetConfigPath: join(dir, "data", "failure-sheet-config.json"),
    scopes: [
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/drive.file",
    ],
  },

  whatsapp: {
    coordinatorNumber: Deno.env.get("COORDINATOR_WHATSAPP_NUMBER") ?? "",
  },
};

export default config;
