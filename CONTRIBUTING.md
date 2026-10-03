# Contributing to planlens

Thanks for helping. Bug reports, plan JSON that planlens handles badly (with secrets removed), and pull requests are all welcome.

## Set up

You need Node.js 22.12 or newer.

```sh
git clone https://github.com/tarun9715m/terraform-planlens.git
cd terraform-planlens
npm ci
npm run build   # dist/cli.js and dist/ui/index.html
npm run dev     # the viewer with the demo plan, reloading as you edit
```

To try the command from your clone, run `npm link`, then `planlens demo`.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Viewer dev server with the demo plan |
| `npm test` | Unit tests (Vitest) |
| `npm run typecheck` | TypeScript, no output |
| `npm run check` | Typecheck, tests and a full build. CI runs this. |
| `npm run build` | `dist/ui/index.html` (Vite) and `dist/cli.js` (tsup) |
| `npm run fixtures` | Regenerate `test/fixtures/real-terraform-1.16.json` from a real Terraform run. Needs `terraform`, no cloud credentials. |
| `npm run screenshots` | Regenerate the images in `docs/public/screenshots`. Needs Chrome; set `CHROME_PATH` if it isn't found. |
| `npm run docs:dev` | Docs site dev server |

## Project layout

```
src/core/      plan parsing, diff engine, analysis, redaction (no DOM or Node APIs)
src/ui/        the browser viewer, bundled into one HTML file
src/cli/       the planlens command
src/samples/   the demo plan
test/          Vitest tests and fixtures
docs/          the documentation site (VitePress)
scripts/       fixture and screenshot generators
```

## Guidelines

- Keep the viewer self-contained: no network requests, no external assets. The content security policy enforces this.
- Anything that touches plan values must keep secrets out of exported reports. Add a test in `test/redact.test.ts` when you change what a report contains.
- Use real plan JSON where you can. Tests built on `terraform show -json` output catch shape assumptions that hand-written fixtures miss.
- Run `npm run check` before opening a pull request.

## Releasing

1. Update `version` in `package.json` and add a section to `CHANGELOG.md`.
2. Commit, then tag: `git tag v0.2.0 && git push origin v0.2.0`.
3. The Release workflow runs the checks, packs the package and publishes a GitHub release with the install tarball.
