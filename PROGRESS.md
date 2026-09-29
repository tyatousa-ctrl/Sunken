# Progress

Tracks milestones from `BRIEF.md`, decisions, and placeholders to replace later.

## Milestones

| # | Milestone | Status |
|---|---|---|
| 1 | Setup: Vite + Three.js + WebXR "Enter VR", controllers visible, FPS overlay, server hosting decided | Built; waiting for Quest test |
| 2 | Movement sandbox: fog, caustics, arm swimming, bubble jets, air gauge, grab, comfort vignette | Built and tested in an emulated Quest 3; waiting for real-headset test and tuning |
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

## Milestone 2: movement sandbox

Ty asked to go ahead with Milestone 2 before Milestone 1 was tried on a headset, so both are waiting for the Quest test together.

**What's in it**

- **Arm-stroke swimming** (`movement/SwimPhysics.ts`): hold grip and pull; force is opposite to the hand's velocity relative to the body, only above 0.35 m/s, capped, and it fades out as you approach 1.5 m/s in the stroke direction. Neutral buoyancy and smooth water drag.
- **Bubble jets**: trigger (analog) pushes you opposite to where that controller points. Both hands = 1.5× total thrust. Top speed 4 m/s with jets, 1.5 m/s swimming, 0.8 m/s thumbstick drift. Pointing both jets in opposite directions spins you. Jets emit bubbles from the palm, hiss (spatialised at the hand) and rumble the controller in proportion to thrust.
- **Air** (`movement/AirTank.ts`): 240 units, 1/s at rest, +3/s per full-trigger jet. Refill by hovering in the bubbling vent or grabbing the yellow spare tank (it respawns after 30 s). At empty the view fades to black and you float back to the checkpoint with a full tank.
- **Wrist dive computer** (`ui/WristComputer.ts`) on the left wrist: air bar (amber below 25 %, blinking red below 10 %), depth, speed. The FPS panel sits just above it.
- **Grab** (`interaction/GrabSystem.ts`): grip within 10 cm of an item's surface picks it up (items glow when in reach, haptic tick on grab); release throws it with the hand's velocity, then it drifts and settles on the sand. Gripping a rock or the seabed anchors that hand, so you can pull yourself along.
- **Controls**: left stick drifts where you look; right stick snap-turns 30° (smooth turn in settings), up/down rises and sinks. Desktop fallback: drag to look, WASD, Q/E, Shift for jets.
- **Comfort vignette** (`movement/ComfortVignette.ts`): the view edge darkens with speed and spin. Off / Low (default) / High on the start screen. The camera itself is never moved by effects.
- **World**: animated caustics on sand, rocks and props (our own Voronoi shader), shimmering surface overhead at 10 m, god rays, bubbles, marine snow, swaying seagrass, a bubbling volcanic vent; props are three Greek amphorae, shells, red Mediterranean starfish and a spare tank.
- **Controller models bundled**: the Quest controller and hand models are now served from `client/public/xr-profiles` (MIT), instead of fetched from a CDN at runtime.

**How it was tested**

- `npm test`: 14 unit tests on the movement maths, including the brief's acceptance test that jets push opposite to the hand direction, scale with trigger pressure and use air.
- Automated runs in headless Chromium with Meta's Immersive Web Emulation Runtime (an emulated Quest 3): enter VR, single and dual jets, coasting, snap turn, sand pull (hand moved 0.5 m, diver moved 0.5 m), amphora highlight / grab / carry / throw, spare-tank refill, out-of-air fade and respawn. One bug found and fixed this way (ledge pulls were always zero).
- Not yet tested on a real headset, so frame rate and feel are unverified. All feel numbers live in `client/src/movement/tuning.ts` for tuning after the Quest test.

**Performance so far**: ~36k triangles; ~26 draw calls per eye. Well inside the budget.

**What to try on the Quest**

1. Pull with both arms (grip held) and see if strokes feel strong enough.
2. Point both hands behind you and squeeze both triggers; then point them in opposite directions to spin.
3. Grab an amphora, throw it; grab a rock and pull yourself along.
4. Swim into the bubbling vent to refill, grab the yellow tank.
5. Check the vignette strength (Low vs High) and whether anything makes you queasy.

## Decisions

- **2026-09-29 — Hosting.** Macaly apps are static exports (TanStack Start + Convex) with no Node process, so they can't run the Colyseus WebSocket server. The game client and game server are hosted together on **Render** as one Node web service (same origin, one deploy). Render's free tier sleeps when idle, so the first load after a quiet period can take up to about a minute; upgrading the plan removes that.
- **2026-09-29 — Macaly's role.** Macaly is the asset pipeline only: find licensed models, import them with `upload_file` into the private "Sunken Sicily" Macaly app's media library, and record each URL and license in `client/src/assets/manifest.json`. The game never loads assets except through the manifest.
- **2026-09-29 — Tests.** Unit tests use Node's built-in test runner through `tsx` (`npm test`). Installing vitest failed on an npm peer-dependency bug with Vite 8, and the built-in runner needs no extra dependency.
- **2026-09-29 — Physics engine.** Milestone 2 uses hand-written swim physics and sphere colliders for rocks, which is enough for open water. Rapier gets added when the wrecks need real mesh collisions (Milestone 4).
- **2026-09-29 — Repo layout.** One root `package.json` with `client/` (Vite root) and `server/`, so Render builds and runs everything with `npm run build` / `npm start`.

## Placeholders to replace

- Seabed rocks, sand and seagrass are primitives built in code (`client/src/world/SeabedScene.ts`). Real Posidonia and volcanic-rock assets come in with the level work.
- Amphorae, shells, starfish and the spare air tank are primitives (`client/src/world/SandboxProps.ts`).
- Hands are the default controller models; the brief's gloved diver hands come with the avatar work.
- Sounds are generated noise (ambient bed, jet hiss); recorded CC0 audio comes in the polish milestone.
