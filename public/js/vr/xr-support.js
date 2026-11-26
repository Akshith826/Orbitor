export async function immersiveVRStatus(xr, secure) {
    if (!secure) return { label: 'Headset VR needs HTTPS', available: false };
    if (!xr) return { label: 'Headset VR unavailable in this browser', available: false };
    try {
        const available = await xr.isSessionSupported('immersive-vr');
        return { label: available ? 'Enter headset VR' : 'No compatible headset detected', available };
    } catch {
        // Some runtimes refuse capability polling but accept an explicit request.
        return { label: 'Try headset VR', available: typeof xr.requestSession === 'function' };
    }
}

export async function questOnlyVRStatus(xr, secure) {
    if (!secure) {
        return {
            label: 'Meta Quest 3 requires HTTPS',
            available: false,
            reason: 'Open this Orbitor address over trusted HTTPS inside your Meta Quest 3 Browser.'
        };
    }
    if (!xr) {
        return {
            label: 'Open in Meta Quest 3 Browser',
            available: false,
            reason: 'This experience is built exclusively for Meta Quest 3 with Touch Plus controllers.'
        };
    }
    try {
        const available = await xr.isSessionSupported('immersive-vr');
        return {
            label: available ? 'Launch in Meta Quest 3' : 'Open in Meta Quest 3 Browser',
            available,
            reason: available ? '' : 'No Meta Quest 3 immersive WebXR headset detected on this device.'
        };
    } catch {
        const canRequest = typeof xr.requestSession === 'function';
        return {
            label: canRequest ? 'Launch in Meta Quest 3' : 'Open in Meta Quest 3 Browser',
            available: canRequest,
            reason: canRequest ? '' : 'WebXR immersive-vr is unavailable.'
        };
    }
}

/**
 * Stick response curve. Small tilts give fine, slow control; full tilt still
 * reaches 1. `expo` 0 is linear, 1 is fully cubic.
 */
export const STICK_EXPO = 0.4;
export function shapeAxis(v, expo = STICK_EXPO) {
    return v * (1 - expo + expo * v * v);
}

/** Rescale a stick past its radial deadzone and apply the response curve. */
function shapeStick(rawX, rawY, deadzone) {
    const mag = Math.hypot(rawX, rawY);
    if (mag < deadzone) return { x: 0, y: 0 };
    const clamped = Math.min(1, mag);
    const shaped = shapeAxis((clamped - deadzone) / (1 - deadzone));
    const factor = shaped / mag;
    return {
        x: Math.max(-1, Math.min(1, rawX * factor)),
        y: Math.max(-1, Math.min(1, rawY * factor))
    };
}

export function readThumbstick(gamepad, deadzone = 0.18) {
    // xr-standard reserves axes 0/1 for the touchpad and 2/3 for the stick.
    // Accept the two-axis layout some nonstandard controllers expose.
    const axes = gamepad?.axes;
    const offset = axes?.length >= 4 ? 2 : 0;
    const rawX = Number.isFinite(axes?.[offset]) ? axes[offset] : 0;
    const rawY = Number.isFinite(axes?.[offset + 1]) ? axes[offset + 1] : 0;
    return shapeStick(rawX, rawY, deadzone);
}

/**
 * Smooth both Touch Plus sticks over time (frame-rate independent), so a
 * twitchy thumb or a noisy stick never jerks the view or the craft. Mutates
 * and returns `current`; `previous` is last frame's smoothed reading.
 */
export function smoothQuestSticks(current, previous, dt, rate = 14) {
    if (!current) return current;
    const k = 1 - Math.exp(-Math.max(0, Math.min(0.1, Number.isFinite(dt) ? dt : 0)) * rate);
    for (const hand of ['left', 'right']) {
        const c = current[hand];
        const p = previous?.[hand];
        if (!c?.stick || !p?.stick) continue;
        let x = p.stick.x + (c.stick.x - p.stick.x) * k;
        let y = p.stick.y + (c.stick.y - p.stick.y) * k;
        if (c.stick.x === 0 && Math.abs(x) < 0.01) x = 0;
        if (c.stick.y === 0 && Math.abs(y) < 0.01) y = 0;
        c.stick = { x, y };
    }
    return current;
}

