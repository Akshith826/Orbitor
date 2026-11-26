# Orbitor

The **VR Deep Space Ride** and the seven **Meta Quest 3 VR games** from
[SpaceVerse](https://github.com/karthikguntoju/spaceverse), extracted into a small
standalone app. It needs no database, no accounts and no API keys.

| Experience | URL |
| --- | --- |
| Hub (every experience) | `/` |
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
| `npm run verify:vr` | Puppeteer check of desktop, phone gyro and split-screen modes for the ride and solar system |

The verify scripts read `VR_TEST_URL` (default `http://localhost:5000`). To use an
installed Chrome instead of Puppeteer's download, set `PUPPETEER_EXECUTABLE_PATH`.

## Layout

```
server.js            Express server: pages, static assets, three.js, tiny API
routes/game.js       Server-side Scan Hunt scoring (not stored)
views/               index.html (hub), vr-working.html (WebXR page), quest-guide.html
public/js/vr/        Ride, cockpit, Quest 3 rig, the 7 games, phone stereo, gaze, remote input
public/js/game/      Mission core + Scan Hunt
public/textures/     Planet and star-map textures
public/css, public/js  Shared page styling
tests/, scripts/     Unit tests and Puppeteer browser checks
```

three.js (r182) is served from `node_modules`. The server patches it so the Quest
compositor gets the standard `XRWebGLLayer`, the same patch the original app applies.

## Differences from SpaceVerse

- No login. Every visitor is a guest pilot, and `/api/user` always reports one.
- Personal bests are saved in the browser (`localStorage`), as in the original.
  Scan Hunt runs are scored by the server but not stored.
- The AI chat widget, the 2D arcade, the quiz, the simulator and the other
  SpaceVerse pages are not included.

## License

MIT. See [LICENSE](LICENSE).
