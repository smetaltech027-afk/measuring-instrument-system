import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const DIST_DIR = path.join(ROOT, 'dist');
const REPO_URL = 'https://github.com/smetaltech027-afk/measuring-instrument-system.git';

function run(cmd, args, cwd = ROOT) {
  const res = spawnSync(cmd, args, {
    cwd,
    shell: process.platform === 'win32' && cmd === 'npm',
    encoding: 'utf8'
  });
  if (res.status !== 0) {
    throw new Error(`Command failed (${cmd} ${args.join(' ')}):\n${res.stdout}\n${res.stderr}`);
  }
  return res.stdout ?? '';
}

if (!fs.existsSync(path.join(ROOT, '.env'))) {
  throw new Error('Missing .env file for production build.');
}

// 1. Fresh production build using .env
console.log('[1/4] Building production bundle...');
run('npm', ['run', 'build']);

if (!fs.existsSync(path.join(DIST_DIR, 'index.html'))) {
  throw new Error('dist/index.html missing after build.');
}

// Verify zero secrets or source Excel leaked into dist
const distFiles = fs.readdirSync(DIST_DIR, { recursive: true }).map(String);
for (const f of distFiles) {
  if (/Book1\.xlsx|\.env/i.test(f)) {
    throw new Error(`Refusing to publish unsafe file in dist: ${f}`);
  }
}

// 2. Stage dist/ into a clean temp repo and push to gh-pages branch
const stageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mi-gh-pages-'));
try {
  fs.cpSync(DIST_DIR, stageDir, { recursive: true });
  fs.writeFileSync(path.join(stageDir, '.nojekyll'), '', 'utf8');

  console.log('[2/4] Preparing gh-pages commit...');
  run('git', ['init', '-b', 'gh-pages'], stageDir);
  run('git', ['config', 'user.name', 'smetaltech027-afk'], stageDir);
  run('git', ['config', 'user.email', 'smetaltech027@gmail.com'], stageDir);
  run('git', ['add', '-A'], stageDir);
  run('git', ['commit', '-m', 'deploy: publish GitHub Pages build'], stageDir);

  console.log('[3/4] Pushing gh-pages branch...');
  run('git', ['remote', 'add', 'origin', REPO_URL], stageDir);
  run('git', ['push', '-f', 'origin', 'gh-pages'], stageDir);
} finally {
  fs.rmSync(stageDir, { recursive: true, force: true });
}

// 4. Enable GitHub Pages on gh-pages branch (idempotent)
console.log('[4/4] Enabling GitHub Pages (branch: gh-pages)...');
const enableRes = spawnSync(
  'gh',
  [
    'api',
    '-X',
    'POST',
    'repos/smetaltech027-afk/measuring-instrument-system/pages',
    '-f',
    'source[branch]=gh-pages',
    '-f',
    'source[path]=/'
  ],
  { cwd: ROOT, shell: process.platform === 'win32', encoding: 'utf8' }
);
if (enableRes.status === 0) {
  console.log('[OK] GitHub Pages enabled:', enableRes.stdout.trim());
} else if ((enableRes.stderr + enableRes.stdout).includes('already')) {
  console.log('[OK] GitHub Pages already enabled on gh-pages.');
} else {
  console.log('[INFO] GitHub Pages API response:', enableRes.stdout, enableRes.stderr);
}
