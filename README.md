# Bird Game 🕊️

Fly like a bird using your laptop's webcam. Stand back, flap your arms to climb,
lean side to side to steer, and let your arms drop to dive — all tracked from the
camera, no controller needed. Runs entirely in your browser.

After calibrating, pick a mode:
- **Free Roam** — fly anywhere over an endless sunset sea dotted with beach
  islets, among floating sky islands with waterfalls, ruins and cherry trees.
  Follow the gold marker to collect sky petals: finishing a set of 8 opens a
  new one wherever you are.
- **Time Trial** — race through 8 glowing gold rings in order, against the clock.
  Your best time is remembered on this computer.

## Controls

| Your body              | The bird does |
| ---------------------- | ------------- |
| Raise / hold arms up   | Climb ⬆️ (flapping adds an extra boost) |
| Lower your arms        | Dive ⬇️ (and speed up) |
| Lean / tilt left       | Bank & turn left ↩️ |
| Lean / tilt right      | Bank & turn right ↪️ |

Keyboard while flying:

| Key | Does |
| --- | ---- |
| **C** | Recalibrate — stand straight & still for a second (use this if the bird drifts/turns on its own) |
| **H** | Hide / show the camera view |
| **Esc** | Pause; also stops the Time Trial clock (lists all the controls) |

## Running it

You need **Node.js** installed (version 20.19+ or 22+). Check by opening the
Terminal and running:

```
node -v
```

