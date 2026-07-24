import { dirname, join } from "node:path";

// `deno compile` extracts the bundled source into a synthetic temp directory at
// runtime, so `import.meta.dirname` no longer points at a real folder on disk —
// it points into that virtual snapshot instead. Files pulled in via
// `deno compile --include` live in that same snapshot, at the same relative
// path they had at compile time, so `embeddedRoot` (computed the same way in
// both `deno run` and compiled contexts) is the right base for reading them.
export function isCompiledBinary(): boolean {
  const exeName = Deno.execPath().split(/[\\/]/).pop()?.toLowerCase() ?? "";
  return exeName !== "deno" && exeName !== "deno.exe";
}

export const embeddedRoot: string = dirname(import.meta.dirname!);

// Google token / sheet-config get written at runtime (OAuth connect, token
// refresh), so they can't live in the read-only embedded snapshot. When
// compiled, keep them in %APPDATA% instead — invisible next to the .exe, and
// writable. In dev mode, keep using the plain on-disk server/data folder.
function computeWritableDataDir(): string {
  if (isCompiledBinary()) {
    const appData = Deno.env.get("APPDATA");
    if (appData) return join(appData, "CultureFailureMonitor");
  }
  return join(embeddedRoot, "server", "data");
}

export const writableDataDir: string = computeWritableDataDir();
