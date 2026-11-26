/**
 * VR by default.
 *
 * Every Orbitor page calls setupAutoVR() once its scene is ready. On a device
 * with an immersive headset (Meta Quest Browser) the page goes into VR without
 * hunting for an "Enter VR" button, using the best mechanism the browser has:
 *
 *   1. WebXR navigation — `sessiongranted` fires when the previous page was in
 *      VR and navigated here, so the new page can resume immersion directly.
 *   2. `navigator.xr.offerSession()` — the browser shows its own Enter VR prompt
 *      without needing a click on the page.
 *   3. A full-screen "pull the trigger to enter VR" layer. WebXR only starts a
 *      session from a user gesture, so the first trigger/tap anywhere starts it.
 *
 * Desktop and phone browsers without immersive VR are left untouched.
 */
const STAY_2D_KEY = 'orbitor.stay2d';
const CARRY_KEY = 'orbitor.vrCarry';

export const XR_SESSION_INIT = { optionalFeatures: ['hand-tracking'] };

function storage() {
    try { return window.sessionStorage; } catch { return null; }
}

/** Remember that the user is moving between pages while in VR. */
export function markVRNavigation() {
    try { storage()?.setItem(CARRY_KEY, String(Date.now())); } catch { /* private mode */ }
}

/** Navigate to another Orbitor page, keeping the headset in VR where possible. */
export function navigateInVR(url, session) {
    markVRNavigation();
    // Ending the session first lets browsers without WebXR navigation unload
    // cleanly; Quest Browser with navigation support grants the next page a
    // session either way.
    const go = () => { location.href = url; };
    if (session) session.end().then(go, go);
    else go();
}

function cameFromVR() {
    try {
        const at = Number(storage()?.getItem(CARRY_KEY) || 0);
        storage()?.removeItem(CARRY_KEY);
        return at > 0 && Date.now() - at < 60000;
    } catch { return false; }
}

function stays2D() {
    try { return storage()?.getItem(STAY_2D_KEY) === '1'; } catch { return false; }
}

function buildPrompt(text, sub, fromVR) {
    const layer = document.createElement('div');
    layer.id = 'auto-vr';
    layer.setAttribute('role', 'dialog');
    layer.setAttribute('aria-label', 'Enter VR');
    layer.innerHTML = `
        <div class="auto-vr-card">
            <div class="auto-vr-icon" aria-hidden="true">🥽</div>
            <h2></h2>
            <p class="auto-vr-sub"></p>
            <button type="button" class="auto-vr-go">Enter VR</button>
            <button type="button" class="auto-vr-skip">Stay in 2D</button>
        </div>`;
    layer.querySelector('h2').textContent = fromVR ? 'Continue in VR' : text;
    layer.querySelector('.auto-vr-sub').textContent = sub;
    const style = document.createElement('style');
    style.textContent = `
        #auto-vr { position: fixed; inset: 0; z-index: 2147483000; display: flex; align-items: center; justify-content: center;
            background: radial-gradient(circle at 50% 40%, rgba(20,40,80,.82), rgba(2,6,16,.94)); cursor: pointer;
            font-family: Inter, system-ui, sans-serif; color: #e8eefc; animation: autoVrIn .35s ease-out; }
        #auto-vr .auto-vr-card { text-align: center; padding: 36px 40px; max-width: 440px; border-radius: 24px;
            border: 1px solid rgba(100,255,218,.35); background: rgba(8,15,28,.7); box-shadow: 0 0 60px rgba(100,255,218,.18); }
        #auto-vr .auto-vr-icon { font-size: 56px; animation: autoVrPulse 1.8s ease-in-out infinite; }
        #auto-vr h2 { font-family: Orbitron, Inter, sans-serif; letter-spacing: .06em; margin: 12px 0 8px; font-size: 24px; }
        #auto-vr .auto-vr-sub { color: #9aa8c7; line-height: 1.5; margin: 0 0 22px; }
        #auto-vr button { font: inherit; border-radius: 999px; cursor: pointer; }
        #auto-vr .auto-vr-go { display: block; width: 100%; padding: 14px 20px; font-weight: 700; font-size: 18px;
            color: #04121a; background: #64ffda; border: 0; }
        #auto-vr .auto-vr-skip { margin-top: 12px; padding: 8px 16px; color: #9aa8c7; background: transparent;
            border: 1px solid rgba(255,255,255,.16); }
        @keyframes autoVrIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes autoVrPulse { 50% { transform: scale(1.12); } }`;
    document.head.appendChild(style);
    document.body.appendChild(layer);
    return layer;
}

/**
 * @param {object} opts
 * @param {(session: XRSession|null) => Promise<void>|void} opts.enter
 *        Start immersive VR. Called with a session the browser already granted
 *        (offerSession), or null — then it must call requestSession itself,
 *        synchronously inside the user gesture that triggered it.
 * @param {() => boolean} opts.isActive  True while a session is running or starting.
 * @param {string} [opts.title]  Prompt heading.
 * @param {string} [opts.sub]    Prompt detail line.
 * @returns {Promise<{supported: boolean}>}
 */
export async function setupAutoVR({ enter, isActive, title = 'Enter VR', sub = 'Pull the trigger anywhere to put this experience in your headset.' }) {
    const xr = navigator.xr;
    if (!xr || !window.isSecureContext) return { supported: false };
    let supported = false;
    try { supported = await xr.isSessionSupported('immersive-vr'); } catch { supported = false; }
    if (!supported) return { supported: false };

    const fromVR = cameFromVR();
    let prompt = null;
    const closePrompt = () => { prompt?.remove(); prompt = null; };
    const start = session => {
        closePrompt();
        if (isActive()) { session?.end().catch(() => {}); return; }
        return enter(session || null);
    };

    // 1. WebXR navigation: the previous page was immersive.
    xr.addEventListener?.('sessiongranted', () => { if (!isActive()) start(null); });

    if (stays2D() && !fromVR) return { supported: true };

    // 2. Let the browser offer VR itself.
    if (typeof xr.offerSession === 'function') {
        xr.offerSession('immersive-vr', XR_SESSION_INIT).then(start, () => {});
    }

    // 3. One trigger pull / tap anywhere.
    prompt = buildPrompt(title, sub, fromVR);
    prompt.addEventListener('click', ev => {
        if (ev.target.closest('.auto-vr-skip')) {
            try { storage()?.setItem(STAY_2D_KEY, '1'); } catch { /* private mode */ }
            closePrompt();
            return;
        }
        start(null);
    });
    return { supported: true };
}
