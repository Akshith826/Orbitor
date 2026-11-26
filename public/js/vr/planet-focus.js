/**
 * Focus effect for the selected world in the VR Solar System.
 *
 *  • Glow shell: a pulsing rim-light (fresnel) halo hugging the planet, in its own colour.
 *  • Scan ping: a ring that ripples outward from the planet when it is chosen.
 *  • Depth name: the planet's name, huge and translucent, floating far behind it
 *    on the line of sight. The planet occludes it, and in a headset it sits at
 *    a real stereo depth behind the world.
 *
 * Everything follows the planet as it orbits and always faces the viewer.
 */
import * as THREE from 'three';

const GLOW_VERT = /* glsl */`
    varying vec3 vN;
    varying vec3 vView;
    void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vN = normalize(mat3(modelMatrix) * normal);
        vView = normalize(cameraPosition - w.xyz);
        gl_Position = projectionMatrix * viewMatrix * w;
    }`;
const GLOW_FRAG = /* glsl */`
    uniform vec3 uColor;
    uniform float uStrength;
    varying vec3 vN;
    varying vec3 vView;
    void main() {
        float rim = 1.0 - abs(dot(normalize(vN), normalize(vView)));
        float a = pow(rim, 2.4) * uStrength;
        gl_FragColor = vec4(uColor * a, a);
    }`;

function nameTexture(name, color) {
    const c = document.createElement('canvas');
    c.width = 2048; c.height = 512;
    const x = c.getContext('2d');
    const text = name.toUpperCase().split('').join(' ');
    let size = 300;
    x.font = `800 ${size}px Orbitron, Inter, sans-serif`;
    while (x.measureText(text).width > 1960 && size > 120) { size -= 10; x.font = `800 ${size}px Orbitron, Inter, sans-serif`; }
    const g = x.createLinearGradient(0, 100, 0, 420);
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(1, color);
    x.fillStyle = g;
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.shadowColor = color;
    x.shadowBlur = 40;
    x.fillText(text, 1024, 270);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
}

export class PlanetFocus {
    constructor(scene) {
        this.scene = scene;
        this.key = null;
        this.t = 0;
        this._cam = new THREE.Vector3();
        this._pos = new THREE.Vector3();
        this._dir = new THREE.Vector3();

        this.glowMat = new THREE.ShaderMaterial({
            uniforms: { uColor: { value: new THREE.Color(0x64ffda) }, uStrength: { value: 0 } },
            vertexShader: GLOW_VERT, fragmentShader: GLOW_FRAG,
            transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.BackSide
        });
        this.glow = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 48), this.glowMat);
        this.glow.renderOrder = 5;

        this.pingMat = new THREE.MeshBasicMaterial({ color: 0x64ffda, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
        this.ping = new THREE.Mesh(new THREE.RingGeometry(0.96, 1, 96), this.pingMat);
        this.ping.renderOrder = 6;

        this.nameMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending });
        this.name = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.25), this.nameMat);   // 4:1, matches the texture
        this.name.renderOrder = -1;

        this.group = new THREE.Group();
        this.group.visible = false;
        this.group.add(this.name, this.glow, this.ping);
        scene.add(this.group);
    }

    /** Focus a body. `getPos(out)` returns its live world position; `radius` in scene units. */
    show(key, name, radius, colorHex, getPos) {
        if (this.key !== key) {
            this.nameMat.map?.dispose();
            const css = '#' + new THREE.Color(colorHex).getHexString();
            this.nameMat.map = nameTexture(name, css);
            this.nameMat.needsUpdate = true;
        }
        this.key = key;
        this.radius = radius;
        this.getPos = getPos;
        const c = new THREE.Color(colorHex).lerp(new THREE.Color(0xffffff), 0.25);
        this.glowMat.uniforms.uColor.value.copy(c);
        this.pingMat.color.copy(c);
        this.t = 0;
        this.group.visible = true;
    }

    hide() {
        this.group.visible = false;
        this.key = null;
    }

    update(dt, camera) {
        if (!this.group.visible || !this.getPos) return;
        this.t += dt;
        const t = this.t, r = this.radius;
        const pos = this.getPos(this._pos);
        camera.getWorldPosition(this._cam);

        // Glow: bursts in, then breathes.
        const intro = Math.min(1, t / 0.6);
        const breathe = 0.75 + 0.25 * Math.sin(t * 2.4);
        this.glow.position.copy(pos);
        this.glow.scale.setScalar(r * (1.22 + 0.25 * (1 - intro) + 0.03 * Math.sin(t * 2.4)));
        this.glowMat.uniforms.uStrength.value = (1.6 - 0.6 * intro) * breathe;

        // Scan ping: ripples outward every 2.4 s, facing the viewer.
        const cycle = (t % 2.4) / 2.4;
        this.ping.position.copy(pos);
        this.ping.lookAt(this._cam);
        this.ping.scale.setScalar(r * (1.1 + cycle * 2.4));
        this.pingMat.opacity = (1 - cycle) * 0.55 * (t < 12 ? 1 : 0.4);

        // Depth name: far behind the planet on the line of sight, filling the backdrop.
        this._dir.copy(pos).sub(this._cam);
        const dist = this._dir.length();
        this._dir.normalize();
        const back = Math.max(r * 6, dist * 0.6);
        // Size it so the word spans ~5x the planet's apparent width at its depth:
        // the planet hides the middle letters and the rest frame it.
        const depthScale = (dist + back) / Math.max(0.001, dist);
        const width = r * 2 * 5 * depthScale;
        this.name.position.copy(pos).addScaledVector(this._dir, back);
        this.name.lookAt(this._cam);
        this.name.translateY(r * 0.55 * depthScale);
        this.name.scale.set(width, width, 1);
        // Slow drift in from further back as it appears, then hold.
        this.nameMat.opacity = Math.min(1, t / 1.0) * 0.62;
    }
}
