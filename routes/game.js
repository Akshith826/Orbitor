// Mission scoring for the VR Solar System's Scan Hunt. The browser reports the
// facts of a finished run and the server computes the score, using the same
// rule the Scan Hunt has always used. Orbitor has no accounts or database, so
// runs are scored but not stored (`persisted: false`, `progression: null`).
const express = require('express');
const router = express.Router();

const MISSIONS = {
    'scan-hunt': {
        title: 'Scan Hunt',
        facts: {
            found: [0, 20],
            missed: [0, 40],
            elapsedMs: [0, 15 * 60 * 1000]
        },
        score({ found, missed, elapsedMs }, { won }) {
            if (!found) return 0;
            let xp = found * 10 - missed * 2;
            // Speed bonus only for a completed hunt, so quitting early never pays.
            if (won) {
                const seconds = elapsedMs / 1000;
                if (seconds < 60) xp += 15;
                else if (seconds < 120) xp += 8;
            }
            return Math.max(0, Math.round(xp));
        }
    }
};

function validateFacts(mission, reported) {
    const facts = {};
    for (const [key, [min, max]] of Object.entries(mission.facts)) {
        const raw = reported ? reported[key] : undefined;
        const value = raw === undefined ? 0 : Number(raw);
        if (!Number.isFinite(value)) return { ok: false, error: `fact "${key}" is not a number` };
        if (value < min || value > max) return { ok: false, error: `fact "${key}" out of range (${min}..${max})` };
        facts[key] = value;
    }
    return { ok: true, facts };
}

router.MISSIONS = MISSIONS;
router.validateFacts = validateFacts;

// POST /api/game/run — score a finished mission run.
router.post('/run', (req, res) => {
    const { missionId, won, failed, elapsedMs } = req.body || {};
    const mission = Object.hasOwn(MISSIONS, missionId) ? MISSIONS[missionId] : null;
    if (!mission) return res.status(400).json({ success: false, message: `Unknown mission "${missionId}"` });

    const facts = req.body.facts || {};
    const reported = Object.assign({}, facts, {
        elapsedMs: facts.elapsedMs !== undefined ? facts.elapsedMs : elapsedMs
    });
    const check = validateFacts(mission, reported);
    if (!check.ok) return res.status(400).json({ success: false, message: check.error });

    const score = mission.score(check.facts, { won: !!won, failed: !!failed });
    res.json({ success: true, persisted: false, score, progression: null });
});

// GET /api/game/missions — what the server is willing to score.
router.get('/missions', (req, res) => {
    res.json({
        success: true,
        missions: Object.entries(MISSIONS).map(([id, m]) => ({ id, title: m.title, facts: Object.keys(m.facts) }))
    });
});

module.exports = router;
