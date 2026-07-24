import type { NextFunction, Request, Response } from "express";
import config from "../config.ts";
import { verifySessionToken } from "../services/authService.ts";
import type { Role } from "../types.ts";

function getTokenFromRequest(req: Request): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    if (key === config.auth.cookieName) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return undefined;
}

export function getSessionRole(req: Request): Role | null {
  return verifySessionToken(getTokenFromRequest(req));
}

export function requirePageAuth(req: Request, res: Response, next: NextFunction) {
  if (getSessionRole(req)) {
    next();
    return;
  }
  res.redirect("/login.html");
}

export function requireApiAuth(req: Request, res: Response, next: NextFunction) {
  const role = getSessionRole(req);
  if (!role) {
    res.status(401).json({ error: "Not logged in." });
    return;
  }
  (req as Request & { role: Role }).role = role;
  next();
}

export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const role = (req as Request & { role?: Role }).role ?? getSessionRole(req);
    if (!role || !roles.includes(role)) {
      res.status(403).json({ error: `Only ${roles.join(" or ")} can do this.` });
      return;
    }
    next();
  };
}
