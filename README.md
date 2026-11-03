# Bird Game 🕊️

Fly like a bird using your laptop's webcam. Stand back, flap your arms to climb,
lean side to side to steer, and let your arms drop to dive — all tracked from the
camera, no controller needed. Runs entirely in your browser.

After calibrating, pick a mode:
- **Free Roam** — fly anywhere over an endless, hilly landscape (mountains and
  dips scattered here and there), no goal.
- **Time Trial** — race through 8 checkpoint gates in order, against the clock.
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
| **H** | Hide / show the camera preview |

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
- Terrain shape (how mountainous, how sparse): `TERRAIN_CONSTANTS` at the top
  of [`src/terrain.js`](src/terrain.js). Change `SEED` for a different world.
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
| `src/terrain.js` | Deterministic, endless terrain height (mountains/dips). |
| `src/course.js` | The Time Trial checkpoint list, progress, and timer. |
| `src/checkpoints.js` | The 3D checkpoint gate rings. |
| `src/bird.js` | The bird's 3D shape and flapping wings. |
| `src/scene.js` / `src/world.js` | Ground, sky, scenery, and the chase camera. |
| `src/ui.js` | On-screen text, mode select, and the timer/results screens. |


## Wild / Wings visual update

The launch screen now opens before any camera request. Choose a bald eagle,
pigeon, or seagull to see its animated 3D preview, then choose Free Roam or
Time Trial. Each bird has a distinct silhouette, plumage, beak, and layered
flight feathers; flight physics are shared across characters.

Keyboard controls are the default: arrow keys or WASD turn, climb, and dive.
Select Body motion to use the existing camera tracking and calibration flow.
The Change bird / Menu button restarts at the selection screen.

The environment features larger layered pines, clustered clouds, warm lighting,
and a snow-capped mountain panorama. The distant peaks are scenic; ground
collision still follows the procedural terrain. Trees remain visual scenery.


## Momentum, flaps, and wind experiment

- Dive to gain speed; pull up to spend momentum on altitude. A faster approach
  carries you higher. Low-speed climbs ease toward level flight, and fast zoom
  climbs can coast above the soft ceiling.
- Keyboard: tap Space for one flap. Holding Space does not repeat strokes.
- Camera: a quick raised-arm/downstroke cycle (120–650 ms) gives one speed
  impulse. Hold arms high or low for 500 ms to climb or dive. Quick strokes
  retain your prior pitch; keeping arms down afterward begins a dive.
- Five flap charges. Each accepted stroke uses one charge, with at least
  280 ms between strokes. Recharge starts after 1.5 seconds without a flap,
  at one charge per second. Exhaustion blocks flapping for three seconds;
  charges continue to recover. Wind and dives still work during cooldown.
- Follow the translucent mint tunnels in the direction of their moving rings
  and streaks. Boosts fade near the edges and depend on alignment. Momentum
  persists after leaving. The first stream starts straight ahead of spawn.
- The HUD displays airspeed, remaining charges, recovery countdown, and flight
  state. Camera field of view widens slightly with speed.

Tuning lives in `FLIGHT_CONSTANTS`, `CONTROL_CONSTANTS`, and `WIND_TEMPLATES`.
All three birds currently share these settings. Time-trial records use a new
storage version because the speed model changed. Automated gesture tests use
synthetic poses; real camera timing still needs personal playtesting.
