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

// 追加: 先頭力（推力）の説明と簡易計算関数
// 説明:
// - F = m * a
//   質量 m [kg] に加速度 a [m/s^2] を与えたときの力 [N]（ニュートンの運動方程式）
// - ロケット推力: F = ṁ * v_e
//   質量流量 ṁ [kg/s] と排気速度 v_e [m/s] の積で表される理想的な推力 [N]
// 使い方の例:
//   computeForce({ type: 'inertia', mass: 2.0, acceleration: 3.0 }) -> 6.0 (N)
//   computeForce({ type: 'thrust', massFlow: 0.5, exhaustVelocity: 300 }) -> 150.0 (N)

export function getForceExplanation(type = 'all') {
	// type: 'all' | 'inertia' | 'thrust'
	if (type === 'inertia') {
		return '慣性力: F = m * a（質量 m[kg] と加速度 a[m/s^2] による力[N]）';
	}
	if (type === 'thrust') {
		return '推力（ロケット等）: F = ṁ * v_e（質量流量 ṁ[kg/s] と排気速度 v_e[m/s] の積）';
	}
	return 'F = m * a（慣性力） および F = ṁ * v_e（ロケット推力）の2種類が代表的です。';
}

export function computeForce(params = {}) {
	// params.type: 'inertia'|'thrust'
	// inertia: requires mass, acceleration
	// thrust: requires massFlow, exhaustVelocity
	const { type = 'inertia' } = params;
	if (type === 'inertia') {
		const { mass, acceleration } = params;
		if (typeof mass !== 'number' || typeof acceleration !== 'number') {
			throw new Error('computeForce(inertia) requires numeric mass and acceleration');
		}
		return mass * acceleration; // [N]
	}
	if (type === 'thrust') {
		const { massFlow, exhaustVelocity } = params;
		if (typeof massFlow !== 'number' || typeof exhaustVelocity !== 'number') {
			throw new Error('computeForce(thrust) requires numeric massFlow and exhaustVelocity');
		}
		return massFlow * exhaustVelocity; // [N]
	}
	throw new Error('Unknown computeForce type');
}

// 追加: 性別に応じた体格計算と戦闘力の算出
function _randIntInclusive(min, max) {
	// min,max は整数
	return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * computePhysique
 * - gender: 'male' | 'female'（大文字小文字可）
 * - height: 身長 [cm]（数値）
 * 仕様:
 *  - 男性: baseHeight = 170.8 -> physique = 200000
 *  - 女性: baseHeight = 158   -> physique = 200000
 *  - 1cm ごとに 5000 単位で増減（基準より高ければ増加）
 */
export function computePhysique({ gender = 'male', height }) {
	if (typeof height !== 'number' || Number.isNaN(height)) {
		throw new Error('computePhysique requires numeric height (cm)');
	}
	const g = String(gender).toLowerCase();
	let base;
	if (g === 'male' || g === 'm') base = 170.8;
	else if (g === 'female' || g === 'f') base = 158;
	else throw new Error('computePhysique: gender must be "male" or "female"');

	const deltaCm = height - base; // cm (can be fractional)
	const physique = 200000 + (deltaCm * 5000);
	return physique;
}

/**
 * computeCombatPower
 * params:
 *  - shoulderWidth: 数値
 *  - expression: 数値
 *  - poseBonus: 数値
 *  - gender: 'male'|'female'
 *  - height: 身長 [cm]
 *  - randomValue: optional 数値 (1..10000)。未指定ならランダム生成
 *
 * 戦闘力 = shoulderWidth + expression + poseBonus + physique + random(1..10000)
 * 上限は無し
 */
export function computeCombatPower(params = {}) {
	const {
		shoulderWidth = 0,
		expression = 0,
		poseBonus = 0,
		gender = 'male',
		height,
		randomValue
	} = params;

	// basic validation
	['shoulderWidth', 'expression', 'poseBonus'].forEach((k) => {
		const v = params[k];
		if (v !== undefined && typeof v !== 'number') {
			throw new Error(`computeCombatPower: ${k} must be numeric`);
		}
	});

	const physique = computePhysique({ gender, height });
	const rand = (typeof randomValue === 'number')
		? Math.max(1, Math.min(10000, Math.floor(randomValue)))
		: _randIntInclusive(1, 10000);

	const total = (Number(shoulderWidth) || 0)
		+ (Number(expression) || 0)
		+ (Number(poseBonus) || 0)
		+ physique
		+ rand;

	return total;
}

/**
 * getCombatBreakdown
 * 同上の入力で各内訳と合計をオブジェクトで返す（デバッグ用）
 */
export function getCombatBreakdown(params = {}) {
	const {
		shoulderWidth = 0,
		expression = 0,
		poseBonus = 0,
		gender = 'male',
		height,
		randomValue
	} = params;
	const physique = computePhysique({ gender, height });
	const rand = (typeof randomValue === 'number')
		? Math.max(1, Math.min(10000, Math.floor(randomValue)))
		: _randIntInclusive(1, 10000);

	const total = (Number(shoulderWidth) || 0) + (Number(expression) || 0) + (Number(poseBonus) || 0) + physique + rand;
	return {
		shoulderWidth: Number(shoulderWidth) || 0,
		expression: Number(expression) || 0,
		poseBonus: Number(poseBonus) || 0,
		physique,
		random: rand,
		total
	};
}
