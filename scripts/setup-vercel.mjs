/* Pushes the variables in .env up to Vercel, then redeploys.
   Run:  npm run setup:vercel

   The values are read from your local .env and piped straight to the Vercel
   CLI. This script never prints them and never writes them anywhere else.

   Prerequisites, both interactive, both yours to do:
     vercel login     authenticates the CLI with your Vercel account
     vercel link      connects this folder to the Vercel project
   The script checks for each and tells you if one is missing. */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const ENVS = ["production", "preview", "development"];

// Only these are sent. Anything else in .env stays local.
const SEND = ["GEMINI_API_KEY", "GEMINI_MODEL", "PRESENCE_PASSCODE",
              "ANTHROPIC_API_KEY", "ANTHROPIC_MODEL", "LLM_PROVIDER",
              "RATE_PER_HOUR", "GEMINI_THINKING_HEADROOM"];

const SECRET = /KEY|PASSCODE|TOKEN|SECRET/i;
const show = (k, v) => (SECRET.test(k) ? `<${v.length} chars, hidden>` : v);

function run(args, { input, quiet = true } = {}) {
  return spawnSync("vercel", args, {
    input,
    encoding: "utf8",
    shell: process.platform === "win32",
    stdio: quiet ? ["pipe", "pipe", "pipe"] : "inherit",
  });
}

// --- preflight ------------------------------------------------------------
if (!existsSync(".env")) {
  console.error("No .env here. Nothing to push."); process.exit(1);
}

const who = run(["whoami"]);
if (who.status !== 0) {
  console.error("Not logged in to Vercel.\n\n  Run this first:  vercel login\n");
  process.exit(1);
}
console.log(`Vercel account: ${(who.stdout || "").trim()}`);

if (!existsSync(".vercel/project.json")) {
  console.error("\nThis folder isn't linked to a Vercel project.\n\n  Run this first:  vercel link\n");
  process.exit(1);
}
const proj = JSON.parse(readFileSync(".vercel/project.json", "utf8"));
console.log(`Linked project:  ${proj.projectName || proj.projectId}\n`);

// --- parse .env -----------------------------------------------------------
const vars = new Map();
for (const raw of readFileSync(".env", "utf8").split(/\r?\n/)) {
  const line = raw.trim();
  if (!line || line.startsWith("#")) continue;
  const eq = line.indexOf("=");
  if (eq < 1) continue;
  const k = line.slice(0, eq).trim();
  let v = line.slice(eq + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  if (v && SEND.includes(k)) vars.set(k, v);
}

if (!vars.size) { console.error("No sendable variables set in .env."); process.exit(1); }

/* Pin the provider explicitly.

   pickProvider() checks ANTHROPIC_API_KEY before GEMINI_API_KEY, so a stale
   Anthropic key left in the Vercel project from earlier experimentation
   silently beats the Gemini key we are about to push -- and the local .env
   gives no hint that it is happening. Sending LLM_PROVIDER makes the choice
   explicit, so leftovers cannot change which provider answers. */
const chosen = vars.has("GEMINI_API_KEY") && !vars.has("ANTHROPIC_API_KEY") ? "gemini"
             : vars.has("ANTHROPIC_API_KEY") && !vars.has("GEMINI_API_KEY") ? "anthropic"
             : (vars.get("LLM_PROVIDER") || "").toLowerCase();

if (!chosen) {
  console.error("Both provider keys are set in .env but LLM_PROVIDER is not.");
  console.error("Set LLM_PROVIDER to \"gemini\" or \"anthropic\" and run again.");
  process.exit(1);
}
vars.set("LLM_PROVIDER", chosen);
console.log(`Provider: ${chosen} (pinned via LLM_PROVIDER)
`);

if (!vars.has("PRESENCE_PASSCODE")) {
  console.log("WARNING: PRESENCE_PASSCODE is not set. Your endpoint will be open to");
  console.log("         anyone who finds the URL, spending your API credit.\n");
}

console.log("Pushing to Vercel:");
for (const [k, v] of vars) console.log(`  ${k.padEnd(26)} ${show(k, v)}`);
console.log();

// --- push -----------------------------------------------------------------
let failed = 0;
for (const [k, v] of vars) {
  for (const env of ENVS) {
    // Adding over an existing variable errors, so clear it first. A missing
    // variable makes this a harmless no-op.
    run(["env", "rm", k, env, "--yes"]);
    const r = run(["env", "add", k, env], { input: v });
    if (r.status === 0) {
      console.log(`  OK    ${k} -> ${env}`);
    } else {
      // Vercel echoes the value back in some errors; strip it defensively.
      const err = (r.stderr || r.stdout || "").split("\n").filter(Boolean).pop() || "unknown error";
      console.log(`  FAIL  ${k} -> ${env}: ${err.replaceAll(v, "<hidden>")}`);
      failed++;
    }
  }
}

if (failed) {
  console.error(`\n${failed} variable(s) failed. Not deploying.`);
  process.exit(1);
}

// --- warn about the other provider's key still sitting in the project -----
const other = chosen === "gemini" ? "ANTHROPIC_API_KEY" : "GEMINI_API_KEY";
const listed = run(["env", "ls"]);
if (listed.status === 0 && new RegExp(`\b${other}\b`).test(listed.stdout || "")) {
  console.log(`
Note: ${other} is still set in this Vercel project.`);
  console.log(`      LLM_PROVIDER=${chosen} means it will not be used, but it is dead`);
  console.log(`      weight and a future reader will find it confusing. Remove it with:`);
  console.log(`        vercel env rm ${other} production --yes
`);
}

// --- deploy ---------------------------------------------------------------
// Variables only apply to builds started after they are set, so the redeploy
// is part of the job, not an afterthought.
console.log("\nAll variables set. Deploying to production...\n");
const dep = run(["--prod"], { quiet: false });
process.exit(dep.status ?? 0);
