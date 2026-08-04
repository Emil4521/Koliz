#!/usr/bin/env node
/**
 * Lance toute la suite de tests. Chaque fichier s'exécute dans son propre
 * processus : un plantage n'emporte pas les autres, et l'isolation évite
 * qu'un test contamine l'état global d'un autre.
 *
 *   npm test        ou      node tests/run.js
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const files = fs.readdirSync(__dirname)
  .filter((f) => f.endsWith(".test.js"))
  .sort();

let failed = 0;
for (const file of files) {
  const res = spawnSync(process.execPath, [path.join(__dirname, file)], {
    encoding: "utf8",
    cwd: path.join(__dirname, ".."),
  });
  if (res.status === 0) {
    process.stdout.write(res.stdout);
  } else {
    failed++;
    console.error(`\n=== ÉCHEC : ${file} ===`);
    process.stdout.write(res.stdout || "");
    process.stderr.write(res.stderr || "");
  }
}

console.log("");
if (failed) {
  console.error(`${failed}/${files.length} fichier(s) de tests en échec.`);
  process.exit(1);
}
console.log(`${files.length}/${files.length} fichiers de tests au vert.`);