If that prints a version number you're set. If not, download the "LTS" installer
from [nodejs.org](https://nodejs.org) and run it like any other Mac app, then
reopen the Terminal.

Then, from this folder:

```
npm install      # one time only — downloads the game's building blocks
npm run dev      # starts the game
```

`npm run dev` prints a local address like `http://localhost:5173`. **Open that in
Google Chrome**, and:

1. Click **Allow** when Chrome asks for camera access.
2. Step back ~4–6 feet so your head, shoulders, and hips are all in view, with
   decent lighting in front of you.
3. Hold still for the 3-second calibration countdown.
4. Choose **Free Roam** or **Time Trial**.
5. Fly! Raise your arms to climb, lean to turn, drop your arms to dive.

In Time Trial, fly through the glowing gold gate — the ring turns green once
you've passed through it and the next one lights up gold. Finishing shows your
time and lets you fly again or change mode.

If the bird ever gets stuck turning or drifting, press **C**, sit/stand
straight, and hold still for a second to re-center your neutral pose.

Keep the Terminal window open while you play. Press `Ctrl+C` in it to stop.

> Chrome is the best-supported browser. Safari may work but is not the primary
> target for this prototype.

## Tuning the feel

If a control feels backwards or too sensitive, the knobs live in a few files:

- Flight feel (turn rate, climb/dive strength, speed, drag):
  `FLIGHT_CONSTANTS` at the top of [`src/flight.js`](src/flight.js).
- Body-tracking sensitivity (how hard you must lean/flap):
  `CONTROL_CONSTANTS` at the top of [`src/controls.js`](src/controls.js).
- Terrain shape (how many islets, how tall): `TERRAIN_CONSTANTS` at the top
  of [`src/terrain.js`](src/terrain.js). Change `SEED` for a different world.
  `SEABED_DROP` sets how far the land sits below the sea.
- Floating islands (how many, how big, how high): `ISLAND_CONSTANTS` and the
  island designs in [`src/islands.js`](src/islands.js).
- Sky colours and sun position: `SKY_PALETTE` and `SUN_DIRECTION` in
  [`src/sky.js`](src/sky.js).
- Sky petals (how many, how close you must fly): `PETAL_CONSTANTS` at the top
  of [`src/petals.js`](src/petals.js).
- Time Trial course layout: `CHECKPOINTS` in [`src/course.js`](src/course.js).

If leaning one way turns the bird the *opposite* way, flip `turnSignMultiplier`
in `src/controls.js` from `1` to `-1`.

## Tests

```
npm test          # fast logic tests for the flight physics & control mapping
npm run test:e2e  # browser smoke test (boots the app, checks it reaches "flying")
```

## How it's built

- **[Vite](https://vitejs.dev)** — dev server.
- **[Three.js](https://threejs.org)** — 3D graphics (the bird, sky, camera).
- **[MediaPipe Tasks Vision](https://ai.google.dev/edge/mediapipe)** — full-body
  pose tracking from the webcam, running entirely on your machine.

| File | Responsibility |
| ---- | -------------- |
| `src/main.js` | Ties everything together; game state machine + main loop. |
| `src/poseTracking.js` | Webcam access + running the pose-detection model. |
| `src/calibration.js` | The 3-second "hold still" baseline capture. |
| `src/controls.js` | Turns body pose into turn/flap flight inputs. |
| `src/flight.js` | The flight physics (how inputs move the bird). |
| `src/terrain.js` | Deterministic, endless terrain height; sea level and seabed. |
| `src/islands.js` | Where floating islands are, and bumping into them. |
| `src/islandModels.js` | Builds and streams the floating islands' 3D models. |
| `src/sky.js` / `src/sea.js` | Golden-hour sky and sun; the turquoise sea. |
| `src/course.js` | The Time Trial checkpoint list, progress, and timer. |
| `src/petals.js` / `src/petalModels.js` | Sky petal placement and collecting; their 3D models. |
| `src/checkpoints.js` | The glowing gold checkpoint rings. |
| `src/bird.js` | The bird's 3D shape and flapping wings. |
| `src/scene.js` / `src/world.js` | Lighting, seabed and islets, clouds, and the chase camera. |
| `src/ui.js` | On-screen text, mode select, and the timer/results screens. |


## Wild / Wings visual update

The launch screen opens before any camera request. Pick a bird to see its
animated 3D preview, then choose Camera or Keyboard and Free Roam or Time Trial.
Each bird has a distinct silhouette, plumage, beak, and layered flight feathers;
flight physics are shared across characters.

Camera is the default. **Camera setup** shows a large mirrored view, waits until
you're in frame, then counts down while you hold steady. Keyboard skips this:
arrow keys or WASD turn, climb, and dive, and holding Space flaps.

In flight, **Pause [Esc]** freezes everything, including the race clock, and
lists the controls. **Back to nest** returns to the menu.

## Dreamflight look

The world is a golden-hour sky over a turquoise sea. Floating islands with
sandstone cliffs, waterfalls, ruined arches and columns, and cherry blossom
trees fill the sky endlessly, the same every visit. Islands are solid: you can
skim across their grass, but you slide off their rock instead of flying through
it. Their undersides never hang lower than 48, so low flying (and the whole
Time Trial course) is always clear. Trees and ruins are scenery you can fly
through. Each bird's wings are built from layered feathers and bend at the
wrist when flapping; the white dove is the default bird.


## Flapping, climbing, and momentum

Flying is meant to be easy, with momentum as a bonus rather than a hurdle:

- **Climbing always works.** Holding up (or raising your arms) climbs steadily,
  even at low speed, and a slow bird eases back up to cruising speed.
- **Flapping = speed and lift.** Hold Space, or flap your arms in any rhythm:
  the bird speeds up and rises. Flap while climbing to gain speed going up.
- **Diving = lots of speed.** A few seconds of diving reaches 45+ m/s, and
  pulling out turns that speed into a big zoom climb.
- **Stamina.** About 8 seconds of non-stop flapping empties the bar. Tired
  flapping still works at 40% strength; glide for a moment and it refills in ~3s.
- **Camera controls.** How much your wrists are moving sets flap strength, so
  big, small, fast or slow flaps all count straight away. The average height of
  your arms steers: above the shoulders climbs, held down by your sides dives.
  Flapping with your arms low doesn't count as a dive.
- Follow the translucent mint wind streams for a free boost.

Tuning lives in `FLIGHT_CONSTANTS`, `CONTROL_CONSTANTS`, and `WIND_TEMPLATES`.
All three birds currently share these settings. Time-trial records use a new
storage version because the speed model changed. Automated gesture tests use
synthetic poses; real camera timing still needs personal playtesting.
