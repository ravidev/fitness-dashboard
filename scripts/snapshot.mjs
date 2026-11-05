// Downloads every configured tab from the published Google Sheet into /data.
// Run locally with `node scripts/snapshot.mjs`, or let the GitHub Action run it daily.
// Each run that changes data becomes a commit, so git history keeps every version.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
globalThis.window = {};
new Function(readFileSync(join(root, "js/config.js"), "utf8"))();
const CFG = window.FD_CONFIG;

if (!CFG.publishedId) {
  console.log("publishedId not set in js/config.js — nothing to snapshot.");
  process.exit(0);
}

let ok = 0, failed = 0;
for (const [key, tab] of Object.entries(CFG.tabs)) {
  if (tab.gid == null) { console.log(`skip ${tab.name} (no gid)`); continue; }
  const url = `https://docs.google.com/spreadsheets/d/e/${CFG.publishedId}/pub?gid=${tab.gid}&single=true&output=csv`;
  try {
    const res = await fetch(url);
    const text = await res.text();
    if (!res.ok || /^\s*<(!doctype|html)/i.test(text)) throw new Error(`HTTP ${res.status}`);
    // Guard against wiping a snapshot with an empty sheet response
    if (text.trim().split("\n").length < 2) throw new Error("response looks empty");
    writeFileSync(join(root, tab.file), text.replace(/\r\n/g, "\n"));
    console.log(`✓ ${tab.name} → ${tab.file} (${text.split("\n").length} lines)`);
    ok++;
  } catch (e) {
    console.error(`✗ ${tab.name}: ${e.message} (kept previous snapshot)`);
    failed++;
  }
}
console.log(`${ok} updated, ${failed} failed`);
if (failed && !ok) process.exit(1);
