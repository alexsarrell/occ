import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/cli.tsx'],
  outDir: 'dist',
  format: ['esm'],
  target: 'node18',
  banner: { js: '#!/usr/bin/env node' },
  clean: true,
  external: ['node-pty'],
});
