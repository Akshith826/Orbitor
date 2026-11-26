/**
 * The lobby's real sky must put stars where they actually are. These checks
 * compare our fast per-star conversion against astronomy-engine's own
 * horizon calculation, and check two things anyone can verify outside.
 */
const fs = require('node:fs');
let sky, Astronomy, THREE;
beforeAll(async () => {
    sky = await import('../public/js/lobby/real-sky.js');
    Astronomy = await import('../public/js/vendor/astronomy.js');
    THREE = await import('three');
});

const catalog = JSON.parse(fs.readFileSync('public/data/sky.json', 'utf8'));
const named = name => catalog.named.find(n => n[0] === name);
const angleBetween = (a, b) => Math.acos(Math.min(1, a.dot(b))) * 180 / Math.PI;

describe('real sky', () => {
    it('ships every naked-eye star, the constellations and named bright stars', () => {
        expect(catalog.stars.length).toBeGreaterThan(4500);
        expect(catalog.constellations.length).toBe(89);
        for (const star of ['Sirius', 'Vega', 'Betelgeuse', 'Canopus', 'Arcturus']) expect(named(star)).toBeDefined();
    });

    it.each([
        ['Sirius', 17.38, 78.48, '2026-11-27T18:30:00Z'],
        ['Vega', 51.5, -0.12, '2026-07-01T22:00:00Z'],
        ['Canopus', -33.87, 151.21, '2026-02-10T11:00:00Z'],
        ['Arcturus', 40.71, -74.0, '2026-05-15T02:00:00Z']
    ])('places %s within half a degree of astronomy-engine', (name, lat, lon, iso) => {
        const [, ra, dec] = named(name);
        const date = new Date(iso);
        const ours = sky.equatorialToLocal(ra, dec, sky.localSiderealTime(date, lon), lat, new THREE.Vector3()).normalize();
        const hor = Astronomy.Horizon(date, new Astronomy.Observer(lat, lon, 0), ra / 15, dec, null);
        const ref = sky.horizonToLocal(hor.azimuth, hor.altitude, new THREE.Vector3());
        // The catalogue is J2000; precession since then is ~0.37°.
        expect(angleBetween(ours, ref)).toBeLessThan(0.5);
    });

    it('puts the celestial pole at an altitude equal to your latitude', () => {
        for (const lat of [-35, 0, 17.4, 51.5, 64]) {
            const v = sky.equatorialToLocal(0, 90, 7.3, lat, new THREE.Vector3());
            expect(Math.asin(v.y) * 180 / Math.PI).toBeCloseTo(lat, 4);
        }
    });

    it('uses -Z as north and +X as east', () => {
        expect(sky.horizonToLocal(0, 0).z).toBeCloseTo(-1);
        expect(sky.horizonToLocal(90, 0).x).toBeCloseTo(1);
        expect(sky.horizonToLocal(123, 90).y).toBeCloseTo(1);
        expect(sky.compass(0)).toBe('N');
        expect(sky.compass(225)).toBe('SW');
    });
});
