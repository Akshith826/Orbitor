/**
 * A tabletop solar system for mixed reality: about 1.4 m across at scale 1.
 *
 * Sizes and distances are compressed so everything fits on a table and stays
 * readable, but the order, colours, relative orbital periods, axial tilts and
 * Saturn's rings are real. The Sun is the light source, so each planet has a
 * true day side and night side wherever you stand around it.
 */
import * as THREE from 'three';

const DAY = 1;
export const PLANETS = [
    // name, key, radius (m), orbit (m), period (days), tilt (deg), day length (h)
    { name: 'Mercury', key: 'mercury', r: 0.011, orbit: 0.13, period: 88, tilt: 0.03, dayH: 1408 },
    { name: 'Venus', key: 'venus', r: 0.017, orbit: 0.18, period: 225, tilt: 177, dayH: -5832 },
    { name: 'Earth', key: 'earth', r: 0.018, orbit: 0.245, period: 365.25, tilt: 23.4, dayH: 24 },
    { name: 'Mars', key: 'mars', r: 0.013, orbit: 0.305, period: 687, tilt: 25.2, dayH: 24.6 },
    { name: 'Jupiter', key: 'jupiter', r: 0.046, orbit: 0.41, period: 4333, tilt: 3.1, dayH: 9.9 },
    { name: 'Saturn', key: 'saturn', r: 0.039, orbit: 0.52, period: 10759, tilt: 26.7, dayH: 10.7 },
    { name: 'Uranus', key: 'uranus', r: 0.026, orbit: 0.61, period: 30687, tilt: 97.8, dayH: -17.2 },
    { name: 'Neptune', key: 'neptune', r: 0.025, orbit: 0.69, period: 60190, tilt: 28.3, dayH: 16.1 }
];

function labelSprite(text) {
    const c = document.createElement('canvas');
    const x = c.getContext('2d');
    x.font = '600 44px Inter, sans-serif';
    c.width = Math.ceil(x.measureText(text).width) + 40;
    c.height = 70;
    x.font = '600 44px Inter, sans-serif';
    x.fillStyle = 'rgba(6,12,24,0.72)';
    const r = 35;
    x.beginPath();
    x.moveTo(r, 0); x.arcTo(c.width, 0, c.width, c.height, r); x.arcTo(c.width, c.height, 0, c.height, r);
    x.arcTo(0, c.height, 0, 0, r); x.arcTo(0, 0, c.width, 0, r); x.fill();
    x.fillStyle = '#eaf3ff';
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(text, c.width / 2, c.height / 2 + 2);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false }));
    const h = 0.022;
    s.scale.set(h * c.width / c.height, h, 1);
    s.center.set(0.5, 0);
    return s;
}

const SUN_FRAG = /* glsl */`
    uniform float uTime;
    varying vec3 vN;
    varying vec3 vP;
    float h(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 45.164))) * 43758.5453); }
    float n3(vec3 p) {
        vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(h(i), h(i + vec3(1,0,0)), f.x), mix(h(i + vec3(0,1,0)), h(i + vec3(1,1,0)), f.x), f.y),
                   mix(mix(h(i + vec3(0,0,1)), h(i + vec3(1,0,1)), f.x), mix(h(i + vec3(0,1,1)), h(i + vec3(1,1,1)), f.x), f.y), f.z);
    }
    void main() {
        vec3 p = vP * 60.0;
        float g = n3(p + uTime * 0.6) * 0.6 + n3(p * 2.3 - uTime * 0.9) * 0.4;   // granulation
        float limb = pow(max(dot(normalize(vN), vec3(0.0, 0.0, 1.0)), 0.0), 0.35);  // limb darkening
        vec3 col = mix(vec3(1.0, 0.45, 0.08), vec3(1.0, 0.92, 0.6), g) * (0.55 + 0.6 * limb);
        gl_FragColor = vec4(col * 1.6, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
    }`;

export class SolarModel {
    constructor() {
        this.group = new THREE.Group();
        this.group.name = 'solar-model';
        this.tilt = new THREE.Group();              // whole system, so it can be turned
        this.group.add(this.tilt);
        this.days = 0;
        this.daysPerSecond = 18;
        this.paused = false;
        this.planets = [];
        this.pickTargets = [];
        this._build();
    }

