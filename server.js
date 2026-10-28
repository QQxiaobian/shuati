'use strict';
/* ================= 刷题宝后端（Node.js + SQLite，零第三方依赖） ================= */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

process.env.TZ = process.env.TZ || 'Asia/Shanghai';

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 3000);
const DB_PATH = process.env.DB_PATH || path.join(ROOT, 'data', 'shutibao.db');
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;

const DEFAULT_SETTINGS = {
  openRegister: true, quotaMB: 1024, maxFileMB: 35, maxSheets: 30,
  maxRows: 10000, maxPerImport: 20000, shareEnabled: true, wrongThreshold: 2,
};

/* ---------------- 基础工具 ---------------- */
const ms = () => Date.now();
const genId = () => Date.now().toString(16) + crypto.randomBytes(5).toString('hex');

function hashPwd(s) {
  const salt = 'shutibao::';
  let h1 = 0xdeadbeef ^ 0x9e3779b9, h2 = 0x41c6ce57 ^ 0x9e3779b9;
  const str = salt + s;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16) + (h1 >>> 0).toString(16);
}

/* ---------------- 数据库 ---------------- */
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;');
db.exec(`
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT NOT NULL, role TEXT, status TEXT, data TEXT);
CREATE TABLE IF NOT EXISTS banks (id TEXT PRIMARY KEY, owner_id TEXT, data TEXT);
CREATE TABLE IF NOT EXISTS questions (id TEXT PRIMARY KEY, bank_id TEXT, data TEXT);
CREATE TABLE IF NOT EXISTS answers (id TEXT PRIMARY KEY, user_id TEXT, question_id TEXT, data TEXT);
CREATE TABLE IF NOT EXISTS wrongbook (id TEXT PRIMARY KEY, user_id TEXT, question_id TEXT, data TEXT);
CREATE TABLE IF NOT EXISTS papers (id TEXT PRIMARY KEY, user_id TEXT, data TEXT);
CREATE TABLE IF NOT EXISTS exam_records (id TEXT PRIMARY KEY, user_id TEXT, paper_id TEXT, status TEXT, data TEXT);
CREATE TABLE IF NOT EXISTS shares (id TEXT PRIMARY KEY, bank_id TEXT, owner_id TEXT, target_user_id TEXT, link_token TEXT, status TEXT, data TEXT);
CREATE TABLE IF NOT EXISTS paper_shares (id TEXT PRIMARY KEY, paper_id TEXT, owner_id TEXT, target_user_id TEXT, link_token TEXT, status TEXT, data TEXT);
CREATE TABLE IF NOT EXISTS favorites (id TEXT PRIMARY KEY, user_id TEXT, question_id TEXT, data TEXT);
CREATE TABLE IF NOT EXISTS import_tasks (id TEXT PRIMARY KEY, user_id TEXT, data TEXT);
CREATE TABLE IF NOT EXISTS audit_logs (id TEXT PRIMARY KEY, ts INTEGER, data TEXT);
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, data TEXT);
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_lower ON users(lower(username));
CREATE INDEX IF NOT EXISTS idx_banks_owner ON banks(owner_id);
CREATE INDEX IF NOT EXISTS idx_questions_bank ON questions(bank_id);
CREATE INDEX IF NOT EXISTS idx_answers_user ON answers(user_id);
CREATE INDEX IF NOT EXISTS idx_wrongbook_user ON wrongbook(user_id);
CREATE INDEX IF NOT EXISTS idx_papers_user ON papers(user_id);
CREATE INDEX IF NOT EXISTS idx_exam_records_user ON exam_records(user_id);
CREATE INDEX IF NOT EXISTS idx_shares_bank ON shares(bank_id);
CREATE INDEX IF NOT EXISTS idx_paper_shares_paper ON paper_shares(paper_id);
CREATE INDEX IF NOT EXISTS idx_paper_shares_target ON paper_shares(target_user_id);
CREATE INDEX IF NOT EXISTS idx_favorites_user ON favorites(user_id);
CREATE INDEX IF NOT EXISTS idx_import_tasks_user ON import_tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
`);

const TABLES = new Set(['users', 'banks', 'questions', 'answers', 'wrongbook', 'papers', 'exam_records', 'shares', 'paper_shares', 'favorites', 'import_tasks', 'audit_logs']);

function getRow(t, id) {
  const r = db.prepare(`SELECT data FROM ${t} WHERE id=?`).get(id);
  return r ? JSON.parse(r.data) : null;
}
function allRows(t) {
  return db.prepare(`SELECT data FROM ${t}`).all().map(r => JSON.parse(r.data));
}
function putRow(t, id, cols, data) {
  const names = ['id', 'data', ...Object.keys(cols)];
  const vals = [id, JSON.stringify(data), ...Object.values(cols).map(v => v === undefined ? null : v)];
  const updates = ['data=excluded.data', ...Object.keys(cols).map(k => `${k}=excluded.${k}`)];
  db.prepare(`INSERT INTO ${t} (${names.join(',')}) VALUES (${names.map(() => '?').join(',')}) ON CONFLICT(id) DO UPDATE SET ${updates.join(',')}`).run(...vals);
}
function delRow(t, id) { db.prepare(`DELETE FROM ${t} WHERE id=?`).run(id); }
function metaGet(k, def = null) {
  const r = db.prepare('SELECT data FROM meta WHERE k=?').get(k);
  return r ? JSON.parse(r.data) : def;
}
function metaPut(k, v) {
  db.prepare('INSERT INTO meta (k,data) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET data=excluded.data').run(k, JSON.stringify(v));
}
function findWhere(t, where, params) {
  const r = db.prepare(`SELECT data FROM ${t} WHERE ${where}`).get(...params);
  return r ? JSON.parse(r.data) : null;
}

