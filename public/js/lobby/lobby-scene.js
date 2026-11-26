/**
 * Orbitor lobby scene — the home screen as a place you stand in.
 *
 * A ring of holographic launch panels floats above Earth. The VR page
 * (main.js) owns the renderer, camera, controllers and the XR session; this
 * module only builds and animates the lobby's objects inside one group, so
 * switching between the lobby and an experience never leaves the page and never
 * drops the headset session.
 */
import * as THREE from 'three';
import { RealSky, initialLocation, askLocation } from './real-sky.js?v=20261127-o2';

export const EXPERIENCES = [
    { row: 0, slug: 'vr-ride', url: '/vr-ride', icon: '🎢', tag: 'RIDE · 3 MIN', title: 'VR Deep Space Ride', accent: '#ff8ba7',
        text: 'Rail-guided plunge from the pilot seat: solar slingshot, asteroid gauntlet, Jupiter roll, Saturn’s rings.' },
    { row: 0, slug: 'mixed-reality', url: '/mr', icon: '🪐', tag: 'MIXED REALITY', title: 'Solar System In Your Room', accent: '#c4b5fd',
        text: 'Your walls stay visible while the planets orbit at table height. Walk around Saturn, grab and resize it all.' },
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

/** A plane bent around the viewer (concentric with the panel ring), so cards wrap gently. */
function bentPlane(w, h, bendRadius, segments = 24) {
    const geo = new THREE.PlaneGeometry(w, h, segments, 1);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
        const a = pos.getX(i) / bendRadius;
        pos.setX(i, Math.sin(a) * bendRadius);
        pos.setZ(i, (1 - Math.cos(a)) * bendRadius);
    }
    geo.computeVertexNormals();
    return geo;
}

/** White rounded rectangle with a wide blurred falloff: tinted for hover glow or shadow. */
const softCache = new Map();
function softRoundedTexture(aspect) {
    const key = aspect.toFixed(2);
    if (softCache.has(key)) return softCache.get(key);
    const W = 512, H = Math.round(W / aspect);
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const x = c.getContext('2d');
    const pad = Math.round(H * 0.16);
    // Draw the shape off-canvas and keep only its blurred shadow: a smooth
    // falloff in every browser (canvas filter support is not universal).
    x.shadowColor = '#ffffff';
    x.shadowBlur = pad * 0.9;
    x.shadowOffsetX = W * 4;
    x.fillStyle = '#ffffff';
    roundRect(x, pad - W * 4, pad, W - pad * 2, H - pad * 2, Math.round(H * 0.12));
    x.fill();
    const tex = new THREE.CanvasTexture(c);
    softCache.set(key, tex);
    return tex;
}

function canvasTexture(c, renderer) {
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    return tex;
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
    const corner = Math.round(H * 0.13);
    roundRect(x, 4, 4, W - 8, H - 8, corner);
    x.fillStyle = bg; x.fill();
    // A faint wash of the accent from one corner, like light on frosted glass.
    const glow = x.createRadialGradient(W * 0.9, 0, 0, W * 0.9, 0, W * 0.75);
    glow.addColorStop(0, exp.accent + '2a');
    glow.addColorStop(1, exp.accent + '00');
    x.fillStyle = glow; x.fill();
    // Top sheen.
    const sheen = x.createLinearGradient(0, 0, 0, H * 0.45);
    sheen.addColorStop(0, 'rgba(255,255,255,0.07)');
    sheen.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = sheen; x.fill();
    x.lineWidth = 3; x.strokeStyle = exp.accent + '80'; x.stroke();

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
    }
    return canvasTexture(c, renderer);
}


function textTexture(lines, W, H, renderer) {
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const x = c.getContext('2d');
    x.textAlign = 'center';
    for (const { text, font, color, y, glow } of lines) {
        x.font = font;
        x.fillStyle = color;
        x.shadowColor = glow || 'transparent';
        x.shadowBlur = glow ? 24 : 0;
        x.fillText(text, W / 2, y);
    }
    return canvasTexture(c, renderer);
}

