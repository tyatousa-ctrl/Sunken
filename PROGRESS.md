# Progress

Tracks milestones from `BRIEF.md`, decisions, and placeholders to replace later.

## Milestones

| # | Milestone | Status |
|---|---|---|
| 1 | Setup: Vite + Three.js + WebXR "Enter VR", controllers visible, FPS overlay, server hosting decided | Built; waiting for Quest test |
| 2 | Movement sandbox: fog, caustics, arm swimming, bubble jets, air gauge, grab, comfort vignette | Built and tested in an emulated Quest 3; waiting for real-headset test and tuning |
| 3 | Intro sequence: galleon deck, clay-shooting fake-out, beer barrel, darts, cannon attack, gear up, sinking, dive transition | Built and tested end to end in an emulated Quest 3; waiting for real-headset test |
| 4 | Level 1 + systems: backpack, map pieces, first riddle, Strongman skill, checkpoints | Built and tested end to end in an emulated Quest 3; waiting for real-headset test |
| 5 | Multiplayer: Colyseus rooms, room codes, pose sync, shared objects, voice, reconnect | Built and tested with real clients (Node and two/three headless browsers); waiting for a multi-headset test |
| 6 | Bots + all classes + magic: bot behaviour, all four skills, rune spells with gesture recognition | Built and tested (solo with 3 bots, crew with host-run bots); waiting for real-headset test |
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

## Milestone 3: intro sequence

The game now starts on the galleon's deck instead of the sandbox (`?stage=sandbox` still opens the sandbox directly).

**The flow**

1. **Deck at golden hour** (`world/above/Coast.ts`, `world/ship/Galleon.ts`): the galleon anchored off the Sicilian coast, with limestone cliffs, a lighthouse, and Mount Etna smoking on the horizon; animated sea with sun glints. A crew of four (Salvo, Nino, Rosalia, Turi) and a parrot. Walk with the left stick, snap-turn, A/X to jump; you can't walk through the rails, masts, table or cabin.
2. **Clay pigeon fake-out** (`intro/Shotgun.ts`, `intro/ClayRange.ts`): two blunderbusses on a rack by the cabin. Grip snaps one into your hand; trigger fires 8 pellets; two shots, then flick the wrist down (breaks open) and up (closes, loaded); A/X reloads instantly. Grip the barrel with the other hand to aim two-handed. Strong haptic on the firing hand, lighter on the support hand, muzzle flash, smoke, a boom that echoes off the cliffs, recoil on the gun model only. Dropped guns glide back to the rack. Salvo shouts "Pull!" whenever you hold a gun and the sky is clear (or press the red button on the thrower); clays shatter or splash. The scoreboard on the main mast shows hits and shots.
3. **The ship in the bay**: a "merchant" anchored ~150 m off the starboard bow. Nothing says to shoot it. Nudges: at ~1:40 Nino mutters about it, at ~2:50 the parrot flies over and circles it, at ~4:00 Turi notices her empty deck.
4. **The switch** (`intro/attackTimeline.ts`, `intro/AttackSequence.ts`): any pellet on her hull, sails or flag starts the attack. Ambience cuts for a beat, she runs up a black flag, swings broadside and fires; the first ball smashes the scoreboard. "Who Shot First?" is recorded for the victory screen.
5. **The attack (90 s)**: volleys every few seconds, splinters, fires on deck, the foremast shot away and toppling, misses throwing up spray; the crew panics; a SINKING timer counts down; the ship settles by the bow and rolls to starboard (max 8° roll, 3° pitch). Impacts shake the ship's visuals, never your head (the deck you stand on stays steady).
6. **Gear up** (`intro/GearRack.ts`): at the SCUBA rack by the main mast: tank (let go of it over your shoulder), mask (hold it to your face; you then see a dive-mask rim), fins (grab). The treasure map is on the captain's table. A checklist prompt walks you through it.
7. **Abandon ship**: the rails open once your gear is on (or at 1:15 regardless). Go over the side; if you're still aboard at 0:00 you're washed off with any missing gear put on for you.
8. **Dive** (`stages/DiveStage.ts`): splash, bubbles, then underwater. The galleon sinks past you and settles on the seabed (it becomes Level 1 next milestone), then you're in the movement sandbox.

