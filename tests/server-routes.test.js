/**
 * Every route the VR Deep Space Ride and the Meta Quest 3 games depend on is
 * served by the standalone server, with no login and no database.
 */
const fs = require('node:fs');
const path = require('node:path');
const request = require('supertest');
const app = require('../server');

const QUEST_GAMES = ['orbital-intercept', 'asteroid-dodge', 'lunar-landing', 'orbital-docking',
    'satellite-repair', 'mars-rover', 'space-rescue'];

describe('pages', () => {
    it('serves the hub at /, /games and /app, linking every experience', async () => {
        for (const url of ['/', '/games', '/app']) {
            const res = await request(app).get(url).expect(200);
            expect(res.text).toContain('href="/vr-ride"');
            for (const slug of QUEST_GAMES) expect(res.text).toContain(`href="/games/${slug}"`);
        }
    });

    it('serves the WebXR page for the ride, solar system and all seven Quest games', async () => {
        for (const url of ['/vr-ride', '/vr-solar-system', ...QUEST_GAMES.map(s => '/games/' + s)]) {
            const res = await request(app).get(url).expect(200);
            expect(res.text).toContain('/public/js/vr/main.js');
            expect(res.text).toContain('id="quest3-deck"');
        }
    });

    it('serves the Meta Quest guide and redirects unknown games to the hub', async () => {
        await request(app).get('/quest-guide').expect(200);
        await request(app).get('/games/not-a-game').expect(302).expect('Location', '/games');
    });

    it('sends a CSP and allows WebXR for this origin', async () => {
        const res = await request(app).get('/vr-ride');
        expect(res.headers['content-security-policy']).toContain("default-src 'self'");
        expect(res.headers['permissions-policy']).toContain('xr-spatial-tracking=(self)');
    });
});

describe('assets', () => {
    it('serves three.js with the XRWebGLLayer patch, and its addons', async () => {
        const three = await request(app).get('/lib/three/webxr.module.js').expect(200).expect('Content-Type', /javascript/);
        expect(three.text).toContain("typeof XRWebGLLayer !== 'function'");
        await request(app).get('/lib/three/addons/postprocessing/UnrealBloomPass.js').expect(200);
        await request(app).get('/lib/three/addons/geometries/RoundedBoxGeometry.js').expect(200);
        await request(app).get('/lib/three/addons/environments/RoomEnvironment.js').expect(200);
    });

    it('has every file the VR page and its modules reference', async () => {
        const root = path.join(__dirname, '..');
        const html = fs.readFileSync(path.join(root, 'views', 'vr-working.html'), 'utf8');
        const urls = new Set([...html.matchAll(/(?:src|href)="(\/public\/[^"?]+)/g)].map(m => m[1]));
        const vrDir = path.join(root, 'public', 'js', 'vr');
        const sources = fs.readdirSync(vrDir).map(f => fs.readFileSync(path.join(vrDir, f), 'utf8'));
        for (const src of sources) {
            for (const m of src.matchAll(/'(\/public\/[^'?]+)'/g)) urls.add(m[1]);
            for (const m of src.matchAll(/from '(\.{1,2}\/[^'?]+)/g)) {
                urls.add('/public/js/' + path.posix.normalize('vr/' + m[1]));
            }
        }
        expect(urls.size).toBeGreaterThan(30);
        for (const url of urls) await request(app).get(url).expect(200);
    });
});

describe('api', () => {
    it('treats every visitor as a guest pilot', async () => {
        const res = await request(app).get('/api/user').expect(200);
        expect(res.body.loggedIn).toBe(true);
        expect(res.body.ephemeral).toBe(true);
        await request(app).post('/api/login').send({ username: 'x', password: 'y' }).expect(200);
    });

    it('scores a Scan Hunt run without storing it', async () => {
        const res = await request(app).post('/api/game/run')
            .send({ missionId: 'scan-hunt', won: true, elapsedMs: 50000, facts: { found: 5, missed: 1 } })
            .expect(200);
        expect(res.body).toMatchObject({ success: true, persisted: false, score: 5 * 10 - 2 + 15, progression: null });
    });

    it('rejects unknown missions and out-of-range facts', async () => {
        await request(app).post('/api/game/run').send({ missionId: 'nope' }).expect(400);
        await request(app).post('/api/game/run').send({ missionId: 'scan-hunt', facts: { found: 999 } }).expect(400);
        await request(app).post('/api/game/run').send({ missionId: '__proto__' }).expect(400);
    });
});
