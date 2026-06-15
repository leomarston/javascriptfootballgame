import { defineConfig } from 'vite';

// Astra Arena build configuration.
// `base: './'` keeps asset paths relative so the production build can be opened
// from any sub-path (or even straight off the file system after `vite preview`).
export default defineConfig({
  base: './',
  server: {
    host: true,
    port: 5173,
    open: false
  },
  build: {
    target: 'es2020',
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1600
  }
});