**Structure added**: stages (`core/Stage.ts`: the deck and the dive are separate stages, swapped behind a fade), a walking mode for the player (gravity, jumping, following a tilting and sinking deck while the view stays level), seated mode, a floating subtitle/prompt panel that lazily follows your view (`ui/Hud.ts`), a particle system (`fx/Particles.ts`), synthesized sound effects (`audio/synth.ts`), and a desktop virtual hand for testing (E grab, F trigger, R reload).

**How it was tested**

- `npm test`: 45 unit tests, including the reload rules, the attack timeline (tilt under 10°, deterministic volleys, rails opening, countdown), drink tiers and blackout, dart board scoring (segment order and edges, rings, bulls) and the darts rules (301/501 busts and double-out, turns, skipped turns, Around the Clock).
- Beer and darts in the emulated Quest: fill a mug at the tap, drink it (the counter and haze go up), effects at 7.5 drinks (fog, gun sway, haze), blackout and waking up sober, grab a dart from the rack and throw it through the real release path into the bull (slate: 301 → 251, BULL), and the attack knocking the board off the wall with the darts left on the deck.
- End-to-end run in an emulated Quest 3 (IWER): pick up a gun at the rack, Salvo pulls a clay, a pellet aimed at a clay breaks it, a real trigger pull aimed at the merchant starts the attack, the flag swaps and she turns, the first ball destroys the scoreboard, the crew panics and the checklist appears, tank / mask / fins / map all equip through real grab gestures, the rails open, walking off the side drops you into the water and the dive stage starts with the galleon sinking. No page errors.
- Desktop run: pick up, fire and reload with the keyboard.
- Not yet tried on a real headset.

**Performance so far**: 50–60 draw calls and ~25–50k triangles on deck (static ship parts and the distant enemy are merged into a few meshes).

**Beer barrel** (`intro/BeerBarrel.ts`, `intro/drunk.ts`): a barrel with a brass tap by the port rail near the stern, four pewter mugs on top. Hold a mug under the tap and pull the trigger to fill it (foam rises); raise it to your mouth (within 15 cm) and tip it back to drink, with gulps and a light buzz. Turn it upside down away from your face and it pours out. One full mug = one drink; the counter is hidden and wears off by one drink per 45 s.
- 1–3 drinks: light fog and a warm haze. 4–6: foggier, and a wobble is added to your walking (only while you're pushing the stick, never on its own). 7–9: heavy fog, slower walking, more wobble, and a held blunderbuss sways (half as much held two-handed).
- 10 drinks: blackout. The view fades to black, sound drops out, anything you hold goes back, and you can't move for 3 s; you come round sober. A blackout skips your darts turn.
- The camera is never moved, tilted or spun by any of this: it's fog, colour and input wobble only. "Drunk visual effects" on the start screen turns the fog and haze off (the wobble stays).
- Going into the sea sobers you up.

**Dart board** (`intro/DartBoard.ts`, `intro/darts/`): on the cabin wall port of the door at regulation height, a slate scoreboard beside it, a throw line at 2.37 m, and a rack with three darts. Grab a dart, throw it with the controller's release velocity (a small boost, plus a gravity arc); point-first sticks, flat bounces off. Standard board scoring (singles, doubles, trebles, 25, bull 50). Default 301 with double-out; the blue button under the slate cycles 301 / 501 / Around the Clock, the red one toggles double-out. The slate shows remaining score, the last three darts and whose turn it is. Darts return to the rack after each turn, or if they fall on the deck or overboard. Drink adds scatter to throws. A bullseye before the attack earns "Bullseye Before Battle". When the first cannonball lands, the darts fall, the board drops off the wall, and the slate shows the final scores for 2 s before it breaks.

The deck layout changed to fit them: the captain's table (with the map) moved forward to the port side, and the port cabin window gave way to the slate.

Still not in from the fake-out: the spyglass nudge (the other three nudges are in), the "Pull!" crew voice (subtitles only), slurred voice chat (no voice chat until Milestone 5) and double vision (would need a post-processing pass that costs frame rate on Quest; fog and haze stand in for it). Bots at the barrel and the board come with Milestone 6.

## Milestone 4: Level 1 and the core systems

After going overboard, the galleon sinks past you and settles on the seabed: that's Level 1, The Sinking Galleon. The start screen now has **Start at** (the ship, Level 1, or the sandbox), so you can jump straight in on the Quest.

**The riddle** (`src/data/levels/level1.json`): *"Where the captain slept, the key is kept, beneath the one who never wept."*
1. Swim in through the doorway of the captain's cabin at the stern (the wreck's cabin is a real room now, with solid walls and hull).
2. Beside the bunk lies the ship's old stone figurehead. Grabbing her does nothing ("she won't budge"); the Strongman presses **B** next to her to heave her aside (20 s to recover, shown on the wrist).
3. A brass key lay underneath. Carry it, or stow it in the backpack.
4. Touch the captain's chest lock with the key in hand, or with an empty hand if the key's in your backpack. The lid opens.
5. Take map piece II. The riddle is solved: the iron grille in the stone arch at the edge of the reef sinks into the sand, and the map now shows piece II in place and Level 2's riddle.
6. Swim through the arch: level summary (coins, gems, score, time) and a checkpoint saved on this device.

