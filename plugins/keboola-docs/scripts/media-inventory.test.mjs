// media-inventory.test.mjs — node --test <plugin>/scripts/media-inventory.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, 'media-inventory.mjs');
const FIXTURE = path.join(HERE, '..', 'skills', 'docs-diataxis-check', 'scripts', 'fixtures', 'repo');

function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'media-inv-'));
  fs.cpSync(FIXTURE, dir, { recursive: true });
  fs.mkdirSync(path.join(dir, 'public', 'guide'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'public', 'guide', 'pic.png'), '');
  fs.writeFileSync(path.join(dir, 'public', 'guide', 'orphan.png'), '');
  fs.writeFileSync(path.join(dir, 'public', 'guide', 'clip.mp4'), '');
  const page = path.join(dir, 'src', 'content', 'docs', 'guide', 'clean-howto.md');
  fs.writeFileSync(page, fs.readFileSync(page, 'utf8').replace('**Next:**', '![The guide](/guide/pic.png)\n\n<video autoplay loop muted playsinline src="/guide/clip.mp4" poster="/guide/clip-poster.png" aria-label="Guide running"></video>\n\n**Next:**'));
  return dir;
}
const run = (dir, ...a) => { const r = spawnSync(process.execPath, [SCRIPT, '--root', dir, '--json', ...a], { encoding: 'utf8' }); return { status: r.status, out: JSON.parse(r.stdout) }; };

test('lists image, video and poster refs with existence and who references them', () => {
  const dir = repo();
  const { status, out } = run(dir, 'src/content/docs/guide/clean-howto.md');
  assert.equal(out.pages.length, 1);
  const m = Object.fromEntries(out.pages[0].media.map((x) => [x.path, x]));
  assert.equal(m['/guide/pic.png'].kind, 'image'); assert.equal(m['/guide/pic.png'].exists, true); assert.equal(m['/guide/pic.png'].alt, 'The guide');
  assert.equal(m['/guide/clip.mp4'].kind, 'video'); assert.equal(m['/guide/clip.mp4'].exists, true);
  assert.equal(m['/guide/clip-poster.png'].kind, 'poster'); assert.equal(m['/guide/clip-poster.png'].exists, false);
  assert.deepEqual(m['/guide/pic.png'].referencedBy, ['src/content/docs/guide/clean-howto.md']);
  assert.equal(status, 1, 'a missing poster makes the exit code 1');
});

test('unreferenced media under public/ is listed site-wide even when one page is selected', () => {
  const dir = repo();
  const { out } = run(dir, 'src/content/docs/guide/no-desc.md');
  assert.deepEqual(out.pages[0].media, []);
  assert.deepEqual(out.unreferenced, ['guide/orphan.png']);
});
