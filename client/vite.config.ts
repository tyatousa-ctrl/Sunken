import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  build: {
    outDir: fileURLToPath(new URL('../dist/client', import.meta.url)),
    emptyOutDir: true,
    target: 'es2022',
    // three.js + the Colyseus SDK are ~1 MB (280 kB gzipped); well inside the 40 MB initial-download budget.
    chunkSizeWarningLimit: 1500,
  },
  server: { host: true },
})