**Systems**
- **Backpack** (`ui/Backpack.ts`, `systems/Inventory.ts`): 12 slots in a floating 3×4 grid. Open with A/X, or by gripping over your shoulder. Let go of an item over the grid, or over your shoulder, to stow it; grip a filled cell to take one out. Coins, gems, shells and runes stack.
- **Treasure map** (`ui/MapView.ts`): left thumbstick click holds it up in your left hand. The current riddle is inked on the front, found pieces fill their torn holes, and hints are written on the back as they unlock. Grip it with the other hand and pull apart to zoom.
- **Hints** (`systems/LevelProgress.ts`): three tiers from the level file, one per minute you're stuck (progress resets the clock). After two minutes without progress, a compass needle on the map points at whatever the next step needs.
- **Collectibles**: 20 coins (12 on and in the wreck, 3 of them in the chest, 8 on the seabed) and 3 secret gems (the crow's nest, a corner of the cabin, and a far corner of the seabed). Swim into them or grab them; coins +10, gems +50 to the team score.
- **Skill**: the Strongman's heave (B). Single player plays the Strongman until character selection comes with the lobby; the other three classes' cooldowns are already defined.
- **Checkpoints**: running out of air returns you to the level's checkpoint (moved to the arch once the riddle's solved); finishing the level saves progress (`systems/save.ts`).
- **Collisions**: oriented box colliders for the wreck's hull and cabin walls, spheres for the main mast.

**How it was tested**
- `npm test`: 55 unit tests, now including the backpack (stacking, 12-slot limit, using a key), level progress (steps only in order, three hints a minute apart, progress resetting the hint clock, the compass at two minutes), the level file's contents, and skill cooldowns.
- End-to-end in an emulated Quest 3, with real controller input throughout: map opens on the left stick click, a coin is collected by swimming into it, the backpack opens on A, a head pushed into the cabin wall is pushed back out, entering the cabin completes the first step, grabbing the figurehead gives the "won't budge" feedback, B heaves her aside and reveals the key, the key is taken and stowed over the shoulder, an empty hand on the lock uses the key from the backpack, the map piece solves the level and opens the gate, and swimming through the arch completes the level and writes the save.

## Milestone 5: multiplayer

Up to four divers per crew. Solo play still works with no server at all.

**Joining** (start screen, "Crew"): type your name, then **Create crew** (a private room with a 4-letter code to share), **Quick play** (joins or opens a public crew), or type a code and **Join**. Everyone starts where the crew is: on deck, or in Level 1 once the ship has gone down. **Rejoin crew** appears after a reload or drop; **Leave crew** goes back to solo.