/* ---------------- 初始化与默认管理员 ---------------- */
function initData() {
  const cnt = db.prepare('SELECT COUNT(*) c FROM users').get().c;
  const insMeta = db.prepare('INSERT OR IGNORE INTO meta (k,data) VALUES (?,?)');
  insMeta.run('settings', JSON.stringify(DEFAULT_SETTINGS));
  insMeta.run('builtinCategories', JSON.stringify(['资格考试', '职业技能']));
  insMeta.run('builtinBanks', JSON.stringify([]));
  if (cnt === 0) {
    const now = ms();
    const admin = {
      id: genId(), username: ADMIN_USERNAME, nickname: '系统管理员',
      pwd: hashPwd(ADMIN_PASSWORD), role: 'admin', status: 'active',
      createdAt: now, mustChangePwd: false, failCount: 0, lockedUntil: 0,
    };
    putRow('users', admin.id, { username: admin.username, role: 'admin', status: 'active' }, admin);
    console.log(`[init] 已创建默认管理员：${ADMIN_USERNAME} / ${ADMIN_PASSWORD}`);
  }
}
initData();

/* ---------------- 可见性与数据组装 ---------------- */
function isAdm(u) { return !!u && u.role === 'admin'; }
function canReadBankArr(bank, uid, usersById, shares) {
  if ((bank.ownerId || '') === uid) return true;
  for (const s of shares) {
    if ((s.bankId || '') === bank.id && (s.status || '') === 'active' && (s.targetUserId || '') === uid) {
      const o = usersById[bank.ownerId || ''];
      return !!o && (o.status || 'active') === 'active';
    }
  }
  return false;
}

function buildDb(u) {
  const uid = u.id, adm = isAdm(u);
  const usersAll = allRows('users');
  const usersById = {};
  for (const x of usersAll) usersById[x.id] = x;
  const sharesAll = allRows('shares');

  const banks = allRows('banks').filter(b => adm || canReadBankArr(b, uid, usersById, sharesAll));
  const bids = banks.map(b => b.id);
  let questions = [];
  if (bids.length) {
    const ph = bids.map(() => '?').join(',');
    questions = db.prepare(`SELECT data FROM questions WHERE bank_id IN (${ph})`).all(...bids).map(r => JSON.parse(r.data));
  }

  const users = [];
  for (const x of usersAll) {
    if (x.id === uid) { users.push(x); continue; }
    if (adm) { const y = { ...x }; delete y.pwd; users.push(y); }
    else if ((x.status || 'active') === 'active') {
      users.push({
        id: x.id, username: x.username, nickname: x.nickname || '',
        role: x.role || 'user', status: x.status, createdAt: x.createdAt || 0,
      });
    }
  }

  const mine = t => db.prepare(`SELECT data FROM ${t} WHERE user_id=?`).all(uid).map(r => JSON.parse(r.data));
  const answers = mine('answers');
  const wrongBook = mine('wrongbook');
  const importTasks = mine('import_tasks');
  const favorites = mine('favorites');

  // 试卷：自己的 + 别人共享给我的（仅状态为 active）
  const myPapers = mine('papers');
  const paperSharesAll = allRows('paper_shares');
  const paperShares = paperSharesAll.filter(s => adm || (s.ownerId || '') === uid || (s.targetUserId || '') === uid);
  const papers = [...myPapers];
  for (const s of paperShares) {
    if ((s.targetUserId || '') !== uid || (s.status || '') !== 'active') continue;
    if (papers.some(p => p.id === s.paperId)) continue;
    const p = getRow('papers', s.paperId || '');
    if (p) papers.push(p);
  }
  const myPaperIds = new Set(myPapers.map(p => p.id));

  // 考试记录：自己的 + 自己试卷下所有人的（试卷所有者可查看每个人成绩）
  const allRecords = allRows('exam_records');
  const examRecords = allRecords.filter(r => (r.userId || '') === uid || myPaperIds.has(r.paperId || ''));
  for (const rr of examRecords) {
    if (!rr.answers || typeof rr.answers !== 'object' || Array.isArray(rr.answers)) rr.answers = {};
    // 随机重考的题目快照：考试进行中不下发答案与解析
    if (Array.isArray(rr.questions) && (rr.status || '') === 'ongoing') {
      for (const qq of rr.questions) { delete qq.answer; delete qq.analysis; }
    }
  }

  // 进行中的试卷不下发答案；共享试卷在本人交卷前也不下发答案
  const ongoingMine = new Set();
  const submittedMine = new Set();
  for (const r of examRecords) {
    if ((r.userId || '') !== uid) continue;
    if ((r.status || '') === 'ongoing') ongoingMine.add(r.paperId);
    else submittedMine.add(r.paperId);
  }
  for (const pp of papers) {
    if (!Array.isArray(pp.questions)) continue;
    const owned = (pp.userId || '') === uid;
    const hide = owned ? ongoingMine.has(pp.id) : !submittedMine.has(pp.id);
    if (hide) {
      for (const qq of pp.questions) { delete qq.answer; delete qq.analysis; }
    }
  }

  const shares = sharesAll.filter(s => adm || (s.ownerId || '') === uid || (s.targetUserId || '') === uid);

  return {
    settings: metaGet('settings', {}),
    builtinCategories: metaGet('builtinCategories', []),
    builtinBanks: metaGet('builtinBanks', []),
    users, banks, questions, answers, wrongBook, papers, examRecords, shares, paperShares,
    favorites, importTasks,
    auditLogs: adm ? allRows('audit_logs') : [],
    practiceSessions: {},
  };
}

