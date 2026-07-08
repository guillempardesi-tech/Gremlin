#!/usr/bin/env node
/**
 * Bundle the app into a single self-contained HTML file.
 *
 *   node tools/build-standalone.mjs [artifactOutPath]
 *
 * Always writes ./swinglab-standalone.html — the whole app (CSS + all JS
 * modules) inlined into one file you can open by double-clicking, no server
 * needed. Chrome treats file:// as a secure context, so the camera works;
 * the MediaPipe model still streams from its CDN on first use.
 *
 * With an argument, additionally writes an "artifact" variant to that path:
 * the same bundle as page content only (no <!DOCTYPE>/<html>/<head>/<body>
 * wrapper), for publishing environments that supply their own document shell.
 */

import { readFile, writeFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const css = await readFile(join(ROOT, 'css/style.css'), 'utf8');

// Dependency order matters: later files reference earlier declarations.
const ORDER = ['clubs', 'physics', 'storage', 'swing', 'advice', 'trajectory', 'main'];
let bundle = '';
for (const name of ORDER) {
  let src = await readFile(join(ROOT, `js/${name}.js`), 'utf8');
  src = src
    .replace(/^import .*$/gm, '')                    // local imports → same scope
    .replace(/^export \{[^}]*\};?\s*$/gm, '')        // bare export lists
    .replace(/^export (?=const|function|class|let|var)/gm, '');
  bundle += `\n/* ── js/${name}.js ───────────────────────────────────────── */\n${src}`;
}

// Emit a CLASSIC (non-module) script wrapped in an IIFE — never a
// `type="module"` script. Claude Artifacts and other embeds run inside a
// sandboxed iframe with an OPAQUE origin, where inline ES module scripts
// silently refuse to execute (clubs never populate, buttons do nothing).
// Classic scripts run fine there, and the bundle is already a flat
// concatenation with imports/exports stripped, so IIFE scoping is all it needs.
let html = await readFile(join(ROOT, 'index.html'), 'utf8');
html = html
  .replace(/[ \t]*<link rel="stylesheet"[^>]*\/>\s*\n/, `  <style>\n${css}\n  </style>\n`)
  .replace(
    /[ \t]*<script type="module" src="js\/main\.js"><\/script>/,
    `  <script>\n(function () {\n${bundle}\n})();\n  </script>`
  );

await writeFile(join(ROOT, 'swinglab-standalone.html'), html);
console.log(`wrote swinglab-standalone.html (${(html.length / 1024).toFixed(0)} KB)`);

const artifactOut = process.argv[2];
if (artifactOut) {
  const artifact = html
    .replace(/^<!DOCTYPE html>\s*/i, '')
    .replace(/<html[^>]*>\s*/i, '')
    .replace(/<\/html>\s*$/i, '')
    .replace(/<head>\s*/i, '')
    .replace(/<\/head>\s*/i, '')
    .replace(/<body>\s*/i, '')
    .replace(/<\/body>\s*/i, '')
    .replace(/[ \t]*<meta charset[^>]*\/?>\s*\n/i, '')
    .replace(/[ \t]*<meta name="viewport"[^>]*\/?>\s*\n/i, '')
    .replace(/[ \t]*<link rel="icon"[^>]*\/>\s*\n/i, '');
  await writeFile(artifactOut, artifact);
  console.log(`wrote ${artifactOut} (${(artifact.length / 1024).toFixed(0)} KB)`);
}
