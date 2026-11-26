/**
 * Supermassive black hole for the Deep Space Ride finale.
 *
 * Everything here renders per eye with ordinary meshes and shaders (no
 * screen-space post-processing), so it is correct in a WebXR headset:
 *
 *  • Lens sphere — for every pixel it bends the view ray toward the hole
 *    (deflection ∝ 1 / impact parameter) and samples the same star map the
 *    scene uses as its background, so the sky visibly warps and an Einstein
 *    ring forms. Rays that pass inside the photon sphere are captured (black).
 *  • Accretion disk — hot plasma with swirling turbulence, a blackbody
 *    gradient and Doppler beaming (the side rotating toward you is brighter).
 *  • Lensed halo — the far side of the disk, bent up over and under the
 *    shadow, plus the thin photon ring that hugs it.
 */
import * as THREE from 'three';

export const BH = Object.freeze({
    shadow: 7.8,      // radius of the black shadow (scene units)
    lens: 34,         // radius of the lensing region
    diskInner: 10.5,
    diskOuter: 30
});

const LENS_VERT = /* glsl */`
    varying vec3 vWorld;
    void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
    }`;

const LENS_FRAG = /* glsl */`
    uniform sampler2D uSky;
    uniform float uHasSky;
    uniform vec3 uCenter;
    uniform float uShadow;
    uniform float uLens;
    uniform float uIntensity;
    uniform float uStrength;
    varying vec3 vWorld;

    vec2 equirect(vec3 d) {
        return vec2(atan(d.z, d.x) * 0.15915494 + 0.5, asin(clamp(d.y, -1.0, 1.0)) * 0.31830989 + 0.5);
    }

    void main() {
        vec3 dir = normalize(vWorld - cameraPosition);
        vec3 toC = uCenter - cameraPosition;
        float along = dot(toC, dir);
        vec3 closest = cameraPosition + dir * along;
        vec3 offs = uCenter - closest;           // points from the ray toward the hole
        float b = length(offs);                  // impact parameter
        if (along < 0.0) discard;

        // Captured by the hole: pure black, with the faintest rim of light.
        float capture = uShadow * 1.02;
        float edge = 1.0 - smoothstep(uLens * 0.72, uLens, b);
        if (b < capture) {
            gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
            return;
        }

        // Weak-field deflection grows as 1/b, steepening near the photon sphere.
        float defl = uStrength * uShadow / b;
        defl += 0.9 * pow(uShadow / b, 6.0);
        vec3 bent = normalize(dir + normalize(offs) * min(defl, 2.6));

        vec3 sky = uHasSky > 0.5 ? texture2D(uSky, equirect(bent)).rgb * uIntensity : vec3(0.0);
        // Light piles up just outside the shadow: the photon ring.
        float ring = exp(-pow((b - uShadow * 1.12) / (uShadow * 0.035), 2.0));
        vec3 col = sky + vec3(1.0, 0.72, 0.42) * ring * 0.75;
        gl_FragColor = vec4(col, edge);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
    }`;

const DISK_VERT = /* glsl */`
    varying vec2 vLocal;
    varying vec3 vWorld;
    void main() {
        vLocal = position.xy;
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
    }`;

const DISK_FRAG = /* glsl */`
    uniform float uTime;
    uniform float uInner;
    uniform float uOuter;
    uniform vec3 uCenter;
    uniform vec3 uSpinAxis;
    uniform float uBright;
    varying vec2 vLocal;
    varying vec3 vWorld;

    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
    }
    vec3 blackbody(float t) {           // t: 0 cool .. 1 hot
        vec3 c1 = vec3(0.45, 0.04, 0.01);
        vec3 c2 = vec3(1.0, 0.32, 0.04);
        vec3 c3 = vec3(1.0, 0.72, 0.36);
        vec3 c4 = vec3(1.0, 0.95, 0.85);
        return t < 0.4 ? mix(c1, c2, t / 0.4) : t < 0.75 ? mix(c2, c3, (t - 0.4) / 0.35) : mix(c3, c4, (t - 0.75) / 0.25);
    }

    void main() {
        float r = length(vLocal);
        float x = (r - uInner) / (uOuter - uInner);
        if (x < 0.0 || x > 1.0) discard;
        float ang = atan(vLocal.y, vLocal.x);
        // Inner material orbits faster (Keplerian shear) → spiral streaks.
        float spin = uTime * (1.6 / pow(r / uInner, 1.5));
        vec2 q = vec2(ang * 3.0 + spin * 2.2, r * 0.9);
        float turb = noise(q * vec2(2.0, 3.0)) * 0.55 + noise(q * vec2(5.0, 9.0)) * 0.3 + noise(q * vec2(13.0, 21.0)) * 0.15;
        float temp = pow(1.0 - x, 1.4);
        float dens = smoothstep(0.0, 0.06, x) * (1.0 - smoothstep(0.75, 1.0, x));

        // Doppler beaming: material moving toward the camera is brighter.
        vec3 radial = normalize(vWorld - uCenter);
        vec3 vel = normalize(cross(uSpinAxis, radial));
        vec3 toCam = normalize(cameraPosition - vWorld);
        float beam = pow(1.0 + 0.75 * dot(vel, toCam), 2.2);

        vec3 col = blackbody(clamp(temp * 0.85 + turb * 0.3, 0.0, 1.0)) * (0.35 + turb * 1.1) * beam * uBright;
        float a = dens * (0.55 + 0.45 * turb);
        gl_FragColor = vec4(col * a, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
    }`;

