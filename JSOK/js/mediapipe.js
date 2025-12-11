// Lightweight MediaPipe Pose loader and factory
// Exported as ES module for use from measurement.js

function loadScript(url) {
    return new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = url;
        s.onload = () => resolve();
        s.onerror = () => reject(new Error('Failed to load ' + url));
        document.head.appendChild(s);
    });
}

function withTimeout(promise, ms) {
    return Promise.race([promise, new Promise((_, r) => setTimeout(() => r(new Error('timeout')), ms))]);
}

export async function ensurePoseLoaded(statusEl) {
    if (window.Pose || (window.pose && window.pose.Pose)) return true;
    // NOTE: Installed local version differs slightly (0.5.1675469404). Try local first.
    const urls = [
        // Local vendored assets (preferred if available)
        '/mediapipe/pose/pose.js',
        'mediapipe/pose/pose.js',
        // From installed npm package served statically by our dev server
        '/node/node_modules/@mediapipe/pose/pose.js',
        'node/node_modules/@mediapipe/pose/pose.js',
        // Fallbacks
        'pose.js',
        'https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5.1675469404/pose.js',
        'https://unpkg.com/@mediapipe/pose@0.5.1675469404/pose.js'
    ];
    for (const u of urls) {
        try {
            if (statusEl) statusEl.textContent = 'LOADING POSE...';
            await withTimeout(loadScript(u), 8000);
        } catch (_) { continue; }
        if (window.Pose || (window.pose && window.pose.Pose)) {
            // Derive base path for assets from loaded script URL
            try {
                const url = new URL(u, window.location.href);
                const base = url.href.slice(0, url.href.lastIndexOf('/') + 1);
                window._mpPoseBase = base; // used by createPose() caller
            } catch {}
            return true;
        }
    }
    if (statusEl) statusEl.textContent = 'POSE NOT FOUND';
    return false;
}

export async function createPose({ base, options = {}, onResults } = {}) {
    const PoseClass = window.Pose || (window.pose && window.pose.Pose);
    if (!PoseClass) throw new Error('MediaPipe Pose not loaded');
    const locateBase = (base !== undefined) ? base : (window._mpPoseBase || 'https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5.1675469404/');
    const instance = new PoseClass({ locateFile: (file) => `${locateBase}${file}` });
    const defaultOptions = {
        selfieMode: true,
        modelComplexity: 1,
        smoothLandmarks: true,
        enableSegmentation: false,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5
    };
    if (onResults) instance.onResults(onResults);
    // Ensure graph is loaded before setting options to avoid warnings
    try { await instance.initialize(); } catch {}
    instance.setOptions({ ...defaultOptions, ...options });
    return instance;
}

export default { ensurePoseLoaded, createPose };
