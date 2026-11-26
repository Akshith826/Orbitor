/**
 * Tonight's real sky, for the Orbitor lobby.
 *
 * Every naked-eye star (magnitude ≤ 6, from the d3-celestial catalogue), the
 * constellation figures, the Milky Way band, the Moon in its true phase and
 * the bright planets are placed where they are right now above the viewer's
 * location. Positions are recomputed every few seconds, so the sky turns in
 * real time.
 *
 * Frame: the lobby's forward (-Z) is north, +X is east, +Y is up. The headset
 * has no compass, so "north" is wherever the lobby faces; compass letters on
 * the horizon say which way is which.
 */
import * as THREE from 'three';
import * as Astronomy from '../vendor/astronomy.js?v=20261127-o1';

const DEG = Math.PI / 180;
const SKY_R = 480;

/** Equatorial (RA hours or degrees, Dec deg) → local horizon unit vector (x east, y up, z = -north). */
export function equatorialToLocal(raDeg, decDeg, lstHours, latDeg, out = new THREE.Vector3()) {
    const H = (lstHours * 15 - raDeg) * DEG;          // hour angle, positive west
    const d = decDeg * DEG, p = latDeg * DEG;
    const east = -Math.cos(d) * Math.sin(H);
    const north = Math.sin(d) * Math.cos(p) - Math.cos(d) * Math.cos(H) * Math.sin(p);
    const up = Math.sin(d) * Math.sin(p) + Math.cos(d) * Math.cos(H) * Math.cos(p);
    return out.set(east, up, -north);
}

/** Azimuth (deg from north, eastward) + altitude (deg) → local unit vector. */
export function horizonToLocal(azDeg, altDeg, out = new THREE.Vector3()) {
    const a = azDeg * DEG, h = altDeg * DEG;
    return out.set(Math.cos(h) * Math.sin(a), Math.sin(h), -Math.cos(h) * Math.cos(a));
}

/** Local apparent sidereal time in hours. */
export function localSiderealTime(date, lonDeg) {
    const gst = Astronomy.SiderealTime(date);
    return ((gst + lonDeg / 15) % 24 + 24) % 24;
}

/** B−V colour index → star colour (hot blue-white … cool orange). */
function bvColor(bv) {
    const stops = [[-0.3, [0.62, 0.72, 1.0]], [0.0, [0.8, 0.86, 1.0]], [0.4, [1.0, 0.98, 0.94]],
        [0.8, [1.0, 0.9, 0.74]], [1.2, [1.0, 0.8, 0.58]], [1.8, [1.0, 0.66, 0.42]]];
    if (bv <= stops[0][0]) return stops[0][1];
    for (let i = 1; i < stops.length; i++) {
        if (bv <= stops[i][0]) {
            const [b0, c0] = stops[i - 1], [b1, c1] = stops[i];
            const t = (bv - b0) / (b1 - b0);
            return c0.map((v, k) => v + (c1[k] - v) * t);
        }
    }
    return stops[stops.length - 1][1];
}

/** Galactic (l, b) → equatorial J2000 (RA, Dec) in degrees. */
function galacticToEquatorial(l, b) {
    const T = [[-0.0548755604, -0.8734370902, -0.4838350155],
        [0.4941094279, -0.4448296300, 0.7469822445],
        [-0.8676661490, -0.1980763734, 0.4559837762]];
    const g = [Math.cos(b) * Math.cos(l), Math.cos(b) * Math.sin(l), Math.sin(b)];
    const e = [0, 1, 2].map(i => T[0][i] * g[0] + T[1][i] * g[1] + T[2][i] * g[2]);   // Tᵀ·g
    return [((Math.atan2(e[1], e[0]) / DEG) + 360) % 360, Math.asin(e[2]) / DEG];
}

function label(text, color = '#cfe3ff', size = 34, weight = 600) {
    const c = document.createElement('canvas');
    const x = c.getContext('2d');
    x.font = `${weight} ${size}px Inter, sans-serif`;
    c.width = Math.ceil(x.measureText(text).width) + 16;
    c.height = size + 16;
    x.font = `${weight} ${size}px Inter, sans-serif`;
    x.fillStyle = color;
    x.textBaseline = 'middle';
    x.shadowColor = 'rgba(0,0,0,0.9)';
    x.shadowBlur = 6;
    x.fillText(text, 8, c.height / 2);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false }));
    // World-space size: about 1.6° tall per label at the sky's distance, readable in a headset.
    s.scale.set(c.width * 0.19, c.height * 0.19, 1);
    s.center.set(0, 0.5);
    return s;
}

