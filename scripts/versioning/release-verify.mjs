import { spawnSync } from 'node:child_process';
import process from 'node:process';

const checks = [
  ['version metadata', ['corepack', ['pnpm', 'version:metadata']]],
  ['version consistency', ['corepack', ['pnpm', 'version:check']]],
  ['versioning tests', ['corepack', ['pnpm', 'version:test']]],
  ['game-core tests', ['corepack', ['pnpm', '--filter', '@animal-name-place/game-core', 'test']]],
  ['mobile tests', ['corepack', ['pnpm', '--filter', 'mobile', 'test']]],
  ['typecheck', ['corepack', ['pnpm', 'typecheck']]],
  ['mobile production web export', ['corepack', ['pnpm', '--filter', 'mobile', 'exec', 'expo', 'export', '--platform', 'web', '--output-dir', '../../.local-monitor/tmp/release-web-export']]],
  ['local Supabase SQL tests', ['corepack', ['pnpm', 'supabase', 'test', 'db']]],
];

const results = [];

for (const [name, [command, args]] of checks) {
  console.log(`\n== ${name} ==`);
  const result = spawnSync(command, args, { stdio: 'inherit', shell: false });
  results.push({ name, status: result.status === 0 ? 'passed' : 'failed', exitCode: result.status });
}

console.log('\nRelease verification summary');
for (const result of results) {
  console.log(`- ${result.status.toUpperCase()}: ${result.name}${result.exitCode === 0 ? '' : ` (exit ${result.exitCode})`}`);
}

if (results.some((result) => result.status === 'failed')) {
  console.error('\nRelease is not verified. Fix failed checks before packaging or distributing the app.');
  process.exit(1);
}

console.log('\nRelease source checks passed. This does not mean a build was generated, uploaded, or installed on a device.');
