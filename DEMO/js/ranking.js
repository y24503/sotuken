// ランキング取得・表示・削除の最小モジュール

const rankingListEl = document.getElementById('ranking-list');

async function fetchAndShowRanking() {
	if (!rankingListEl) return;
	// Tailwind風の表示文言に合わせる
	rankingListEl.innerHTML = '<div class="text-center text-gray-400">ろーでぃんぐ...</div>';
	try {
		// 既存の API を優先。念のため軽いフォールバックを試す（互換性維持）
		let res = await fetch('/api/get_ranking');
		if (!res.ok) {
			try { res = await fetch('api.php?action=get_ranking'); } catch (e) {}
		}
		const data = await res.json();
		const rankingData = Array.isArray(data) ? data : [];
		renderRanking(rankingData);
	} catch (e) {
		rankingListEl.innerHTML = '<div class="text-center text-red-400">らんきんぐ しっぱい</div>';
	}
}

function renderRanking(rows) {
	if (!rankingListEl) return;
	if (!rows || rows.length === 0) {
		rankingListEl.innerHTML = '<div class="text-center text-gray-400">まだ ないよ</div>';
		return;
	}
	const html = rows.map((row, idx) => {
		const rank = idx + 1;
		// 画像が data URL かファイル名かに対応（なければプレースホルダ）
		let imgHtml = `<div style="width:64px;height:48px;background:#071116;border-radius:6px;"></div>`;
		if (row.image) {
			const imgSrc = String(row.image).startsWith('data:') ? row.image : `src/${encodeURIComponent(row.image)}`;
			imgHtml = `<img class="w-16 h-12 object-cover rounded-md cursor-zoom-in" src="${imgSrc}" alt="thumb">`;
		}
		const name = escapeHtml(row.name || 'PLAYER');
		const score = (typeof row.score === 'number') ? row.score.toLocaleString() : (row.score ? escapeHtml(row.score) : '0');
		return `<div class="flex items-center gap-4 p-2 bg-gray-800 rounded-lg" data-id="${row.id}">
					<span class="text-2xl font-bold text-cyan-400 w-8 text-center">${rank}</span>
					${imgHtml}
					<span class="font-orbitron text-lg flex-1">${name}</span>
					<span class="font-mono text-xl text-yellow-300">${score}</span>
					<button type="button" class="btn btn-danger ml-4" data-id="${row.id}" onclick="deleteRankingEntry(${row.id})">けす</button>
				</div>`;
	}).join('');
	rankingListEl.innerHTML = html;
}

// 簡易 HTML エスケープ（名前表示に使用）
function escapeHtml(s) {
	return String(s).replace(/[&<>"']/g, (m) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

async function deleteRankingEntry(id) {
	if (!confirm('このデータ を 消す？ 名前 と 画像 が 消えるよ。')) return;
	try {
		const res = await fetch('/api/delete_score', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ id })
		});
		const json = await res.json();
		if (json && json.success) {
			await fetchAndShowRanking();
		} else {
			alert('削除 に 失敗しました');
		}
	} catch (e) {
		alert('削除 エラー');
	}
}

// インライン onclick 用に公開
try { window.deleteRankingEntry = deleteRankingEntry; } catch(e) {}

// DOM 準備ができたら読み込み
window.addEventListener('DOMContentLoaded', () => {
	fetchAndShowRanking();

	// 画像クリックで拡大表示（イベント委譲）
	if (rankingListEl) {
		rankingListEl.addEventListener('click', (ev) => {
			const img = ev.target && ev.target.tagName === 'IMG' ? ev.target : null;
			if (!img) return;
			const modal = document.getElementById('img-modal');
			const modalImg = document.getElementById('img-modal-img');
			if (!modal || !modalImg) return;
			modalImg.src = img.src;
			modal.classList.remove('hidden');
			modal.classList.add('flex');
		});
	}

	// モーダル閉じる（背景クリック・ボタン・Esc）
	const modal = document.getElementById('img-modal');
	const modalImg = document.getElementById('img-modal-img');
	const modalClose = document.getElementById('img-modal-close');
	function closeModal(){
		if (!modal) return;
		modal.classList.add('hidden');
		modal.classList.remove('flex');
		if (modalImg) modalImg.src = '';
	}
	if (modal) {
		modal.addEventListener('click', (e) => {
			// 画像以外の領域クリックで閉じる
			if (e.target === modal) closeModal();
		});
	}
	if (modalClose) modalClose.addEventListener('click', closeModal);
	document.addEventListener('keydown', (e) => {
		if (e.key === 'Escape') closeModal();
	});
});
