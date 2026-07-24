import { randomBytes, scryptSync } from "node:crypto";
import { dirname } from "node:path";
import { existsSync } from "jsr:@std/fs";
import config from "../config.ts";
import { ROLES } from "../types.ts";

const [role, password] = Deno.args;

if (!role || !password || !(ROLES as string[]).includes(role)) {
  console.error(`Usage: deno task set-password <${ROLES.join("|")}> <password>`);
  Deno.exit(1);
}

interface AuthConfigFile {
  sessionSecret: string;
  roles: Record<string, { salt: string; hash: string }>;
}

const path = config.auth.configPath;
const data: AuthConfigFile = existsSync(path)
  ? JSON.parse(Deno.readTextFileSync(path))
  : { sessionSecret: "", roles: {} };

if (!data.sessionSecret) data.sessionSecret = randomBytes(32).toString("hex");

const salt = randomBytes(16).toString("hex");
const hash = scryptSync(password, salt, 64).toString("hex");
data.roles[role] = { salt, hash };

Deno.mkdirSync(dirname(path), { recursive: true });
Deno.writeTextFileSync(path, JSON.stringify(data, null, 2));

console.log(`Password set for role "${role}".`);
