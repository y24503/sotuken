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
    const cdn = 'https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5.1675469404/pose.js';
    try {
        if (statusEl) statusEl.textContent = 'LOADING POSE...';
        await withTimeout(loadScript(cdn), 8000);
    } catch (_) {
        if (statusEl) statusEl.textContent = 'POSE NOT FOUND';
        return false;
    }
    if (window.Pose || (window.pose && window.pose.Pose)) {
        // 固定で CDN ベースを使う
        window._mpPoseBase = 'https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5.1675469404/';
        if (statusEl) statusEl.textContent = 'CAMERA READY';
        return true;
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
