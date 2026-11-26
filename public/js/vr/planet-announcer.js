/**
 * Spoken one-line facts as the Deep Space Ride approaches each planet.
 *
 * Pure logic, no Three.js or audio: the host reports how far the ship is
 * from each body every frame, and check() returns the fact to say (once per
 * body per ride) when the ship is closing in on it.
 */
export const PLANET_FACTS = {
    earth: 'Earth, our home — the only world known to hold life, with oceans covering seventy-one percent of its surface.',
    sun: 'The Sun — a star so vast that about 1.3 million Earths could fit inside it.',
    mercury: 'Mercury, the smallest planet, swings from 430 degrees by day to minus 180 at night.',
    venus: 'Venus, the hottest planet, hides under clouds of sulphuric acid at around 465 degrees Celsius.',
    mars: 'Mars, the red planet, is home to Olympus Mons, a volcano nearly three times taller than Everest.',
    jupiter: 'Jupiter, the largest planet, is a gas giant with nearly a hundred known moons.',
    saturn: 'Saturn is so light for its size that it would float in a bathtub big enough to hold it.',
    uranus: 'Uranus, an ice giant, takes eighty-four Earth years to orbit the Sun once.',
    neptune: 'Neptune, the farthest planet, needs one hundred and sixty-five Earth years for a single orbit.'
};

/** How close counts as "approaching": a few radii, plus a margin for small worlds. */
export function approachDistance(radius) {
    return radius * 3 + 14;
}

export class PlanetAnnouncer {
    constructor({ facts = PLANET_FACTS, cooldown = 3.5 } = {}) {
        this.facts = facts;
        this.cooldown = cooldown;
        this.reset();
    }

    reset() {
        this.announced = new Set();
        this.lastDistance = new Map();
        this.quietUntil = -Infinity;
    }

    /**
     * @param {{key: string, distance: number, radius: number}[]} bodies
     * @param {number} now  seconds, any monotonic clock
     * @returns {{key: string, text: string}|null}
     */
    check(bodies, now) {
        let best = null;
        for (const b of bodies) {
            const prev = this.lastDistance.get(b.key);
            this.lastDistance.set(b.key, b.distance);
            if (this.announced.has(b.key) || !this.facts[b.key]) continue;
            if (b.distance > approachDistance(b.radius)) continue;
            // Closing in (or already as close as we get); never on the way out.
            if (prev !== undefined && b.distance > prev + 1e-6) continue;
            const closeness = b.distance / approachDistance(b.radius);
            if (!best || closeness < best.closeness) best = { key: b.key, closeness };
        }
        if (!best || now < this.quietUntil) return null;
        this.announced.add(best.key);
        this.quietUntil = now + this.cooldown;
        return { key: best.key, text: this.facts[best.key] };
    }
}
