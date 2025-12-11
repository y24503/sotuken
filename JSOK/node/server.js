// Demo POWER SCAN Node server
// - WebSocket: landmarks -> compute stats & append to CSV (power_scan_log.csv)
// - REST API: ranking CSV (save/get/delete) + music list, and image save/delete

const { WebSocketServer } = require('ws');
const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const cors = require('cors');

const PORT = Number(process.env.PORT || 8080); // reuse same port for WS + REST
const POWER_LOG_CSV = path.join(__dirname, 'power_scan_log.csv');
const RANKING_CSV = path.join(__dirname, 'ranking.csv');
const DEMO_ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(DEMO_ROOT, 'src');
const MUSIC_DIR = path.join(DEMO_ROOT, 'music');

// --- helpers: ensure files/dirs
function ensureFile(filePath, headerLine) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, headerLine, 'utf8');
  }
}
function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

ensureFile(POWER_LOG_CSV, 'timestamp,base_power,pose_bonus,expression_bonus,speed_bonus,total_power,landmark_count\n');
ensureFile(RANKING_CSV, 'id,name,score,image,created_at\n');
ensureDir(SRC_DIR);

// --- CSV utils (very small, RFC4180-ish for our fields)
function csvEscape(val) {
  if (val === null || val === undefined) return '';
  const s = String(val);
  if (/[",\n]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}
function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { cur += ch; }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === ',') { out.push(cur); cur = ''; }
      else { cur += ch; }
    }
  }
  out.push(cur);
  return out;
}

function readRankingCsv() {
  const text = fs.readFileSync(RANKING_CSV, 'utf8');
  const lines = text.split(/\r?\n/).filter(Boolean);
  const rows = [];
  for (let i = 1; i < lines.length; i++) { // skip header
    const cols = parseCsvLine(lines[i]);
    if (cols.length >= 5) {
      rows.push({
        id: Number(cols[0]),
        name: cols[1],
        score: Number(cols[2]),
        image: cols[3] || null,
        created_at: cols[4],
      });
    }
  }
  return rows;
}

function writeRankingCsv(rows) {
  const header = 'id,name,score,image,created_at\n';
  const body = rows
    .map(r => [r.id, r.name, r.score, r.image || '', r.created_at]
      .map(csvEscape).join(','))
    .join('\n');
  const tmp = RANKING_CSV + '.tmp';
  fs.writeFileSync(tmp, header + body + (body ? '\n' : ''), 'utf8');
  fs.renameSync(tmp, RANKING_CSV);
}

function nowIso() { return new Date().toISOString(); }

function safeBaseName(name) {
  let raw = (name || 'player').toString().trim();
  raw = raw.replace(/[\0\\\/]/g, ''); // remove null and slashes
  raw = raw.replace(/[\x00-\x1F\x7F]/g, ''); // control chars
  // replace punctuation/symbols with underscore
  raw = raw.replace(/[\p{P}\p{S}]+/gu, '_');
  raw = raw.replace(/^[_\-\s]+|[_\-\s]+$/g, '');
  if (!raw) raw = 'player';
  // truncate to ~200 bytes (approx chars)
  if (Buffer.byteLength(raw, 'utf8') > 200) {
    while (Buffer.byteLength(raw, 'utf8') > 200) {
      raw = raw.slice(0, -1);
    }
  }
  return raw;
}

function saveImageFromDataUrl(dataUrl, baseName) {
  if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) return null;
  const idx = dataUrl.indexOf(',');
  if (idx < 0) return null;
  const b64 = dataUrl.slice(idx + 1);
  let buf;
  try { buf = Buffer.from(b64, 'base64'); } catch { return null; }
  ensureDir(SRC_DIR);
  const base = safeBaseName(baseName);
  let candidate = `${base}.png`;
  let i = 0;
  while (fs.existsSync(path.join(SRC_DIR, candidate)) && i < 1000) {
    i++;
    candidate = `${base}_${i}.png`;
  }
  const filePath = path.join(SRC_DIR, candidate);
  fs.writeFileSync(filePath, buf);
  return candidate; // return file name only
}

function deleteImageIfExists(fileName) {
  if (!fileName) return;
  const p = path.join(SRC_DIR, fileName);
  try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch {}
}