const STAR_VERT = /* glsl */`
    attribute float size;
    uniform float uScale;
    uniform float uTime;
    uniform float uDay;
    varying vec3 vColor;
    varying float vAlpha;
    void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        // Below the horizon: hidden. Near it: dimmed by the thicker atmosphere.
        float alt = normalize(position).y;
        float horizon = smoothstep(-0.02, 0.08, alt);
        float tw = 1.0 + 0.1 * step(2.4, size) * sin(uTime * 2.1 + position.x * 0.3 + position.z * 0.17);
        vColor = color * tw;
        vAlpha = horizon * (1.0 - uDay * 0.75);
        gl_PointSize = size * uScale;
        gl_Position = projectionMatrix * mv;
    }`;

const STAR_FRAG = /* glsl */`
    varying vec3 vColor;
    varying float vAlpha;
    void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        if (d > 1.0 || vAlpha <= 0.0) discard;
        float a = smoothstep(1.0, 0.0, d);
        gl_FragColor = vec4(vColor, a * a * vAlpha);
    }`;

export class RealSky {
    constructor(parent, renderer) {
        this.renderer = renderer;
        this.group = new THREE.Group();
        this.group.name = 'real-sky';
        parent.add(this.group);
        this.location = { lat: 0, lon: 0, source: 'approximate' };
        this.ready = false;
        this._t = 999;
        this._v = new THREE.Vector3();
        this.onInfo = () => {};
    }

    async load() {
        const res = await fetch('/public/data/sky.json?v=20261127-o1');
        if (!res.ok) throw new Error('sky catalogue HTTP ' + res.status);
        this.catalog = await res.json();
        this._buildStars();
        this._buildMilkyWay();
        this._buildConstellations();
        this._buildBodies();
        this._buildHorizon();
        this.ready = true;
        this.refresh(new Date());
    }

    /** Use a location. Re-plots the whole sky immediately. */
    setLocation(lat, lon, source) {
        this.location = { lat, lon, source };
        if (this.ready) this.refresh(new Date());
    }

