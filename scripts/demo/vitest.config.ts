import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';
export default defineConfig({
  root: __dirname,
  test: { globals: true, include: ['*.demo.ts'], testTimeout: 120000, hookTimeout: 60000, fileParallelism: false, reporters: ['dot'] },
  plugins: [swc.vite({ module: { type: 'es6' } })],
});
