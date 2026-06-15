import { defineConfig } from 'vite';

// Astra Arena build configuration.
// `base: './'` keeps asset paths relative so the production build can be opened
// from any sub-path (or even straight off the file system after `vite preview`).
export default defineConfig({
  base: './',
  // .glb is the baked player art asset — import it for a hashed, base-relative URL.
  assetsInclude: ['**/*.glb'],
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
