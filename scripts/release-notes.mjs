// Print the CHANGELOG.md section for one version, used as the GitHub release notes.
// Usage: node scripts/release-notes.mjs v0.1.0
import { readFileSync } from 'node:fs';

const version = (process.argv[2] ?? '').replace(/^v/, '');
const changelog = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
const start = changelog.indexOf(`## [${version}]`);
if (!version || start < 0) {
  console.error(`No section for ${version || '(no version given)'} in CHANGELOG.md`);
  process.exit(1);
}
const rest = changelog.slice(start);
const end = rest.indexOf('\n## [', 1);
const section = (end < 0 ? rest : rest.slice(0, end)).split('\n').slice(1).join('\n').replace(/\n\[[^\]]+\]: .*$/gm, '').trim();
const install = 'npm install -g https://github.com/tarun9715m/terraform-planlens/releases/latest/download/terraform-planlens.tgz';
console.log(`${section}\n\n## Install\n\n\`\`\`sh\n${install}\n\`\`\`\n\nRequires Node.js 22 or newer. See the [installation guide](https://tarun9715m.github.io/terraform-planlens/guide/installation).`);
