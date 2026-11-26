/**
 * Orbitor VR lobby — the home screen as a place you stand in.
 *
 * A ring of holographic launch panels floats around the viewer above Earth.
 * The same scene works three ways:
 *   • headset  — WebXR, Touch Plus controller rays, trigger to launch
 *   • desktop  — drag to look, click a panel
 *   • phone    — drag (touch) to look, tap a panel
 * Launching from inside VR keeps the headset in VR on the next page
 * (see auto-vr.js).
 */
import * as THREE from 'three';
import { Quest3Rig } from '../vr/quest3-rig.js?v=20261125-q3';
import { setupAutoVR, navigateInVR, XR_SESSION_INIT } from '../vr/auto-vr.js?v=20261126-1';

const EXPERIENCES = [
    { row: 0, slug: 'vr-ride', url: '/vr-ride', icon: '🎢', tag: 'RIDE · 3 MIN', title: 'VR Deep Space Ride', accent: '#ff8ba7',
        text: 'Rail-guided plunge from the pilot seat: solar slingshot, asteroid gauntlet, Jupiter roll, Saturn’s rings.' },
    { row: 0, slug: 'vr-solar-system', url: '/vr-solar-system', icon: '🌌', tag: 'FREE FLIGHT', title: 'VR Solar System', accent: '#7aa2ff',
        text: 'Fly among twelve textured worlds and their moons, or take the 90-second Scan Hunt.' },
    { row: 1, slug: 'orbital-intercept', icon: '🛡️', title: 'Orbital Intercept', accent: '#64ffda',
        text: 'Dual-wield shield and blaster combat in Earth orbit.' },
    { row: 1, slug: 'asteroid-dodge', icon: '☄️', title: 'Asteroid Dodge', accent: '#ffb46b',
        text: 'Bank through a Saturn-ring trench and blast crystals.' },
    { row: 1, slug: 'lunar-landing', icon: '🌕', title: 'Lunar Landing', accent: '#cfe1ff',
        text: 'Feather the retro engine and set down on PAD 01.' },
    { row: 1, slug: 'orbital-docking', icon: '🛰️', title: 'Orbital Docking', accent: '#80e8ff',
        text: 'Match roll, bleed velocity, lock onto the ISS collar.' },
    { row: 1, slug: 'satellite-repair', icon: '🔧', title: 'Satellite Repair', accent: '#ffd196',
        text: 'Grapple spares and weld faulty bays back online.' },
    { row: 1, slug: 'mars-rover', icon: '🪨', title: 'Mars Rover', accent: '#ffb281',
        text: 'Drive Jezero canyon and drill three core samples.' },
    { row: 1, slug: 'space-rescue', icon: '🧑‍🚀', title: 'Space Rescue', accent: '#8ff2d9',
        text: 'Match drift, fire the tether harpoon, reel them home.' }
];
for (const e of EXPERIENCES) {
    if (!e.url) e.url = '/games/' + e.slug;
    if (!e.tag) e.tag = 'QUEST 3';
}

const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const DEG = Math.PI / 180;
const RADIUS = 2.6;

function bestScore(slug) {
    try { return Number(localStorage.getItem('spaceverse.arcade.' + slug + '.best') || 0); } catch { return 0; }
}

function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

function wrap(ctx, text, maxW) {
    const lines = [];
    let line = '';
    for (const word of text.split(' ')) {
        const next = line ? line + ' ' + word : word;
        if (ctx.measureText(next).width > maxW && line) { lines.push(line); line = word; }
        else line = next;
    }
    if (line) lines.push(line);
    return lines;
}

