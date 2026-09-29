import { Server } from '@colyseus/core'
import { WebSocketTransport } from '@colyseus/ws-transport'
import express from 'express'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { ROOM_NAME } from '../client/src/net/protocol.ts'
import { CrewRoom } from './CrewRoom.ts'

// One process serves the built WebXR client and runs the Colyseus crew rooms on the same origin.
const PORT = Number(process.env.PORT ?? 3000)
const CLIENT_DIR = fileURLToPath(new URL('../dist/client', import.meta.url))

const server = new Server({
  transport: new WebSocketTransport(),
  greet: false,
  express: (app) => {
    app.get('/healthz', (_req, res) => {
      res.type('text/plain').send('ok')
    })
    app.use(
      express.static(CLIENT_DIR, {
        setHeaders: (res, path) => {
          // Hashed build assets never change; everything else revalidates.
          res.setHeader('cache-control', path.includes(`${join('assets', '')}`) ? 'public, max-age=31536000, immutable' : 'no-cache')
        },
      }),
    )
  },
})

server.define(ROOM_NAME, CrewRoom)
await server.listen(PORT)
console.log(`Sunken Sicily listening on :${PORT}`)
