/**
 * Tiny JSON-file data store. All data lives in data/db.json.
 * Writes are atomic (write temp file, then rename) to avoid corruption.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const RUNTIME_ROOT = process.env.RWP_RUNTIME_DIR
  ? process.env.RWP_RUNTIME_DIR
  : process.env.VERCEL
    ? path.join(os.tmpdir(), 'risewithpledge')
    : path.join(__dirname, '..');
const DATA_DIR = process.env.RWP_DATA_DIR || path.join(RUNTIME_ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

const DEFAULTS = {
  settings: {
    email: 'info.risewithpledgefoundation@gmail.com',
    phone: '+2348165753686',
    address: 'Lagos, Nigeria',
    instagram: 'https://instagram.com/risewithpledgefoundation',
    instagramHandle: '@risewithpledgefoundation',
    facebook: 'https://facebook.com/',
    facebookName: 'Risewithpledge education welfare and empowerment foundation',
    accountName: 'RISEWITHPLEDGE EDUCATION WELFARE AND EMPOWERMENT FOUNDATION',
    accountNumber: '2048132563',
    bankName: 'First Bank'
  },
  impact: {
    studentsSupported: 0,
    scholarshipsAwarded: 0,
    materialsDistributed: 0,
    volunteersEngaged: 0,
    volunteerHours: 0,
    outreachProgrammes: 0,
    communitiesReached: 0,
    beneficiariesImpacted: 0,
    individualsTrained: 0,
    skillsProgrammes: 0,
    entrepreneursSupported: 0,
    familiesAssisted: 0,
    reliefMaterials: 0,
    humanitarianInterventions: 0,
    projectsCompleted: 0,
    partnershipsEstablished: 0,
    fundsMobilized: 0
  },
  team: [],
  projects: [],
  stories: [],
  news: [],
  gallery: [],
  reports: [],
  partners: [],
  members: [],
  volunteers: [],
  pledges: [],
  contacts: [],
  partners_enquiries: [],
  newsletter: [],
  admins: []
};

let db = null;

function getSeedAdmins() {
  const password = String(process.env.SEED_ADMIN_PASSWORD || '').trim();
  const usernames = String(process.env.SEED_ADMIN_USERS || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  if (!password || !usernames.length) return [];
  return usernames.map((username) => ({ username, password }));
}

function load() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(DB_FILE)) {
    try {
      db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    } catch (e) {
      // Keep a backup of the corrupt file rather than silently destroying data
      fs.copyFileSync(DB_FILE, DB_FILE + '.corrupt-' + Date.now());
      db = JSON.parse(JSON.stringify(DEFAULTS));
    }
  } else {
    db = JSON.parse(JSON.stringify(DEFAULTS));
  }
  // Fill in any keys added after first deployment
  for (const key of Object.keys(DEFAULTS)) {
    if (db[key] === undefined) db[key] = JSON.parse(JSON.stringify(DEFAULTS[key]));
  }
  // Migrate away from the old single default "admin" account
  if (db.admin) delete db.admin;
  if (!Array.isArray(db.admins)) db.admins = [];
  // Seed admin accounts only when explicit bootstrap env vars are provided.
  for (const seed of getSeedAdmins()) {
    if (!db.admins.some(a => a.username === seed.username)) {
      const salt = crypto.randomBytes(16).toString('hex');
      db.admins.push({ username: seed.username, salt, hash: hashPassword(seed.password, salt) });
    }
  }
  if (process.env.VERCEL && !db.admins.length) {
    console.warn('No admin accounts found. Set SEED_ADMIN_USERS and SEED_ADMIN_PASSWORD to bootstrap admin access on Vercel.');
  }
  save();
  return db;
}

function save() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8');
  fs.renameSync(tmp, DB_FILE);
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function verifyPassword(password, salt, hash) {
  const candidate = Buffer.from(hashPassword(password, salt), 'hex');
  const stored = Buffer.from(hash, 'hex');
  return candidate.length === stored.length && crypto.timingSafeEqual(candidate, stored);
}

function id() {
  return crypto.randomBytes(8).toString('hex');
}

module.exports = { load, save, hashPassword, verifyPassword, id, get: () => db };
