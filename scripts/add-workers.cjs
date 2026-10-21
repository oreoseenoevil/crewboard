#!/usr/bin/env node
// Adds or updates workers in the Workers pane's status file, from any session:
//   node add-workers.cjs <entries.json> [cloud|local|tasks]
// entries.json holds an array of entries ({ id, label, model, effort, role, startedAt, session? }).
// The status file is ~/.claude/crewboard/workers.json unless CREWBOARD_FILE names another.
const fs = require("fs");
const os = require("os");
const path = require("path");

const [entriesPath, kind = "cloud"] = process.argv.slice(2);
if (!entriesPath || !["cloud", "local", "tasks"].includes(kind)) {
  console.error("usage: node add-workers.cjs <entries.json> [cloud|local|tasks]");
  process.exit(1);
}
const file = process.env.CREWBOARD_FILE || path.join(os.homedir(), ".claude", "crewboard", "workers.json");
const read = (p) => JSON.parse(fs.readFileSync(p, "utf8").replace(/^﻿/, ""));
const list = fs.existsSync(file) ? read(file) : { local: [], cloud: [], tasks: [] };
list[kind] = list[kind] || [];
for (const entry of read(entriesPath)) {
  const at = list[kind].findIndex((existing) => existing.id === entry.id);
  if (at >= 0) list[kind][at] = { ...list[kind][at], ...entry };
  else list[kind].push({ startedAt: Date.now(), ...entry });
}
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify(list, null, 2));
console.log(`${kind}: ${list[kind].length} entries in ${file}`);