**Server** (`server/`): one Node process on Render serves the game and runs Colyseus 0.18 on the same address, so there's nothing new to sign up for. `CrewRoom` holds the synced state everyone agrees on (roster, team score, when the attack started and who shot first, Level 1 riddle steps, collectibles taken, who holds which shared object, map pieces) and decides every shared event:
- the first pellet on the ship in the bay starts the attack, for everyone at the same moment (late joiners catch up to the right second);
- one clay thrower for the crew: the server launches clays with a seed so everyone sees the same flight, and the first hit report breaks it; the scoreboard lists the whole crew;
- shared objects: first grab wins (the blunderbusses: while someone holds one, everyone sees it in their hand, with the flash and boom when they fire, and nobody else can take it);
- coins and gems count once, into the team score, and go into the backpack of whoever got there first;
- riddle steps are accepted only in order and then happen in everyone's world ("Bob heaved the figurehead aside!"); once someone takes the key it disappears for everyone else.

**Poses**: head and both hands, 20 times a second each way; others are drawn 100 ms in the past, blended between updates, as coloured divers (masked head, body with tank, gloved hands, name tag) and only when they're in the same part of the game as you.

**Voice** (`net/Voice.ts`): WebRTC audio between every pair of players (at most 4), signalled through the room. Each voice comes from that diver's head and is muffled when either of you is underwater. Mute on the start screen, or in VR by touching the dive computer on your left wrist with your other hand.

**Reconnect**: a dropped player's slot is kept for 2 minutes and others see "(reconnecting)"; the game reconnects by itself when the network returns, or with **Rejoin crew** after a reload. (A bot will stand in while they're gone once bots exist, Milestone 6.)

**How it was tested**
- `npm test`: 62 unit tests, now including the server rules (room codes, lowest free slot, first-grab-wins claims, first-report-wins events, name cleaning).
- `npm run test:crew` against a running server, with real Colyseus clients: private room code, Quick Play not landing in a private room, join by code and roster, pose relay, claims, collect-once and team score, server clays and first hit, one attack start, riddle steps in order only, voice signalling to one player, drop and reconnect into the same slot. All pass.
- Two headless browsers (desktop mode, fake microphones): create a crew, join it by typing the code in lowercase, each sees the other's avatar move, one picks up a gun and the other sees it in her hand and can't take it, server clays appear in both worlds with the same ids, one shot at the ship starts both attacks together ("Who Shot First" recorded for both), voice connects peer to peer both ways, and a 6-second network outage shows "dropped out" to the other player then reconnects into the same session.
- Three browsers in Level 1: a coin taken by one disappears for the others, the team score matches, riddle steps by one player happen for everyone, the key vanishes for others once taken, the solve opens the gate for all, and a third player joining afterwards arrives with everything caught up.
- Solo Level 1 end to end still passes on the new server.

**Not yet**: beer, darts, loose props underwater and the backpack stay per-player for now (their state isn't shared); voice isn't slurred when drunk. Voice uses Google's public STUN server only; on some strict networks two players may not be able to connect voice without a TURN relay (a paid service, so I haven't added one).

## Milestone 6: bots, the four classes, and magic

**Classes** (`systems/crew.ts`, `intro/CrewBoard.ts`): a crew board by the main mast with four plaques; touch one to take that class. One of each: in a crew the server refuses a class another human has, and new arrivals get a free one. Bots take whatever's left, so every skill is always in the crew. The start screen also has a Class menu.

