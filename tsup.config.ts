import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { cli: 'src/cli/index.ts' },
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: false, // dist/ui is built by Vite first
  splitting: false,
  sourcemap: false,
  banner: { js: '#!/usr/bin/env node' },
});
