/**
 * Build NSIS installer into a fresh folder (avoids locked release/win-unpacked).
 */
const { spawnSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19).replace('T', '-');
const outDir = path.join('release-out', stamp);

console.log(`[dist] saída: ${outDir}`);

const r = spawnSync(
  'npx',
  ['electron-builder', '--win', 'nsis', `--config.directories.output=${outDir}`],
  { stdio: 'inherit', shell: true, cwd: root }
);

if (r.status !== 0) {
  process.exit(r.status || 1);
}

console.log(`[dist] instalador em: ${path.resolve(root, outDir)}`);
