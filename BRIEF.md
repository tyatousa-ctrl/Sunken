# Sunken Sicily — Multiplayer VR Scuba Treasure Hunt: Build Brief for Claude Code

2026-09-29 · Ty

## Pitch and how to use this brief

Build a 1–4 player co-op VR game for Meta Quest where divers escape a sinking pirate ship, follow a riddle-filled treasure map across underwater levels, and find the treasure. Empty player slots are filled by AI bot divers.

**Name:** Sunken Sicily. **Genre:** co-op VR exploration + puzzle. **Session length:** 30–45 minutes for the full run, with a save/checkpoint after each level.

**Setting:** the pirate ship is attacked and sinks off the coast of Sicily in the Mediterranean. The whole underwater world should feel Sicilian: clear blue Mediterranean water, volcanic rock (Mount Etna visible on the horizon in the intro), Posidonia seagrass meadows, sunken Greek and Roman amphorae, and the ruins of a drowned Greek temple. Local sea life such as groupers, octopus, moray eels, bream, and loggerhead turtles replaces generic tropical fish.

**Instructions to Claude Code:**

1. Read this whole brief before writing any code. Save it in the repo as `BRIEF.md` and keep a `PROGRESS.md` that you update after each milestone.
2. Build in the milestone order in the last section. Each milestone must run on a Quest headset before the next one starts.
3. When something in this brief is technically impossible or ambiguous, stop and ask me rather than guessing. Log decisions in `PROGRESS.md`.
4. Prefer simple, working, and fun over complete. A playable vertical slice beats a half-finished everything.
5. Never ship an asset whose license you have not recorded (see the asset section).

## Tech stack

Build it as a **WebXR** game that runs in the Meta Quest Browser, hosted on Macaly Cloud. Macaly deploys web apps, so a native Unity/Unreal APK is out of scope for this brief. Players open a URL on the headset, tap "Enter VR", and play; no store install needed.

| Layer | Choice | Why |
|---|---|---|
| 3D engine | Three.js (or Babylon.js if Claude Code finds XR support smoother) | Mature WebXR support, glTF loading, runs well on Quest |
| Language / build | TypeScript + Vite | Fast builds, type safety for netcode |
| XR input | WebXR Device API + `XRInputSource` gamepad mapping for Quest Touch controllers; hand tracking optional later | Native Quest controller support in the browser |
| Physics | Rapier (WASM) or cannon-es | Collisions, buoyancy, grabbing |
| 3D model format | glTF / GLB, Draco or Meshopt compressed, KTX2 textures | Smallest files, fastest load on Quest |
| Multiplayer | Authoritative Node.js server with WebSockets (Colyseus recommended) | Rooms, state sync, bots run server-side |
| Voice chat | WebRTC peer audio, spatialised with Web Audio `PannerNode` | Divers hear teammates from where they are |
| Hosting | Macaly Cloud app for the game client; game server on Macaly if it supports long-lived WebSocket processes, otherwise a separate host (Fly.io, Render, Railway) | See connector section |
| Testing | Desktop browser with WebXR emulator (Immersive Web Emulator) + real Quest 3 / Quest 3S | Fast iteration without a headset on |

**Target devices:** Quest 3 and Quest 3S first, Quest 2 supported at lower settings. **Frame rate:** 72 fps minimum, 90 fps target.

## Using the Macaly Cloud connector

Macaly Cloud builds, stores, and hosts the app; it does not generate or search for 3D models. Claude Code must find realistic models from licensed libraries, then import them into the Macaly app's media library and load them in the game.

**What the Macaly tools do (use these names):**

| Tool | Use it for |
|---|---|
| `list_teams`, `list_projects` | Find the team and check whether the app already exists |
| `create_app` | Create the private app with its Git repo and cloud hosting |
| `skill_info` | Read Macaly's guide for the app template. **Call this first** to learn the framework, build commands, and whether a WebSocket game server can run there |
| `write_file`, `read_file`, `list_files`, `delete_file` | Write and edit source files (each write is a Git commit) |
| `run_project_command` | Install packages (`npm install three ...`), run builds and tests |
| `upload_file` | Import a model, texture, or sound into the app's media library **from a public URL** |
| `list_media` | Get the stored URLs of imported assets to reference in code |
| `preview_app` | Get a 3-hour preview link to open on the Quest for testing |
| `get_logs`, `get_project` | Debug build and runtime errors |
| `publish_app`, `get_deployment` | Deploy to production and get the live URL |
| `connect_domain` | Optional custom domain |

