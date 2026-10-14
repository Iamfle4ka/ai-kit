#!/usr/bin/env node
// media-inventory.mjs — which media each page references, and which files under public/ no page references.
//
//   node <plugin>/scripts/media-inventory.mjs [--root <dir>] [--json] [--dates] [page-or-dir ...]
//
// Reads src/content/docs/**/*.md|mdx for ![alt](/path), <img src>, <video src|poster>, <source src>,
// and `image:`/`poster:` frontmatter values that start with "/". Media paths are site-absolute
// (/section/file.png → public/section/file.png). References are always collected site-wide so the
// `unreferenced` list is right even when only one page is selected. --dates adds each media file's
// last commit date (one git call per file, slow on a whole site). Read-only.
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const args = process.argv.slice(2);
const flagVal = (n) => { const i = args.indexOf(n); return i >= 0 ? (args[i + 1] ?? null) : null; };
const has = (n) => args.includes(n);
const ROOT = path.resolve(flagVal('--root') ?? process.cwd());
const DOCS = path.join(ROOT, 'src', 'content', 'docs');
const PUBLIC = path.join(ROOT, 'public');
const JSON_OUT = has('--json'), DATES = has('--dates');
if (!fs.existsSync(DOCS)) { console.error(`✗ src/content/docs not found under ${ROOT}`); process.exit(2); }

const MEDIA_EXT = /\.(png|jpe?g|gif|webp|svg|avif|mp4|webm|mov)$/i;
const isPage = (f) => /\.(md|mdx)$/.test(f);
const walk = (d, keep, out = []) => { if (!fs.existsSync(d)) return out; for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p, keep, out); else if (keep(p)) out.push(p); } return out; };

const selected = [];
for (let i = 0; i < args.length; i++) { const a = args[i]; if (a.startsWith('--')) { if (a === '--root') i++; continue; } const p = path.resolve(ROOT, a); if (fs.existsSync(p) && fs.statSync(p).isDirectory()) selected.push(...walk(p, isPage)); else selected.push(p); }
const allPages = walk(DOCS, isPage).sort();
const wanted = new Set((selected.length ? selected : allPages).map((p) => path.resolve(p)));

const refsOf = (text) => {
  const out = [];
  const push = (p, kind, alt) => { if (p && p.startsWith('/') && !p.startsWith('//')) out.push({ path: p.split(/[?#]/)[0], kind, alt: alt ?? null }); };
  for (const m of text.matchAll(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) push(m[2], 'image', m[1]);
  for (const m of text.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/g)) { const alt = m[0].match(/\balt=["']([^"']*)["']/); push(m[1], 'image', alt?.[1]); }
  for (const m of text.matchAll(/<(video|source)\b[^>]*>/g)) {
    const tag = m[0]; const src = tag.match(/\bsrc=["']([^"']+)["']/); const poster = tag.match(/\bposter=["']([^"']+)["']/); const label = tag.match(/\baria-label=["']([^"']*)["']/);
    push(src?.[1], 'video', label?.[1]); push(poster?.[1], 'poster', label?.[1]);
  }
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (fm) for (const m of fm[1].matchAll(/^(image|poster|cover):\s*['"]?(\/[^'"\s]+)['"]?/gm)) push(m[2], m[1] === 'poster' ? 'poster' : 'image');
  return out;
};
const lastCommit = (rel) => { try { return execSync(`git log -1 --format=%cs -- "${rel}"`, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null; } catch { return null; } };

const referenced = new Map(); // public-relative path → [pages]
const pages = [];
for (const abs of allPages) {
  const rel = path.relative(ROOT, abs);
  const media = [];
  for (const r of refsOf(fs.readFileSync(abs, 'utf8'))) {
    const pub = r.path.replace(/^\//, '');
    if (!referenced.has(pub)) referenced.set(pub, []);
    referenced.get(pub).push(rel);
    const file = path.join(PUBLIC, pub);
    media.push({ ...r, exists: fs.existsSync(file), ...(DATES && fs.existsSync(file) ? { lastCommit: lastCommit('public/' + pub) } : {}) });
  }
  if (wanted.has(abs)) pages.push({ page: rel, media });
}
for (const p of pages) for (const m of p.media) m.referencedBy = referenced.get(m.path.replace(/^\//, '')) ?? [];
const unreferenced = walk(PUBLIC, (f) => MEDIA_EXT.test(f)).map((f) => path.relative(PUBLIC, f)).filter((f) => !referenced.has(f)).sort();

const result = { root: ROOT, pages, unreferenced, totals: { pages: pages.length, media: pages.reduce((n, p) => n + p.media.length, 0), missing: pages.reduce((n, p) => n + p.media.filter((m) => !m.exists).length, 0), unreferenced: unreferenced.length } };
if (JSON_OUT) { console.log(JSON.stringify(result, null, 2)); process.exitCode = result.totals.missing ? 1 : 0; }
else {
for (const p of pages) {
  console.log(`\n${p.page}${p.media.length ? '' : '  (no media)'}`);
  for (const m of p.media) console.log(`  ${m.kind.padEnd(7)} ${m.path}${m.exists ? '' : '  MISSING'}${m.lastCommit ? '  ' + m.lastCommit : ''}${m.referencedBy.length > 1 ? `  (also on ${m.referencedBy.length - 1} other page${m.referencedBy.length > 2 ? 's' : ''})` : ''}`);
}
if (unreferenced.length) { console.log(`\n! ${unreferenced.length} file(s) under public/ referenced by no page:`); for (const f of unreferenced) console.log(`  public/${f}`); }
console.log(`\n${result.totals.missing ? '✗' : '✓'} ${result.totals.pages} page(s) · ${result.totals.media} media ref(s) · ${result.totals.missing} missing · ${result.totals.unreferenced} unreferenced`);
process.exitCode = result.totals.missing ? 1 : 0;
}
