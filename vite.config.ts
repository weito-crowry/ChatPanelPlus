import { defineConfig } from 'vite';

export default defineConfig({
  root: 'options',
  publicDir: '../public',
  base: './',
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    target: 'chrome111',
  },
});