export class LobbyScene {
    constructor(scene, renderer) {
        this.scene = scene;
        this.renderer = renderer;
        this.group = new THREE.Group();
        this.group.visible = false;
        this.group.name = 'orbitor-lobby';
        scene.add(this.group);
        this.panels = [];
        this.hitTargets = [];
        this.built = false;
    }

    async build() {
        if (this.built) return;
        this.built = true;
        this.buildSpace();
        try { await Promise.race([document.fonts.load('800 40px Orbitron'), new Promise(res => setTimeout(res, 2500))]); } catch { /* fonts optional */ }
        this.buildPanels();
    }

    buildSpace() {
        const g = this.group;
        const loader = new THREE.TextureLoader();
        // Light 2K lobby copies (the full-size maps are for close-up flight).
        // A material passed in shows its base colour at once and takes the
        // texture when it lands, so Earth never pops in late.
        const tex = (url, material) => {
            const t = loader.load(url, () => {
                if (material) { material.map = t; material.color.set(0xffffff); material.needsUpdate = true; }
            });
            t.colorSpace = THREE.SRGBColorSpace;
            t.anisotropy = 4;
            return material ? null : t;
        };

        // Tonight's real sky above the viewer: catalogue stars, Milky Way,
        // constellations, the Moon in its true phase and the bright planets.
        this.realSky = new RealSky(g, this.renderer);
        this.realSky.onInfo = info => this.drawSkyCard(info);
        this.skyLoad = initialLocation()
            .then(loc => { this.realSky.location = loc; return this.realSky.load(); })
            .catch(err => console.warn('[lobby] real sky unavailable:', err.message));

        this.lights = new THREE.Group();
        this.lights.add(new THREE.AmbientLight(0x6070a0, 0.25));
        const sun = new THREE.DirectionalLight(0xfff2dd, 3.0);
        sun.position.set(-60, 30, 40);
        this.lights.add(sun);
        g.add(this.lights);


        // Earth fills the lower view, as if the lobby orbits above it.
        this.earth = new THREE.Group();
        this.earth.position.set(0, -44, -52);
        this.earth.rotation.z = 0.35;
        const earthMat = new THREE.MeshStandardMaterial({ color: 0x1f4f8f, roughness: 0.9, metalness: 0 });
        tex('/public/textures/lobby/earth-2k.jpg', earthMat);
        this.earthBody = new THREE.Mesh(new THREE.SphereGeometry(34, 96, 64), earthMat);
        const cloudMat = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false });
        const cloudTex = loader.load('/public/textures/earth-clouds.png', () => { cloudMat.map = cloudTex; cloudMat.opacity = 0.8; cloudMat.needsUpdate = true; });
        cloudTex.colorSpace = THREE.SRGBColorSpace;
        this.clouds = new THREE.Mesh(new THREE.SphereGeometry(34.3, 96, 64), cloudMat);
        const atmosphere = new THREE.Mesh(
            new THREE.SphereGeometry(36, 64, 48),
            new THREE.ShaderMaterial({
                transparent: true, side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false,
                vertexShader: 'varying vec3 vN; void main(){ vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
                fragmentShader: 'varying vec3 vN; void main(){ float i = pow(0.72 - dot(vN, vec3(0.0,0.0,1.0)), 3.0); gl_FragColor = vec4(0.35,0.65,1.0,1.0) * i; }'
            })
        );
        this.earth.add(this.earthBody, this.clouds, atmosphere);
        g.add(this.earth);

        const moonMat = new THREE.MeshStandardMaterial({ color: 0x8c8c8c, roughness: 1 });
        tex('/public/textures/lobby/moon-1k.jpg', moonMat);
        const moon = new THREE.Mesh(new THREE.SphereGeometry(3.2, 48, 32), moonMat);
        moon.position.set(48, 22, -120);
        g.add(moon);

        // A faint ring on the "floor" anchors the panels in space.
        const ring = new THREE.Mesh(
            new THREE.RingGeometry(RADIUS - 0.02, RADIUS + 0.02, 128, 1, -80 * DEG + Math.PI / 2, 160 * DEG),
            new THREE.MeshBasicMaterial({ color: 0x64ffda, transparent: true, opacity: 0.35, side: THREE.DoubleSide })
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = -0.95;
        g.add(ring);
    }

    buildPanels() {
        const r = this.renderer;
        this.title = new THREE.Mesh(
            new THREE.PlaneGeometry(2.2, 0.55),
            new THREE.MeshBasicMaterial({
                map: textTexture([
                    { text: 'ORBITOR', font: '800 150px Orbitron, Inter, sans-serif', color: '#eaf6ff', y: 160, glow: '#64ffda' },
                    { text: 'VR SPACE RIDE  ·  META QUEST 3 GAMES', font: '600 40px Inter, sans-serif', color: '#64ffda', y: 236 }
                ], 1600, 400, r),
                transparent: true, depthWrite: false
            })
        );
        this.title.position.set(0, 0.98, -RADIUS - 0.35);
        this.group.add(this.title);

        const sc = document.createElement('canvas');
        sc.width = 1600; sc.height = 120;
        this.statusCanvas = sc;
        this.statusTex = canvasTexture(sc, r);
        this.statusMesh = new THREE.Mesh(
            new THREE.PlaneGeometry(2.2, 0.165),
            new THREE.MeshBasicMaterial({ map: this.statusTex, transparent: true, depthWrite: false })
        );
        this.statusMesh.position.set(0, -0.86, -RADIUS + 0.3);
        this.statusMesh.lookAt(0, -0.86, 0);
        this.group.add(this.statusMesh);
        this.setStatus('Point and pull the trigger · or click a panel');

        const rows = [
            { y: 0.3, w: 0.96, h: 0.56, step: 23 },
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
                    bentPlane(row.w, row.h, RADIUS),
                    new THREE.MeshBasicMaterial({ map: panelTexture(exp, row.w, row.h, r), transparent: true, toneMapped: false })
                );
                mesh.userData.exp = exp;
                const soft = softRoundedTexture(row.w / row.h);
                // Soft accent light spilling around the card on hover (follows its rounded shape).
                const glow = new THREE.Mesh(
                    bentPlane(row.w * 1.3, row.h * 1.42, RADIUS),
                    new THREE.MeshBasicMaterial({ map: soft, color: new THREE.Color(exp.accent), transparent: true, opacity: 0, depthWrite: false, toneMapped: false })
                );
                glow.position.z = -0.03;
                // Faint shadow below and behind, so cards read as objects in space.
                const shadow = new THREE.Mesh(
                    bentPlane(row.w * 1.22, row.h * 1.34, RADIUS),
                    new THREE.MeshBasicMaterial({ map: soft, color: 0x000000, transparent: true, opacity: 0.45, depthWrite: false })
                );
                shadow.position.set(0.01, -0.035, -0.06);
                group.add(shadow, glow, mesh);
                this.group.add(group);
                this.panels.push({ exp, group, mesh, glow, baseY: row.y, phase: Math.random() * Math.PI * 2, hover: 0, flash: 0 });
            });
        }
        this.hitTargets = this.panels.map(p => p.mesh);
        this.buildSkyCard();
    }

    /** "Your sky right now" card to the right of the launch panels, with a location button. */
    buildSkyCard() {
        const W = 1024, H = 900;
        const c = document.createElement('canvas');
        c.width = W; c.height = H;
        this.skyCanvas = c;
        this.skyTex = canvasTexture(c, this.renderer);
        const angle = 64 * DEG;
        const w = 0.86, h = w * H / W;
        const group = new THREE.Group();
        group.position.set(Math.sin(angle) * RADIUS, 0.02, -Math.cos(angle) * RADIUS);
        group.lookAt(0, 0.02, 0);
        const card = new THREE.Mesh(bentPlane(w, h, RADIUS), new THREE.MeshBasicMaterial({ map: this.skyTex, transparent: true, toneMapped: false }));
        const shadow = new THREE.Mesh(bentPlane(w * 1.2, h * 1.24, RADIUS),
            new THREE.MeshBasicMaterial({ map: softRoundedTexture(w / h), color: 0x000000, transparent: true, opacity: 0.45, depthWrite: false }));
        shadow.position.set(0.01, -0.035, -0.06);
        group.add(shadow, card);

        // Location button under the card (a normal lobby target).
        const bc = document.createElement('canvas');
        bc.width = 800; bc.height = 150;
        this.locCanvas = bc;
        this.locTex = canvasTexture(bc, this.renderer);
        const exp = { slug: 'sky-locate', action: 'locate', title: 'Use my location', accent: '#64ffda' };
        const btn = new THREE.Mesh(bentPlane(0.56, 0.105, RADIUS), new THREE.MeshBasicMaterial({ map: this.locTex, transparent: true, toneMapped: false }));
        btn.position.set(0, -h / 2 - 0.1, 0.01);
        btn.userData.exp = exp;
        const glow = new THREE.Mesh(bentPlane(0.7, 0.2, RADIUS),
            new THREE.MeshBasicMaterial({ map: softRoundedTexture(0.56 / 0.105), color: 0x64ffda, transparent: true, opacity: 0, depthWrite: false, toneMapped: false }));
        glow.position.copy(btn.position).setZ(-0.02);
        group.add(glow, btn);
        this.group.add(group);
        this.panels.push({ exp, group, mesh: btn, glow, baseY: 0.02, phase: 0, hover: 0, flash: 0, static: true });
        this.hitTargets.push(btn);
        this.drawLocationButton('📍 Use my location');
        this.drawSkyCard(null);
    }

    drawLocationButton(text) {
        if (!this.locCanvas) return;
        const x = this.locCanvas.getContext('2d');
        x.clearRect(0, 0, 800, 150);
        roundRect(x, 4, 4, 792, 142, 70);
        x.fillStyle = 'rgba(10,22,40,0.95)'; x.fill();
        x.lineWidth = 4; x.strokeStyle = '#64ffda'; x.stroke();
        x.fillStyle = '#e6fffa';
        x.font = '700 54px Inter, sans-serif';
        x.textAlign = 'center'; x.textBaseline = 'middle';
        x.fillText(text, 400, 78, 740);
        this.locTex.needsUpdate = true;
    }

    drawSkyCard(info) {
        if (!this.skyCanvas) return;
        const W = this.skyCanvas.width, H = this.skyCanvas.height;
        const x = this.skyCanvas.getContext('2d');
        x.clearRect(0, 0, W, H);
        roundRect(x, 4, 4, W - 8, H - 8, 110);
        const bg = x.createLinearGradient(0, 0, 0, H);
        bg.addColorStop(0, 'rgba(14,24,46,0.95)'); bg.addColorStop(1, 'rgba(6,11,24,0.95)');
        x.fillStyle = bg; x.fill();
        x.lineWidth = 3; x.strokeStyle = 'rgba(100,255,218,0.5)'; x.stroke();
        const pad = 60;
        x.textBaseline = 'top';
        x.fillStyle = '#64ffda'; x.font = '700 34px Inter, sans-serif';
        x.fillText('YOUR SKY · RIGHT NOW', pad, 56);
        if (!info) {
            x.fillStyle = '#a8b6d6'; x.font = '500 40px Inter, sans-serif';
            x.fillText('Plotting tonight’s stars…', pad, 140);
            this.skyTex.needsUpdate = true;
            return;
        }
        const d = info.date;
        x.fillStyle = '#eef4ff'; x.font = '800 66px Orbitron, Inter, sans-serif';
        x.fillText(d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), pad, 108);
        x.fillStyle = '#a8b6d6'; x.font = '500 36px Inter, sans-serif';
        x.fillText(d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' }), pad, 190);
        const lat = `${Math.abs(info.lat).toFixed(1)}°${info.lat >= 0 ? 'N' : 'S'}`;
        const lon = `${Math.abs(info.lon).toFixed(1)}°${info.lon >= 0 ? 'E' : 'W'}`;
        x.fillText(info.source === 'approximate' ? `≈ ${lat} ${lon} · guessed from your time zone` : `📍 ${lat} ${lon}`, pad, 240, W - pad * 2);

        const rows = [];
        const m = info.moon;
        const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
        const dir = az => dirs[Math.round(((az % 360) + 360) % 360 / 45) % 8];
        rows.push(['🌙', `Moon ${Math.round(m.illumination * 100)}% ${m.waxing ? 'waxing' : 'waning'} · in ${m.constellation}`]);
        rows.push(['', m.up ? `${Math.round(m.alt)}° up in the ${dir(m.az)}` : 'below your horizon right now']);
        rows.push(['🪐', info.planetsUp.length ? info.planetsUp.slice(0, 3).join(' · ') : 'No bright planets up right now']);
        rows.push(['✨', `${info.starsUp.toLocaleString()} naked-eye stars above you`]);
        if (info.sunAlt > -6) rows.push(['☀️', info.sunAlt > 0 ? 'Sun is up: stars shown faint, as by day' : 'Twilight: the first stars are out']);
        let y = 330;
        for (const [icon, text] of rows) {
            x.font = '400 44px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';
            x.fillText(icon, pad, y);
            x.fillStyle = '#dbe6f7'; x.font = '500 38px Inter, sans-serif';
            x.fillText(text, pad + 70, y + 4, W - pad * 2 - 70);
            x.fillStyle = '#a8b6d6';
            y += 92;
        }
        x.fillStyle = '#6f84a8'; x.font = '500 28px Inter, sans-serif';
        x.fillText('Lobby faces north · N E S W on the horizon', pad, H - 80);
        this.skyTex.needsUpdate = true;
    }

    /** Ask for the real location and re-plot the sky (the browser may show a permission prompt). */
    locate() {
        this.drawLocationButton('📍 Locating…');
        return askLocation().then(loc => {
            this.realSky.setLocation(loc.lat, loc.lon, loc.source);
            this.drawLocationButton('📍 Sky set to your location');
            this.setStatus('Sky set to your location', true);
            return loc;
        }).catch(err => {
            this.drawLocationButton('📍 Use my location');
            this.setStatus('Location unavailable: ' + (err?.message || 'permission denied'), true);
            throw err;
        });
    }

    /** @param {boolean} [important] also show it on a flat screen (the page has its own hint there) */
    setStatus(text, important = false) {
        this.statusImportant = important;
        if (!this.statusCanvas) return;
        const x = this.statusCanvas.getContext('2d');
        x.clearRect(0, 0, 1600, 120);
        x.font = '600 44px Inter, sans-serif';
        x.textAlign = 'center';
        x.fillStyle = '#9fb3d9';
        x.fillText(text, 800, 76);
        this.statusTex.needsUpdate = true;
    }

    setVisible(on) {
        this.group.visible = on;
    }

    get visible() { return this.group.visible; }

    /** @returns {{exp: object, distance: number}|null} */
    hit(raycaster) {
        const h = raycaster.intersectObjects(this.hitTargets, false)[0];
        return h ? { exp: h.object.userData.exp, distance: h.distance, mesh: h.object } : null;
    }

    flash(exp) {
        const p = this.panels.find(q => q.exp === exp);
        if (p) p.flash = 1;
    }

    /** @param {Set<THREE.Object3D>} hovered panel meshes under a pointer or controller ray */
    update(dt, t, hovered = new Set()) {
        if (!this.group.visible || !this.earthBody) return;
        this.earthBody.rotation.y += dt * 0.012;
        this.clouds.rotation.y += dt * 0.016;
        this.realSky.update(dt, t);
        if (this.title) this.title.position.y = 0.98 + Math.sin(t * 0.8) * 0.015;
        if (this.statusMesh) this.statusMesh.visible = this.renderer.xr.isPresenting || this.statusImportant;
        let newlyHovered = false;
        for (const p of this.panels) {
            const target = hovered.has(p.mesh) ? 1 : 0;
            if (target && p.hover < 0.05) newlyHovered = true;
            p.hover += (target - p.hover) * Math.min(1, dt * 12);
            p.flash = Math.max(0, p.flash - dt * 3);
            // Hover: the card eases toward you and its light comes up softly.
            p.group.scale.setScalar(1 + p.hover * 0.035 + p.flash * 0.05);
            p.mesh.position.z = p.hover * 0.06;
            p.glow.position.z = -0.03 + p.hover * 0.05;
            p.group.position.y = p.baseY + Math.sin(t * 0.9 + p.phase) * 0.012;
            p.glow.material.opacity = p.hover * 0.42 + p.flash * 0.45;
        }
        return newlyHovered;
    }
}
