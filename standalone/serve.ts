// Standalone launcher for the Culture Failure Dashboard.
//
// The dashboard itself (culture-failure.html) is fully client-side and talks
// straight to the Google Apps Script web app — it needs no backend of its own.
// This tiny static server exists only so the page can be shipped as a
// double-clickable .exe: it serves this folder over http://localhost, opens the
// browser, and (when compiled) hides its own console window. Serving over http
// (rather than file://) keeps the cross-origin fetch to Apps Script reliable.
//
// Dev:    deno task start-standalone
// Build:  deno task build-standalone   (or scripts/package-standalone.ps1)

import { extname, join } from "node:path";

// `deno compile` extracts the bundled source + `--include`d files into a
// synthetic temp dir at runtime, preserving their relative paths. This module
// sits in `standalone/`, so its own dirname is the folder to serve in both
// `deno run` and compiled contexts.
const ROOT = import.meta.dirname!;
const INDEX = "culture-failure.html";
const PORT = Number(Deno.env.get("PORT") ?? "3100");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function isCompiledBinary(): boolean {
  const exe = Deno.execPath().split(/[\\/]/).pop()?.toLowerCase() ?? "";
  return exe !== "deno" && exe !== "deno.exe";
}

// Hide this process's console window on Windows so the compiled .exe doesn't
// leave a terminal up. Best-effort; skipped under `deno run` so dev logs show.
function hideConsoleWindow() {
  if (Deno.build.os !== "windows" || !isCompiledBinary()) return;
  try {
    const kernel32 = Deno.dlopen("kernel32.dll", {
      GetConsoleWindow: { parameters: [], result: "pointer" },
    });
    const user32 = Deno.dlopen("user32.dll", {
      ShowWindow: { parameters: ["pointer", "i32"], result: "i32" },
    });
    const hwnd = kernel32.symbols.GetConsoleWindow();
    if (hwnd) user32.symbols.ShowWindow(hwnd, 0); // SW_HIDE
  } catch {
    // Ignore — worst case the console window just stays visible.
  }
}

function toUtf16Nul(s: string): Uint8Array {
  const buf = new Uint8Array((s.length + 1) * 2);
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    buf[i * 2] = code & 0xff;
    buf[i * 2 + 1] = (code >> 8) & 0xff;
  }
  return buf;
}

// Native Windows message box for startup failures — the compiled exe has no
// visible console, so an error (e.g. port in use) would otherwise be silent.
function showFatalError(message: string) {
  if (Deno.build.os !== "windows" || !isCompiledBinary()) {
    console.error(message);
    return;
  }
  try {
    const user32 = Deno.dlopen("user32.dll", {
      MessageBoxW: { parameters: ["pointer", "buffer", "buffer", "u32"], result: "i32" },
    });
    user32.symbols.MessageBoxW(null, toUtf16Nul(message), toUtf16Nul("Culture Failure Dashboard"), 0x10);
  } catch {
    // Nothing more we can do.
  }
}

function openBrowser(url: string) {
  try {
    const cmd = Deno.build.os === "windows"
      ? new Deno.Command("cmd", { args: ["/c", "start", "", url] })
      : Deno.build.os === "darwin"
      ? new Deno.Command("open", { args: [url] })
      : new Deno.Command("xdg-open", { args: [url] });
    cmd.spawn();
  } catch {
    // Best-effort — the console log still prints the URL under `deno run`.
  }
}

async function handler(req: Request): Promise<Response> {
  const { pathname } = new URL(req.url);
  let rel = decodeURIComponent(pathname);
  if (rel === "/" || rel === "") rel = "/" + INDEX;

  // Block path traversal — only ever read files under ROOT.
  const safe = rel.replace(/\\/g, "/").split("/").filter((p) => p && p !== ".." && p !== ".").join("/");
  const filePath = join(ROOT, safe);

  try {
    const data = await Deno.readFile(filePath);
    const ext = extname(filePath).toLowerCase();
    return new Response(data, {
      headers: {
        "content-type": MIME[ext] ?? "application/octet-stream",
        "cache-control": "no-store",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

hideConsoleWindow();

try {
  Deno.serve({
    port: PORT,
    hostname: "127.0.0.1",
    onListen: ({ port }) => {
      const url = `http://localhost:${port}/${INDEX}`;
      console.log(`Culture Failure Dashboard running at ${url}`);
      openBrowser(url);
    },
  }, handler);
} catch (err) {
  const msg = err instanceof Deno.errors.AddrInUse
    ? `Culture Failure Dashboard is already running (port ${PORT} is in use).\n\n` +
      `Check Task Manager for an existing process, or set a different PORT.`
    : `Culture Failure Dashboard failed to start:\n${err instanceof Error ? err.message : String(err)}`;
  showFatalError(msg);
  Deno.exit(1);
}
