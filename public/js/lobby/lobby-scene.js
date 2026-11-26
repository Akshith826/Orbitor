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

export const EXPERIENCES = [
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
    }
    return canvasTexture(c, renderer);
}

/**
 * Realistic starfield: tiny round points of varied brightness and colour
 * temperature, with a crisp core and a short soft falloff. Sizes are in
 * screen pixels so stars stay pin-sharp at any distance, as real stars do.
 */
function buildStars(count) {
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const size = new Float32Array(count);
    const tint = [
        [0.70, 0.80, 1.00], [0.85, 0.90, 1.00], [1.00, 1.00, 1.00], [1.00, 1.00, 1.00],
        [1.00, 0.96, 0.88], [1.00, 0.90, 0.75], [1.00, 0.80, 0.62]
    ];
    const v = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
        // Thicker band along a tilted "galactic plane" for a natural spread.
        v.randomDirection();
        if (Math.random() < 0.35) { v.y *= 0.18; v.normalize(); }
        v.applyAxisAngle(new THREE.Vector3(1, 0, 0.3).normalize(), 0.5).multiplyScalar(500);
        pos.set([v.x, v.y, v.z], i * 3);
        // Magnitude distribution: most stars faint, a few bright.
        const m = Math.pow(Math.random(), 3.2);
        const c = tint[(Math.random() * tint.length) | 0];
        const b = 0.45 + m * 0.85;
        col.set([c[0] * b, c[1] * b, c[2] * b], i * 3);
        size[i] = 1.15 + m * 2.4;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(size, 1));
    const mat = new THREE.ShaderMaterial({
        uniforms: { uScale: { value: 1 }, uTime: { value: 0 } },
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
        vertexShader: `
            attribute float size;
            uniform float uScale;
            uniform float uTime;
            varying vec3 vColor;
            void main() {
                // Very slight scintillation on the brighter stars only.
                float tw = 1.0 + 0.12 * step(2.0, size) * sin(uTime * 1.7 + position.x * 0.37 + position.z * 0.21);
                vColor = color * tw;
                vec4 mv = modelViewMatrix * vec4(position, 1.0);
                gl_PointSize = size * uScale;
                gl_Position = projectionMatrix * mv;
            }`,
        fragmentShader: `
            varying vec3 vColor;
            void main() {
                float d = length(gl_PointCoord - 0.5) * 2.0;
                if (d > 1.0) discard;
                float a = smoothstep(1.0, 0.0, d);
                a *= a;
                gl_FragColor = vec4(vColor, a);
            }`
    });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    return points;
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
        const tex = url => {
            const t = loader.load(url);
            t.colorSpace = THREE.SRGBColorSpace;
            return t;
        };

        // Faint Milky Way backdrop; the point stars on top carry the detail.
        const sky = new THREE.Mesh(
            new THREE.SphereGeometry(900, 48, 32),
            new THREE.MeshBasicMaterial({ map: tex('/public/textures/star-map.jpg'), side: THREE.BackSide, color: 0x3a4258, toneMapped: false, depthWrite: false })
        );
        sky.rotation.z = 0.5;
        this.sky = sky;
        this.stars = buildStars(6500);
        g.add(sky, this.stars);

        this.lights = new THREE.Group();
        this.lights.add(new THREE.AmbientLight(0x6070a0, 0.25));
        const sun = new THREE.DirectionalLight(0xfff2dd, 3.0);
        sun.position.set(-60, 30, 40);
        this.lights.add(sun);
        g.add(this.lights);

        // The Sun: a small, hard-edged disc with a tight halo — not a fog ball.
        const sunDisc = new THREE.Mesh(
            new THREE.CircleGeometry(4, 48),
            new THREE.MeshBasicMaterial({ color: 0xfff6e6, toneMapped: false })
        );
        sunDisc.position.set(-300, 150, 200);
        sunDisc.lookAt(0, 0, 0);
        g.add(sunDisc);

        // Earth fills the lower view, as if the lobby orbits above it.
        this.earth = new THREE.Group();
        this.earth.position.set(0, -44, -52);
        this.earth.rotation.z = 0.35;
        this.earthBody = new THREE.Mesh(
            new THREE.SphereGeometry(34, 96, 64),
            new THREE.MeshStandardMaterial({ map: tex('/public/textures/earth.jpg'), roughness: 0.9, metalness: 0 })
        );
        this.clouds = new THREE.Mesh(
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
        this.earth.add(this.earthBody, this.clouds, atmosphere);
        g.add(this.earth);

        const moon = new THREE.Mesh(
            new THREE.SphereGeometry(3.2, 48, 32),
            new THREE.MeshStandardMaterial({ map: tex('/public/textures/moon.jpg'), roughness: 1 })
        );
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
                    new THREE.MeshBasicMaterial({ map: panelTexture(exp, row.w, row.h, r), transparent: true })
                );
                mesh.userData.exp = exp;
                const halo = new THREE.Mesh(
                    new THREE.PlaneGeometry(row.w * 1.08, row.h * 1.12),
                    new THREE.MeshBasicMaterial({ color: new THREE.Color(exp.accent), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })
                );
                halo.position.z = -0.01;
                group.add(halo, mesh);
                this.group.add(group);
                this.panels.push({ exp, group, mesh, halo, baseY: row.y, phase: Math.random() * Math.PI * 2, hover: 0, flash: 0 });
            });
        }
        this.hitTargets = this.panels.map(p => p.mesh);
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
        this.sky.rotation.y += dt * 0.0015;
        this.stars.rotation.y += dt * 0.0015;
        this.stars.material.uniforms.uTime.value = t;
        this.stars.material.uniforms.uScale.value = this.renderer.getPixelRatio() * (this.renderer.xr.isPresenting ? 1.6 : 1);
        if (this.title) this.title.position.y = 0.98 + Math.sin(t * 0.8) * 0.015;
        if (this.statusMesh) this.statusMesh.visible = this.renderer.xr.isPresenting || this.statusImportant;
        let newlyHovered = false;
        for (const p of this.panels) {
            const target = hovered.has(p.mesh) ? 1 : 0;
            if (target && p.hover < 0.05) newlyHovered = true;
            p.hover += (target - p.hover) * Math.min(1, dt * 12);
            p.flash = Math.max(0, p.flash - dt * 3);
            p.group.scale.setScalar(1 + p.hover * 0.07 + p.flash * 0.08);
            p.group.position.y = p.baseY + Math.sin(t * 0.9 + p.phase) * 0.012;
            p.halo.material.opacity = 0.05 + p.hover * 0.38 + p.flash * 0.5;
        }
        return newlyHovered;
    }
}
