import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

/** Which commit this build is, shown on the start screen so you can tell a fresh deploy from an old one. */
function buildId(): string {
  let commit = process.env.RENDER_GIT_COMMIT ?? ''
  if (!commit) {
    try {
      commit = execSync('git rev-parse HEAD').toString().trim()
    } catch {
      commit = 'dev'
    }
  }
  const date = new Date().toISOString().slice(0, 16).replace('T', ' ')
  return `${commit.slice(0, 7)} · built ${date} UTC`
}

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
  define: { __BUILD_ID__: JSON.stringify(buildId()) },
})