// --- WS: power scan logging
function dist2D(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function calcStats(landmarks) {
  if (!Array.isArray(landmarks) || landmarks.length < 29) {
    return { base_power:0, pose_bonus:0, expression_bonus:0, speed_bonus:0, total_power:0 };
  }
  const shoulder_width = dist2D(landmarks[11], landmarks[12]);
  const left_reach = dist2D(landmarks[11], landmarks[15]);
  const right_reach = dist2D(landmarks[12], landmarks[16]);
  const reach_score = left_reach + right_reach;
  const left_leg = dist2D(landmarks[23], landmarks[27]);
  const right_leg = dist2D(landmarks[24], landmarks[28]);
  const leg_score = left_leg + right_leg;
  const base_power = (shoulder_width + reach_score + leg_score) * 100000;
  const pose_bonus = 0, expression_bonus = 0, speed_bonus = 0;
  const total_power = base_power + pose_bonus + expression_bonus + speed_bonus;
  return { base_power, pose_bonus, expression_bonus, speed_bonus, total_power };
}
function appendPowerCsv(stats, landmarkCount) {
  const ts = nowIso();
  const row = `${ts},${Math.round(stats.base_power)},${Math.round(stats.pose_bonus)},${Math.round(stats.expression_bonus)},${Math.round(stats.speed_bonus)},${Math.round(stats.total_power)},${landmarkCount}\n`;
  fs.appendFile(POWER_LOG_CSV, row, (err) => { if (err) console.error('CSV append error:', err.message); });
}

// --- HTTP + WS server (same port)
const app = express();
app.use(cors());
app.use(express.json({ limit: '20mb' }));
// --- Static files (serve project root) ---
app.use(express.static(DEMO_ROOT, { extensions: ['html'] }));

// Root -> index.html (if not served automatically)
app.get('/', (req, res, next) => {
  // If static already handled, skip
  if (req.path !== '/' ) return next();
  res.sendFile(path.join(DEMO_ROOT, 'index.html'));
});

// health
app.get('/api/health', (_req, res) => res.json({ ok: true }));

// GET ranking
app.get('/api/get_ranking', (_req, res) => {
  const rows = readRankingCsv().sort((a,b) => b.score - a.score).slice(0, 100);
  res.json(rows);
});

// POST save_score { name, score, image? (dataURL) }
app.post('/api/save_score', (req, res) => {
  const { name, score, image } = req.body || {};
  if (!name || typeof score !== 'number') {
    return res.status(400).json({ success: false, message: '名前またはスコアがありません。' });
  }
  const rows = readRankingCsv();
  const id = rows.reduce((m, r) => Math.max(m, r.id || 0), 0) + 1;
  const imageFilename = image ? saveImageFromDataUrl(image, name) : null;
  const created_at = nowIso();
  rows.push({ id, name, score: Math.trunc(score), image: imageFilename, created_at });
  writeRankingCsv(rows);
  res.json({ success: true, message: 'スコアを保存しました！', image: imageFilename });
});

// POST delete_score { id }
app.post('/api/delete_score', (req, res) => {
  const { id } = req.body || {};
  const nid = Number(id);
  if (!Number.isInteger(nid)) {
    return res.status(400).json({ success: false, message: 'id が指定されていません' });
  }
  const rows = readRankingCsv();
  const target = rows.find(r => r.id === nid);
  const next = rows.filter(r => r.id !== nid);
  writeRankingCsv(next);
  if (target && target.image) deleteImageIfExists(target.image);
  res.json({ success: true, message: '削除しました' });
});

// GET music list -> { files: [..] }
app.get('/api/music-list', (_req, res) => {
  try {
    const files = fs.readdirSync(MUSIC_DIR)
      .filter(f => fs.statSync(path.join(MUSIC_DIR, f)).isFile())
      .filter(f => /\.(mp3|ogg|wav)$/i.test(f));
    res.json({ files });
  } catch (e) {
    res.json({ files: [] });
  }
});

// --- PHP compatibility endpoints ---

// --- HTTP server (HTTPS 廃止) ---
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  ws.on('message', (data, isBinary) => {
    if (isBinary) return;
    let payload;
    try {
      const msg = JSON.parse(data.toString('utf8'));
      if (msg.type === 'landmarks') {
        const stats = calcStats(msg.landmarks);
        appendPowerCsv(stats, Array.isArray(msg.landmarks) ? msg.landmarks.length : 0);
        payload = {
          combat_stats: Object.fromEntries(Object.entries(stats).map(([k,v]) => [k, Math.round(v)])),
          received: Array.isArray(msg.landmarks) ? msg.landmarks.length : 0,
        };
      } else {
        payload = { combat_stats: { base_power:0, pose_bonus:0, expression_bonus:0, speed_bonus:0, total_power:0 }, received:0 };
      }
    } catch (e) {
      payload = { combat_stats: { base_power:0, pose_bonus:0, expression_bonus:0, speed_bonus:0, total_power:0 }, received:0, error:'parse_failed' };
    }
    ws.send(JSON.stringify(payload));
  });
  ws.on('error', (err) => console.error('WS error:', err.message));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Demo Node server running at http://0.0.0.0:${PORT} (bind all interfaces)`);
  console.log(`WS endpoint ws://<your-ip>:${PORT}`);
  console.log(`Power log: ${POWER_LOG_CSV}`);
  console.log(`Ranking CSV: ${RANKING_CSV}`);
});
