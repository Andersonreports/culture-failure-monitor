import express, { type Request, type Response } from "express";
import config from "../config.ts";
import { checkLogin, createSessionToken } from "../services/authService.ts";
import { getSessionRole } from "../middleware/requireAuth.ts";
import { ROLES, type Role } from "../types.ts";

const router = express.Router();

router.post("/login", (req: Request, res: Response) => {
  const { role, password } = (req.body ?? {}) as { role?: string; password?: string };
  if (!role || !password) {
    res.status(400).json({ error: "role and password are required" });
    return;
  }

  let ok: boolean;
  try {
    ok = checkLogin(role, password);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
    return;
  }
  if (!ok) {
    res.status(401).json({ error: "Incorrect role or password." });
    return;
  }

  const token = createSessionToken(role as Role);
  // No maxAge: a session cookie, cleared when the browser fully closes. The
  // token's own embedded expiry (config.auth.sessionTtlMs) is a server-side
  // backstop in case a browser restores cookies across restarts.
  res.cookie(config.auth.cookieName, token, {
    httpOnly: true,
    sameSite: "lax",
  });
  res.json({ ok: true, role });
});

router.post("/logout", (_req: Request, res: Response) => {
  res.clearCookie(config.auth.cookieName);
  res.json({ ok: true });
});

router.get("/session", (req: Request, res: Response) => {
  res.json({ role: getSessionRole(req), roles: ROLES });
});

export default router;