**Asset workflow Claude Code must follow:**

1. Search licensed sources for each asset in the asset list. Preferred, in order: Poly Pizza, Quaternius, Kenney (all CC0 / free), Sketchfab downloadable models filtered to CC0 or CC-BY, Mixamo for rigged humans and animations (free with an Adobe account; I will download these and give you the files or URLs).
2. Pick GLB/glTF models. Reject anything over the triangle budget in the performance section, or optimise it with `gltf-transform` (Draco/Meshopt geometry, KTX2 textures, max 1024px, 2048px only for hero objects).
3. Get a direct public download URL, then call `upload_file` to import it into Macaly. If a source needs a login, list it for me and I will download it manually.
4. Call `list_media` and store every asset's Macaly URL in `src/assets/manifest.json` with: id, Macaly URL, source page, author, license, triangle count, file size.
5. Generate `CREDITS.md` from the manifest (CC-BY requires attribution in-game; show it on a Credits screen).
6. Load assets through one `AssetLoader` module that uses the manifest, shows a loading bar, and caches models for reuse (instancing for fish and rocks).

**Realism, honestly:** photoreal humans are too heavy for a browser on Quest. Aim for "stylised-realistic": good PBR textures, underwater fog, caustic light, god rays, and particles do most of the work. Water itself is shaders, not models (see asset list).

**Fallback:** if a needed model can't be found, Claude Code builds a clean low-poly placeholder from Three.js primitives and flags it in `PROGRESS.md` so we can replace it later.

## Asset list

Every asset below goes in the manifest with its license. Budgets are triangles per model.

