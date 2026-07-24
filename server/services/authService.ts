import { createHmac, scryptSync, timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";
import { existsSync } from "jsr:@std/fs";
import config from "../config.ts";
import { ROLES, type Role } from "../types.ts";

interface RoleAuth {
  salt: string;
  hash: string;
}

interface AuthConfigFile {
  sessionSecret: string;
  roles: Partial<Record<Role, RoleAuth>>;
}

function isRole(value: string): value is Role {
  return (ROLES as string[]).includes(value);
}

function loadAuthConfig(): AuthConfigFile {
  if (!existsSync(config.auth.configPath)) {
    throw new Error(
      "No login passwords have been set up yet. Run: deno task set-password <wetlab|coordinator|manager> <password>",
    );
  }
  return JSON.parse(Deno.readTextFileSync(config.auth.configPath));
}

function verifyPassword(password: string, roleAuth: RoleAuth): boolean {
  const candidate = scryptSync(password, roleAuth.salt, 64);
  const expected = Buffer.from(roleAuth.hash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export function checkLogin(role: string, password: string): boolean {
  if (!isRole(role)) return false;
  const roleAuth = loadAuthConfig().roles[role];
  if (!roleAuth) return false;
  return verifyPassword(password, roleAuth);
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createSessionToken(role: Role): string {
  const authConfig = loadAuthConfig();
  const exp = Date.now() + config.auth.sessionTtlMs;
  const payload = Buffer.from(JSON.stringify({ role, exp })).toString("base64url");
  const sig = sign(payload, authConfig.sessionSecret);
  return `${payload}.${sig}`;
}

export function verifySessionToken(token: string | undefined): Role | null {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;

  let authConfig: AuthConfigFile;
  try {
    authConfig = loadAuthConfig();
  } catch {
    return null;
  }

  const expectedSig = Buffer.from(sign(payload, authConfig.sessionSecret));
  const actualSig = Buffer.from(sig);
  if (expectedSig.length !== actualSig.length || !timingSafeEqual(expectedSig, actualSig)) return null;

  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof data.exp !== "number" || Date.now() > data.exp) return null;
    if (typeof data.role !== "string" || !isRole(data.role)) return null;
    return data.role;
  } catch {
    return null;
  }
}
