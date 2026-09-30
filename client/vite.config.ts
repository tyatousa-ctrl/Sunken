import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

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

const BUILD_ID = buildId()

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
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  plugins: [
    {
      // version.json next to the page: a running game asks for it to notice a newer deploy.
      name: 'build-version',
      writeBundle(options) {
        if (options.dir) writeFileSync(join(options.dir, 'version.json'), JSON.stringify({ build: BUILD_ID }))
      },
    },
  ],
})
