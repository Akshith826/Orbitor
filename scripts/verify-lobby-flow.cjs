/**
 * Lobby → experience → lobby without ever reloading the page.
 *
 * A WebXR session belongs to one document, so the headset only stays in VR
 * if every move is a same-page switch. This marks the window object on the
 * lobby and confirms the same window survives launching the ride (from a 3D
 * panel click), going back, opening a Quest 3 game from the dock, and
 * browser back/forward. It also runs the Deep Space Ride end to end and
 * checks that a one-line fact is spoken for the Sun and every planet.
 */
const assert = require('node:assert/strict');
const puppeteer = require('puppeteer');

const base = process.env.VR_TEST_URL || 'http://localhost:5000';
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
    const browser = await puppeteer.launch({ headless: true, protocolTimeout: 300000, args: ['--use-gl=angle', '--use-angle=swiftshader'] });
    const errors = [];
    try {
        const page = await browser.newPage();
        page.setDefaultTimeout(120000);
        await page.setViewport({ width: 1280, height: 800 });
        page.on('pageerror', e => errors.push(e.message));
        page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

        await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.__vr && window.__vr.mode === 'lobby' && window.__vr.lobby.hitTargets.length === 9);
        await page.evaluate(() => { window.__sameDocument = 'yes'; });
        const state = () => page.evaluate(() => ({
            path: location.pathname, same: window.__sameDocument, entry: window.__vr.entry, mode: window.__vr.mode,
            lobby: window.__vr.lobby.visible, menu: document.getElementById('mode-menu').classList.contains('show'),
            system: window.__vr.system.root.visible
        }));
        let s = await state();
        assert.equal(s.lobby, true, 'lobby visible at /');
        console.log('Lobby open at / ✓');

        // Click the Deep Space Ride panel in the 3D scene.
        const xy = await page.evaluate(() => {
            const v = window.__vr;
            const mesh = v.lobby.panels.find(p => p.exp.slug === 'vr-ride').mesh;
            const p = mesh.getWorldPosition(mesh.position.clone()).project(v.camera);
            return { x: (p.x + 1) / 2 * innerWidth, y: (1 - p.y) / 2 * innerHeight };
        });
        await page.mouse.click(xy.x, xy.y);
        await page.waitForFunction(() => location.pathname === '/vr-ride' && document.getElementById('mode-menu').classList.contains('show'), { timeout: 120000 });
        s = await state();
        assert.deepEqual([s.same, s.entry, s.lobby, s.menu, s.system], ['yes', 'ride', false, true, true], 'ride opened in place');
        console.log('3D panel → /vr-ride, same page, ride menu shown ✓');

        // Run the ride and collect what is said.
        const spoken = await page.evaluate(async () => {
            const v = window.__vr;
            const said = [];
            v.speak = text => said.push(text);
            v.startRide();
            v.renderer.setAnimationLoop(null);
            v.ride.playing = true;
            for (let t = 0; t < v.ride.total; t += 0.25) {
                v.ride.seek(t);
                v.announcePlanets();
            }
            v.ride.stop();
            return said;
        });
        const PLANET_FACTS = await page.evaluate(() => import('/public/js/vr/planet-announcer.js?v=20261126-3').then(m => m.PLANET_FACTS));
        const facts = spoken.filter(t => Object.values(PLANET_FACTS).includes(t));
        const keys = facts.map(t => Object.keys(PLANET_FACTS).find(k => PLANET_FACTS[k] === t));
        assert.deepEqual([...keys].sort(), Object.keys(PLANET_FACTS).sort(), 'every planet announced once: ' + keys.join(', '));
        console.log('Ride planet facts in order: ' + keys.join(' → ') + ' ✓');
        await page.evaluate(() => window.__vr.renderer.setAnimationLoop((t, f) => window.__vr.loop(f)));

        // Back to the lobby with the top-bar link.
        await page.click('#home-link');
        await page.waitForFunction(() => location.pathname === '/' && window.__vr.mode === 'lobby');
        s = await state();
        assert.deepEqual([s.same, s.lobby, s.system], ['yes', true, false], 'back in the lobby, same page');
        console.log('← Lobby, same page ✓');

        // Dock link to a Quest 3 game.
        await page.click('#lobby-dock a[href="/games/mars-rover"]');
        await page.waitForFunction(() => location.pathname === '/games/mars-rover' && document.getElementById('mode-menu').classList.contains('show'));
        s = await state();
        assert.deepEqual([s.same, s.entry, s.lobby], ['yes', 'dodge', false]);
        const deck = await page.evaluate(() => getComputedStyle(document.getElementById('quest3-deck')).display);
        assert.notEqual(deck, 'none', 'Quest 3 deck shown');
        assert.equal(await page.title(), 'Mars Rover Expedition — Meta Quest 3 · SpaceVerse');
        console.log('Dock → Mars Rover, same page, Quest 3 deck shown ✓');

        // Another game straight after: the right game is selected.
        await page.evaluate(() => window.__vr.goTo('/games/orbital-intercept'));
        s = await state();
        assert.equal(await page.evaluate(() => Boolean(window.__vr.interceptGame && !window.__vr.flightGame)), true);
        console.log('Switch game to game in place ✓');

        // Browser back / forward.
        await page.goBack();
        await page.waitForFunction(() => location.pathname === '/games/mars-rover' && window.__vr.flightGame);
        await page.goBack();
        await page.waitForFunction(() => location.pathname === '/' && window.__vr.mode === 'lobby');
        await page.goForward();
        await page.waitForFunction(() => location.pathname === '/games/mars-rover');
        assert.equal((await state()).same, 'yes');
        console.log('Back / forward stay on the same page ✓');

        // Trigger pull with a controller ray aimed at a lobby panel (the headset path).
        await page.evaluate(() => window.__vr.goTo('/'));
        await page.evaluate(() => {
            const v = window.__vr;
            const panel = v.lobby.panels.find(p => p.exp.slug === 'orbital-docking').mesh;
            const target = panel.getWorldPosition(panel.position.clone());
            const controller = new v.dolly.constructor();
            controller.visible = true;
            v.scene.add(controller);
            // Controllers aim down their -Z axis; Object3D.lookAt points +Z, so look away from the panel.
            controller.lookAt(target.clone().multiplyScalar(-1));
            controller.updateMatrixWorld(true);
            v.onControllerSelect(controller);
        });
        await page.waitForFunction(() => location.pathname === '/games/orbital-docking' && document.getElementById('mode-menu').classList.contains('show'));
        assert.equal((await state()).same, 'yes');
        console.log('Controller ray + trigger on a panel launches it in place ✓');
        await page.evaluate(() => window.__vr.goTo('/games/mars-rover'));

        // Start the game after switching, to be sure it actually runs.
        await page.evaluate(() => window.__vr.startDodge());
        await wait(600);
        assert.equal(await page.evaluate(() => window.__vr.mode), 'dodge');
        console.log('Game starts after an in-place switch ✓');

        assert.deepEqual(errors, [], 'no page errors');
        console.log('Lobby flow checks passed.');
    } finally {
        await browser.close();
    }
})().catch(err => {
    console.error(err);
    process.exit(1);
});