    _points(count, sizes, colors, uniforms) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
        geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
        const mat = new THREE.ShaderMaterial({
            uniforms, vertexColors: true, transparent: true, depthWrite: false, toneMapped: false,
            vertexShader: STAR_VERT, fragmentShader: STAR_FRAG
        });
        const pts = new THREE.Points(geo, mat);
        pts.frustumCulled = false;
        return pts;
    }

    _buildStars() {
        const stars = this.catalog.stars;
        const n = stars.length;
        const sizes = new Float32Array(n), colors = new Float32Array(n * 3);
        stars.forEach(([, , mag, bv], i) => {
            sizes[i] = THREE.MathUtils.clamp(5.6 - 0.72 * mag, 1.1, 6.6);
            const b = THREE.MathUtils.clamp(1.6 - mag * 0.2, 0.35, 1.8);
            const c = bvColor(bv);
            colors.set([c[0] * b, c[1] * b, c[2] * b], i * 3);
        });
        this.uniforms = { uScale: { value: 1 }, uTime: { value: 0 }, uDay: { value: 0 } };
        this.stars = this._points(n, sizes, colors, this.uniforms);
        this.group.add(this.stars);
    }

    _buildMilkyWay() {
        // A faint haze of unresolved stars along the galactic plane, densest toward the centre.
        const n = 14000;
        this.milky = [];
        const sizes = new Float32Array(n), colors = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) {
            const l = (Math.random() * 2 - 1) * Math.PI;
            const core = Math.exp(-Math.pow(l / 0.9, 2));
            const spread = (0.05 + 0.08 * core) * (Math.random() + Math.random() + Math.random() - 1.5);
            if (Math.random() > 0.35 + 0.65 * core) { i--; continue; }
            this.milky.push(galacticToEquatorial(l, spread));
            sizes[i] = 1.0 + Math.random() * 0.9;
            const b = 0.09 + Math.random() * 0.14 + core * 0.1;
            colors.set([b * 1.0, b * 0.96, b * 0.9], i * 3);
        }
        this.milkyPoints = this._points(n, sizes, colors, this.uniforms);
        this.group.add(this.milkyPoints);
    }

    _buildConstellations() {
        const segs = [];
        for (const [, lines] of this.catalog.constellations) {
            for (const line of lines) for (let i = 1; i < line.length; i++) segs.push(line[i - 1], line[i]);
        }
        this.conSegs = segs;
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(segs.length * 3), 3));
        this.conLines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
            color: 0x6f8fd0, transparent: true, opacity: 0.16, depthWrite: false, toneMapped: false
        }));
        this.conLines.frustumCulled = false;
        this.group.add(this.conLines);

        // Names of the brightest stars.
        this.starLabels = this.catalog.named.map(([name, ra, dec, mag]) => {
            const s = label(name, '#aebfdc', 30, 500);
            s.material.opacity = 0.75;
            s.userData = { ra, dec, mag };
            this.group.add(s);
            return s;
        });
    }

    _buildBodies() {
        // The Moon: real texture, lit from the Sun's true direction, so its phase is exact.
        const moonTex = new THREE.TextureLoader().load('/public/textures/lobby/moon-1k.jpg');
        moonTex.colorSpace = THREE.SRGBColorSpace;
        this.moonMat = new THREE.ShaderMaterial({
            uniforms: { uMap: { value: moonTex }, uSun: { value: new THREE.Vector3(1, 0, 0) } },
            vertexShader: `varying vec3 vN; varying vec2 vUv; void main(){ vUv = uv; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
            fragmentShader: `uniform sampler2D uMap; uniform vec3 uSun; varying vec3 vN; varying vec2 vUv;
                void main(){ float l = smoothstep(-0.05, 0.25, dot(normalize(vN), uSun));
                vec3 c = texture2D(uMap, vUv).rgb * (0.03 + 1.25 * l); gl_FragColor = vec4(c, 1.0);
                #include <colorspace_fragment>
                }`,
            toneMapped: false
        });
        // Drawn ~3× its true 0.5° size so it reads in a headset.
        this.moon = new THREE.Mesh(new THREE.SphereGeometry(SKY_R * 0.024, 48, 32), this.moonMat);
        this.moonLabel = label('Moon', '#e6edf7', 32, 600);
        this.group.add(this.moon, this.moonLabel);

        // The Sun's true position (shown dim if it is below the horizon).
        this.sun = new THREE.Mesh(new THREE.CircleGeometry(SKY_R * 0.012, 40),
            new THREE.MeshBasicMaterial({ color: 0xfff4e0, toneMapped: false }));
        this.group.add(this.sun);

        const PLANETS = [
            ['Mercury', Astronomy.Body.Mercury, '#c9b9a6'], ['Venus', Astronomy.Body.Venus, '#fff1c7'],
            ['Mars', Astronomy.Body.Mars, '#ff9a6b'], ['Jupiter', Astronomy.Body.Jupiter, '#ffe2b8'],
            ['Saturn', Astronomy.Body.Saturn, '#f4dea4']
        ];
        const dot = (() => {
            const c = document.createElement('canvas'); c.width = c.height = 64;
            const x = c.getContext('2d'); const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
            g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,255,255,0.85)'); g.addColorStop(1, 'rgba(255,255,255,0)');
            x.fillStyle = g; x.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c);
        })();
        this.planets = PLANETS.map(([name, body, color]) => {
            const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: dot, color, transparent: true, depthWrite: false, toneMapped: false }));
            sprite.scale.setScalar(SKY_R * 0.018);
            const tag = label(name, color, 32, 600);
            this.group.add(sprite, tag);
            return { name, body, sprite, tag };
        });
    }

    _buildHorizon() {
        const ring = new THREE.Mesh(new THREE.RingGeometry(SKY_R * 0.995, SKY_R, 180),
            new THREE.MeshBasicMaterial({ color: 0x64ffda, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }));
        ring.rotation.x = -Math.PI / 2;
        this.group.add(ring);
        for (const [txt, az] of [['N', 0], ['E', 90], ['S', 180], ['W', 270]]) {
            const s = label(txt, '#64ffda', 44, 700);
            horizonToLocal(az, 1.5, s.position).multiplyScalar(SKY_R * 0.97);
            s.center.set(0.5, 0);
            this.group.add(s);
        }
    }

    /** Re-plot everything for `date` at the current location. */
    refresh(date) {
        if (!this.ready) return;
        const { lat, lon } = this.location;
        const lst = localSiderealTime(date, lon);
        const v = this._v;

        const place = (arr, list, radius) => {
            for (let i = 0; i < list.length; i++) {
                const [ra, dec] = list[i];
                equatorialToLocal(ra, dec, lst, lat, v).multiplyScalar(radius);
                arr[i * 3] = v.x; arr[i * 3 + 1] = v.y; arr[i * 3 + 2] = v.z;
            }
        };
        place(this.stars.geometry.attributes.position.array, this.catalog.stars, SKY_R);
        this.stars.geometry.attributes.position.needsUpdate = true;
        place(this.milkyPoints.geometry.attributes.position.array, this.milky, SKY_R * 1.01);
        this.milkyPoints.geometry.attributes.position.needsUpdate = true;
        place(this.conLines.geometry.attributes.position.array, this.conSegs, SKY_R * 0.999);
        this.conLines.geometry.attributes.position.needsUpdate = true;

        let shown = 0;
        for (const s of [...this.starLabels].sort((a, b) => a.userData.mag - b.userData.mag)) {
            equatorialToLocal(s.userData.ra, s.userData.dec, lst, lat, v);
            s.visible = v.y > 0.06 && shown < 14;
            if (s.visible) shown++;
            s.position.copy(v).multiplyScalar(SKY_R * 0.985).add(new THREE.Vector3(6, 0, 0));
        }

        const observer = new Astronomy.Observer(lat, lon, 0);
        const altAz = body => {
            const eq = Astronomy.Equator(body, date, observer, true, true);
            const hor = Astronomy.Horizon(date, observer, eq.ra, eq.dec, 'normal');
            return { az: hor.azimuth, alt: hor.altitude, ra: eq.ra, dec: eq.dec };
        };

        const sun = altAz(Astronomy.Body.Sun);
        const sunDir = horizonToLocal(sun.az, sun.alt, new THREE.Vector3());
        this.sun.position.copy(sunDir).multiplyScalar(SKY_R * 0.98);
        this.sun.lookAt(0, 0, 0);
        this.sun.visible = sun.alt > -1;
        // Daylight / twilight washes out the stars, as it does outside.
        this.uniforms.uDay.value = THREE.MathUtils.clamp((sun.alt + 12) / 12, 0, 1);
        this.conLines.material.opacity = 0.16 * (1 - this.uniforms.uDay.value * 0.75);

        const moon = altAz(Astronomy.Body.Moon);
        horizonToLocal(moon.az, moon.alt, this.moon.position).multiplyScalar(SKY_R * 0.95);
        this.moonMat.uniforms.uSun.value.copy(sunDir);
        this.moonLabel.position.copy(this.moon.position).add(new THREE.Vector3(SKY_R * 0.035, 0, 0));
        this.moon.visible = this.moonLabel.visible = moon.alt > -2;
        const illum = Astronomy.Illumination(Astronomy.Body.Moon, date);
        const phaseAngle = Astronomy.MoonPhase(date);
        const moonCon = Astronomy.Constellation(moon.ra, moon.dec).name;

        const up = [];
        for (const p of this.planets) {
            const pos = altAz(p.body);
            horizonToLocal(pos.az, pos.alt, p.sprite.position).multiplyScalar(SKY_R * 0.96);
            p.tag.position.copy(p.sprite.position).add(new THREE.Vector3(SKY_R * 0.016, 0, 0));
            p.sprite.visible = p.tag.visible = pos.alt > 0;
            if (pos.alt > 0) up.push(`${p.name} ${compass(pos.az)} ${Math.round(pos.alt)}°`);
        }

        this.info = {
            date, lat, lon, source: this.location.source,
            sunAlt: sun.alt,
            moon: {
                up: moon.alt > 0, alt: moon.alt, az: moon.az,
                illumination: illum.phase_fraction,
                waxing: phaseAngle < 180,
                constellation: moonCon
            },
            planetsUp: up,
            starsUp: this.catalog.stars.reduce((n, [ra, dec]) => n + (equatorialToLocal(ra, dec, lst, lat, v).y > 0 ? 1 : 0), 0)
        };
        this.onInfo(this.info);
    }

    update(dt, t) {
        if (!this.ready) return;
        this.uniforms.uTime.value = t;
        this.uniforms.uScale.value = this.renderer.getPixelRatio() * (this.renderer.xr.isPresenting ? 1.6 : 1);
        this._t += dt;
        if (this._t > 5) { this._t = 0; this.refresh(new Date()); }
    }
}

export function compass(az) {
    return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(((az % 360) + 360) % 360 / 45) % 8];
}

/**
 * Best location we can get without bothering anyone: a saved fix, then a
 * silent fix if permission was already granted, else a rough guess from the
 * time zone (longitude from the UTC offset).
 */
export async function initialLocation() {
    try {
        const saved = JSON.parse(localStorage.getItem('orbitor.location') || 'null');
        if (saved && Number.isFinite(saved.lat) && Number.isFinite(saved.lon)) return { ...saved, source: 'saved' };
    } catch { /* storage unavailable */ }
    try {
        const perm = await navigator.permissions?.query({ name: 'geolocation' });
        if (perm?.state === 'granted') return await askLocation();
    } catch { /* permissions API unavailable */ }
    const lon = THREE.MathUtils.clamp(-new Date().getTimezoneOffset() / 60 * 15, -180, 180);
    return { lat: 25, lon, source: 'approximate' };
}

/** Ask the browser for the real location (shows its permission prompt the first time). */
export function askLocation() {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) { reject(new Error('Location is not available in this browser.')); return; }
        navigator.geolocation.getCurrentPosition(pos => {
            const loc = { lat: +pos.coords.latitude.toFixed(2), lon: +pos.coords.longitude.toFixed(2), source: 'gps' };
            try { localStorage.setItem('orbitor.location', JSON.stringify({ lat: loc.lat, lon: loc.lon })); } catch { /* ignore */ }
            resolve(loc);
        }, err => reject(err), { maximumAge: 3600000, timeout: 15000 });
    });
}
