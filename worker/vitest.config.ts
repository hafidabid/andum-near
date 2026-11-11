import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { globals: true, include: ['src/**/*.test.ts', 'src/**/*.e2e.ts'], testTimeout: 30000, hookTimeout: 60000, fileParallelism: false },
  plugins: [swc.vite({ module: { type: 'es6' } })],
});