export function readQuestHand(gamepad, deadzone = 0.16) {
    const empty = {
        connected: false,
        stick: { x: 0, y: 0 },
        trigger: 0,
        triggerPressed: false,
        grip: 0,
        gripPressed: false,
        stickPressed: false,
        primary: false,
        secondary: false
    };
    if (!gamepad) return empty;

    const axes = gamepad.axes || [];
    const offset = axes.length >= 4 ? 2 : 0;
    const rawX = Number.isFinite(axes[offset]) ? axes[offset] : 0;
    const rawY = Number.isFinite(axes[offset + 1]) ? axes[offset + 1] : 0;
    const stick = shapeStick(rawX, rawY, deadzone);

    const buttons = gamepad.buttons || [];
    const btn0 = buttons[0];
    const btn1 = buttons[1];
    const trigger = Math.max(0, Math.min(1, Number.isFinite(btn0?.value) ? btn0.value : (btn0?.pressed ? 1 : 0)));
    const grip = Math.max(0, Math.min(1, Number.isFinite(btn1?.value) ? btn1.value : (btn1?.pressed ? 1 : 0)));

    return {
        connected: true,
        stick,
        trigger,
        triggerPressed: Boolean(btn0?.pressed || trigger > 0.65),
        grip,
        gripPressed: Boolean(btn1?.pressed || grip > 0.65),
        stickPressed: Boolean(buttons[3]?.pressed),
        primary: Boolean(buttons[4]?.pressed),
        secondary: Boolean(buttons[5]?.pressed)
    };
}

function withEdges(current, previous) {
    return {
        ...current,
        triggerJustPressed: Boolean(current.triggerPressed && !previous?.triggerPressed),
        gripJustPressed: Boolean(current.gripPressed && !previous?.gripPressed),
        primaryJustPressed: Boolean(current.primary && !previous?.primary),
        secondaryJustPressed: Boolean(current.secondary && !previous?.secondary),
        stickJustPressed: Boolean(current.stickPressed && !previous?.stickPressed)
    };
}

export function readQuestControllers(session, prev = null) {
    let leftRaw = readQuestHand(null);
    let rightRaw = readQuestHand(null);
    let connected = 0;

    for (const source of session?.inputSources || []) {
        if (!source?.gamepad) continue;
        const hand = readQuestHand(source.gamepad);
        if (source.handedness === 'left') {
            leftRaw = hand;
            connected++;
        } else if (source.handedness === 'right') {
            rightRaw = hand;
            connected++;
        } else if (!rightRaw.connected) {
            rightRaw = hand;
            connected++;
        } else if (!leftRaw.connected) {
            leftRaw = hand;
            connected++;
        }
    }

    return {
        connected,
        left: withEdges(leftRaw, prev?.left),
        right: withEdges(rightRaw, prev?.right)
    };
}

export function pulseQuestController(session, handedness = 'both', intensity = 0.4, durationMs = 40) {
    if (!session?.inputSources) return;
    const amp = Math.max(0, Math.min(1, Number.isFinite(intensity) ? intensity : 0));
    const ms = Math.max(8, Math.min(1500, Number.isFinite(durationMs) ? durationMs : 40));
    if (amp <= 0) return;

    for (const source of session.inputSources) {
        if (handedness !== 'both' && source.handedness !== handedness) continue;
        const gamepad = source.gamepad;
        if (!gamepad) continue;
        try {
            const actuator = gamepad.hapticActuators?.[0];
            if (actuator && typeof actuator.pulse === 'function') {
                Promise.resolve(actuator.pulse(amp, ms)).catch(() => {});
                continue;
            }
            if (gamepad.vibrationActuator && typeof gamepad.vibrationActuator.playEffect === 'function') {
                Promise.resolve(gamepad.vibrationActuator.playEffect('dual-rumble', {
                    startDelay: 0,
                    duration: ms,
                    weakMagnitude: amp * 0.8,
                    strongMagnitude: amp
                })).catch(() => {});
            }
        } catch {
            /* ignore unsupported runtime haptics */
        }
    }
}

export function setRayFromObject(raycaster, obj) {
    if (!raycaster || !obj) return raycaster;
    obj.updateWorldMatrix(true, false);
    return raycaster.setFromXRController(obj);
}