**Skills (B)**, 20–60 s cooldowns shown on the wrist:
- **Navigator**: a trail of glowing motes to the next clue for 15 s (routed through the cabin doorway), and hidden ink on the back of the map (where the level's secret gems are).
- **Strongman**: heaves heavy things aside (the Level 1 figurehead).
- **Deep Diver**: double air, always; B shares air with the nearest diver (bot or human).
- **Fish Whisperer**: a school of bream swims out, fetches the nearest treasure within 12 m, and brings it back.

**Bots** (`bots/`): every empty slot, and any dropped player's slot, has a bot diver with a name tag and robot icon. They swim with the player physics (bubble-jetting when far), have their own air, and follow a small priority list (`bots/brain.ts`): refill air when low → obey a human's order → Deep Diver shares air with anyone nearly out → do the puzzle job only their class can, but only once a human has got there → pick up nearby coins and gems while humans are around (never runes: those are mana for the humans' spells) → follow the nearest human at 2–4 m. They route through the cabin doorway, and hop up and over anything they're stuck against. On deck they walk with the crew and go over the side when the rails open.
- **Commands**: point at a bot and pull the trigger; cards appear: *Come here*, *Go there* (then point at the spot), *Use skill*.
- **Who runs them**: solo, all three run on your device. In a crew they run on the host (the connected human in the lowest slot) and the server relays their poses; if the host leaves, the next player takes over from where the bots were.
- Bots never solve a riddle alone: the Strongman bot only heaves the figurehead once a human is in the cabin.

**Magic** (`magic/Magic.ts`, `systems/gesture.ts`): three tide runes in Level 1 (one on deck, two on the seabed) fill the mana meter (up to 3, shown ◆◆◇ on the wrist). Press **Y**, hold the trigger, draw a shape in the air and let go; a $1 Unistroke recogniser reads it:
- **Circle: Light Orb**, a real light that follows you for 60 s (for dark cabins and wrecks);
- **Triangle: Air Bubble**, a dome that refills everyone inside for 20 s;
- **Zigzag: Current**, a 25 m stream that carries divers along for 12 s.
"Spell menu instead of drawing" (start screen) swaps drawing for three cards you touch with the other hand; desktop uses keys 1/2/3. Spells cast in a crew appear for everyone.

**How it was tested**
- `npm test`: 77 unit tests, now including crew slots (solo gets three bots with the other classes; a dropped player's bot keeps their class; hosting), the gesture recogniser (wobbly circles, tilted and reversed triangles, zigzags; rejects twitches), and the bot brain's priorities.
- Solo with three bots, playing the Navigator: entering the cabin makes the Strongman bot swim over the deck, in through the doorway, and heave the figurehead ("Strongman bot heaves the stone maiden aside!"); all three spells cast and spend runes; the Navigator trail shows; pointing at the Deep Diver bot opens the command cards and "Come here" sets its order. Found and fixed on the way: bots' stuck-detection was far too eager (they kept hopping upwards), bots were taking the runes, and desktop key taps shorter than a frame were missed (the cause of the earlier flaky desktop reload).
- Crew with two humans and two bots: the second player asking for a taken class gets a free one and a later duplicate request is refused; the host runs the bots and the other player sees them; when the host's tab closes, their slot becomes "Alice's bot" with her class and the other player takes over running all three bots.
- Solo Level 1 end to end and the crew server integration test still pass.

**Not yet**: bots don't shoot clays, drink or play darts on deck (they walk with you); commanding a bot's skill works for the Strongman's heave and the Deep Diver's air (the other classes' skills are for humans for now); rune-locked doors arrive with the temple level.

## Playtest fixes (after Milestone 6)

From the first Quest playtest on Render:

- **Quieter background sound.** The sea and underwater beds are about a third as loud and much softer (lower filter), and the jet hiss is halved. A **Background sound** slider on the start screen goes from silent to that level (default halfway).
- **Button guide.** Raise a controller and turn it toward your face: a card over it lists what its buttons do right now (deck, dive, sandbox). It hides while that hand holds something, and can be turned off on the start screen ("Button guide on controller"). On desktop the keys are listed in the bottom-left corner.
- **Backpack.** On arriving in Level 1 you're told "press A or X (or reach over your shoulder and grip) to open it".
- **Beer.** A "Grog" sign floats over the barrel with the three steps (grip a mug, fill under the tap with the trigger, raise and tip to drink); the step you're on lights up.
- **Darts.** A sign over the dart rack: grip a dart, stand behind the white line, swing and let go; which button does what. The step you're on lights up.
- **Blunderbuss ammo.** A small display over the breech shows the shells loaded (●● 2 shells). At zero it says "Flick down to open" (or A/X, or R on desktop); open, it says "Flick up to load".
- **Bodies.** You have your own diver body under the camera (no head, so it never blocks your view), coloured like your crew slot. Every body (yours, the crew's, the bots') is fitted to the ground under it: on deck it stretches from your head to the deck, so it matches your real height and bends when you crouch. Swimming, it leans forward, and near the seabed it lies flat, so legs never go into the ground. Your eyes now stay 0.5 m above the seabed (was 0.35 m), the height of a diver lying flat with a tank on.

## Decisions

- **2026-09-29 — Hosting.** Macaly apps are static exports (TanStack Start + Convex) with no Node process, so they can't run the Colyseus WebSocket server. The game client and game server are hosted together on **Render** as one Node web service (same origin, one deploy). Render's free tier sleeps when idle, so the first load after a quiet period can take up to about a minute; upgrading the plan removes that.
- **2026-09-29 — Macaly's role.** Macaly is the asset pipeline only: find licensed models, import them with `upload_file` into the private "Sunken Sicily" Macaly app's media library, and record each URL and license in `client/src/assets/manifest.json`. The game never loads assets except through the manifest.
- **2026-09-29 — Tests.** Unit tests use Node's built-in test runner through `tsx` (`npm test`). Installing vitest failed on an npm peer-dependency bug with Vite 8, and the built-in runner needs no extra dependency.
- **2026-09-29 — Physics engine.** Milestone 2 uses hand-written swim physics and sphere colliders for rocks, which is enough for open water. Rapier gets added when the wrecks need real mesh collisions (Milestone 4).
- **2026-09-29 — Intro scope.** Beer barrel and darts were built after the main intro flow so it played end to end first. Guns never get lost overboard: dropped or thrown, they glide back to the rack.
- **2026-09-29 — Darts mode.** The brief's "First to 501" is implemented as standard 501 counting down (first to reach zero wins).
- **2026-09-29 — Drunk effects and comfort.** No double vision: it needs a full-screen post-processing pass that would cost frame rate on Quest. Fog, an amber haze and input wobble carry the effect instead. Walking wobble only applies while the stick is pushed, so you never move on your own.
- **2026-09-29 — Comfort on a sinking ship.** The player's view stays level while the deck tilts under them; only the ground height follows the deck. Cannon hits shake the ship's visuals, not the player.
- **2026-09-29 — Class in single player.** Until the lobby's character board exists (Milestones 5–6), the local player is the Strongman, since Level 1's riddle needs him.
- **2026-09-29 — Level 1's exit.** Level 2 isn't built yet, so the level ends by swimming through the reef arch; the save records `level2` as the next checkpoint.
- **2026-09-29 — Colyseus 0.18 and the server.** The current Colyseus (0.18, with `@colyseus/sdk` on the client) runs inside the same Render service as the game (Express serves the built client). The room code is the room id, so joining by code is a direct lookup; crews made with "Create crew" are private and never matched by Quick Play.
- **2026-09-29 — What's shared.** Shared facts live in the synced state (so late joiners and reconnects are right); moment-to-moment things (poses, shots, clay launches) are messages. Beer, darts and underwater loose props stay per-player for now.
- **2026-09-29 — Voice relay.** Voice is peer-to-peer with a free public STUN server. A TURN relay would make voice work on every network but is a paid service, so it's left out until you decide.
- **2026-09-29 — Where bots run.** The brief puts bots on the server, but the server has no copy of the level geometry to steer them through (hull, cabin doorway, rocks). They run on the host player's device instead (the connected human in the lowest slot), and the server relays their poses and accepts the host's actions on their behalf. Solo play runs them locally, so it needs no server. If the host leaves, the next player takes over.
- **2026-09-29 — Bots at the start.** Bots fill empty slots from the moment you board, rather than waiting for a "Set Sail" press; the crew board shows who has which class.
- **2026-09-29 — Repo layout.** One root `package.json` with `client/` (Vite root) and `server/`, so Render builds and runs everything with `npm run build` / `npm start`.

## Placeholders to replace

- Seabed rocks, sand and seagrass are primitives built in code (`client/src/world/SeabedScene.ts`). Real Posidonia and volcanic-rock assets come in with the level work.
- Amphorae, shells, starfish and the spare air tank are primitives (`client/src/world/SandboxProps.ts`).
- Hands are the default controller models; the brief's gloved diver hands come with the avatar work.
- Sounds are synthesized in code (ambience, jets, gunshot with cliff echo, cannon, clay crack, splashes, clicks); recorded CC0 audio comes in the polish milestone. There's no music yet.
- The galleon, the enemy ship, the crew, the parrot, the blunderbusses, the gear and the coast are all built from primitives.
- Voice lines are subtitles only.
- The wreck interior (bunk, table, figurehead, chest), the key, coins, gems, map piece and the reef arch are primitives.
