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

// Same rules as scripts/sanitize.py: never publish registration, confirmation or payment details
const DROP_COLS = { "racelist.csv": ["Registration / Confirmation #", "Cost", "Notes"] };
const SENSITIVE = /\bref\s+[A-Z]{2,}\d{5,}|\bCTG\d+|\bconfirmation\s*(#|no|number)|\$\s?\d|\bpaid\b|\bbib\s*#?\s*\d/i;
function parseCsv(t) { const rows = []; let row = [], f = "", q = false; for (let i = 0; i < t.length; i++) { const c = t[i]; if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; } else if (c === '"') q = true; else if (c === ",") { row.push(f); f = ""; } else if (c === "\n" || c === "\r") { if (c === "\r" && t[i + 1] === "\n") i++; row.push(f); rows.push(row); row = []; f = ""; } else f += c; } if (f || row.length) { row.push(f); rows.push(row); } return rows; }
const toCsv = rows => rows.map(r => r.map(c => /[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c).join(",")).join("\n") + "\n";
function sanitize(file, text) {
  const name = file.split("/").pop();
  let rows = parseCsv(text);
  if (DROP_COLS[name]) {
    const h = rows.findIndex(r => r[0] === "Date");
    const drop = new Set(rows[h].map((c, i) => DROP_COLS[name].includes(c) ? i : -1).filter(i => i >= 0));
    rows = rows.map((r, k) => k >= h ? r.filter((_, i) => !drop.has(i)) : r);
  }
  if (name === "racelist.csv") { const h = rows.findIndex(r => r[0] === "Date"), st = rows[h].indexOf("Status"); rows = rows.filter((r, k) => k <= h || !/sold out/i.test(r[st] || "")); }
  if (name === "summary.csv") rows = rows.filter(r => !r.some(c => SENSITIVE.test(c)));
  rows = rows.map(r => r.map(c => c.replace(/\(?\bref\s+[A-Z]{2,}\d{5,}\)?/gi, "").replace(/\$\s?\d[\d,]*(\.\d+)?/g, "")));
  return toCsv(rows);
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
    writeFileSync(join(root, tab.file), sanitize(tab.file, text.replace(/\r\n/g, "\n")));
    console.log(`✓ ${tab.name} → ${tab.file} (${text.split("\n").length} lines)`);
    ok++;
  } catch (e) {
    console.error(`✗ ${tab.name}: ${e.message} (kept previous snapshot)`);
    failed++;
  }
}
console.log(`${ok} updated, ${failed} failed`);
if (failed && !ok) process.exit(1);
