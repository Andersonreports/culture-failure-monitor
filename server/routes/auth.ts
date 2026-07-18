import express, { type Request, type Response } from "express";
import googleSheets from "../services/googleSheets.ts";

const router = express.Router();

router.get("/google", (_req: Request, res: Response) => {
  try {
    const url = googleSheets.getAuthUrl();
    res.redirect(url);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).send(message);
  }
});

router.get("/google/callback", async (req: Request, res: Response) => {
  try {
    const { code } = req.query;
    await googleSheets.handleOAuthCallback(code as string);
    res.redirect("/?googleConnected=1");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).send(message);
  }
});

router.get("/google/status", async (_req: Request, res: Response) => {
  const authenticated = googleSheets.isAuthenticated();
  const sheetUrl = authenticated ? await googleSheets.getSheetUrl() : null;
  res.json({ authenticated, sheetUrl });
});

export default router;