function panelTexture(exp, w, h, renderer) {
    const W = 1024, H = Math.round(W * h / w);
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const x = c.getContext('2d');
    const pad = 44;

    const bg = x.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, 'rgba(14,24,46,0.96)');
    bg.addColorStop(1, 'rgba(6,11,24,0.96)');
    roundRect(x, 6, 6, W - 12, H - 12, 48);
    x.fillStyle = bg; x.fill();
    const glow = x.createRadialGradient(W * 0.85, 0, 0, W * 0.85, 0, W * 0.7);
    glow.addColorStop(0, exp.accent + '55');
    glow.addColorStop(1, exp.accent + '00');
    x.fillStyle = glow; x.fill();
    x.lineWidth = 6; x.strokeStyle = exp.accent + 'aa'; x.stroke();

    x.textBaseline = 'top';
    x.font = `${Math.round(H * 0.17)}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;
    x.fillText(exp.icon, pad, pad - 6);

    x.font = '700 30px Inter, sans-serif';
    const tw = x.measureText(exp.tag).width + 36;
    roundRect(x, W - pad - tw, pad, tw, 50, 25);
    x.strokeStyle = exp.accent; x.lineWidth = 3; x.stroke();
    x.fillStyle = exp.accent; x.fillText(exp.tag, W - pad - tw + 18, pad + 10);

    let size = Math.round(H * 0.11);
    x.font = `800 ${size}px Orbitron, Inter, sans-serif`;
    while (x.measureText(exp.title.toUpperCase()).width > W - pad * 2 && size > 30) {
        size -= 2;
        x.font = `800 ${size}px Orbitron, Inter, sans-serif`;
    }
    const titleY = pad + H * 0.22;
    x.fillStyle = '#eef4ff';
    x.fillText(exp.title.toUpperCase(), pad, titleY);

    x.font = `400 ${Math.round(H * 0.068)}px Inter, sans-serif`;
    x.fillStyle = '#a8b6d6';
    const lineH = Math.round(H * 0.09);
    wrap(x, exp.text, W - pad * 2).slice(0, 3).forEach((line, i) => x.fillText(line, pad, titleY + size + 22 + i * lineH));

    x.textBaseline = 'alphabetic';
    x.font = `700 ${Math.round(H * 0.065)}px Inter, sans-serif`;
    x.fillStyle = exp.accent;
    x.fillText('LAUNCH →', pad, H - pad);
    const best = bestScore(exp.slug);
    if (best > 0) {
        x.fillStyle = '#a8b6d6';
        x.textAlign = 'right';
        x.fillText('BEST ' + best.toLocaleString(), W - pad, H - pad);
        x.textAlign = 'left';
    }

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    return tex;
}

function textTexture(lines, W, H) {
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const x = c.getContext('2d');
    x.textAlign = 'center';
    for (const { text, font, color, y, glow } of lines) {
        x.font = font;
        x.fillStyle = color;
        x.shadowColor = glow || 'transparent';
        x.shadowBlur = glow ? 28 : 0;
        x.fillText(text, W / 2, y);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
}

function glowSprite(color, size) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g; x.fillRect(0, 0, 128, 128);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
        map: new THREE.CanvasTexture(c), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true
    }));
    s.scale.setScalar(size);
    return s;
}

class Lobby {
    constructor() {
        this.panels = [];
        this.hovered = new Set();
        this.yaw = 0;
        this.pitch = -0.04;
        this.session = null;
        this.starting = false;
        this.clock = new THREE.Clock();
        this.raycaster = new THREE.Raycaster();
        this.pointer = new THREE.Vector2(9, 9);
        this.launching = false;
    }

    async init() {
        const r = this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
        r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
        r.setSize(innerWidth, innerHeight);
        r.outputColorSpace = THREE.SRGBColorSpace;
        r.toneMapping = THREE.ACESFilmicToneMapping;
        r.xr.enabled = true;
        r.xr.setReferenceSpaceType('local');
        $('lobby').appendChild(r.domElement);

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x02040a);
        this.camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 2000);
        this.dolly = new THREE.Group();
        this.dolly.add(this.camera);
        this.scene.add(this.dolly);

        this.buildSpace();
        try { await Promise.race([document.fonts.load('800 40px Orbitron'), new Promise(res => setTimeout(res, 2500))]); } catch { /* fonts optional */ }
        this.buildPanels();

        this.rig = new Quest3Rig({
            renderer: r,
            dolly: this.dolly,
            onSelect: controller => this.onControllerSelect(controller)
        });

        this.bindInput();
        window.addEventListener('resize', () => this.onResize());
        r.setAnimationLoop(() => this.loop());

        $('loading').classList.add('done');
        window.__lobby = this;

        const { supported } = await setupAutoVR({
            enter: s => this.enterVR(s),
            isActive: () => Boolean(this.session || this.starting),
            title: 'Enter the Orbitor lobby',
            sub: 'Pull the trigger anywhere to step into VR. Point at a panel and pull again to launch.'
        });
        const vrBtn = $('enter-vr');
        if (supported) {
            vrBtn.hidden = false;
            vrBtn.onclick = () => this.enterVR(null);
        }
    }

    buildSpace() {
        const loader = new THREE.TextureLoader();
        const tex = (url, srgb = true) => {
            const t = loader.load(url);
            if (srgb) t.colorSpace = THREE.SRGBColorSpace;
            return t;
        };

        const sky = new THREE.Mesh(
            new THREE.SphereGeometry(900, 48, 32),
            new THREE.MeshBasicMaterial({ map: tex('/public/textures/star-map.jpg'), side: THREE.BackSide, color: 0x8a96b8 })
        );
        this.sky = sky;
        this.scene.add(sky);

        // Bright foreground stars so the void has depth in a headset.
        const n = 1400, pos = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) {
            const v = new THREE.Vector3().randomDirection().multiplyScalar(80 + Math.random() * 300);
            pos.set([v.x, v.y, v.z], i * 3);
        }
        const starGeo = new THREE.BufferGeometry();
        starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        this.stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xdfe8ff, size: 0.9, sizeAttenuation: true, transparent: true, opacity: 0.85 }));
        this.scene.add(this.stars);

        this.scene.add(new THREE.AmbientLight(0x6070a0, 0.35));
        const sun = new THREE.DirectionalLight(0xfff2dd, 3.2);
        sun.position.set(-60, 30, 40);
        this.scene.add(sun);
        const sunGlow = glowSprite('rgba(255,236,200,1)', 70);
        sunGlow.position.set(-300, 150, 200);
        this.scene.add(sunGlow);

        // Earth fills the lower view, as if the lobby orbits above it.
        this.earth = new THREE.Group();
        this.earth.position.set(0, -44, -52);
        this.earth.rotation.z = 0.35;
        const earthBody = new THREE.Mesh(
            new THREE.SphereGeometry(34, 96, 64),
            new THREE.MeshStandardMaterial({ map: tex('/public/textures/earth.jpg'), roughness: 0.9, metalness: 0 })
        );
        const clouds = new THREE.Mesh(
            new THREE.SphereGeometry(34.3, 96, 64),
            new THREE.MeshStandardMaterial({ map: tex('/public/textures/earth-clouds.png'), transparent: true, opacity: 0.8, depthWrite: false })
        );
        const atmosphere = new THREE.Mesh(
            new THREE.SphereGeometry(36, 64, 48),
            new THREE.ShaderMaterial({
                transparent: true, side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false,
                vertexShader: 'varying vec3 vN; void main(){ vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
                fragmentShader: 'varying vec3 vN; void main(){ float i = pow(0.72 - dot(vN, vec3(0.0,0.0,1.0)), 3.0); gl_FragColor = vec4(0.35,0.65,1.0,1.0) * i; }'
            })
        );
        this.clouds = clouds;
        this.earth.add(earthBody, clouds, atmosphere);
        this.earthBody = earthBody;
        this.scene.add(this.earth);

        const moon = new THREE.Mesh(
            new THREE.SphereGeometry(3.2, 48, 32),
            new THREE.MeshStandardMaterial({ map: tex('/public/textures/moon.jpg'), roughness: 1 })
        );
        moon.position.set(48, 22, -120);
        this.scene.add(moon);

        // A faint ring on the "floor" anchors the panels in space.
        const ring = new THREE.Mesh(
            new THREE.RingGeometry(RADIUS - 0.02, RADIUS + 0.02, 128, 1, -80 * DEG + Math.PI / 2, 160 * DEG),
            new THREE.MeshBasicMaterial({ color: 0x64ffda, transparent: true, opacity: 0.35, side: THREE.DoubleSide })
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = -0.95;
        this.scene.add(ring);
        const disc = new THREE.Mesh(
            new THREE.CircleGeometry(0.7, 64),
            new THREE.MeshBasicMaterial({ color: 0x64ffda, transparent: true, opacity: 0.08 })
        );
        disc.rotation.x = -Math.PI / 2;
        disc.position.y = -1.2;
        this.scene.add(disc);
    }

    buildPanels() {
        const title = new THREE.Mesh(
            new THREE.PlaneGeometry(2.2, 0.55),
            new THREE.MeshBasicMaterial({
                map: textTexture([
                    { text: 'ORBITOR', font: '800 150px Orbitron, Inter, sans-serif', color: '#eaf6ff', y: 160, glow: '#64ffda' },
                    { text: 'VR SPACE RIDE  ·  META QUEST 3 GAMES', font: '600 40px Inter, sans-serif', color: '#64ffda', y: 236 }
                ], 1600, 400),
                transparent: true, depthWrite: false
            })
        );
        title.position.set(0, 0.98, -RADIUS - 0.35);
        this.title = title;
        this.scene.add(title);

        const rows = [
            { y: 0.3, w: 1.08, h: 0.56, step: 25 },
            { y: -0.38, w: 0.66, h: 0.46, step: 15.5 }
        ];
        for (const [ri, row] of rows.entries()) {
            const items = EXPERIENCES.filter(e => e.row === ri);
            items.forEach((exp, i) => {
                const angle = (i - (items.length - 1) / 2) * row.step * DEG;
                const group = new THREE.Group();
                group.position.set(Math.sin(angle) * RADIUS, row.y, -Math.cos(angle) * RADIUS);
                group.lookAt(0, row.y, 0);

                const mesh = new THREE.Mesh(
                    new THREE.PlaneGeometry(row.w, row.h),
                    new THREE.MeshBasicMaterial({ map: panelTexture(exp, row.w, row.h, this.renderer), transparent: true })
                );
                mesh.userData.exp = exp;
                const halo = new THREE.Mesh(
                    new THREE.PlaneGeometry(row.w * 1.08, row.h * 1.12),
                    new THREE.MeshBasicMaterial({ color: new THREE.Color(exp.accent), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })
                );
                halo.position.z = -0.01;
                group.add(halo, mesh);
                this.scene.add(group);
                this.panels.push({ exp, group, mesh, halo, baseY: row.y, phase: Math.random() * Math.PI * 2, hover: 0 });
            });
        }
        this.hitTargets = this.panels.map(p => p.mesh);
    }

    /* ── input ─────────────────────────────────────────────────────── */

    bindInput() {
        const el = this.renderer.domElement;
        let down = null;
        el.addEventListener('pointerdown', e => {
            down = { x: e.clientX, y: e.clientY, yaw: this.yaw, pitch: this.pitch, moved: false };
            el.setPointerCapture(e.pointerId);
        });
        el.addEventListener('pointermove', e => {
            this.pointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
            if (!down) return;
            const dx = e.clientX - down.x, dy = e.clientY - down.y;
            if (Math.hypot(dx, dy) > 6) down.moved = true;
            this.yaw = down.yaw + dx * 0.0042;
            this.pitch = clamp(down.pitch + dy * 0.0042, -1.2, 1.2);
        });
        el.addEventListener('pointerup', e => {
            const wasClick = down && !down.moved;
            down = null;
            if (!wasClick) return;
            this.pointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
            const hit = this.pick();
            if (hit) this.launch(hit.userData.exp);
        });
        el.addEventListener('pointerleave', () => this.pointer.set(9, 9));
        window.addEventListener('keydown', e => {
            if (e.target.closest?.('a,button,input')) return;
            if (e.key === 'ArrowLeft') this.yaw += 0.2;
            if (e.key === 'ArrowRight') this.yaw -= 0.2;
        });
    }

    pick() {
        this.raycaster.setFromCamera(this.pointer, this.camera);
        return this.raycaster.intersectObjects(this.hitTargets, false)[0]?.object || null;
    }

    controllerHit(controller) {
        if (!controller.visible) return null;
        this.raycaster.setFromXRController(controller);
        const hit = this.raycaster.intersectObjects(this.hitTargets, false)[0];
        return hit || null;
    }

    onControllerSelect(controller) {
        const hit = this.controllerHit(controller);
        if (hit) this.launch(hit.object.userData.exp, controller);
    }

    launch(exp, controller) {
        if (this.launching) return;
        this.launching = true;
        const panel = this.panels.find(p => p.exp === exp);
        if (panel) panel.flash = 1;
        if (controller && this.session) {
            for (const source of this.session.inputSources) {
                source.gamepad?.hapticActuators?.[0]?.pulse?.(0.6, 80);
            }
        }
        $('launch-status').textContent = 'Launching ' + exp.title + '…';
        setTimeout(() => {
            if (this.session) navigateInVR(exp.url, this.session);
            else location.href = exp.url;
        }, 260);
    }

    /* ── WebXR ─────────────────────────────────────────────────────── */

    async enterVR(offered) {
        if (this.session || this.starting) { offered?.end().catch(() => {}); return; }
        this.starting = true;
        try {
            // requestSession must run inside the gesture, so nothing awaits before it.
            const session = offered || await navigator.xr.requestSession('immersive-vr', XR_SESSION_INIT);
            await this.renderer.xr.setSession(session);
            this.session = session;
            document.body.classList.add('in-vr');
            session.addEventListener('end', () => {
                this.session = null;
                this.launching = false;
                document.body.classList.remove('in-vr');
                this.onResize();
            }, { once: true });
        } catch (e) {
            console.warn('[lobby] could not enter VR', e);
            $('launch-status').textContent = 'Headset VR could not start: ' + (e?.message || e);
        } finally {
            this.starting = false;
        }
    }

    /* ── frame ─────────────────────────────────────────────────────── */

    onResize() {
        if (this.renderer.xr.isPresenting) return;
        this.camera.aspect = innerWidth / innerHeight;
        // Narrow phones see more of the ring.
        this.camera.fov = innerWidth < innerHeight ? 88 : 70;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(innerWidth, innerHeight);
    }

    loop() {
        const dt = Math.min(0.05, this.clock.getDelta());
        const t = this.clock.elapsedTime;
        const xr = this.renderer.xr.isPresenting;

        if (!xr) {
            this.camera.position.set(0, 0, 0);
            this.camera.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
        }

        this.earthBody.rotation.y += dt * 0.012;
        this.clouds.rotation.y += dt * 0.016;
        this.sky.rotation.y += dt * 0.002;
        this.stars.rotation.y += dt * 0.003;
        this.title.position.y = 0.98 + Math.sin(t * 0.8) * 0.015;

        // Hover: mouse ray on screen, controller rays in a headset.
        const hovered = new Set();
        if (xr) {
            for (const slot of this.rig.slots) {
                const hit = this.controllerHit(slot.controller);
                if (hit) hovered.add(hit.object);
                const d = hit ? hit.distance : 5.5;
                slot.rayLine.scale.z = d;
                slot.hitDot.position.z = -d;
            }
        } else {
            const hit = this.pick();
            if (hit) hovered.add(hit);
            this.renderer.domElement.style.cursor = hit ? 'pointer' : 'grab';
        }

        for (const p of this.panels) {
            const target = hovered.has(p.mesh) ? 1 : 0;
            if (target && !p.hover && xr) {
                for (const source of this.session?.inputSources || []) source.gamepad?.hapticActuators?.[0]?.pulse?.(0.15, 20);
            }
            p.hover += (target - p.hover) * Math.min(1, dt * 12);
            p.flash = Math.max(0, (p.flash || 0) - dt * 3);
            const s = 1 + p.hover * 0.07 + (p.flash || 0) * 0.08;
            p.group.scale.setScalar(s);
            p.group.position.y = p.baseY + Math.sin(t * 0.9 + p.phase) * 0.012;
            p.halo.material.opacity = 0.05 + p.hover * 0.38 + (p.flash || 0) * 0.5;
        }

        this.renderer.render(this.scene, this.camera);
    }
}

const lobby = new Lobby();
lobby.init().catch(e => {
    console.error('[lobby] init failed', e);
    $('loading').classList.add('done');
    document.body.classList.add('no-3d');
});
