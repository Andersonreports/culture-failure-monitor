import { isCompiledBinary } from "./appRoot.ts";

// Hides this process's own console window on Windows, so double-clicking the
// compiled .exe doesn't leave a terminal window up. Skipped under `deno run`
// (dev mode) so the terminal stays visible for logs while developing.
// Best-effort: any failure (wrong OS, FFI unavailable) just leaves the
// console visible instead of crashing the app.
export function hideConsoleWindow() {
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
