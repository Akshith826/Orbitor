/**
 * "VR by default" check, with a simulated headset.
 *
 * Headless Chrome has no immersive WebXR, so this injects a fake
 * `navigator.xr` that reports immersive-vr support and records every
 * requestSession / offerSession call. It then confirms, on the lobby, the
 * ride, the solar system and every Quest 3 game, that:
 *   • the page offers VR by itself (offerSession + full-screen prompt)
 *   • one click anywhere requests an immersive session inside that gesture
 *   • "Stay in 2D" is remembered for the browsing session
 *   • arriving from another page in VR says "Continue in VR"
 *   • a `sessiongranted` event (WebXR navigation) starts VR with no click
 * and that without a headset no prompt appears at all.
 */
const assert = require('node:assert/strict');
const puppeteer = require('puppeteer');

const base = process.env.VR_TEST_URL || 'http://localhost:5000';
const PAGES = ['/', '/vr-ride', '/vr-solar-system', '/games/orbital-intercept', '/games/asteroid-dodge',
    '/games/lunar-landing', '/games/orbital-docking', '/games/satellite-repair', '/games/mars-rover', '/games/space-rescue'];

function fakeHeadset() {
    const calls = [];
    window.__xrCalls = calls;
    const xr = new EventTarget();
    xr.isSessionSupported = async mode => mode === 'immersive-vr';
    xr.requestSession = mode => {
        calls.push({ type: 'request', mode, gesture: Boolean(navigator.userActivation && navigator.userActivation.isActive) });
        return Promise.reject(new DOMException('simulated headset', 'NotSupportedError'));
    };
    xr.offerSession = mode => {
        calls.push({ type: 'offer', mode });
        return new Promise(() => {});
    };
    Object.defineProperty(navigator, 'xr', { value: xr, configurable: true });
}

async function ready(page, url) {
    await page.goto(base + url, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__lobby || window.__vr, { timeout: 120000 });
}

(async () => {
    const browser = await puppeteer.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader'] });
    const errors = [];
    try {
        const page = await browser.newPage();
        page.setDefaultTimeout(120000);
        await page.setViewport({ width: 1280, height: 800 });
        page.on('pageerror', e => errors.push(e.message));

        // No headset: nothing is offered.
        await ready(page, '/');
        await new Promise(r => setTimeout(r, 500));
        assert.equal(await page.$('#auto-vr'), null, 'no prompt without a headset');
        assert.equal(await page.$eval('#enter-vr', b => b.offsetParent === null), true, 'no Enter VR button in the lobby without a headset');
        console.log('No headset: no VR prompt ✓');

        await page.evaluateOnNewDocument(fakeHeadset);
        for (const url of PAGES) {
            await page.evaluate(() => sessionStorage.clear());
            await ready(page, url);
            await page.waitForSelector('#auto-vr', { visible: true, timeout: 30000 });
            const offered = await page.evaluate(() => window.__xrCalls.filter(c => c.type === 'offer').length);
            assert.ok(offered >= 1, `${url}: browser was asked to offer VR`);
            await page.mouse.click(640, 200);
            await page.waitForFunction(() => window.__xrCalls.some(c => c.type === 'request'), { timeout: 10000 });
            const req = await page.evaluate(() => window.__xrCalls.find(c => c.type === 'request'));
            assert.equal(req.mode, 'immersive-vr', `${url}: immersive session requested`);
            assert.equal(req.gesture, true, `${url}: requested inside the click gesture`);
            assert.equal(await page.$('#auto-vr'), null, `${url}: prompt closes`);
            console.log(`${url}: VR offered, one click requested immersive-vr ✓`);
        }

        // "Stay in 2D" sticks for the session.
        await ready(page, '/vr-ride');
        await page.evaluate(() => sessionStorage.clear());
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#auto-vr .auto-vr-skip', { visible: true });
        await page.click('#auto-vr .auto-vr-skip');
        assert.equal(await page.$('#auto-vr'), null, 'Stay in 2D closes the prompt');
        assert.equal(await page.evaluate(() => window.__xrCalls.some(c => c.type === 'request')), false, 'Stay in 2D does not request VR');
        await page.goto(base + '/games/mars-rover', { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.__vr, { timeout: 120000 });
        await new Promise(r => setTimeout(r, 800));
        assert.equal(await page.$('#auto-vr'), null, 'Stay in 2D remembered on the next page');
        console.log('Stay in 2D remembered ✓');

        // Arriving from VR: "Continue in VR", even after choosing 2D earlier.
        await page.evaluate(() => sessionStorage.setItem('orbitor.vrCarry', String(Date.now())));
        await page.goto(base + '/vr-ride', { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#auto-vr', { visible: true });
        assert.equal(await page.$eval('#auto-vr h2', h => h.textContent), 'Continue in VR');
        console.log('Arriving from VR shows "Continue in VR" ✓');

        // WebXR navigation: sessiongranted starts VR with no click.
        await page.evaluate(() => navigator.xr.dispatchEvent(new Event('sessiongranted')));
        await page.waitForFunction(() => window.__xrCalls.some(c => c.type === 'request'), { timeout: 10000 });
        console.log('sessiongranted resumes VR without a click ✓');

        assert.deepEqual(errors, [], 'no page errors');
        console.log('VR-by-default checks passed.');
    } finally {
        await browser.close();
    }
})().catch(err => {
    console.error(err);
    process.exit(1);
});
