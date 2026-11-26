// Assemble static assets (public/, favicon, and patched three.js) into dist/
// so Vercel serves large textures and ES modules directly from its CDN instead
// of routing them through the 4.5 MB-limited serverless function.
const fs = require('fs');
const path = require('path');
const { buildPatchedThreeModule } = require('../lib/webxr-three');

const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const threeBuildDir = path.join(rootDir, 'node_modules', 'three', 'build');
const threeAddonsDir = path.join(rootDir, 'node_modules', 'three', 'examples', 'jsm');

if (!fs.existsSync(threeBuildDir) || !fs.existsSync(threeAddonsDir)) {
    throw new Error('three.js not found in node_modules. Run `npm install` before building.');
}

fs.rmSync(distDir, { recursive: true, force: true });
fs.mkdirSync(distDir, { recursive: true });

fs.cpSync(path.join(rootDir, 'public'), path.join(distDir, 'public'), { recursive: true });
fs.copyFileSync(path.join(rootDir, 'public', 'favicon.svg'), path.join(distDir, 'favicon.ico'));

const distThreeDir = path.join(distDir, 'lib', 'three');
fs.cpSync(threeBuildDir, distThreeDir, { recursive: true });
fs.cpSync(threeAddonsDir, path.join(distThreeDir, 'addons'), { recursive: true });
fs.writeFileSync(path.join(distThreeDir, 'webxr.module.js'), buildPatchedThreeModule(rootDir), 'utf8');

console.log('Built Vercel static output in dist/ (public/, favicon.ico, lib/three/)');
