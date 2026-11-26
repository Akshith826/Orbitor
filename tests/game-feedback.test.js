/**
 * Game feedback and controls regressions.
 *
 * Shots, shield blocks, EMPs, tether latches and the like raise events before
 * the frame's run.update(). update() used to clear the event list first, so
 * none of those explosions, sounds or haptics ever played. Events now persist
 * until the host game plays and clears them.
 */
let InterceptRun, DodgeRun, ArcadeRun, shapeAxis, readThumbstick, smoothQuestSticks;
beforeAll(async () => {
    ({ InterceptRun } = await import('../public/js/vr/intercept-run.js'));
    ({ DodgeRun } = await import('../public/js/vr/dodge-run.js'));
    ({ ArcadeRun } = await import('../public/js/vr/arcade-run.js'));
    ({ shapeAxis, readThumbstick, smoothQuestSticks } = await import('../public/js/vr/xr-support.js'));
});

const types = run => run.events.map(e => e.type);
function playing(run, step = 0.05) {
    run.play();
    for (let i = 0; i < 80 && run.state !== 'playing'; i++) run.update(step, {});
    run.events = [];
    return run;
}

describe('events raised before update() survive the frame', () => {
    it('Orbital Intercept keeps laser and kill events', () => {
        const run = playing(new InterceptRun(() => 0.5));
        run.targets.push({ id: 999, kind: 'meteor', x: 0, y: 0, z: -10, vx: 0, vy: 0, vz: 0, hp: 1, maxHp: 1, radius: 1 });
        run.fireBlaster({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 });
        run.update(0.016, {});
        expect(types(run)).toEqual(expect.arrayContaining(['laser', 'target-destroyed']));
    });

    it('Asteroid Dodge keeps the crystal hit', () => {
        const run = playing(new DodgeRun(() => 0.5));
        run.crystals.push({ id: 1, x: 0, y: 0.5, z: -20, speed: 10 });
        run.fireBlaster({ x: 0, y: 0.5, z: 0 }, { x: 0, y: 0, z: -1 });
        run.update(0.016, 0);
        expect(types(run)).toContain('crystal-hit');
    });

    it('Space Rescue keeps the tether latch and win', () => {
        const run = playing(new ArcadeRun('space-rescue', () => 0.3));
        for (let i = 0; i < 240; i++) run.update(0.05, {});
        expect(run.action('match')).toBe(true);
        for (let i = 0; i < 20; i++) run.update(0.05, {});
        run.events = [];
        expect(run.action('tether')).toBe(true);
        run.update(0.016, {});
        expect(types(run)).toEqual(expect.arrayContaining(['tether-latch', 'won']));
    });
});

describe('game dynamics', () => {
    it('a deflected bolt hits the closest threat, not a shielded boss', () => {
        const run = playing(new InterceptRun(() => 0.5));
        run.targets.push(
            { id: 1, kind: 'boss', x: 0, y: 1.5, z: -15, hp: 10, maxHp: 10, radius: 1.75, fireTimer: 9 },
            { id: 2, kind: 'pylon', parentId: 1, orbitAngle: 0, x: 3, y: 1.5, z: -14.2, hp: 2, maxHp: 2, radius: 0.7, fireTimer: 99 },
            { id: 3, kind: 'scout', x: 1, y: 1, z: -9, vx: 0, vz: 0, hp: 1, maxHp: 1, radius: 0.9, fireTimer: 9, phase: 0 }
        );
        run.enemyShots.push({ id: 9, x: 0, y: 0, z: -0.6, vx: 0, vy: 0, vz: 0 });
        expect(run.deflectWithShield({ x: 0, y: 0, z: -0.6 })).toBe(1);
        expect(run.targets.find(t => t.id === 3)).toBeUndefined();
        expect(run.targets.find(t => t.id === 1).hp).toBe(10);
    });

    it('Orbital Docking starts rolled off-axis, so roll alignment matters', () => {
        for (const r of [0.1, 0.4, 0.6, 0.9]) {
            const run = new ArcadeRun('orbital-docking', () => r);
            expect(Math.abs(run.roll)).toBeGreaterThan(0.45);
        }
    });
});

describe('Touch Plus sticks', () => {
    const pad = (x, y) => ({ axes: [0, 0, x, y] });

    it('gives fine control near centre and full power at full tilt', () => {
        expect(shapeAxis(0)).toBe(0);
        expect(shapeAxis(1)).toBeCloseTo(1);
        expect(shapeAxis(-1)).toBeCloseTo(-1);
        expect(shapeAxis(0.5)).toBeLessThan(0.5);
        expect(readThumbstick(pad(1, 0)).x).toBeCloseTo(1);
        expect(readThumbstick(pad(0.1, 0.1))).toEqual({ x: 0, y: 0 });
        expect(readThumbstick(pad(0.5, 0)).x).toBeLessThan(0.5);
    });

    it('smooths a sudden full tilt over a few frames and settles back to zero', () => {
        let prev = { left: { stick: { x: 0, y: 0 } }, right: { stick: { x: 0, y: 0 } } };
        const frame = x => smoothQuestSticks({ left: { stick: { x, y: 0 } }, right: { stick: { x: 0, y: 0 } } }, prev, 1 / 72);
        prev = frame(1);
        expect(prev.left.stick.x).toBeGreaterThan(0.1);
        expect(prev.left.stick.x).toBeLessThan(0.3);
        for (let i = 0; i < 40; i++) prev = frame(1);
        expect(prev.left.stick.x).toBeGreaterThan(0.98);
        for (let i = 0; i < 60; i++) prev = frame(0);
        expect(prev.left.stick.x).toBe(0);
    });
});
