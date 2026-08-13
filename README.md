# Space Battle

A 3D space-combat game: two fleets, two 2.6 km capital ships, and 200 fighters tearing each other apart while you fly through the middle of it.

### ▶️ [**Play it in your browser**](https://space-battle-sand.vercel.app)

No install, no plugins. Works on desktop and mobile.

---

## The game

You fly a single fighter in a fleet battle. Your squadron and the enemy's are both 100 ships strong, each capital ship bristles with turrets that shoot back, and the mission is simple: wipe out the enemy fleet before they wipe out you.

**Controls — desktop**

| Input | Action |
|---|---|
| Mouse | Steer (pitch / yaw) |
| `W` / `S` | Throttle / brake |
| `A` / `D` | Strafe |
| `R` / `F` | Vertical thrust |
| `Q` / `E` | Roll |
| `Shift` + `W` | Boost |
| `Space` / left click | Lasers |
| Right click | Guided missile |

**Controls — mobile**

A virtual stick on the right steers the ship; drag diagonally to bank into a turn. `FIRE`, `BOOST` and `MISSILE` sit under your left thumb. The ship cruises forward automatically.

**Missiles** don't fire on demand: hold your crosshair on an enemy and a ring charges around it. Once it reads `TARGET LOCKED`, the missile will chase its mark — and one hit kills any fighter.

**Waves.** Clear the enemy fleet and the next wave doubles it: 100, then 200, then 400. Your side never grows. Capital ships that die stay dead, so losing yours costs you its guns for the rest of the run.

## What's in this repository

This started as a Unity project and grew a browser version, plus the asset pipeline that feeds both.

| Path | What it is |
|---|---|
| `Web/` | The playable browser game — three.js, ~1900 lines, no build step |
| `Assets/` | Unity 6 project (6000.5.7f1): 6DOF flight, one-click scene builder |
| `Tools/Blender/` | Procedural asset pipeline — Python scripts that generate every ship, planet, asteroid and skybox in Blender |
| `Tools/viewer/` | three.js mirror of the pipeline: the same models, built in the browser |
| `Assets/ThirdParty/` | CC0 assets with their licenses documented |
| `cf-rooms/` | Cloudflare Worker: the public-rooms board for multiplayer |
| `api/` | Vercel function that mints short-lived TURN credentials |

### Multiplayer without a game server

Matches are peer-to-peer over WebRTC — the host relays, and nothing runs on a server. That leaves one hole: with no server, there is nobody to ask who is currently playing. `cf-rooms/` fills it with a noticeboard that forgets. Hosts announce themselves every 30 seconds, entries expire after 90, and the whole registry is one Durable Object holding one key.

The intervals are not arbitrary. Cloudflare's free plan allows ~100,000 requests a day across the Worker and the object together, and a heartbeat every 15 seconds would spend it on twenty rooms alone. Reads are served from an 8-second edge cache that is invalidated the moment a room appears or disappears, so browsing is nearly free while the list still reacts instantly to what matters.

### Counting players without tracking them

The same Worker counts how many people actually play — a question neither Vercel Analytics (which counts page opens, and doesn't ship in the portal builds) nor CrazyGames (which only sees its own site) can answer on its own.

Telling one player from another normally means storing something on their device. This doesn't: the server hashes `IP + user agent + a salt that is thrown away every night`, keeps eight bytes of that, and forgets the address. Yesterday's fingerprints can't be compared against today's, so they can only do one thing — avoid counting the same person twice within a day. Nothing is written to the player's browser, which is exactly what would otherwise require a consent banner.

The counters live at `/panel`.

### The models are code

There are almost no model files in this repository. Ships, planets, asteroids and nebulae are all *generated* — the Blender scripts export FBX/GLB for Unity, and `Tools/viewer/space-kit-models.js` builds the same geometry directly in the browser from the same recipes. That's why the browser game ships as ~190 KB of JavaScript: the fleet is written, not stored.

### Rendering 200 ships

The 184 swarm fighters are baked into two merged geometries (hull with vertex colors, emissive parts) and drawn as instanced meshes — the entire swarm costs 4 draw calls and holds 60 fps. Named fighters, capitals and the player are regular scene objects.

## Running it locally

The web game uses ES modules, so it needs a server — `file://` won't work:

```bash
python3 -m http.server 8788 -d /path/to/SpaceBattle
```

Then open `http://127.0.0.1:8788/Web/index.html`.

The public-rooms board runs on its own, and the game degrades gracefully without it — hosting by link and joining by code keep working:

```bash
cd cf-rooms && npx wrangler login && ./deploy.sh
```

### Regenerating the assets

With Blender 4.1+ installed:

```bash
blender --background --python Tools/Blender/generate_all_assets.py -- --slice --skip-skybox
```

Models land in `Assets/Game/Models/Generated/`. In Unity, **Tools → Space Battle → Montar escena base** rebuilds the whole scene around them.

## Credits

Third-party visual assets are CC0, with licenses documented under `Assets/ThirdParty/Licenses/`. The sound effects and music in `Web/assets/` are placeholders used for local development and are not covered by this repository's license — swap them for your own before redistributing.
