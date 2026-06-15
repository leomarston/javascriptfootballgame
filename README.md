# ⚽ Astra Arena — 3D Football Stadium (JavaScript / Three.js)

A photoreal, **playable** 3D football stadium rendered entirely in the browser
with [Three.js](https://threejs.org/). Regulation pitch, a full two‑tier seating
bowl with a club‑coloured crowd, a cantilever roof, floodlights, animated LED
advertising boards, day/night lighting — and a ball you can actually shoot,
dribble and score with.

It's built to look and feel like a console stadium (the kind you'd see in
*eFootball* / *FIFA*) while being 100% web tech — no Unity, no Blender exports,
every asset generated procedurally in code.

![Aerial — day](screenshots/aerial-day.png)

| Broadcast (day) | Floodlit night |
| --- | --- |
| ![Broadcast day](screenshots/broadcast-day.png) | ![Aerial night](screenshots/aerial-night.png) |

---

## ✨ Features

### The pitch (graphics-first)
- **Regulation IFAB markings** drawn to exact metric measurements — centre circle
  (9.15 m), penalty areas (16.5 m), goal areas, penalty arcs & spots, corner arcs.
- **Realistic turf**: procedurally generated mowing stripes, organic colour
  mottling, goalmouth & centre‑circle wear, plus tiled **normal + roughness maps**
  so sunlight and floodlights rake across the grass.
- **Goals** with round posts, crossbars and a slanted, sagging mesh net.

### The stadium
- **Two‑tier seating bowl** built around a rounded‑rectangle perimeter —
  **~57,000 instanced seats** in a single draw call.
- **Crowd mosaics**: club‑coloured sections, banded patterns and a seat‑art
  *tifo* that spells the home club's name across the main stand.
- **Instanced 3D spectators** filling the stands.
- **Cantilever roof** with structural ribs, a hanging fascia and an under‑roof
  **LED light bank**.
- **Four floodlight pylons** with emissive lamp arrays and real spotlights.
- **Animated LED perimeter boards** with scrolling sponsor hoardings.
- Dugouts, corner flags and a concrete apron.

### Rendering ("the engine look")
- PBR materials, **ACES Filmic** tone mapping, sRGB output.
- Real‑time **shadows**, a physical **Sky** + image‑based reflections (PMREM).
- Post‑processing: **UnrealBloom**, **SMAA** anti‑aliasing.
- **Day / Night** mode with a gradient night dome, stars and a floodlit pitch.
- Automatic graceful degradation on software/headless GL.

### The players (rigged & animated)
- A **fully rigged, skinned humanoid** — 19 bones covering pelvis, spine, chest,
  neck, head, both clavicles, upper/lower arms, hands, thighs, shins and feet.
- **Hand‑authored animation clips** — `idle`, `walk`, `run`, plus a standing
  **tackle** and a **slide** — keyed as real poses and played by an
  `AnimationMixer`. The motion is designed art, not per‑frame procedural code.
- **Speed‑driven blending**: a player eases from idle → walk → run, cross‑fades
  the clips and stride‑syncs playback to ground speed, and turns to face the run.
- One **kit‑configurable rig** (`FieldPlayer`) powers every outfielder — your two
  red HOME players and the blue AWAY defender. The same rig + clips are exported
  to a portable **glTF asset** (`src/assets/player.glb`) you can open in Blender
  or Unity (see *Baking the player*).

### Teams, formations & AI
- Full **11‑v‑11** — two **4‑4‑2** sides (HOME red attacking +X, AWAY blue),
  each a keeper + 4 defenders + 4 midfielders + 2 forwards. Every player has a
  **name** and a set **position** (see `formations.js`).
- **Team shape, not a swarm**: off‑ball players hold an **elastic formation
  slot** — they follow the ball partially (line height + lateral compactness),
  **push up** in possession and **drop** when defending — so the team keeps its
  shape. One teammate offers support; an AI carrier dribbles, passes or shoots.
- **Defending as a unit**: the nearest player **presses** the ball, a second man
  **covers** goal‑side behind him, and the rest **collapse** toward the ball the
  closer the attack gets to goal — so an attacker driving at the box is swarmed
  by the block, not chased by one defender.
- **Auto‑switching control**: you drive the HOME ball carrier; a pass switches you
  to the receiver; when defending you take over the HOME player nearest the ball.
  A yellow **ring** marks your player (its name shows bottom‑left); an auto‑switch
  holds for at least a second so it doesn't flicker, and **Q** switches manually.

### The goalkeeper (smart AI)
- A keeper for the away side on the same rig (teal kit + gloves) with its own
  **authored clips**: a low **ready stance**, a square **shuffle**, explosive
  **dives** (both sides) and a vertical **jump** — get‑ups come free from the
  mixer blending the clamped dive pose back to the stance.
- **Reads the game**: holds its line and shuffles to stay on the ball→goal
  angle, comes off the line to narrow the angle, **predicts a shot's crossing
  point** and only reacts when it's on target — diving the correct way for
  corners, jumping for high central balls, and **ignoring balls going wide**.
- **Catches** soft shots (then punts upfield), **parries** hard ones, blocks
  shots hit at its body, and in a 1‑v‑1 **smothers** the ball off the dribbler.

### Gameplay
- **Close‑control dribbling**: run near a loose ball to **trap** it, then it
  stays glued just ahead of the boots through turns and sprints. A player on the
  ball runs ~15% slower, so dribbling past defenders takes care.