| Category | Asset | Notes | Budget |
|---|---|---|---|
| People | 4 diver characters (one per class) | Rigged humanoid, swap between pirate outfit and wetsuit + tank + mask; unique colour per player | 15k each |
| People | Pirate crew (4–6 NPCs) | Idle, panic, and run animations for the intro | 8k each |
| People | Enemy pirate captain (finale) | Ghost/skeleton variant for the magic ending | 12k |
| Animations | Swim, tread water, grab, point, wave, celebrate, hurt | Mixamo or retargeted; drive with IK for hands | — |
| Ships | Player pirate galleon (walkable deck) | Masts, rails, cannons, scuba gear rack, captain's table with map | 40k |
| Ships | Enemy warship | Seen at distance, fires cannons | 15k |
| Ships | 3 shipwrecks on the seabed | Broken hull, cabin, cargo hold; players swim inside | 30k each |
| Fish | Mediterranean fish schools (bream, damselfish, sardines, grouper) | GPU-instanced, boids flocking | 500 each |
| Fish | Sea turtle, manta ray, octopus, jellyfish | Ambient life, simple animation | 3–6k |
| Fish | Shark, moray eel | Hazards; eel hides in wrecks | 6k |
| Fish | Giant octopus or sea serpent guardian | Final level boss (non-lethal puzzle fight) | 20k |
| Environment | Coral, kelp, rocks, sand, sea caves, ruins, temple | Modular pieces, instanced; plus a sea-cave kit for the Blue Grotto (cave walls, stalactites, ledges, smugglers' camp props, rowboat) | 1–5k each |
| Props | Treasure map, scuba tank, mask, fins, backpack | Hero items; map must be readable up close | 2–5k |
| Props | Chests, keys, gems, coins, bottles, compass, lantern, shells, runes | Collectibles and puzzle pieces | <2k each |
| Props | Cannons, cannonballs, barrels, crates, ropes, 2 blunderbuss shotguns + rack, clay thrower, clay targets (whole + shattered), scoreboard, beer barrel with tap, beer mugs, dart board, 12 darts, dart scoreboard, spyglass, parrot | Intro scene | <3k each |
| Shaders / FX | Ocean surface, underwater fog, caustics, god rays, bubbles, sand puffs, cannon fire, splash, magic glow | Built in code, not downloaded | — |
| Audio | Ocean, cannon, creaking wood, bubbles, muffled underwater bed, whale song, UI chimes, music (calm, tense, triumphant) | CC0 from Freesound / Pixabay audio; record license | — |

## Game flow

The run goes: ship deck → clay pigeon fake-out → someone shoots the other ship → attack → dive → five underwater levels → treasure. Each level ends with a riddle that unlocks the next area.

1. **Lobby (on deck, calm seas):** players spawn on the galleon at golden hour off the Sicilian coast, with cliffs, a lighthouse, and Mount Etna in view, pick a character at the crew board, and learn grabbing by picking up props. Bots join empty slots when the host presses "Set Sail". A short tutorial prompt shows controls.
2. **Fake-out mini-game: clay pigeon shooting (no time limit):** the game pretends to be a relaxed shooting gallery. Two shotguns sit on a rack at the stern, a clay thrower launches clays over the water, and a big wooden scoreboard shows each player's hits. Players can play as long as they want. A second ship sits quietly anchored out in the bay.
3. **The trigger:** the moment any player's shot hits the ship in the bay, the real game starts. The other ship turns, runs up a black flag, and fires a cannon back.
4. **The attack (about 90 seconds, scripted):** cannonballs hit, masts crack, fires start, the deck tilts, and water floods in. The crew panics. A timer UI shows the ship sinking.
5. **Gear up:** each player must grab a scuba tank (clips onto the back), a mask (hold to face), and fins from the gear rack. One player grabs the treasure map from the captain's table; it is shared, and any player can summon a copy. Bots help the team if someone is slow.
6. **Abandon ship:** players jump off the rail or get washed off as the ship goes under. Screen goes to a splash, bubbles, then silence underwater. The galleon sinks past them to the seabed and becomes Level 1.
7. **Level 1 — The Sinking Galleon (tutorial):** learn swimming, bubble jets, the backpack, and first riddle.
8. **Level 2 — Seagrass Meadows:** open Posidonia meadows and rocky reef, fish schools, a loggerhead turtle guide.
9. **Level 3 — The Blue Grotto:** swim through a low underwater opening in the sea cliff, surface inside a huge air-filled cave lit by glowing blue water, climb out onto the rocks and explore on foot, then dive back in through a hidden passage on the far side to reach the next level.
10. **Level 4 — The Wreck Graveyard:** dark, three shipwrecks, eels, lantern needed.
11. **Level 5 — Sunken Temple:** a drowned Greek temple with columns and mosaics, magic runes, trap puzzles.
12. **Finale — The Treasure Vault:** guardian creature puzzle, then the treasure chest opens. Team score, collectible count, and time shown on a victory screen. Players surface to a rescue boat.

**Clay pigeon fake-out details:**

- **Guns:** two pirate-style shotguns (blunderbuss look). Grab with grip, fire with trigger, two-handed aim supported. Unlimited ammo with a fast, physical reload: two shots, then a quick flick of the wrist downward breaks the barrel open, and flicking it back up closes it loaded (about 0.5 s total). Pressing A/X while holding the gun is a one-button reload fallback. Use the full Quest feature set: strong haptic kick on the firing hand scaled to the shot, a lighter rumble on the support hand, two-handed aiming where the front hand steadies the barrel, muzzle flash, smoke puff, spatial boom that echoes off the cliffs, and small recoil movement of the gun model (never the player's camera). Guns snap back to the rack if dropped or thrown overboard.
- **Clays:** a pull button or a crew NPC shouting "Pull!" launches 1 or 2 clays at random angles over the water. Clays shatter into pieces with a satisfying crack; misses splash into the sea.
- **Scoreboard:** a chalk or wooden board on the mast listing each player's name, colour, hits, and shots, sorted by hits. Holders swap when a player sets a gun down, so 3–4 players take turns. Bots queue up and shoot too, at a modest hit rate.
- **The ship in the bay:** anchored about 150 m away, looking harmless (a merchant flag). Nothing tells players to shoot it. Any pellet hit on its hull, sails, or flag triggers the attack.
- **Gentle nudges (not forced):** after a few minutes, small things draw attention to it: a crew member mutters about it, a spyglass on the rail zooms onto it, a parrot flies toward it. There is no timer; players can shoot clays forever.
- **The switch:** on the hit, the music cuts, a pause of about 1 second, then the other ship swaps to a black flag, turns broadside, and fires. The first cannonball smashes the scoreboard. The shotguns stay on deck but are useless underwater.
- **Networking:** clay launches, hits, and the ship-hit trigger are decided on the server so every player sees the same thing at the same moment.
- **Achievement:** "Who Shot First?" goes to the player whose shot started the attack; show it on the final victory screen.

**Beer barrel (deck only):**

- A barrel with a tap and a stack of mugs sits near the shooting station. Hold a mug under the tap and pull the trigger to fill it; foam rises as it fills.
- Drink by raising the mug to the mouth and tilting it (mug within about 15 cm of the headset). Gulping sound and a light haptic buzz. One full mug = 1 drink. Each player has a hidden drink counter.
- Effects grow with each drink: 1–3 drinks, slight fog and a soft glow on lights; 4–6, foggier view, mild double vision on distant objects, and a small random drift added to thumbstick walking; 7–9, heavy fog, slower walking, stronger drift, a bit of sway in aim for the shotguns, and slurred-sounding voice chat (pitch filter).
- **10 drinks = blackout:** the screen fades to black, sound goes muffled, and the player passes out for 3 seconds. Other players see that avatar slump onto the deck. Then the view fades back in, the player stands up, and everything resets to sober with the counter at 0.
- Effects also wear off slowly on their own (about 1 drink level every 45 s), and hitting the sea water when the ship sinks clears them fully so the dive starts sober.
- **Comfort rules (important in VR):** never move, tilt, or spin the player's camera for the drunk effect, since that causes motion sickness. Do it with fog, blur, vignette, colour shift, and wobble added to movement input instead. Add a setting to turn the visual effects off.
- Bots can drink too (rarely), for comedy.
- Networking: drink counts and blackouts are server state so everyone sees the same slump.

**Dart board (deck only, part of the fake-out):**

- A dart board hangs on the cabin wall near the beer barrel, with a chalk or slate scoreboard beside it and a small rack holding 3 darts per player colour. Darts return to the rack after each turn, and any dart that falls on the deck or overboard respawns there.
- **Throwing:** grab a dart with grip, and release the grip while flicking the hand to throw. Use the controller's velocity and angle at release for the throw, with a small gravity arc so it feels physical. Darts stick into the board if they hit point-first and bounce off if they don't. Light haptic tick on grab, sharper thud on a stick.
- **Scoring:** standard board (20 segments, double and triple rings, bullseye 50, outer bull 25). Default game is 301 counting down, with a mode toggle to First to 501 or Around the Clock. Rule: must finish on a double (host can turn this off in the lobby for a relaxed game).
- **Scoreboard:** shows each player's name and colour, remaining score, last three dart scores, and whose turn it is. It updates immediately after each dart. Turn order rotates by player slot; bots take their turns automatically with a modest, slightly random aim.
- **Casual by design:** no time limit, and players can leave and come back to it. Players can still wander over to the shotguns or barrel mid-game; the darts game pauses and resumes by turn.
- **Drunk interaction:** the more a player has had to drink, the more wobble is added to their throw (aim scatter grows with the drink count), which is funny and matches the beer system. Blackouts skip that player's turn.
- **Attack interruption:** when the enemy ship fires, darts and board scatter: the first cannonball shakes the deck, the darts fall, and the board drops off the wall. The scoreboard shows the final scores for a moment before it breaks.
- **Networking:** dart throws are simulated on the client that owns the dart, and the server validates hits and scores so everyone sees the same board and turn order.
- **Achievement:** "Bullseye Before Battle" for hitting the bullseye during the fake-out.

**Air as a soft timer:** each diver has an air gauge on the wrist. Normal swimming uses it slowly, bubble jets use it faster. Refill at air pockets, bubbling vents, and tanks hidden in levels. At empty, the diver floats to the last checkpoint (no permadeath, keep it friendly).

## Controls, swimming and bubble jets

Movement has two layers: arm-stroke swimming for immersion, and hand bubble jets for speed. Both work together, and a thumbstick fallback exists for comfort.

| Input (Quest Touch) | On deck | Underwater |
|---|---|---|
| Left thumbstick | Walk (smooth locomotion) | Drift slowly in the direction you look (comfort fallback) |
| Right thumbstick | Snap turn 30° (smooth turn optional) | Snap turn; up/down = rise/sink |
| Grip (either hand) | Grab / hold objects | Grab objects, ledges, and teammates' hands |
| Trigger (either hand) | Use held item | **Bubble jet** from that hand |
| A / X | Jump | Open backpack (on the hip) |
| B / Y | — | Special skill (B) / cast magic (Y) |
| Menu button | Pause / settings | Pause / settings |
| Thumbstick click (left) | — | Open the treasure map |

**Arm-stroke swimming:** while the grip is held and the hand moves, apply force opposite to the hand's velocity (like pulling water). Force = hand velocity × stroke strength, capped. Only strokes faster than a small threshold count. Water drag slows the player smoothly. Neutral buoyancy: no gravity, tiny drift.

**Bubble jets:**

- Pulling the trigger shoots a stream of bubbles out of the palm in the direction the hand points. The player is pushed the **opposite** way (point hands behind you to go forward).
- Trigger pressure (analog 0–1) sets thrust. Both hands firing together gives a boost multiplier of 1.5×.
- Thrust uses air from the tank; the gauge drains visibly.
- Top speed about 4 m/s with jets, 1.5 m/s swimming, 0.8 m/s thumbstick drift.
- Bubbles are GPU particles that rise and wobble; play a hiss sound spatialised at the hand; light haptic rumble on the controller scaled to thrust.
- Pointing both hands in opposite directions spins the player (fun trick, useful for tight wrecks).

**Grabbing:** physics-based hands with a grab radius of about 10 cm, highlight outline on grabbable objects, two-handed grab for heavy items (chests need two players).

**Hand presence:** show gloved hands with finger poses driven by grip/trigger/touch sensors. Hand tracking (no controllers) is a stretch goal: pinch = trigger, fist = grip.

## Characters, backpack and magic

Four classes, each with one skill the team needs at least once per level, so every slot (human or bot) matters.

| Character | Special skill (B button) | Where it's needed | Cooldown |
|---|---|---|---|
| **The Navigator** | Reads hidden ink on the map and reveals a glowing trail to the next clue for 15 s | Finding the riddle location in each level | 45 s |
| **The Strongman** | Lifts, pushes, and breaks heavy objects (rubble, stuck doors, anchor chains) alone | Opening wreck passages and temple doors | 20 s |
| **The Deep Diver** | Double air capacity, can dive into the dark trenches others can't, and refills a teammate's air by touching tanks | Deep zones and emergency air | 60 s (refill) |
| **The Fish Whisperer** | Calms and commands sea creatures: moves the eel, rides the turtle or manta for a speed burst, sends fish to fetch small items | Creature puzzles and the finale guardian | 30 s |

**Backpack:**

- Worn on the back; open by reaching over the shoulder and gripping, or press A/X. Opens as a floating 3×4 grid near the hand.
- 12 slots per player. Items: keys, gems, runes, map pieces, lantern, coins, air canister, shells.
- Grab an item and drop it in the bag to store it. Pull it out the same way. Quest items are shared: they show in everyone's team tab.
- Players can hand items to each other directly (network-owned object transfer).
- Coins and gems add to the team score; runes power magic.

**Magic system (light, fits the pirate-legend theme):** the treasure is cursed sea-god gold, and ancient **tide runes** are scattered through the levels.

- Collect runes to fill a mana meter (max 3 charges). Cast with Y by drawing a simple shape in the air with the hand (circle, triangle, zigzag) and releasing the trigger.
- **Circle — Light Orb:** a floating light that follows you in dark wrecks for 60 s.
- **Triangle — Air Bubble:** creates a big air dome that refills everyone inside.
- **Zigzag — Current:** makes a water current that carries the team fast along a line.
- Later levels include rune-locked doors that need a specific spell cast on them.
- Gesture recognition: record the hand path for up to 1.5 s, normalise it, compare to templates (a $1 Unistroke recogniser is enough). Also allow a radial menu fallback for accessibility.

## Levels, riddles and the treasure map

Each level has one main riddle, two or three side clues, and a gate that opens when the riddle is solved. Riddles live in data files so they can be changed without code.

**The treasure map:**

- A parchment in 3D that players hold with both hands and can stretch to zoom. It starts torn: five missing pieces, one found per level.
- Each new piece reveals the next level's area and its riddle, written in ink on the map.
- A compass on the map points to the current objective after 2 minutes stuck (soft hint system).
- The Navigator sees extra hidden ink (bonus clues and secret treasure).

| Level | Setting | Main riddle (example) | Solution | Skill / magic needed |
|---|---|---|---|---|
| 1. Sinking Galleon | The ship you escaped, now on the seabed | "Where the captain slept, the key is kept, beneath the one who never wept." | Key under the stone figurehead in the captain's cabin | Strongman lifts the figurehead |
| 2. Seagrass Meadows | Posidonia seagrass, rocky reef, loggerhead turtle, fish schools | "Count the stars that live below, their number opens the door of stone." | Count starfish (7), dial 7 on a stone lock | Fish Whisperer rides turtle to reach high reef |
| 3. The Blue Grotto | Sea cave entered underwater; air-filled cavern inside with glowing blue water, stalactites, rock ledges, an old smugglers' camp | "When noon's light swims through the door, blue shows the way the old ones swore." | Angle three polished shells to bounce the blue light onto a carved wall; it reveals the hidden underwater exit | Navigator reads the carving; Strongman moves a boulder off the exit; Light Orb helps in dark side tunnels |
| 4. Wreck Graveyard | Three dark wrecks, eels | "Three ships lie still; the one with no name holds the flame." | Find the wreck with the scratched-off name, light its lantern | Light Orb spell, Deep Diver enters trench |
| 5. Sunken Temple | Drowned Greek temple, columns, mosaics, rune doors | "Sun, moon, and tide in order stand, press them true with a steady hand." | Press symbol tiles in order shown on a mural; all players press at once | Navigator reveals the mural order |
| Finale. Treasure Vault | Cavern with a sleeping guardian | "Wake not the keeper, feed it instead, give it the pearl from the oyster bed." | Fetch a pearl, calm the guardian, open the chest together | Fish Whisperer calms it, Current spell escapes |

**Blue Grotto level details:**

- Look: modelled on the famous Blue Grotto look, set on the Sicilian coast. Sunlight enters through the underwater opening and lights the water an intense glowing blue from below; the cave air is dim with blue reflections dancing on the rock ceiling (animated caustic texture).
- Entry: a narrow underwater arch in the cliff base, about 2 m tall. Players swim through a short dark tunnel and see the bright blue water ahead.
- **Surfacing (new mechanic):** when a diver's head rises above the water plane, switch to surface mode: water sounds become unfiltered and echoey, air stops draining and refills, fog clears, and the player floats at the waterline. Players grab ledges (grip) to climb out onto the rocks, then walk with the thumbstick like on the ship deck. Diving back in switches to underwater mode.
- Inside: a large cave (about 40 m long) with rock shelves, a smugglers' camp with old crates, a rowboat, and a treasure clue carved into the wall. Side tunnels hold coins and a secret gem.
- Exit: once the riddle is solved, the blocked underwater passage on the far side opens. Everyone jumps back in and swims through it to Level 4.
- Streaming: load Level 4 while players are in the cave so the exit is seamless.

**Puzzle rules for Claude Code:**

- Store riddles in `src/data/levels/*.json` with: text, solution conditions, hints (3 tiers), reward.
- Co-op puzzles must work with bots: a bot can press a tile, hold a door, or use its skill when asked (see bots).
- Riddles scale with player count (e.g. 4-player version needs 4 simultaneous presses; 1 human + 3 bots still works).
- Side collectibles: 20 coins and 3 secret gems per level for replay value.

## Multiplayer and bots

One authoritative server room per crew of 4 slots; any slot without a human is a bot, and a human can take over a bot's slot mid-game.

**Networking:**

- Colyseus room with a shared state schema: players (head + two hands pose, character, air, mana, backpack), world objects (position, owner, state), puzzle state, level, timer.
- Clients send head/hand poses at 20–30 Hz; others interpolate with a 100 ms buffer. Local player movement is client-predicted; the server validates.
- Grabbed objects: ownership transfers to the grabbing client; the server resolves conflicts (first grab wins).
- Puzzle solutions and item pickups are decided only on the server.
- Room codes (4 letters) to join friends; "Quick Play" matches public rooms.
- Reconnect: a dropped player's bot takes over, and they get their slot back if they return within 2 minutes.
- Voice: WebRTC mesh (max 4 peers), muffled filter underwater, mute button.

**Bots (run on the server):**

- Each bot plays its character class and uses its skill when a puzzle needs it.
- Behaviour tree: follow the nearest human (stay 2–4 m away) → collect nearby coins → go to the current objective when humans are there → perform the co-op action (press tile, hold door, use skill) → refill air when low.
- Humans can command bots with a point gesture + trigger on a bot: "come here", "go there", "use skill".
- Bots swim with the same physics and visibly bubble-jet, so they look like players. Name tag shows "Bot" with a small icon.
- Bots never solve the main riddle alone; they help, so humans get the "aha".
- Solo play (1 human + 3 bots) must be fully completable.

**Lobby:** host creates a room, picks difficulty (Easy: more air, more hints; Normal; Hard: less air, sharks), chooses characters (no duplicates), and starts. Bots take remaining characters.

## Comfort, performance, audio and UI

Swimming in VR causes motion sickness easily, so comfort settings and a steady frame rate are requirements, not polish.

**Comfort:** vignette that narrows the view during fast bubble-jet movement (on by default, adjustable); snap turn default; seated mode (raises the player height); no camera shake from cannon hits on the player's head, shake the world instead; ship tilt in the intro kept under 10°.

| Performance budget (Quest 3) | Limit |
|---|---|
| Frame rate | 72 fps floor, 90 fps target |
| Triangles on screen | 300k max (Quest 2: 150k) |
| Draw calls | Under 150 (use instancing and merged static meshes) |
| Texture memory | Under 512 MB |
| Real-time lights | 1 directional + light orbs; baked lighting elsewhere |
| Initial download | Under 40 MB; stream later levels while playing |

Use fixed foveated rendering, fog to limit draw distance (about 30 m underwater), LOD models, and a level-streaming loader. Add an FPS debug overlay toggled from settings.

**Audio:** spatial sounds for everything; above water is loud and bright, underwater is low-pass filtered with a constant ambient hum and your own breathing (regulator sound synced with bubble exhale). Music changes per level and swells when a riddle is solved.

**UI (all diegetic where possible):**

- Wrist dive computer on the left arm: air gauge, depth, mana charges, skill cooldown.
- Look at your wrist to open a small menu: map, backpack, team status, settings.
- Teammate markers: coloured icons above heads, visible through walls when far away.
- Riddle text appears on the map and as a floating scroll when discovered, read aloud with optional subtitles.
- Settings: comfort options, volume, height, dominant hand, subtitles, graphics quality.

## Build plan for Claude Code

Build in seven milestones; each ends with a Macaly `preview_app` link I test on the Quest before you continue.

**Suggested repo layout:**

```
/client
  src/core        (renderer, XR session, game loop, asset loader)
  src/input       (controller mapping, grab, gestures)
  src/movement    (swim, bubble jets, buoyancy, comfort)
  src/player      (avatar, IK hands, backpack, skills, magic)
  src/world       (levels, water shaders, fish boids, FX)
  src/net         (Colyseus client, interpolation, voice)
  src/ui          (wrist computer, map, menus)
  src/data        (levels/*.json, riddles, items)
  src/assets/manifest.json
/server
  rooms/CrewRoom.ts, schema/, bots/, puzzles/
BRIEF.md  PROGRESS.md  CREDITS.md
```

**Milestones:**

1. **Setup:** Macaly `skill_info` → `create_app`, Vite + Three.js + WebXR "Enter VR" running on Quest, controllers visible, FPS overlay. Decide where the game server will be hosted and report back.
2. **Movement sandbox:** underwater test scene with fog and caustics; arm swimming, bubble jets, air gauge, grab, comfort vignette. Tune until it feels good.
3. **Intro sequence:** galleon deck, gear rack, map, cannon attack, sinking, dive transition (single player).
4. **Level 1 + systems:** backpack, map pieces, first riddle, one character skill, checkpoints.
5. **Multiplayer:** Colyseus rooms, room codes, pose sync, shared objects, voice, reconnect.
6. **Bots + all classes + magic:** bot behaviour tree, all four skills, rune spells with gesture recognition.
7. **Levels 2–5 + finale, polish:** audio, music, credits screen, performance pass, `publish_app`.

**Acceptance tests (must all pass before "done"):**

- Runs at 72 fps or better on Quest 3 in every level.
- One human + three bots can finish the whole game.
- Four humans on four headsets can join by room code and finish together.
- A player who disconnects is replaced by a bot and can rejoin.
- Bubble jets push the player opposite to the hand direction, scaled by trigger pressure, and use air.
- Every riddle has three hint tiers and is solvable with any mix of humans and bots.
- Every asset is in `manifest.json` with a license, and `CREDITS.md` is shown in-game.
- Comfort vignette, snap turn, and seated mode all work.

**Rules for Claude Code:** keep files small and modular; write unit tests for puzzle logic and server state; commit after each working step; never hard-code asset URLs outside the manifest; ask me before adding paid services or accounts.
