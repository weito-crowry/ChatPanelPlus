import { defineConfig } from 'vite';

export default defineConfig({
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    target: 'chrome111',
    lib: {
      entry: 'src/content/main.tsx',
      name: 'ChatPanelPlusContent',
      formats: ['iife'],
      fileName: () => 'content.js',
    },
  },
});