/* ---------------- 判分 ---------------- */
function gradeQ(type, answer, content) {
  if (type === 'essay') return null;
  if (type === 'single') return String(content).toUpperCase() === String(answer).toUpperCase();
  if (type === 'judge') return content === answer;
  if (type === 'multi') {
    const u = [...String(content)].sort().join('');
    const a = [...String(answer)].sort().join('');
    return u === a;
  }
  if (type === 'blank') {
    const norm = s => String(s).trim().toLowerCase();
    return String(answer).split('|').some(acc => acc !== '' && norm(acc) === norm(content));
  }
  return false;
}

/* ---------------- 变更合并（写穿透） ---------------- */
function applyChanges(u, ups, del) {
  const uid = u.id, adm = isAdm(u);
  const U = (ups && typeof ups === 'object') ? ups : {};
  const D = (del && typeof del === 'object') ? del : {};

  db.exec('BEGIN');
  try {
    if (Array.isArray(U.users)) {
      for (const row of U.users) {
        if (!row || !row.id || !row.username) continue;
        const ex = getRow('users', row.id);
        if (!adm) {
          if (row.id !== uid) continue;
          if (ex) {
            row.role = ex.role; row.status = ex.status;
            row.failCount = ex.failCount ?? 0; row.lockedUntil = ex.lockedUntil ?? 0;
            row.username = ex.username;
          } else continue;
        } else if (ex && row.id === uid) {
          row.role = ex.role; row.status = ex.status;
        }
        if (!ex && !adm) continue;
        if (ex) {
          for (const k of ['pwd', 'failCount', 'lockedUntil']) {
            if (!(k in row) && (k in ex)) row[k] = ex[k];
          }
        }
        putRow('users', row.id, {
          username: row.username, role: row.role || 'user', status: row.status || 'active',
        }, row);
      }
    }

    if (adm) {
      if (U.settings && typeof U.settings === 'object') metaPut('settings', U.settings);
      if (Array.isArray(U.builtinCategories)) metaPut('builtinCategories', U.builtinCategories);
      if (Array.isArray(U.builtinBanks)) metaPut('builtinBanks', U.builtinBanks);
    }

    const bankOwner = {};
    for (const r of db.prepare('SELECT id,owner_id FROM banks').all()) bankOwner[r.id] = r.owner_id;
    const paperOwner = {};
    for (const r of db.prepare('SELECT id,user_id FROM papers').all()) paperOwner[r.id] = r.user_id;

    if (Array.isArray(U.banks)) {
      for (const b of U.banks) {
        if (!b || !b.id) continue;
        const exOwner = bankOwner[b.id];
        if (exOwner === undefined) {
          if ((b.ownerId || '') !== uid && !adm) continue;
        } else {
          if (exOwner !== uid && !adm) continue;
          if (!adm) b.ownerId = exOwner;
        }
        putRow('banks', b.id, { owner_id: b.ownerId ?? uid }, b);
        bankOwner[b.id] = b.ownerId ?? uid;
      }
    }

    if (Array.isArray(U.questions)) {
      for (const q of U.questions) {
        if (!q || !q.id || !q.bankId) continue;
        let o = bankOwner[q.bankId];
        if (o === undefined) { const bb = getRow('banks', q.bankId); o = bb ? (bb.ownerId ?? null) : null; }
        if (o !== uid && !adm) continue;
        putRow('questions', q.id, { bank_id: q.bankId }, q);
      }
    }

    const personal = [['answers', 'answers'], ['wrongBook', 'wrongbook'], ['favorites', 'favorites'], ['importTasks', 'import_tasks']];
    for (const [key, table] of personal) {
      if (Array.isArray(U[key])) {
        for (const row of U[key]) {
          if (!row || !row.id) continue;
          row.userId = uid;
          const cols = { user_id: uid };
          if (key !== 'importTasks' && row.questionId) cols.question_id = row.questionId;
          putRow(table, row.id, cols, row);
        }
      }
      if (Array.isArray(D[key])) {
        for (const id of D[key]) {
          if (typeof id !== 'string' || id.length > 64) continue;
          db.prepare(`DELETE FROM ${table} WHERE id=? AND user_id=?`).run(id, uid);
        }
      }
    }

    if (Array.isArray(U.papers)) {
      for (const pp of U.papers) {
        if (!pp || !pp.id) continue;
        const ex = getRow('papers', pp.id);
        if (ex) {
          // 已存在的试卷仅允许所有者/管理员改名称与配置（题目快照不可改，避免影响历史考试记录）
          if ((ex.userId || '') !== uid && !adm) continue;
          ex.name = pp.name ?? ex.name;
          ex.config = (pp.config && typeof pp.config === 'object') ? pp.config : ex.config;
          putRow('papers', pp.id, { user_id: ex.userId || uid }, ex);
          continue;
        }
        pp.userId = uid;
        putRow('papers', pp.id, { user_id: uid }, pp);
      }
    }

    if (Array.isArray(U.examRecords)) {
      for (const r of U.examRecords) {
        if (!r || !r.id) continue;
        const ex = getRow('exam_records', r.id);
        if (ex) {
          if ((ex.userId || '') !== uid) continue;
          if ((ex.status || '') !== 'ongoing') continue;
          if ((r.status || 'ongoing') !== 'ongoing') continue;
          r.userId = uid;
          // 随机重考记录的题目快照由服务端保存，客户端回传的版本已剥离答案，不能覆盖
          if (Array.isArray(ex.questions) && ex.questions.length) r.questions = ex.questions;
          putRow('exam_records', r.id, { user_id: uid, paper_id: r.paperId || ex.paperId || '', status: 'ongoing' }, r);
        } else {
          if ((r.userId || uid) !== uid) r.userId = uid;
          delete r.questions; // 题目快照只能由服务端开考接口写入，避免客户端伪造
          putRow('exam_records', r.id, { user_id: uid, paper_id: r.paperId || '', status: r.status || 'ongoing' }, r);
        }
      }
    }

    if (Array.isArray(U.shares)) {
      const allShares = allRows('shares');
      for (const s of U.shares) {
        if (!s || !s.id) continue;
        const ex = getRow('shares', s.id);
        let bankOwnerId = bankOwner[s.bankId || ''];
        if (bankOwnerId === undefined && s.bankId) {
          const bb = getRow('banks', s.bankId);
          bankOwnerId = bb ? (bb.ownerId ?? null) : null;
        }
        let ok = false;
        if (adm) ok = true;
        else if (bankOwnerId === uid) ok = true;
        else if ((s.targetUserId || '') === uid) {
          if (ex && (ex.targetUserId || '') === uid) ok = true;
          else if (!ex && s.viaLink) {
            for (const ls of allShares) {
              if ((ls.linkToken || '') === s.viaLink && (ls.bankId || '') === (s.bankId || '') && (ls.status || '') === 'active') { ok = true; break; }
            }
          }
        }
        if (!ok) continue;
        putRow('shares', s.id, {
          bank_id: s.bankId || '', owner_id: s.ownerId || '', target_user_id: s.targetUserId || '',
          link_token: s.linkToken || '', status: s.status || 'active',
        }, s);
      }
    }

    if (Array.isArray(U.paperShares)) {
      const allPaperShares = allRows('paper_shares');
      for (const s of U.paperShares) {
        if (!s || !s.id) continue;
        const ex = getRow('paper_shares', s.id);
        let ownerId = paperOwner[s.paperId || ''];
        if (ownerId === undefined && s.paperId) {
          const pp = getRow('papers', s.paperId);
          ownerId = pp ? (pp.userId ?? null) : null;
        }
        let ok = false;
        if (adm) ok = true;
        else if (ownerId === uid) { s.ownerId = uid; ok = true; }
        else if ((s.targetUserId || '') === uid) {
          if (ex && (ex.targetUserId || '') === uid) ok = true;
          else if (!ex && s.viaLink) {
            for (const ls of allPaperShares) {
              if ((ls.linkToken || '') === s.viaLink && (ls.paperId || '') === (s.paperId || '') && (ls.status || '') === 'active') { ok = true; break; }
            }
          }
        }
        if (!ok) continue;
        if (!s.ownerId) s.ownerId = ownerId || '';
        putRow('paper_shares', s.id, {
          paper_id: s.paperId || '', owner_id: s.ownerId || '', target_user_id: s.targetUserId || '',
          link_token: s.linkToken || '', status: s.status || 'active',
        }, s);
      }
    }

    if (Array.isArray(D.banks)) {
      for (const id of D.banks) {
        if (typeof id !== 'string') continue;
        let o = bankOwner[id];
        if (o === undefined) { const bb = getRow('banks', id); o = bb ? (bb.ownerId ?? null) : null; }
        if (o !== uid && !adm) continue;
        delRow('banks', id);
        db.prepare('DELETE FROM questions WHERE bank_id=?').run(id);
        db.prepare('DELETE FROM shares WHERE bank_id=?').run(id);
      }
    }
    if (Array.isArray(D.questions)) {
      for (const id of D.questions) {
        if (typeof id !== 'string') continue;
        const q = getRow('questions', id);
        if (!q) continue;
        let o = bankOwner[q.bankId || ''];
        if (o === undefined) { const bb = getRow('banks', q.bankId || ''); o = bb ? (bb.ownerId ?? null) : null; }
        if (o !== uid && !adm) continue;
        delRow('questions', id);
      }
    }
    if (Array.isArray(D.shares)) {
      for (const id of D.shares) {
        if (typeof id !== 'string') continue;
        const s = getRow('shares', id);
        if (!s) continue;
        if ((s.ownerId || '') !== uid && !adm) continue;
        delRow('shares', id);
      }
    }
    if (Array.isArray(D.paperShares)) {
      for (const id of D.paperShares) {
        if (typeof id !== 'string') continue;
        const s = getRow('paper_shares', id);
        if (!s) continue;
        if ((s.ownerId || '') !== uid && !adm) continue;
        delRow('paper_shares', id);
      }
    }
    if (Array.isArray(D.papers)) {
      for (const id of D.papers) {
        if (typeof id !== 'string') continue;
        db.prepare('DELETE FROM papers WHERE id=? AND user_id=?').run(id, uid);
        db.prepare('DELETE FROM paper_shares WHERE paper_id=?').run(id);
      }
    }

    if (Array.isArray(U.auditLogs)) {
      for (const l of U.auditLogs) {
        if (!l || !l.id) continue;
        db.prepare('INSERT OR IGNORE INTO audit_logs (id,ts,data) VALUES (?,?,?)')
          .run(l.id, Number(l.ts) || ms(), JSON.stringify(l));
      }
    }

    let admins = 0;
    for (const x of allRows('users')) {
      if ((x.role || '') === 'admin' && (x.status || 'active') === 'active') admins++;
    }
    if (admins < 1) throw new Error('系统至少需要保留一个正常管理员');

    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

/* ---------------- HTTP / 会话 ---------------- */
function json(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}
function jfail(res, msg, code = 200) { json(res, code, { ok: false, error: msg }); }

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    const MAX = 64 * 1024 * 1024;
    req.on('data', c => {
      size += c.length;
      if (size > MAX) { reject(new Error('请求体过大')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
async function readJson(req) {
  const buf = await readBody(req);
  if (!buf.length) return {};
  try {
    const j = JSON.parse(buf.toString('utf8'));
    return (j && typeof j === 'object') ? j : {};
  } catch { return {}; }
}

function getCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return '';
}
function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie', `sid=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_MS / 1000)}`);
}
function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', 'sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
}
function createSession(res, uid) {
  const token = crypto.randomBytes(24).toString('hex');
  db.prepare('INSERT INTO sessions (token,user_id,expires_at) VALUES (?,?,?)').run(token, uid, ms() + SESSION_MS);
  setSessionCookie(res, token);
  return token;
}
function destroySession(req, res) {
  const token = getCookie(req, 'sid');
  if (token) db.prepare('DELETE FROM sessions WHERE token=?').run(token);
  clearSessionCookie(res);
}
function me(req) {
  const token = getCookie(req, 'sid');
  if (!token) return null;
  const s = db.prepare('SELECT user_id,expires_at FROM sessions WHERE token=?').get(token);
  if (!s) return null;
  if (s.expires_at < ms()) {
    db.prepare('DELETE FROM sessions WHERE token=?').run(token);
    return null;
  }
  const u = getRow('users', s.user_id);
  if (!u || (u.status || 'active') !== 'active') return null;
  return u;
}
function requireMe(req, res) {
  const u = me(req);
  if (!u) { jfail(res, 'unauthorized', 401); return null; }
  return u;
}

/* ---------------- 认证接口 ---------------- */
async function handleAuth(req, res) {
  if (req.method !== 'POST') return jfail(res, '方法不支持', 405);
  const j = await readJson(req);
  const action = j.action || '';

  if (action === 'login') {
    const name = String(j.username ?? '').trim();
    const pwd = String(j.pwd ?? '');
    if (!name || !pwd) return jfail(res, '用户名或密码错误');
    const r = db.prepare('SELECT data FROM users WHERE LOWER(username)=LOWER(?)').get(name);
    const u = r ? JSON.parse(r.data) : null;
    if (!u) return jfail(res, '用户名或密码错误');
    if ((u.status || 'active') === 'disabled') return jfail(res, '账号已停用，请联系管理员');
    const now = ms();
    if ((u.lockedUntil || 0) > now) return jfail(res, `登录已锁定，请 ${Math.ceil((u.lockedUntil - now) / 60000)} 分钟后再试`);
    if ((u.pwd || '') !== pwd) {
      u.failCount = (u.failCount || 0) + 1;
      if (u.failCount >= 5) {
        u.lockedUntil = now + 10 * 60 * 1000;
        u.failCount = 0;
        putRow('users', u.id, { username: u.username, role: u.role, status: u.status }, u);
        return jfail(res, '连续失败 5 次，账号锁定 10 分钟');
      }
      putRow('users', u.id, { username: u.username, role: u.role, status: u.status }, u);
      return jfail(res, '用户名或密码错误');
    }
    u.failCount = 0; u.lockedUntil = 0;
    putRow('users', u.id, { username: u.username, role: u.role, status: u.status }, u);
    const old = getCookie(req, 'sid');
    if (old) db.prepare('DELETE FROM sessions WHERE token=?').run(old);
    createSession(res, u.id);
    return json(res, 200, { ok: true, user: u, db: buildDb(u) });
  }

  if (action === 'register') {
    const settings = metaGet('settings', {}) || {};
    if (!settings.openRegister) return jfail(res, '注册已关闭，如需账号请联系管理员');
    const name = String(j.username ?? '').trim();
    const nick = String(j.nickname ?? '').trim();
    const pwd = String(j.pwd ?? '');
    if (!/^[\u4e00-\u9fa5A-Za-z0-9_]{3,32}$/u.test(name)) return jfail(res, '用户名需 3–32 位，仅含中文、字母、数字、下划线');
    if (!/^[0-9a-f]{2,32}$/.test(pwd)) return jfail(res, '密码格式不正确');
    if (nick && [...nick].length > 30) return jfail(res, '昵称 1–30 个字符');
    const exists = db.prepare('SELECT COUNT(*) c FROM users WHERE LOWER(username)=LOWER(?)').get(name).c;
    if (exists > 0) return jfail(res, '用户名已被占用');
    const u = {
      id: genId(), username: name, nickname: nick || name, pwd,
      role: 'user', status: 'active', createdAt: ms(), mustChangePwd: false, failCount: 0, lockedUntil: 0,
    };
    putRow('users', u.id, { username: u.username, role: 'user', status: 'active' }, u);
    return json(res, 200, { ok: true });
  }

  if (action === 'changepwd') {
    const u = requireMe(req, res);
    if (!u) return;
    const oldPwd = String(j.old ?? '');
    const pwd = String(j.pwd ?? '');
    if (!/^[0-9a-f]{2,32}$/.test(pwd)) return jfail(res, '密码格式不正确');
    if (!u.mustChangePwd && (u.pwd || '') !== oldPwd) return jfail(res, '旧密码不正确');
    u.pwd = pwd; u.mustChangePwd = false;
    putRow('users', u.id, { username: u.username, role: u.role, status: u.status }, u);
    db.prepare('DELETE FROM sessions WHERE user_id=?').run(u.id);
    clearSessionCookie(res);
    return json(res, 200, { ok: true });
  }

  if (action === 'logout') {
    destroySession(req, res);
    return json(res, 200, { ok: true });
  }

  return jfail(res, '未知操作', 400);
}

/* ---------------- 同步接口 ---------------- */
async function handleSync(req, res) {
  if (req.method === 'GET') {
    const u = me(req);
    if (!u) {
      const s = metaGet('settings', {}) || {};
      return json(res, 401, { ok: false, error: 'unauthorized', settings: { openRegister: s.openRegister !== false } });
    }
    return json(res, 200, { ok: true, user: u, db: buildDb(u) });
  }
  if (req.method === 'POST') {
    const u = requireMe(req, res);
    if (!u) return;
    const j = await readJson(req);
    const ups = j.upserts, del = j.deletes;
    if (!ups || typeof ups !== 'object' || !del || typeof del !== 'object') return jfail(res, '请求格式错误', 400);
    try {
      applyChanges(u, ups, del);
    } catch (e) {
      return jfail(res, '保存失败：' + e.message);
    }
    return json(res, 200, { ok: true });
  }
  return jfail(res, '方法不支持', 405);
}

/* ---------------- 模拟考试 ---------------- */
function toInt(v, def) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
}
function shuffle(a) {
  const r = [...a];
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}
function pad2(n) { return String(n).padStart(2, '0'); }

/* 按试卷配置抽题：生成试卷与「重考随机抽题」共用 */
function drawQuestions(cfg, uid, u, opts) {
  const bypassBankCheck = !!(opts && opts.bypassBankCheck);
  const bankIds = Array.isArray(cfg.banks) ? cfg.banks.filter(x => typeof x === 'string') : [];
  const counts = (cfg.counts && typeof cfg.counts === 'object') ? cfg.counts : {};
  const scores = (cfg.scores && typeof cfg.scores === 'object') ? cfg.scores : {};
  const chaps = Array.isArray(cfg.chaps) ? cfg.chaps.filter(x => typeof x === 'string') : [];
  const diffs = Array.isArray(cfg.diffs) ? cfg.diffs.filter(x => typeof x === 'string') : [];
  if (!bankIds.length) return { ok: false, error: '请至少选择 1 个题库' };
  const types = ['single', 'multi', 'judge', 'blank'];
  let totalWanted = 0;
  for (const t of types) totalWanted += Math.max(0, toInt(counts[t], 0));
  if (totalWanted < 1) return { ok: false, error: '总题量至少为 1 题' };

  const usersById = {};
  for (const x of allRows('users')) usersById[x.id] = x;
  const sharesAll = allRows('shares');
  const visibleBids = [];
  for (const bid of bankIds) {
    const b = getRow('banks', bid);
    if (b && (bypassBankCheck || isAdm(u) || canReadBankArr(b, uid, usersById, sharesAll))) visibleBids.push(bid);
  }
  if (!visibleBids.length) return { ok: false, error: '所选题库不可用' };

  const ph = visibleBids.map(() => '?').join(',');
  const pool = [];
  for (const r of db.prepare(`SELECT data FROM questions WHERE bank_id IN (${ph})`).all(...visibleBids)) {
    const q = JSON.parse(r.data);
    if ((q.type || '') === 'essay') continue;
    if (chaps.length) {
      const qc = q.chapter || '未设置章节';
      if (!chaps.some(c => qc === c || qc.startsWith(c + '/'))) continue;
    }
    if (diffs.length && !diffs.includes(q.difficulty || 'none')) continue;
    pool.push(q);
  }

  const seen = new Set();
  const dedup = [];
  for (const q of pool) {
    const opts = (Array.isArray(q.options) ? q.options : []).map(o => String(o.t ?? '').trim()).sort();
    const ans = (q.type || '') === 'blank' ? String(q.answer ?? '').trim().toLowerCase() : String(q.answer ?? '');
    const key = String(q.stem ?? '').trim().replace(/\s+/gu, ' ') + '##' + (q.type || '') + '##' + opts.join('|') + '##' + ans;
    if (seen.has(key)) continue;
    seen.add(key); dedup.push(q);
  }

  const byType = { single: [], multi: [], judge: [], blank: [] };
  for (const q of dedup) if (byType[q.type]) byType[q.type].push(q);

  const gaps = [];
  const picked = [];
  for (const t of types) {
    const want = Math.max(0, toInt(counts[t], 0));
    if (!want) continue;
    const av = shuffle(byType[t]);
    if (av.length < want) gaps.push({ t, want, have: av.length });
    else {
      const sc = Math.max(0.5, Number(scores[t] ?? 1));
      for (const q of av.slice(0, want)) picked.push({ q, score: sc });
    }
  }
  if (gaps.length) return { ok: false, error: '题量不足', gaps };

  const snap = [];
  let no = 1;
  for (const x of picked) {
    const q = x.q;
    snap.push({
      qid: q.id, bankId: q.bankId, no: no++, type: q.type,
      stem: q.stem ?? '',
      options: (Array.isArray(q.options) ? q.options : []).map(o => ({ k: o.k ?? '', t: o.t ?? '' })),
      answer: q.answer ?? '', analysis: q.analysis ?? '',
      chapter: q.chapter ?? '未设置章节', difficulty: q.difficulty ?? 'none', score: x.score,
    });
  }
  return { ok: true, snap, banks: visibleBids };
}

async function handleExamCreate(req, res) {
  if (req.method !== 'POST') return jfail(res, '方法不支持', 405);
  const u = requireMe(req, res);
  if (!u) return;
  const uid = u.id;
  const j = await readJson(req);

  /* 按已有试卷模板开考：默认复用试卷快照；开启「重考随机抽题」时按原配置重新抽题，快照存进本次考试记录 */
  const tplId = String(j.paperId ?? '').trim();
  if (tplId) {
    const tpl = getRow('papers', tplId);
    if (!tpl) return jfail(res, '试卷不存在或已删除');
    let allowed = isAdm(u) || (tpl.userId || '') === uid;
    if (!allowed) {
      allowed = allRows('paper_shares').some(s =>
        (s.paperId || '') === tplId && (s.targetUserId || '') === uid && (s.status || '') === 'active');
    }
    if (!allowed) return jfail(res, '无权使用该试卷');
    const cfg = (tpl.config && typeof tpl.config === 'object') ? tpl.config : {};
    const duration = Math.max(1, Math.min(300, toInt(j.duration, cfg.duration || 90)));
    const now = ms();
    const ongoing = allRows('exam_records').find(r =>
      (r.userId || '') === uid && (r.paperId || '') === tplId &&
      (r.status || '') === 'ongoing' && Number(r.deadline || 0) > now - 30000);
    let rec = ongoing;
    if (!rec) {
      let attempt = null;
      if (cfg.randomOnRetake) {
        // 试卷共享给他人时，接收方无权读取源题库，但已授权使用该试卷，可按原配置抽题
        const dr = drawQuestions(cfg, uid, u, { bypassBankCheck: true });
        if (!dr.ok) return json(res, 200, { ok: false, error: dr.error, gaps: dr.gaps });
        attempt = dr.snap;
      }
      rec = {
        id: genId(), paperId: tpl.id, userId: uid, answers: {},
        startedAt: now, deadline: now + duration * 60000, status: 'ongoing', score: null, submittedAt: null,
      };
      if (attempt) rec.questions = attempt; // 本次随机抽题快照，仅服务端保存，下发前剥离答案
      putRow('exam_records', rec.id, { user_id: uid, paper_id: tpl.id, status: 'ongoing' }, rec);
    }
    const paperOut = JSON.parse(JSON.stringify(tpl));
    if (Array.isArray(rec.questions) && rec.questions.length) {
      paperOut.questions = JSON.parse(JSON.stringify(rec.questions));
      paperOut.total = rec.questions.length;
    }
    for (const qq of (paperOut.questions || [])) { delete qq.answer; delete qq.analysis; }
    const recOut = JSON.parse(JSON.stringify(rec));
    if (Array.isArray(recOut.questions)) {
      for (const qq of recOut.questions) { delete qq.answer; delete qq.analysis; }
    }
    return json(res, 200, { ok: true, paper: paperOut, record: recOut, reused: !!ongoing, random: Array.isArray(rec.questions) });
  }

  const d = new Date();
  const name = String(j.name ?? '').trim() || `模拟试卷 ${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  const counts = (j.counts && typeof j.counts === 'object') ? j.counts : {};
  const scores = (j.scores && typeof j.scores === 'object') ? j.scores : {};
  const chaps = Array.isArray(j.chaps) ? j.chaps.filter(x => typeof x === 'string') : [];
  const diffs = Array.isArray(j.diffs) ? j.diffs.filter(x => typeof x === 'string') : [];
  const duration = Math.max(1, Math.min(300, toInt(j.duration, 90)));
  const passPct = Math.max(1, Math.min(100, toInt(j.passPct, 60)));

  const drawn = drawQuestions({ banks: j.banks, counts, scores, chaps, diffs }, uid, u);
  if (!drawn.ok) {
    if (drawn.gaps) return json(res, 200, { ok: false, error: drawn.error, gaps: drawn.gaps });
    return jfail(res, drawn.error);
  }
  const snap = drawn.snap;
  const totalScore = Math.round(snap.reduce((s, x) => s + Number(x.score || 0), 0) * 10) / 10;
  const now = ms();
  const paper = {
    id: genId(), userId: uid, name,
    config: { banks: drawn.banks, counts, scores, chaps, diffs, duration, passPct, randomOnRetake: !!j.randomOnRetake },
    questions: snap, total: snap.length, totalScore,
    passScore: Math.round(totalScore * passPct / 100), createdAt: now,
  };
  putRow('papers', paper.id, { user_id: uid }, paper);
  return json(res, 200, { ok: true, paper });
}

async function handleExamSubmit(req, res) {
  if (req.method !== 'POST') return jfail(res, '方法不支持', 405);
  const u = requireMe(req, res);
  if (!u) return;
  const uid = u.id;
  const j = await readJson(req);
  const rid = String(j.recordId ?? '');
  if (!rid) return jfail(res, '缺少考试记录 ID');

  const rec = getRow('exam_records', rid);
  if (!rec || (rec.userId || '') !== uid) return jfail(res, '考试记录不存在');
  if ((rec.status || '') !== 'ongoing') {
    return json(res, 200, { ok: true, already: true, score: rec.score ?? null, status: rec.status ?? '' });
  }
  const paper = getRow('papers', rec.paperId || '');
  if (!paper) return jfail(res, '试卷不存在');

  const now = ms();
  const deadline = Number(rec.deadline || 0);
  const status = now > deadline + 30000 ? 'timeout' : 'submitted';

  const usersById = {};
  for (const x of allRows('users')) usersById[x.id] = x;
  const sharesAll = allRows('shares');

  // 随机重考的记录自带本次抽题快照，优先使用；否则沿用试卷快照
  const qs = (Array.isArray(rec.questions) && rec.questions.length)
    ? rec.questions
    : (Array.isArray(paper.questions) ? paper.questions : []);

  db.exec('BEGIN');
  try {
    let score = 0;
    const wrongOnce = new Set();
    const answers = (rec.answers && typeof rec.answers === 'object' && !Array.isArray(rec.answers)) ? rec.answers : {};
    for (const q of qs) {
      const a = answers[q.qid] ?? null;
      const content = (a && typeof a === 'object') ? (a.content ?? '') : '';
      const right = a ? gradeQ(q.type, q.answer ?? '', content) : false;
      if (right === true) { score += Number(q.score || 0); continue; }
      if (wrongOnce.has(q.qid)) continue;
      wrongOnce.add(q.qid);

      const src = getRow('questions', q.qid);
      if (!src) continue;
      const bank = getRow('banks', src.bankId || '');
      if (!bank) continue;
      if (!isAdm(u) && !canReadBankArr(bank, uid, usersById, sharesAll)) continue;

      const ansRow = {
        id: genId(), userId: uid, questionId: src.id, bankId: src.bankId,
        content, correct: false, source: 'exam', ts: now,
      };
      putRow('answers', ansRow.id, { user_id: uid, question_id: src.id }, ansRow);

      let w = findWhere('wrongbook', 'user_id=? AND question_id=?', [uid, src.id]);
      if (!w) w = {
        id: genId(), userId: uid, questionId: src.id, bankId: src.bankId,
        wrongCount: 0, streak: 0, status: 'unmastered', lastWrongTs: 0,
      };
      w.wrongCount = (w.wrongCount || 0) + 1; w.streak = 0; w.status = 'unmastered'; w.lastWrongTs = now;
      putRow('wrongbook', w.id, { user_id: uid, question_id: src.id }, w);
    }
    const finalScore = Math.round(score * 10) / 10;
    rec.score = finalScore; rec.status = status; rec.submittedAt = now;
    putRow('exam_records', rec.id, { user_id: uid, paper_id: rec.paperId, status }, rec);
    db.exec('COMMIT');
    return json(res, 200, { ok: true, score: finalScore, status, submittedAt: now });
  } catch (e) {
    db.exec('ROLLBACK');
    return jfail(res, '判分失败：' + e.message);
  }
}

/* ---------------- 静态文件 ---------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405); res.end(); return;
  }
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { res.writeHead(400); res.end(); return; }
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403); res.end(); return; }
  if (file === path.join(ROOT, 'server.js')) { res.writeHead(404); res.end(); return; }
  if (file.includes(`${path.sep}.`) || file.includes(`${path.sep}data${path.sep}`)) { res.writeHead(404); res.end(); return; }
  const ext = path.extname(file).toLowerCase();
  if (!MIME[ext]) { res.writeHead(404); res.end(); return; }

  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      const nf = path.join(ROOT, '404.html');
      fs.stat(nf, (e2, s2) => {
        if (e2 || !s2.isFile()) { res.writeHead(404); res.end(); return; }
        res.writeHead(404, { 'Content-Type': MIME['.html'], 'Content-Length': s2.size });
        if (req.method === 'HEAD') { res.end(); return; }
        fs.createReadStream(nf).pipe(res);
      });
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[ext],
      'Content-Length': st.size,
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300',
    });
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(file).pipe(res);
  });
}

/* ---------------- 路由 ---------------- */
const server = http.createServer(async (req, res) => {
  let pathname = '/';
  try {
    pathname = new URL(req.url, 'http://localhost').pathname;
  } catch {
    res.writeHead(400); res.end(); return;
  }
  pathname = pathname.replace(/\/+$/, '') || '/';

  try {
    if (pathname === '/api/auth') return await handleAuth(req, res);
    if (pathname === '/api/sync') return await handleSync(req, res);
    if (pathname === '/api/exam/create') return await handleExamCreate(req, res);
    if (pathname === '/api/exam/submit') return await handleExamSubmit(req, res);
    if (pathname.startsWith('/api/')) return jfail(res, '接口不存在', 404);
    return serveStatic(req, res, pathname);
  } catch (e) {
    console.error('[error]', e);
    if (!res.headersSent) json(res, 500, { ok: false, error: '服务器内部错误' });
    else res.end();
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[server] 刷题宝已启动：http://0.0.0.0:${PORT}（数据库：${DB_PATH}）`);
});

setInterval(() => {
  try { db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(ms()); } catch { /* ignore */ }
}, 60 * 60 * 1000).unref();

function shutdown() {
  server.close(() => {
    try { db.close(); } catch { /* ignore */ }
    process.exit(0);
  });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
