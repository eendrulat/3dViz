import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  // laz-rs loads its .wasm via `new URL(..., import.meta.url)`; pre-bundling breaks that path.
  optimizeDeps: { exclude: ['@loaders.gl/las'] },
  build: { target: 'es2022', chunkSizeWarningLimit: 3000 },
});
