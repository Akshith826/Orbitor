const fs = require('fs');
const path = require('path');

const THREE_LAYERS_DETECTION = "const supportsLayers = supportsGlBinding && 'createProjectionLayer' in XRWebGLBinding.prototype;";
const THREE_LAYERS_PATCH = "const supportsLayers = typeof XRWebGLLayer !== 'function' && supportsGlBinding && 'createProjectionLayer' in XRWebGLBinding.prototype;";

/**
 * Patch three.module.js so WebXR prefers XRWebGLLayer when available.
 * @param {string} rootDir - Project root containing node_modules/three.
 * @returns {string} Patched ES module source.
 */
function buildPatchedThreeModule(rootDir) {
    const sourcePath = path.join(rootDir, 'node_modules', 'three', 'build', 'three.module.js');
    const source = fs.readFileSync(sourcePath, 'utf8');
    if (!source.includes(THREE_LAYERS_DETECTION)) {
        throw new Error(`Expected WebXR layer detection string not found in ${sourcePath}`);
    }
    return source.replace(THREE_LAYERS_DETECTION, THREE_LAYERS_PATCH);
}

module.exports = { buildPatchedThreeModule };
