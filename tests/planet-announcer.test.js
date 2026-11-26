let PlanetAnnouncer, PLANET_FACTS, approachDistance;
beforeAll(async () => ({ PlanetAnnouncer, PLANET_FACTS, approachDistance } = await import('../public/js/vr/planet-announcer.js')));

const at = (key, distance, radius = 10) => ({ key, distance, radius });

describe('PlanetAnnouncer', () => {
    it('has one short sentence for the Sun and each of the eight planets', () => {
        expect(Object.keys(PLANET_FACTS).sort()).toEqual(
            ['earth', 'jupiter', 'mars', 'mercury', 'neptune', 'saturn', 'sun', 'uranus', 'venus']);
        for (const text of Object.values(PLANET_FACTS)) {
            expect(text.split(/[.!?](\s|$)/).filter(s => s && s.trim()).length).toBe(1);
            expect(text.length).toBeLessThan(120);
        }
    });

    it('stays quiet while a planet is still far away', () => {
        const a = new PlanetAnnouncer();
        expect(a.check([at('mars', approachDistance(10) + 1)], 0)).toBeNull();
    });

    it('announces a planet once as the ship closes in', () => {
        const a = new PlanetAnnouncer();
        expect(a.check([at('mars', 60)], 0)).toBeNull();
        expect(a.check([at('mars', 40)], 1)).toEqual({ key: 'mars', text: PLANET_FACTS.mars });
        expect(a.check([at('mars', 30)], 10)).toBeNull();
    });

    it('never announces a planet the ship is moving away from', () => {
        const a = new PlanetAnnouncer();
        expect(a.check([at('venus', 20)], 0)).not.toBeNull();
        const b = new PlanetAnnouncer();
        b.check([at('saturn', 20)], 0);
        b.announced.clear();
        expect(b.check([at('saturn', 25)], 1)).toBeNull();
    });

    it('leaves a gap between facts, then says the next one', () => {
        const a = new PlanetAnnouncer({ cooldown: 3 });
        expect(a.check([at('mercury', 5), at('sun', 60, 30)], 0).key).toBe('mercury');
        expect(a.check([at('sun', 55, 30)], 1)).toBeNull();
        expect(a.check([at('sun', 50, 30)], 3.5).key).toBe('sun');
    });

    it('picks the closest planet when several are in range', () => {
        const a = new PlanetAnnouncer();
        expect(a.check([at('uranus', 40), at('neptune', 15)], 0).key).toBe('neptune');
    });

    it('starts over for a new ride', () => {
        const a = new PlanetAnnouncer();
        a.check([at('jupiter', 20)], 0);
        a.reset();
        expect(a.check([at('jupiter', 20)], 0).key).toBe('jupiter');
    });

    it('ignores bodies it has no fact for', () => {
        expect(new PlanetAnnouncer().check([at('ceres', 1)], 0)).toBeNull();
    });
});
