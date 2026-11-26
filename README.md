# Orbitor

The **VR Deep Space Ride** and the seven **Meta Quest 3 VR games**, as a small
standalone app that runs in VR by default. (Originally extracted from the
[SpaceVerse](https://github.com/karthikguntoju/spaceverse) project.) It needs no database, no accounts and no API keys.

| Experience | URL |
| --- | --- |
| VR lobby (every experience) | `/` (also `/games`) |
| VR Deep Space Ride | `/vr-ride` |
| VR Solar System (free flight + Scan Hunt) | `/vr-solar-system` |
| Orbital Intercept | `/games/orbital-intercept` |
| Asteroid Dodge | `/games/asteroid-dodge` |
| Lunar Landing | `/games/lunar-landing` |
| Orbital Docking | `/games/orbital-docking` |
| Satellite Repair | `/games/satellite-repair` |
| Mars Rover Expedition | `/games/mars-rover` |
| Space Rescue | `/games/space-rescue` |
| Meta Quest guide | `/quest-guide` |

The ride and the Quest games all run on one WebXR page. The VR Solar System
is included because it shares that page and renderer with the ride.

## VR by default

The whole app is built to be used in a headset:

- **The home page is a 3D lobby.** You float above Earth inside a ring of
  holographic launch panels. On a Quest, point a Touch Plus controller and pull
  the trigger to launch. On a desktop, drag to look and click a panel. On a phone,
  drag with a finger and tap. A row of plain links along the bottom does the same
  job for keyboards, screen readers and browsers without WebGL.
- **Every page enters VR on its own.** On a device with immersive WebXR, each page
  asks the browser to offer VR (`navigator.xr.offerSession`) and shows a full-screen
  *Enter VR* prompt, so the first trigger pull anywhere puts you in the headset.
  **Stay in 2D** dismisses it for the rest of the browsing session.
- **You never leave VR.** The lobby, the ride, the solar system and all seven
  games live on one page. Launching from the lobby, choosing **Back to lobby**
  in the grip menu, or using browser back/forward switches the experience in
  place (the address bar still updates), so the headset session is never
  dropped and there is no 2D loading screen in between.
- **Planet facts on the ride.** As the Deep Space Ride closes in on the Sun and
  each planet, Mission Control says a one-sentence fact about it (and shows it
  on the cockpit display). It follows the **AI Mission Control Voice** setting.
- Desktops and phones without a headset see no prompt. The games, ride and phone
  modes behave exactly as before.

The logic lives in [`public/js/vr/auto-vr.js`](public/js/vr/auto-vr.js),
[`public/js/lobby/lobby-scene.js`](public/js/lobby/lobby-scene.js) and
[`public/js/vr/planet-announcer.js`](public/js/vr/planet-announcer.js).

## Quick start

Requires Node.js 20 or newer.

```bash
npm install
npm start            # http://localhost:5000
```

### Meta Quest 3 / phone VR

Headset VR (WebXR) and phone motion sensors only work on a secure origin.
A Quest can't use your laptop's `localhost`, so serve over HTTPS on your LAN:

```bash
npm run start:https
```

The server prints a `https://<LAN-IP>:5000` address. Open it in the **Meta Quest
Browser** on the same Wi-Fi, accept the self-signed certificate warning, pick a game
and choose **Enter VR**. The certificate is generated into `certs/` on first run.

On a normal screen everything works with mouse + keyboard. On a phone, use **Gyro
look** or **Phone VR (Cardboard)** split-screen.

## Scripts

| Script | What it does |
| --- | --- |
| `npm start` | Run the server on `PORT` (default 5000) |
| `npm run start:https` | Same, over HTTPS with a self-signed cert (also `HTTPS=true`) |
| `npm test` | Vitest unit tests for the VR modules plus server route tests |
| `npm run verify:quest` | Puppeteer check of the hub and all 7 Quest games (server must be running) |
| `npm run verify:auto-vr` | Simulated-headset check that every page offers VR and enters it on one click (server must be running) |
| `npm run verify:lobby` | Lobby → ride → games → back without a page reload, plus every planet fact on the ride (server must be running) |
| `npm run verify:vr` | Puppeteer check of desktop, phone gyro and split-screen modes for the ride and solar system |

The verify scripts read `VR_TEST_URL` (default `http://localhost:5000`). To use an
installed Chrome instead of Puppeteer's download, set `PUPPETEER_EXECUTABLE_PATH`.

## Deploying to Vercel

This repo is configured for zero-issue deployment on Vercel via `vercel.json`, `api/index.js`, and `scripts/build-vercel.cjs`:

- `npm install --omit=dev` skips `puppeteer` and test devDependencies during Vercel installs.
- `node scripts/build-vercel.cjs` prepares `dist/` (`public/`, `favicon.ico`, and `/lib/three/` including the patched `webxr.module.js`) so Vercel's CDN serves large textures and ES modules directly without hitting serverless payload limits.
- `api/index.js` wraps the Express app from `server.js` for HTML routes and `/api/*` endpoints.

Deploy with `vercel` or import the repository in the Vercel dashboard (no extra environment variables or build overrides required).

## Layout

```
server.js            Express server: pages, static assets, three.js, tiny API
routes/game.js       Server-side Scan Hunt scoring (not stored)
views/               vr-working.html (the WebXR page: lobby + every experience), quest-guide.html
public/js/lobby/     The lobby scene (launch panels, Earth, starfield)
public/js/vr/        auto-vr.js (VR by default), ride, cockpit, Quest 3 rig, the 7 games, phone stereo, gaze, remote input
public/js/game/      Mission core + Scan Hunt
public/textures/     Planet and star-map textures
public/css, public/js  Shared page styling
tests/, scripts/     Unit tests and Puppeteer browser checks
```

three.js (r182) is served from `node_modules`. The server patches it so the Quest
compositor gets the standard `XRWebGLLayer`, the same patch the original app applies.

## Differences from the original project

- No login. Every visitor is a guest pilot, and `/api/user` always reports one.
- Personal bests are saved in the browser (`localStorage`), as in the original.
  Scan Hunt runs are scored by the server but not stored.
- The home page is a 3D VR lobby, and every page enters VR by default (see above).
- The AI chat widget, the 2D arcade, the quiz, the simulator and the other
  pages of the original project are not included.

## License

MIT. See [LICENSE](LICENSE).
