// Builds the Session Hire Blueprint page from docs/hub/template.html and the
// markdown files in docs/. Run: node scripts/build-hub.mjs [fragment-out-path]
//
// Writes docs/hub/index.html (a complete page you can open in a browser).
// With an argument, also writes the bare fragment there (used to publish the
// page as a claude.ai Artifact, which supplies its own <html>/<head>).
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = [
  ['Build progress', 'docs/progress.md'],
  ['Phone field test', 'docs/field-test.md'],
  ['Switching on sign-in and Google Calendar', 'docs/sign-in-setup.md'],
  ['Design system', 'docs/design-system.md'],
  ['Backups', 'docs/backups.md'],
  ['Error alerts', 'docs/monitoring.md'],
  ['Architecture', 'docs/architecture.md'],
  ['Roadmap', 'docs/roadmap.md'],
  ['Stock tracking', 'docs/research/stock-tracking.md'],
  ['Competitor audit', 'docs/research/competitor-audit.md'],
  ['How booking works today', 'docs/research/current-process.md'],
  ['Crewbox handoff', 'docs/research/crewbox-handoff.md'],
  // Every decision record, in order, titled from its first heading.
  ...readdirSync(join(root, 'docs/adr'))
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((f) => {
      const md = readFileSync(join(root, 'docs/adr', f), 'utf8')
      const title = (md.match(/^# (.+)$/m)?.[1] ?? f).replace(/^ADR (\d+):\s*/, 'Decision $1: ')
      return [title, `docs/adr/${f}`]
    }),
];

const docs = DOCS.map(([title, path]) => ({ title, path, md: readFileSync(join(root, path), 'utf8') }));
const built = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
// Escape "<" so no document can close the <script> block early.
const json = JSON.stringify(docs).replace(/</g, '\\u003c');
const data = `<script type="application/json" id="docs-data" data-built="${built}">${json}</script>`;

const template = readFileSync(join(root, 'docs/hub/template.html'), 'utf8');
if (!template.includes('<!--DOCS-DATA-->')) throw new Error('template is missing <!--DOCS-DATA-->');
// Inline images from docs/hub/img so the page stays a single file.
const fragment = template
  .replace('<!--DOCS-DATA-->', () => data)
  .replace(/src="img\/([\w.-]+\.(png|jpe?g|svg|webp))"/g, (_, file, ext) => {
    const type = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', svg: 'image/svg+xml', webp: 'image/webp' }[ext];
    return `src="data:${type};base64,${readFileSync(join(root, 'docs/hub/img', file)).toString('base64')}"`;
  });

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
</head>
<body>
${fragment}
</body>
</html>
`;
writeFileSync(join(root, 'docs/hub/index.html'), page);
if (process.argv[2]) writeFileSync(process.argv[2], fragment);
console.log(`Built docs/hub/index.html with ${docs.length} documents (${built}).`);