const HALO_FRAG = /* glsl */`
    uniform float uTime;
    uniform float uBright;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 15731.7); }
    void main() {
        vec2 p = vUv * 2.0 - 1.0;               // billboard space, shadow radius = 0.30
        float r = length(p);
        float a = atan(p.y, p.x);
        // The lensed far side of the disk: a bright band arching over the top
        // and a thinner one under the bottom, hugging the shadow.
        float band = exp(-pow((r - 0.42) / 0.075, 2.0));
        float top = smoothstep(-0.1, 0.9, sin(a));          // stronger above
        float bottom = smoothstep(-0.1, 0.9, -sin(a)) * 0.45;
        float flick = 0.85 + 0.15 * hash(vec2(floor(a * 30.0 + uTime * 6.0), 1.0));
        float halo = band * (top + bottom) * flick;
        // Photon ring right at the edge of the shadow.
        float ring = exp(-pow((r - 0.312) / 0.006, 2.0)) * 0.55;
        vec3 col = vec3(1.0, 0.5, 0.14) * halo * 2.2 + vec3(1.0, 0.8, 0.55) * ring;
        float alpha = clamp(halo + ring, 0.0, 1.0) * uBright;
        gl_FragColor = vec4(col * uBright, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
    }`;

export class BlackHole {
    constructor(scene) {
        this.scene = scene;
        this.group = new THREE.Group();
        this.group.name = 'black-hole';
        this.group.visible = false;
        scene.add(this.group);
        this._camPos = new THREE.Vector3();
        this._build();
    }

    _build() {
        const center = new THREE.Vector3();
        this.lensMat = new THREE.ShaderMaterial({
            uniforms: {
                uSky: { value: null }, uHasSky: { value: 0 }, uCenter: { value: center.clone() },
                uShadow: { value: BH.shadow }, uLens: { value: BH.lens }, uIntensity: { value: 0.8 }, uStrength: { value: 1.05 }
            },
            vertexShader: LENS_VERT, fragmentShader: LENS_FRAG,
            transparent: true, depthWrite: false
        });
        this.lens = new THREE.Mesh(new THREE.SphereGeometry(BH.lens, 64, 48), this.lensMat);
        this.lens.renderOrder = 1;

        // The disk is tilted a little so its far side lifts above the shadow.
        this.diskTilt = new THREE.Group();
        this.diskTilt.rotation.set(-Math.PI / 2 + 0.34, 0, 0.16);
        this.diskMat = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 }, uInner: { value: BH.diskInner }, uOuter: { value: BH.diskOuter },
                uCenter: { value: center.clone() }, uSpinAxis: { value: new THREE.Vector3(0, 1, 0) }, uBright: { value: 2.1 }
            },
            vertexShader: DISK_VERT, fragmentShader: DISK_FRAG,
            transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending
        });
        this.disk = new THREE.Mesh(new THREE.RingGeometry(BH.diskInner, BH.diskOuter, 160, 12), this.diskMat);
        this.disk.renderOrder = 3;
        this.diskTilt.add(this.disk);

        this.haloMat = new THREE.ShaderMaterial({
            uniforms: { uTime: { value: 0 }, uBright: { value: 1 } },
            vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
            fragmentShader: HALO_FRAG,
            transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
        });
        // Billboard sized so the shadow fills 0.30 of its half-width.
        const haloSize = BH.shadow / 0.30 * 2;
        this.halo = new THREE.Mesh(new THREE.PlaneGeometry(haloSize, haloSize), this.haloMat);
        this.halo.renderOrder = 4;

        // Opaque core: writes depth so the far half of the disk is hidden behind the hole.
        this.core = new THREE.Mesh(new THREE.SphereGeometry(BH.shadow * 0.98, 48, 32), new THREE.MeshBasicMaterial({ color: 0x000000 }));
        this.core.renderOrder = 0;

        this.group.add(this.core, this.lens, this.diskTilt, this.halo);
    }

    /** Place the hole and pick up the scene's star map so the lensing matches the sky. */
    place(position) {
        this.group.position.copy(position);
        this.group.updateMatrixWorld(true);
        this.lensMat.uniforms.uCenter.value.copy(position);
        this.diskMat.uniforms.uCenter.value.copy(position);
        this.diskMat.uniforms.uSpinAxis.value.set(0, 1, 0).applyQuaternion(this.diskTilt.getWorldQuaternion(new THREE.Quaternion())).normalize();
        const sky = this.scene.background;
        if (sky && sky.isTexture && sky.image) {
            this.lensMat.uniforms.uSky.value = sky;
            this.lensMat.uniforms.uHasSky.value = 1;
            // A touch brighter than the open sky: lensing concentrates starlight.
            this.lensMat.uniforms.uIntensity.value = (this.scene.backgroundIntensity ?? 0.5) * 1.5;
        }
    }

    setVisible(on) { this.group.visible = on; }

    update(dt, camera) {
        if (!this.group.visible) return;
        this.diskMat.uniforms.uTime.value += dt;
        this.haloMat.uniforms.uTime.value += dt;
        // The lensed halo always faces the viewer (both eyes share the head position).
        camera.getWorldPosition(this._camPos);
        this.halo.lookAt(this._camPos);
    }

    /** 0 far away … 1 at the closest pass; drives time dilation and rumble. */
    proximity(point) {
        const d = point.distanceTo(this.group.position);
        return THREE.MathUtils.clamp(1 - (d - BH.lens) / 240, 0, 1);
    }
}
