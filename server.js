// Orbitor — standalone server for the SpaceVerse VR Deep Space Ride and the
// seven Meta Quest 3 VR arcade games (plus the VR Solar System they share a
// renderer with). No database, no accounts: everything runs from static files.
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const path = require('path');
const fs = require('fs');
const { buildPatchedThreeModule } = require('./lib/webxr-three');
require('dotenv').config({ quiet: true });

const app = express();
const PORT = Number(process.env.PORT) || 5000;
const BEHIND_PROXY = process.env.NODE_ENV === 'production' || process.env.TRUST_PROXY === 'true' || Boolean(process.env.VERCEL);
if (BEHIND_PROXY) app.set('trust proxy', 1);

app.use(compression());
app.use(helmet({
    contentSecurityPolicy: {
        useDefaults: true,
        directives: {
            'default-src': ["'self'"],
            // The VR page sets its mode up in a small inline script.
            'script-src': ["'self'", "'unsafe-inline'"],
            'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
            'font-src': ["'self'", 'https://fonts.gstatic.com', 'data:'],
            'img-src': ["'self'", 'data:', 'blob:'],
            'media-src': ["'self'", 'data:', 'blob:'],
            'connect-src': ["'self'", 'blob:'],
            'worker-src': ["'self'", 'blob:'],
            'object-src': ["'none'"],
            'base-uri': ["'self'"],
            'upgrade-insecure-requests': null
        }
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' }
}));
// WebXR, motion sensors and the screen wake lock are allowed for this origin.
app.use((req, res, next) => {
    res.set('Permissions-Policy', 'xr-spatial-tracking=(self), gyroscope=(self), accelerometer=(self), magnetometer=(self), screen-wake-lock=(self)');
    next();
});
app.use(express.json({ limit: '64kb' }));

const view = name => (req, res) => res.sendFile(path.join(__dirname, 'views', name));

/* ── pages ─────────────────────────────────────────────────────────── */
// Hub with every experience. `/games` and `/app` are the links the VR page and
// guide use to go "back", so they land here too.
app.get(['/', '/games', '/app'], view('index.html'));
// One WebXR page hosts every mode; the path picks which one it offers.
app.get(['/vr-ride', '/vr-solar-system', '/vr-working'], view('vr-working.html'));
const QUEST_GAMES = ['orbital-intercept', 'asteroid-dodge', 'lunar-landing', 'orbital-docking',
    'satellite-repair', 'mars-rover', 'space-rescue'];
app.get(QUEST_GAMES.map(slug => '/games/' + slug), view('vr-working.html'));
app.get('/games/:slug', (req, res) => res.redirect('/games'));
app.get('/quest-guide', view('quest-guide.html'));
app.get('/favicon.ico', (req, res) => {
    const iconPath = path.join(__dirname, 'public', 'favicon.svg');
    if (fs.existsSync(iconPath)) return res.type('image/svg+xml').sendFile(iconPath);
    return res.redirect(302, '/public/favicon.svg');
});

/* ── static assets ─────────────────────────────────────────────────── */
const STATIC_CACHE = { maxAge: '7d', etag: true, lastModified: true };
app.use('/public', express.static(path.join(__dirname, 'public'), STATIC_CACHE));
app.use('/lib/three/addons', express.static(path.join(__dirname, 'node_modules', 'three', 'examples', 'jsm'), STATIC_CACHE));
// three r182 picks XR projection layers from API presence alone. Prefer the
// standard XRWebGLLayer when the browser has it so the Quest compositor gets
// the regular eye framebuffer (same patch the original app applies).
let xrThreeModule;
app.get('/lib/three/webxr.module.js', (req, res) => {
    if (!xrThreeModule) xrThreeModule = buildPatchedThreeModule(__dirname);
    res.type('application/javascript').set('Cache-Control', 'public, max-age=604800').send(xrThreeModule);
});
app.use('/lib/three', express.static(path.join(__dirname, 'node_modules', 'three', 'build'), STATIC_CACHE));

/* ── small API the VR page calls ───────────────────────────────────── */
// There are no accounts here; every visitor is a guest pilot. These keep the
// shared page chrome (liquid-glass.js) and the browser check scripts happy.
const GUEST = { loggedIn: true, username: 'Pilot', demo: true, ephemeral: true, user: { id: 'guest', username: 'Pilot' } };
app.get('/api/user', (req, res) => res.json(GUEST));
app.post('/api/login', (req, res) => res.json({ success: true, demo: true, username: GUEST.username }));
app.post('/api/logout', (req, res) => res.json({ success: true }));
app.get('/api/health', (req, res) => res.json({ status: 'ok', uptime: Math.round(process.uptime()) }));
app.use('/api/game', require('./routes/game'));

/* ── boot ──────────────────────────────────────────────────────────── */
module.exports = app;

function lanAddresses() {
    return Object.values(require('os').networkInterfaces()).flat()
        .filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
}

// A self-signed cert so a Quest or phone on the same Wi-Fi gets a secure origin
// (WebXR and motion sensors are only offered over HTTPS off localhost).
function devCertificate() {
    const crypto = require('crypto');
    const certDir = path.join(__dirname, 'certs');
    const lanIps = lanAddresses();
    const covers = certPath => {
        if (!fs.existsSync(certPath)) return false;
        try {
            const names = (new crypto.X509Certificate(fs.readFileSync(certPath)).subjectAltName || '').split(', ');
            return ['127.0.0.1', ...lanIps].every(ip => names.includes(`IP Address:${ip}`));
        } catch (e) { return false; }
    };
    const networkId = crypto.createHash('sha256').update(lanIps.sort().join(',')).digest('hex').slice(0, 12);
    const keyPath = path.join(certDir, `dev-${networkId}-key.pem`);
    const certPath = path.join(certDir, `dev-${networkId}-cert.pem`);
    if (!fs.existsSync(keyPath) || !covers(certPath)) {
        const selfsigned = require('selfsigned');
        const pems = selfsigned.generate([{ name: 'commonName', value: 'orbitor.local' }], {
            days: 3650, keySize: 2048, algorithm: 'sha256',
            extensions: [{
                name: 'subjectAltName',
                altNames: [{ type: 2, value: 'localhost' }, { type: 7, ip: '127.0.0.1' },
                    ...lanIps.map(ip => ({ type: 7, ip }))]
            }]
        });
        fs.mkdirSync(certDir, { recursive: true });
        fs.writeFileSync(keyPath, pems.private);
        fs.writeFileSync(certPath, pems.cert);
        console.log('🔐 Generated a self-signed dev certificate in certs/');
    }
    return { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) };
}

if (require.main === module) {
    const useHttps = String(process.env.HTTPS || '').toLowerCase() === 'true' || process.argv.includes('--https');
    const server = useHttps
        ? require('https').createServer(devCertificate(), app)
        : require('http').createServer(app);
    server.listen(PORT, () => {
        const proto = useHttps ? 'https' : 'http';
        console.log(`🚀 Orbitor is running on ${proto}://localhost:${PORT}`);
        const lan = lanAddresses();
        if (lan.length) {
            console.log(`📱 Quest / phone on the same Wi-Fi: ${lan.map(ip => `${proto}://${ip}:${PORT}`).join('  ')}`);
            if (!useHttps) console.log('   Headset VR and phone gyro need HTTPS — run  npm run start:https');
        }
    });
    server.on('error', err => {
        console.error(err.code === 'EADDRINUSE' ? `Port ${PORT} is in use. Set PORT to another value.` : err);
        process.exit(1);
    });
    const stop = () => server.close(() => process.exit(0));
    process.on('SIGTERM', stop);
    process.on('SIGINT', stop);
}
