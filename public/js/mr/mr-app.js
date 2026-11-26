/**
 * Mixed reality solar system (Meta Quest 3 passthrough, WebXR immersive-ar).
 *
 *  1. Look at a table or the floor: a ring follows real surfaces (hit-test).
 *     Pull the trigger to set the solar system down there.
 *  2. Point and pull the trigger on any world: it is highlighted, a fact card
 *     appears above it and Mission Control reads the fact.
 *  3. Squeeze a grip to pick the whole system up and move it; squeeze both
 *     grips and pull your hands apart or together to resize it.
 *  4. Left stick turns the system; right stick speeds time up or down;
 *     A pauses time; B places it again; X goes back to the lobby.
 *
 * Without a headset the same model is shown on screen with orbit controls.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SolarModel } from './solar-model.js?v=20261127-o1';
import { PLANET_FACTS } from '../vr/planet-announcer.js?v=20261127-o1';
import { setupAutoVR } from '../vr/auto-vr.js?v=20261127-o1';
import { readQuestControllers, smoothQuestSticks, pulseQuestController } from '../vr/xr-support.js?v=20261127-o1';

const $ = id => document.getElementById(id);
const AR_INIT = { requiredFeatures: ['local-floor'], optionalFeatures: ['hit-test', 'hand-tracking', 'anchors', 'plane-detection'] };
const EXTRA_FACTS = {
    moon: 'The Moon, Earth’s only natural satellite, always shows us the same face.'
};

class MixedRealityApp {
    constructor() {
        this.state = 'preview';          // preview | placing | placed
        this.session = null;
        this.hitSource = null;
        this.clock = new THREE.Clock();
        this.raycaster = new THREE.Raycaster();
        this.grabs = new Map();          // controller -> grab info
        this.prevInput = null;
        this._v = new THREE.Vector3();
    }

    init() {
        const r = this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
        r.setSize(innerWidth, innerHeight);
        r.outputColorSpace = THREE.SRGBColorSpace;
        r.toneMapping = THREE.ACESFilmicToneMapping;
        r.xr.enabled = true;
        r.xr.setReferenceSpaceType('local-floor');
        $('mr').appendChild(r.domElement);

        this.scene = new THREE.Scene();
        this.previewBg = new THREE.Color(0x05070d);
        this.scene.background = this.previewBg;
        this.camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.01, 100);
        this.camera.position.set(0, 1.55, 1.25);

        this.model = new SolarModel();
        this.model.group.position.set(0, 1.0, 0);
        this.scene.add(this.model.group);

        // Desktop / phone preview: orbit around the model.
        this.controls = new OrbitControls(this.camera, r.domElement);
        this.controls.target.set(0, 1.0, 0);
        this.controls.enableDamping = true;
        this.controls.minDistance = 0.35;
        this.controls.maxDistance = 4;

        this.buildReticle();
        this.buildControllers();
        this.buildFactCard();
        this.buildGuide();
        this.bindPointer();

        window.addEventListener('resize', () => this.onResize());
        r.setAnimationLoop((t, frame) => this.loop(frame));
        $('loading').classList.add('done');
        window.__mr = this;

        setupAutoVR({
            mode: 'immersive-ar',
            sessionInit: AR_INIT,
            button: 'Enter mixed reality',
            enter: s => this.enterAR(s),
            isActive: () => Boolean(this.session || this.starting),
            title: 'Solar System in your room',
            sub: 'Your room stays visible through passthrough. Pull the trigger anywhere to begin, then look at a table to place the planets.'
        }).then(({ supported }) => {
            $('enter-ar').hidden = !supported;
            $('enter-ar').onclick = () => this.enterAR(null);
            $('ar-note').textContent = supported
                ? 'Mixed reality ready: press Enter mixed reality, or pull the trigger.'
                : 'Mixed reality needs a Meta Quest 3 (Quest Browser over HTTPS). This is the on-screen preview: drag to orbit, click a planet.';
        });
    }

    /* ── scene pieces ─────────────────────────────────────────────── */

    buildReticle() {
        const g = new THREE.Group();
        const ring = new THREE.Mesh(new THREE.RingGeometry(0.11, 0.125, 64).rotateX(-Math.PI / 2),
            new THREE.MeshBasicMaterial({ color: 0x64ffda, transparent: true, opacity: 0.9 }));
        const disc = new THREE.Mesh(new THREE.CircleGeometry(0.11, 64).rotateX(-Math.PI / 2),
            new THREE.MeshBasicMaterial({ color: 0x64ffda, transparent: true, opacity: 0.12, depthWrite: false }));
        g.add(ring, disc);
        g.matrixAutoUpdate = false;
        g.visible = false;
        this.reticle = g;
        this.scene.add(g);
    }

    buildControllers() {
        this.controllers = [0, 1].map(i => {
            const c = this.renderer.xr.getController(i);
            const ray = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]),
                new THREE.LineBasicMaterial({ color: 0x64ffda, transparent: true, opacity: 0.7 }));
            ray.scale.z = 1.5;
            const dot = new THREE.Mesh(new THREE.SphereGeometry(0.006, 12, 8), new THREE.MeshBasicMaterial({ color: 0xbfffee }));
            dot.position.z = -1.5;
            c.add(ray, dot);
            c.userData = { ray, dot, handedness: i ? 'right' : 'left' };
            c.addEventListener('connected', e => { c.userData.handedness = e.data?.handedness || c.userData.handedness; c.visible = true; });
            c.addEventListener('disconnected', () => { c.visible = false; this.grabs.delete(c); });
            c.addEventListener('selectstart', () => this.onSelect(c));
            c.addEventListener('squeezestart', () => this.onGrab(c));
            c.addEventListener('squeezeend', () => this.grabs.delete(c));
            this.scene.add(c);
            return c;
        });
    }

    buildFactCard() {
        const c = document.createElement('canvas');
        c.width = 1024; c.height = 420;
        this.cardCanvas = c;
        this.cardTex = new THREE.CanvasTexture(c);
        this.cardTex.colorSpace = THREE.SRGBColorSpace;
        this.card = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.34 * 420 / 1024),
            new THREE.MeshBasicMaterial({ map: this.cardTex, transparent: true, depthWrite: false, toneMapped: false }));
        this.card.visible = false;
        this.card.renderOrder = 10;
        this.scene.add(this.card);
    }

    buildGuide() {
        const c = document.createElement('canvas');
        c.width = 1024; c.height = 300;
        const x = c.getContext('2d');
        this.guideCanvas = c;
        this.guideTex = new THREE.CanvasTexture(c);
        this.guideTex.colorSpace = THREE.SRGBColorSpace;
        this.guide = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5 * 300 / 1024),
            new THREE.MeshBasicMaterial({ map: this.guideTex, transparent: true, depthWrite: false, toneMapped: false }));
        this.guide.visible = false;
        this.scene.add(this.guide);
        this.drawGuide(['Look at a table or the floor', 'Pull the trigger to place the solar system']);
        void x;
    }

    drawPanel(canvas, tex, title, lines, accent = '#64ffda') {
        const x = canvas.getContext('2d');
        const W = canvas.width, H = canvas.height, r = 60;
        x.clearRect(0, 0, W, H);
        x.beginPath();
        x.moveTo(r, 4); x.arcTo(W - 4, 4, W - 4, H - 4, r); x.arcTo(W - 4, H - 4, 4, H - 4, r);
        x.arcTo(4, H - 4, 4, 4, r); x.arcTo(4, 4, W - 4, 4, r); x.closePath();
        const g = x.createLinearGradient(0, 0, 0, H);
        g.addColorStop(0, 'rgba(14,24,46,0.92)'); g.addColorStop(1, 'rgba(6,11,24,0.92)');
        x.fillStyle = g; x.fill();
        x.lineWidth = 4; x.strokeStyle = accent; x.stroke();
        x.textBaseline = 'top';
        x.fillStyle = accent; x.font = '800 60px Inter, sans-serif';
        x.fillText(title, 50, 40, W - 100);
        x.fillStyle = '#dbe6f7'; x.font = '500 38px Inter, sans-serif';
        let y = 130;
        for (const line of lines) {
            // simple word wrap
            const words = line.split(' ');
            let cur = '';
            for (const w of words) {
                const next = cur ? cur + ' ' + w : w;
                if (x.measureText(next).width > W - 100 && cur) { x.fillText(cur, 50, y); y += 50; cur = w; } else cur = next;
            }
            if (cur) { x.fillText(cur, 50, y); y += 56; }
        }
        tex.needsUpdate = true;
    }

    drawGuide(lines) {
        this.drawPanel(this.guideCanvas, this.guideTex, 'ORBITOR · MIXED REALITY', lines);
    }

    /* ── XR session ───────────────────────────────────────────────── */

    async enterAR(offered) {
        if (this.session || this.starting) { offered?.end().catch(() => {}); return; }
        this.starting = true;
        try {
            // requestSession must run inside the user's gesture: nothing awaits before it.
            const session = offered || await navigator.xr.requestSession('immersive-ar', AR_INIT);
            this.scene.background = null;                       // passthrough shows through
            this.renderer.setClearColor(0x000000, 0);
            this.controls.enabled = false;
            await this.renderer.xr.setSession(session);
            this.session = session;
            document.body.classList.add('in-xr');
            session.addEventListener('end', () => this.onSessionEnd(), { once: true });
            this.startPlacing();
            this.setupHitTest(session);
        } catch (e) {
            console.warn('[mr] could not start mixed reality', e);
            $('ar-note').textContent = 'Mixed reality could not start: ' + (e?.message || e);
            this.scene.background = this.previewBg;
        } finally {
            this.starting = false;
        }
    }

    async setupHitTest(session) {
        try {
            if (!session.requestHitTestSource) return;
            const viewer = await session.requestReferenceSpace('viewer');
            this.hitSource = await session.requestHitTestSource({ space: viewer });
        } catch (e) {
            this.hitSource = null;           // fall back to a spot in front of the viewer
        }
    }

    onSessionEnd() {
        this.session = null;
        this.hitSource = null;
        this.grabs.clear();
        this.scene.background = this.previewBg;
        this.controls.enabled = true;
        this.reticle.visible = false;
        this.guide.visible = false;
        this.model.group.visible = true;
        this.model.group.position.set(0, 1.0, 0);
        this.model.group.scale.setScalar(1);
        this.state = 'preview';
        document.body.classList.remove('in-xr');
        this.onResize();
    }

    startPlacing() {
        this.state = 'placing';
        this.model.group.visible = false;
        this.card.visible = false;
        this.guide.visible = true;
        this.placingSince = this.clock.elapsedTime;
        this.drawGuide(['Look at a table or the floor', 'Pull the trigger to place the solar system']);
    }

    placeAt(matrix) {
        const pos = new THREE.Vector3().setFromMatrixPosition(matrix);
        this.model.group.position.copy(pos).add(new THREE.Vector3(0, 0.16, 0));   // float just above the surface
        // Face the system toward the viewer.
        const head = this.camera.getWorldPosition(new THREE.Vector3());
        this.model.group.rotation.set(0, Math.atan2(head.x - pos.x, head.z - pos.z), 0);
        this.model.group.visible = true;
        this.reticle.visible = false;
        this.state = 'placed';
        this.guideTimer = 10;
        this.drawGuide(['Point + trigger: learn about a world', 'Grip: move it · both grips: resize', 'Sticks: turn / time speed · A: pause · B: place again']);
        this.pulse('both', 0.5, 60);
    }

    /* ── input ────────────────────────────────────────────────────── */

    onSelect(controller) {
        if (this.state === 'placing') {
            if (this.reticle.visible) this.placeAt(this.reticle.matrix);
            return;
        }
        if (this.state !== 'placed') return;
        this.raycaster.setFromXRController(controller);
        this.choose(this.model.pick(this.raycaster));
    }

    choose(hit) {
        if (!hit) { this.model.select(null); this.card.visible = false; return; }
        this.model.select(hit.object);
        const fact = PLANET_FACTS[hit.key] || EXTRA_FACTS[hit.key] || '';
        const def = this.model.planets.find(p => p.def.key === hit.key)?.def;
        const stats = def ? `Orbit ${def.period >= 1000 ? (def.period / 365.25).toFixed(1) + ' years' : Math.round(def.period) + ' days'} · axial tilt ${def.tilt}°` : '';
        this.drawPanel(this.cardCanvas, this.cardTex, hit.name.toUpperCase(), [fact, stats].filter(Boolean), '#c4b5fd');
        this.cardTarget = hit.object;
        this.card.visible = true;
        this.speak(fact);
        this.pulse('right', 0.4, 50);
    }

    onGrab(controller) {
        if (this.state !== 'placed') return;
        const cp = controller.getWorldPosition(new THREE.Vector3());
        const center = this.model.group.position;
        this.raycaster.setFromXRController(controller);
        const rayHit = this.raycaster.ray.distanceToPoint(center) < this.model.radius;
        if (cp.distanceTo(center) > this.model.radius + 0.25 && !rayHit) return;
        const inv = controller.matrixWorld.clone().invert();
        this.grabs.set(controller, {
            local: center.clone().applyMatrix4(inv),
            quat: controller.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(this.model.group.quaternion.clone())
        });
        if (this.grabs.size === 2) {
            const [a, b] = [...this.grabs.keys()];
            this.scaleStart = { dist: a.getWorldPosition(new THREE.Vector3()).distanceTo(b.getWorldPosition(new THREE.Vector3())), scale: this.model.group.scale.x };
        }
        this.pulse(controller.userData.handedness, 0.35, 40);
    }

    updateGrabs() {
        if (this.grabs.size === 1) {
            const [c, g] = [...this.grabs.entries()][0];
            this.model.group.position.copy(g.local).applyMatrix4(c.matrixWorld);
            this.model.group.quaternion.copy(c.getWorldQuaternion(new THREE.Quaternion()).multiply(g.quat));
            // Keep it upright: only yaw follows the hand.
            const e = new THREE.Euler().setFromQuaternion(this.model.group.quaternion, 'YXZ');
            this.model.group.rotation.set(0, e.y, 0);
        } else if (this.grabs.size === 2 && this.scaleStart) {
            const [a, b] = [...this.grabs.keys()];
            const pa = a.getWorldPosition(new THREE.Vector3()), pb = b.getWorldPosition(new THREE.Vector3());
            const s = THREE.MathUtils.clamp(this.scaleStart.scale * pa.distanceTo(pb) / Math.max(0.05, this.scaleStart.dist), 0.25, 4);
            this.model.group.scale.setScalar(s);
            this.model.group.position.copy(pa).add(pb).multiplyScalar(0.5);
        }
    }

    handleButtons(dt) {
        const input = smoothQuestSticks(readQuestControllers(this.session, this.prevInput), this.prevInput, dt);
        this.prevInput = input;
        if (this.state !== 'placed') return;
        const { left, right } = input;
        this.model.group.rotation.y -= (left.stick.x || 0) * dt * 1.2;
        if (Math.abs(right.stick.y) > 0.05) {
            this.model.daysPerSecond = THREE.MathUtils.clamp(this.model.daysPerSecond * Math.exp(-right.stick.y * dt * 2), 0.5, 400);
        }
        if (right.primaryJustPressed) this.model.paused = !this.model.paused;
        if (right.secondaryJustPressed) this.startPlacing();
        if (left.primaryJustPressed) {
            this.session?.end().catch(() => {});
            setTimeout(() => { location.href = '/'; }, 150);
        }
    }

    bindPointer() {
        const el = this.renderer.domElement;
        let down = null;
        el.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY }; });
        el.addEventListener('pointerup', e => {
            if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6 || this.session) { down = null; return; }
            down = null;
            const p = new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
            this.raycaster.setFromCamera(p, this.camera);
            this.choose(this.model.pick(this.raycaster));
        });
    }

    pulse(hand, amp, ms) { pulseQuestController(this.session, hand, amp, ms); }

    speak(text) {
        try {
            if (!text || !('speechSynthesis' in window)) return;
            speechSynthesis.cancel();
            const u = new SpeechSynthesisUtterance(text);
            u.rate = 1.03;
            speechSynthesis.speak(u);
        } catch { /* speech unavailable */ }
    }

    /* ── frame ────────────────────────────────────────────────────── */

    onResize() {
        if (this.renderer.xr.isPresenting) return;
        this.camera.aspect = innerWidth / innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(innerWidth, innerHeight);
    }

    loop(frame) {
        const dt = Math.min(0.05, this.clock.getDelta());
        const xr = this.renderer.xr.isPresenting;
        const cam = xr ? this.renderer.xr.getCamera() : this.camera;

        if (xr && frame) {
            this.handleButtons(dt);
            if (this.state === 'placing') {
                const ref = this.renderer.xr.getReferenceSpace();
                const hits = this.hitSource ? frame.getHitTestResults(this.hitSource) : [];
                const pose = hits.length ? hits[0].getPose(ref) : null;
                if (pose) {
                    this.reticle.matrix.fromArray(pose.transform.matrix);
                    this.reticle.visible = true;
                } else if (this.clock.elapsedTime - this.placingSince > 1.5) {
                    // No surface found (or no hit-test): offer a spot at table height in front of you.
                    const head = cam.getWorldPosition(new THREE.Vector3());
                    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.getWorldQuaternion(new THREE.Quaternion())).setY(0).normalize();
                    const spot = head.clone().addScaledVector(fwd, 0.85).setY(Math.max(0.65, head.y - 0.55));
                    this.reticle.matrix.makeTranslation(spot.x, spot.y, spot.z);
                    this.reticle.visible = true;
                }
            }
            this.updateGrabs();
            for (const c of this.controllers) {
                if (!c.visible) continue;
                this.raycaster.setFromXRController(c);
                const hit = this.state === 'placed' ? this.model.pick(this.raycaster) : null;
                const d = hit ? hit.point.distanceTo(this.raycaster.ray.origin) : 1.5;
                c.userData.ray.scale.z = d;
                c.userData.dot.position.z = -d;
            }
            // Guide floats above the system (or the reticle) facing you, then fades.
            const anchor = this.state === 'placed' ? this.model.group.position : new THREE.Vector3().setFromMatrixPosition(this.reticle.matrix);
            this.guide.position.copy(anchor).add(new THREE.Vector3(0, this.state === 'placed' ? 0.34 * this.model.group.scale.x : 0.3, 0));
            this.guide.lookAt(cam.getWorldPosition(this._v));
            if (this.state === 'placed' && this.guideTimer !== undefined) {
                this.guideTimer -= dt;
                if (this.guideTimer <= 0) this.guide.visible = false;
            }
        } else {
            this.controls.update();
        }

        this.model.update(dt, cam);
        if (this.card.visible && this.cardTarget) {
            const wp = this.cardTarget.getWorldPosition(new THREE.Vector3());
            const cardScale = Math.max(0.6, Math.min(1.6, this.model.group.scale.x));
            const bodyR = (this.cardTarget.geometry.parameters.radius || 0.02) * this.model.group.scale.x;
            // Sit clearly above the planet: its radius + half the card + a small gap.
            this.card.position.copy(wp).add(new THREE.Vector3(0, bodyR + 0.075 * cardScale + 0.02, 0));
            this.card.scale.setScalar(cardScale);
            this.card.lookAt(cam.getWorldPosition(this._v));
        }
        this.renderer.render(this.scene, this.camera);
    }
}

new MixedRealityApp().init();
