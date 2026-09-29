import { createServer } from 'node:http'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname, join, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

// Serves the built WebXR client. The Colyseus game server (Milestone 5) will attach
// to this same HTTP server so the game and its WebSockets share one origin.
const PORT = Number(process.env.PORT ?? 3000)
const CLIENT_DIR = fileURLToPath(new URL('../dist/client', import.meta.url))

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.ktx2': 'image/ktx2',
  '.wasm': 'application/wasm',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
}

async function resolveFile(urlPath: string): Promise<string | null> {
  const decoded = decodeURIComponent(urlPath.split('?')[0])
  const candidate = normalize(join(CLIENT_DIR, decoded))
  if (candidate !== CLIENT_DIR && !candidate.startsWith(CLIENT_DIR + sep)) return null
  try {
    const info = await stat(candidate)
    if (info.isFile()) return candidate
    if (info.isDirectory()) return resolveFile(join(decoded, 'index.html'))
  } catch {
    // not found
  }
  return null
}

const server = createServer(async (req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'text/plain' }).end('ok')
    return
  }
  const file = (await resolveFile(req.url ?? '/')) ?? join(CLIENT_DIR, 'index.html')
  const hashed = file.includes(`${sep}assets${sep}`)
  res.writeHead(200, {
    'content-type': MIME[extname(file)] ?? 'application/octet-stream',
    'cache-control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
  })
  createReadStream(file)
    .on('error', () => res.destroy())
    .pipe(res)
})

server.listen(PORT, () => console.log(`Sunken Sicily listening on :${PORT}`))
