import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// The viewer ships as one self-contained HTML file (scripts, styles and fonts inlined),
// so it works offline and never makes a network request.
export default defineConfig({
  root: 'src/ui',
  plugins: [viteSingleFile()],
  build: {
    outDir: '../../dist/ui',
    emptyOutDir: true,
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    target: 'es2022',
  },
});
