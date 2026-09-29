# Progress

Tracks milestones from `BRIEF.md`, decisions, and placeholders to replace later.

## Milestones

| # | Milestone | Status |
|---|---|---|
| 1 | Setup: Vite + Three.js + WebXR "Enter VR", controllers visible, FPS overlay, server hosting decided | Built; waiting for Quest test |
| 2 | Movement sandbox | Not started |
| 3 | Intro sequence | Not started |
| 4 | Level 1 + systems | Not started |
| 5 | Multiplayer | Not started |
| 6 | Bots + all classes + magic | Not started |
| 7 | Levels 2–5 + finale, polish | Not started |

## Milestone 1: what's in it

- `client/`: Vite + TypeScript + Three.js. `Enter VR` button (`local-floor`, optional hand tracking), fixed foveation at full strength.
- Both Quest Touch controllers render (three.js `XRControllerModelFactory`), with a short pointer ray; tracked hands render when controllers are put down.
- FPS overlay: DOM badge on desktop, a small panel above the back of the left hand in VR. It shows fps (green at 72+, amber at 60+, red below), draw calls and triangle count. Toggled with the "Show FPS overlay" checkbox on the start screen and remembered on the device.
- Placeholder seabed: sand, volcanic rocks, swaying Posidonia seagrass, drifting particles, fog tuned for about 30 m of visibility. 4 draw calls, about 33k triangles.
- `server/index.ts`: Node server that serves the built client with `/healthz`. Colyseus attaches here in Milestone 5.
- `render.yaml`: Render Blueprint for a single free web service.

### How to test on Quest

1. On render.com: **New → Blueprint**, pick this GitHub repo. Render reads `render.yaml` and deploys `sunken-sicily`.
2. On the Quest, open the `https://sunken-sicily-….onrender.com` URL in the Meta Quest Browser and tap **Enter VR**.
3. Check: the seabed surrounds you, both controllers are visible and track, and the FPS panel sits on your left hand reading 72+.

Local desktop: `npm install && npm run dev`, then use the Immersive Web Emulator extension to fake a headset.

## Decisions

- **2026-09-29 — Hosting.** Macaly apps are static exports (TanStack Start + Convex) with no Node process, so they can't run the Colyseus WebSocket server. The game client and game server are hosted together on **Render** as one Node web service (same origin, one deploy). Render's free tier sleeps when idle, so the first load after a quiet period can take up to about a minute; upgrading the plan removes that.
- **2026-09-29 — Macaly's role.** Macaly is the asset pipeline only: find licensed models, import them with `upload_file` into the private "Sunken Sicily" Macaly app's media library, and record each URL and license in `client/src/assets/manifest.json`. The game never loads assets except through the manifest.
- **2026-09-29 — Repo layout.** One root `package.json` with `client/` (Vite root) and `server/`, so Render builds and runs everything with `npm run build` / `npm start`.

## Placeholders to replace

- Seabed rocks, sand and seagrass are primitives built in code (`client/src/world/SeabedScene.ts`). Real Posidonia and volcanic-rock assets come in with the level work.
