import { join } from "node:path";
import { existsSync } from "jsr:@std/fs";
import { embeddedRoot, isCompiledBinary, writableDataDir } from "./appRoot.ts";

// On first run of the compiled exe, copy any pre-authorized token.json /
// failure-sheet-config.json that was embedded at build time into the
// writable %APPDATA% folder, so every recipient starts already connected to
// the same shared Google Sheet. If the build didn't embed one (a "connect
// your own account" build), there's nothing to copy and the normal
// "Connect now" flow just writes fresh files there instead.
export function ensureWritableDataSeeded() {
  if (!isCompiledBinary()) return;

  Deno.mkdirSync(writableDataDir, { recursive: true });
  for (const file of ["token.json", "failure-sheet-config.json"]) {
    const dest = join(writableDataDir, file);
    if (existsSync(dest)) continue;
    const seed = join(embeddedRoot, "server", "data", file);
    if (existsSync(seed)) {
      Deno.copyFileSync(seed, dest);
    }
  }
}
