import { join } from "node:path";
import express from "express";
import config from "./config.ts";
import { embeddedRoot } from "./appRoot.ts";
import { ensureWritableDataSeeded } from "./bootstrapData.ts";
import failuresRoute from "./routes/failures.ts";
import authRoute from "./routes/auth.ts";
import sessionRoute from "./routes/session.ts";
import { requireApiAuth, requirePageAuth } from "./middleware/requireAuth.ts";
import { hideConsoleWindow } from "./hideConsole.ts";

hideConsoleWindow();
ensureWritableDataSeeded();

const app = express();
app.use(express.json());

app.use("/api/auth", sessionRoute);
app.use("/auth", authRoute);

app.get(["/", "/index.html"], requirePageAuth, (_req, res) => {
  res.sendFile(join(embeddedRoot, "server", "views", "dashboard.html"));
});

app.use("/api/failures", requireApiAuth, failuresRoute);

app.use(express.static(join(embeddedRoot, "public"), { index: false }));

function openBrowser(url: string) {
  try {
    new Deno.Command("cmd", { args: ["/c", "start", "", url] }).spawn();
  } catch {
    // Best-effort only — the console log below still tells the user the URL.
  }
}

app.listen(Number(config.port), () => {
  const url = `http://localhost:${config.port}`;
  console.log(`Culture Failure Monitor running at ${url}`);
  openBrowser(url);
});