- **Subtle control assist**: when you're already running toward a loose ball your
  player is gently steered onto it (stronger the closer you get) so imprecise
  input doesn't just miss — but it switches off the moment you steer elsewhere.
- Separate **pass**, **shoot** and **cross** actions: a pass finds the teammate
  who's nearest **in the direction you're facing**, the cross floats a lofted
  ball into the **penalty area** (onto a teammate's run when one is there), and
  shots auto‑aim at the corner away from the keeper.
- The camera **always keeps the ball in frame** (leaning toward your player),
  and swings onto the ball after a shot.
- **Tackles and slides** win the ball off a carrier (no fouls): a standing tackle
  takes possession, a slide knocks it loose.
- **Restarts**: out over a touchline is a **throw-in**; out over a goal line is a
  **corner** (defenders put it out) or a **goal kick** (attackers put it out),
  awarded by who touched it last, with the teams repositioned for the set-piece.
  You take HOME's set-pieces from a **behind-the-taker camera** (the goalkeeper
  takes goal kicks) — **left/right aims**, and **holding the kick sets the power
  and height**; it snaps back to the normal camera the instant you kick. AWAY's
  set-pieces are taken by the AI. After a shot the camera follows the **ball**.
- Full arcade **ball physics**: gravity, turf bounce, rolling friction with
  matching spin, aerodynamic drag, reflective walls and **goal‑post collisions**.
- **Goal‑line detection**, live scoreboard with match clock, goal celebration
  and kickoff.
- Four cameras: **Broadcast**, **Follow**, **Aerial** and free **Orbit**.

---

## 🎮 Controls

| Input | Action |
| --- | --- |
| **W A S D / Arrows** | Move (camera‑relative) |
| **Shift** | Sprint |
| **Space** | With the ball: **pass** (hold for power). Defending: **tackle** |
| **J** | Shoot — hold for power, auto‑aimed (capped, so own‑half pot‑shots won't carry) |
| **K** | Cross / lofted ball into the box |
| **X** | Slide tackle (defending) |
| **Q** | Switch player — nearest to the ball; press again to step further |
| **R** | Reset to kickoff |
| **C** | Cycle camera (Broadcast · Follow · Aerial · Free) |
| **N** | Toggle day / night |
| **Free cam** | Drag to orbit, scroll to zoom |

---

## 🚀 Running it

Requires [Node.js](https://nodejs.org/) 18+.

```bash
npm install      # install dependencies (three, vite)
npm run dev      # start the dev server
```

Then open the printed URL (defaults to <http://localhost:5173>).

### Production build

```bash
npm run build    # bundle to dist/
npm run preview  # serve the production build
```

> **Tip:** for the full visual experience (bloom + sky reflections) run it in a
> browser with hardware WebGL. On software renderers those effects are skipped
> automatically and the scene falls back to the analytic lights.

---

## 🧱 Project structure

```
src/
├─ main.js                 # bootstrap: renderer, loop, wiring
├─ config.js               # all dimensions, palette & quality knobs
├─ core/
│  ├─ Environment.js       # sky, sun, lights, fog, day/night, IBL
│  └─ PostFX.js            # bloom + SMAA + ACES output chain
├─ stadium/
│  ├─ Stadium.js           # assembles the whole arena (staged loading)
│  ├─ Pitch.js / PitchTexture.js   # turf + line-marking generation
│  ├─ Goals.js             # posts, crossbars, nets
│  ├─ Stands.js / standMath.js     # instanced seating bowl + tifo
│  ├─ Roof.js              # cantilever roof + LED bank
│  ├─ Crowd.js             # instanced spectators
│  ├─ Floodlights.js       # corner pylons + spotlights
│  ├─ AdBoards.js          # scrolling LED hoardings
│  └─ Surroundings.js      # ground, dugouts, corner flags
├─ game/
│  ├─ Ball.js              # ball mesh + classic panel texture
│  ├─ Physics.js           # bounce / roll / drag / collisions / goals
│  ├─ Gameplay.js          # match engine: control, possession, actions, AI
│  ├─ CameraRig.js         # broadcast / follow / aerial / orbit
│  ├─ FieldPlayer.js       # kit-configurable outfielder (loco + tackle/slide)
│  ├─ Goalkeeper.js        # keeper rig + smart AI (defends either goal)
│  ├─ formations.js        # 4-4-2 team sheets: names, positions, base coords
│  └─ player/
│     ├─ PlayerRig.js              # skeleton + skinned mesh (kit-configurable)
│     ├─ PlayerAnimations.js       # authored idle / walk / run / tackle / slide
│     └─ GoalkeeperAnimations.js   # authored stance / shuffle / dive / jump
├─ assets/player.glb       # exported rig + clips (glTF art asset)
├─ ui/HUD.js               # scoreboard, goal banner, loader
└─ utils/                  # geometry + async helpers
```

Outfielders are built at runtime from `FieldPlayer` (so each team gets its own
kit and the full clip set); `player.glb` is the same rig exported as a portable
artifact. `tools/screenshot.mjs` captures showcase renders headlessly.

### Baking the player

`src/assets/player.glb` is generated from the rig + clips above and can be
re‑baked at any time:

```bash
npm run dev                 # serve the bake page (in one shell)
npm run bake:player         # export src/assets/player.glb (in another)
```

The exporter writes a standard glTF skin with the `idle` / `walk` / `run` /
`tackle` / `slide` clips, so the character drops straight into Blender, Unity
or any glTF viewer.

---

## 📜 License

MIT — have fun building on it.