    _build() {
        const loader = new THREE.TextureLoader();
        const t = this.tilt;

        this.sunMat = new THREE.ShaderMaterial({
            uniforms: { uTime: { value: 0 } },
            vertexShader: 'varying vec3 vN; varying vec3 vP; void main(){ vP = position; vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
            fragmentShader: SUN_FRAG
        });
        this.sun = new THREE.Mesh(new THREE.SphereGeometry(0.065, 64, 48), this.sunMat);
        this.sun.userData.planet = { name: 'Sun', key: 'sun' };
        t.add(this.sun);
        this.pickTargets.push(this.sun);

        // Soft corona glow.
        const gc = document.createElement('canvas'); gc.width = gc.height = 256;
        const gx = gc.getContext('2d'); const gr = gx.createRadialGradient(128, 128, 20, 128, 128, 128);
        gr.addColorStop(0, 'rgba(255,200,120,0.85)'); gr.addColorStop(0.35, 'rgba(255,150,60,0.25)'); gr.addColorStop(1, 'rgba(255,120,40,0)');
        gx.fillStyle = gr; gx.fillRect(0, 0, 256, 256);
        this.corona = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(gc), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
        this.corona.scale.setScalar(0.34);
        t.add(this.corona);

        // The Sun lights the planets; a little ambient keeps night sides readable against a room.
        this.light = new THREE.PointLight(0xfff1dc, 2.6, 0, 0);
        t.add(this.light);
        t.add(new THREE.AmbientLight(0x8090b0, 0.3));

        for (const def of PLANETS) {
            const orbit = new THREE.LineLoop(
                new THREE.BufferGeometry().setFromPoints(Array.from({ length: 160 }, (_, i) => {
                    const a = i / 160 * Math.PI * 2;
                    return new THREE.Vector3(Math.cos(a) * def.orbit, 0, Math.sin(a) * def.orbit);
                })),
                new THREE.LineBasicMaterial({ color: 0x9fb8e0, transparent: true, opacity: 0.32, depthWrite: false })
            );
            t.add(orbit);

            const pivot = new THREE.Group();            // moves around the Sun
            const axis = new THREE.Group();             // axial tilt
            axis.rotation.z = def.tilt * Math.PI / 180;
            const mat = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.85, metalness: 0 });
            loader.load(`/public/textures/mini/${def.key}.jpg`, tex => {
                tex.colorSpace = THREE.SRGBColorSpace; mat.map = tex; mat.color.set(0xffffff); mat.needsUpdate = true;
            });
            const body = new THREE.Mesh(new THREE.SphereGeometry(def.r, 48, 32), mat);
            body.userData.planet = def;
            axis.add(body);
            pivot.add(axis);
            t.add(pivot);
            this.pickTargets.push(body);

            const tag = labelSprite(def.name);
            tag.position.set(0, def.r + 0.012, 0);
            pivot.add(tag);

            const entry = { def, pivot, axis, body, tag, phase: Math.random() * Math.PI * 2 };
            if (def.key === 'saturn') {
                const ringTex = loader.load('/public/textures/saturn-ring-alpha.png');
                ringTex.colorSpace = THREE.SRGBColorSpace;
                const geo = new THREE.RingGeometry(def.r * 1.25, def.r * 2.3, 96, 1);
                // Map the ring texture radially.
                const pos = geo.attributes.position, uv = geo.attributes.uv;
                for (let i = 0; i < pos.count; i++) {
                    const rr = Math.hypot(pos.getX(i), pos.getY(i));
                    uv.setXY(i, (rr - def.r * 1.25) / (def.r * 1.05), 0.5);
                }
                const ring = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
                    map: ringTex, alphaMap: ringTex, transparent: true, side: THREE.DoubleSide, roughness: 1, depthWrite: false
                }));
                ring.rotation.x = -Math.PI / 2;
                axis.add(ring);
            }
            if (def.key === 'earth') {
                const moonPivot = new THREE.Group();
                const moonMat = new THREE.MeshStandardMaterial({ color: 0x9a9a9a, roughness: 1 });
                loader.load('/public/textures/lobby/moon-1k.jpg', tex => {
                    tex.colorSpace = THREE.SRGBColorSpace; moonMat.map = tex; moonMat.color.set(0xffffff); moonMat.needsUpdate = true;
                });
                const moon = new THREE.Mesh(new THREE.SphereGeometry(0.0055, 24, 16), moonMat);
                moon.position.x = 0.034;
                moon.userData.planet = { name: 'Moon', key: 'moon' };
                moonPivot.add(moon);
                pivot.add(moonPivot);
                entry.moonPivot = moonPivot;
                this.pickTargets.push(moon);
            }
            this.planets.push(entry);
        }

        // Selection ring that hugs the chosen body.
        this.selRing = new THREE.Mesh(new THREE.RingGeometry(1.42, 1.48, 96),
            new THREE.MeshBasicMaterial({ color: 0x64ffda, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }));
        this.selRing.visible = false;
        this.group.add(this.selRing);
        this.update(0);
    }

    /** Planet (or Sun/Moon) under a ray, if any. */
    pick(raycaster) {
        const hit = raycaster.intersectObjects(this.pickTargets, false)[0];
        return hit ? { ...hit.object.userData.planet, object: hit.object, point: hit.point } : null;
    }

    select(object) {
        this.selected = object || null;
        this.selRing.visible = Boolean(object);
    }

    /** Bounding radius in world metres (for grabbing). */
    get radius() {
        return 0.72 * this.group.scale.x;
    }

    update(dt, camera = null) {
        if (!this.paused) this.days += dt * this.daysPerSecond * DAY;
        this.sunMat.uniforms.uTime.value += dt;
        this.sun.rotation.y += dt * 0.05;
        for (const p of this.planets) {
            const a = p.phase + (this.days / p.def.period) * Math.PI * 2;
            p.pivot.position.set(Math.cos(a) * p.def.orbit, 0, -Math.sin(a) * p.def.orbit);
            // Spin, slowed so it stays watchable (a real Earth day would be a blur).
            p.body.rotation.y += dt * (this.paused ? 0 : 1) * Math.sign(p.def.dayH) * Math.min(3, 60 / Math.abs(p.def.dayH));
            if (p.moonPivot) p.moonPivot.rotation.y = (this.days / 27.3) * Math.PI * 2;
        }
        if (this.selected && this.selRing.visible && camera) {
            const wp = this.selected.getWorldPosition(new THREE.Vector3());
            const r = (this.selected.geometry.parameters.radius || 0.02) * this.group.scale.x * this.tilt.scale.x;
            this.selRing.position.copy(this.group.worldToLocal(wp.clone()));
            this.selRing.scale.setScalar(r / this.group.scale.x);
            const cp = camera.getWorldPosition(new THREE.Vector3());
            this.selRing.lookAt(cp);
        }
    }
}
