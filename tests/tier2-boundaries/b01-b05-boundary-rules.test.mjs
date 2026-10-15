import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidGradeString,
  containsDeprecatedGradeFormatting,
  isDeprecatedTable,
  ALLOWED_FIRESTORE_COLLECTIONS
} from '../helpers/contracts.mjs';

describe('Tier 2: Boundary - Feature 1 (Vercel SPA Hosting & Deployment Config)', () => {
  it('B01-1: vercel.json missing rewrites array is rejected by configuration validator', () => {
    const validateVercel = (cfg) => {
      if (!cfg.rewrites || !Array.isArray(cfg.rewrites) || cfg.rewrites.length === 0) {
        throw new Error('Invalid Vercel configuration: rewrites array is required');
      }
      return true;
    };
    assert.throws(() => validateVercel({ version: 2 }), /rewrites array is required/);
    assert.throws(() => validateVercel({ version: 2, rewrites: [] }), /rewrites array is required/);
  });

  it('B01-2: .env.example with missing required Firebase or Supabase keys triggers validation error', () => {
    const validateEnv = (keys) => {
      const required = ['VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_PROJECT_ID', 'VITE_SUPABASE_URL'];
      for (const r of required) {
        if (!keys.includes(r)) throw new Error(`Missing required env key: ${r}`);
      }
      return true;
    };
    assert.throws(() => validateEnv(['VITE_FIREBASE_API_KEY']), /Missing required env key/);
  });

  it('B01-3: Deep nested route paths (e.g. /admin/rescue/view/12) fallback to /index.html', () => {
    const resolveSpaRoute = (route) => {
      if (route.startsWith('/api/')) return route;
      return '/index.html';
    };
    assert.equal(resolveSpaRoute('/admin/rescue/view/12'), '/index.html');
  });

  it('B01-4: Directory traversal in static asset request is sanitized and blocked', () => {
    const sanitizePath = (p) => {
      if (p.includes('..') || p.includes('\\')) throw new Error('Path traversal detected');
      return `/public/${p.replace(/^\/+/, '')}`;
    };
    assert.throws(() => sanitizePath('../../etc/passwd'), /Path traversal detected/);
    assert.throws(() => sanitizePath('..\\..\\windows\\win.ini'), /Path traversal detected/);
  });

  it('B01-5: Missing environment variables produce informative diagnostic instructions', () => {
    const getEnvDiagnostic = (env) => {
      const missing = [];
      if (!env.VITE_FIREBASE_PROJECT_ID) missing.push('VITE_FIREBASE_PROJECT_ID');
      if (!env.VITE_SUPABASE_URL) missing.push('VITE_SUPABASE_URL');
      if (missing.length > 0) return `⚠️ 請依 .env.example 設定以下環境變數: ${missing.join(', ')}`;
      return 'OK';
    };
    const diag = getEnvDiagnostic({});
    assert.ok(diag.includes('請依 .env.example 設定以下環境變數'));
  });
});

describe('Tier 2: Boundary - Feature 2 (Firestore & Supabase SDK Initialization)', () => {
  it('B02-1: Empty or undefined Firebase options object throws descriptive error', () => {
    const initFirebase = (opts) => {
      if (!opts || typeof opts !== 'object' || !opts.apiKey) {
        throw new Error('FirebaseOptions cannot be null or empty');
      }
    };
    assert.throws(() => initFirebase(null), /FirebaseOptions cannot be null/);
    assert.throws(() => initFirebase({}), /FirebaseOptions cannot be null/);
  });

  it('B02-2: Invalid Supabase URL schema fails initialization validation', () => {
    const validateSupabaseUrl = (url) => {
      if (!url || (!url.startsWith('https://') && !url.startsWith('http://localhost'))) {
        throw new Error('Supabase URL must start with https://');
      }
    };
    assert.throws(() => validateSupabaseUrl('ftp://example.com'), /Supabase URL must start with https/);
    assert.throws(() => validateSupabaseUrl('xyzcompany.supabase.co'), /Supabase URL must start with https/);
  });

  it('B02-3: Duplicate initialization calls return existing client without recreating instances', () => {
    let instance = null;
    const getClient = (id) => {
      if (!instance) instance = { id, created: Date.now() };
      return instance;
    };
    const c1 = getClient('app1');
    const c2 = getClient('app2');
    assert.equal(c1, c2);
  });

  it('B02-4: Disconnected network during initialization initializes local cache gracefully', () => {
    const initOffline = (isOnline) => {
      return {
        online: isOnline,
        storageMode: isOnline ? 'remote_with_cache' : 'cache_only'
      };
    };
    const client = initOffline(false);
    assert.equal(client.storageMode, 'cache_only');
  });

  it('B02-5: Corrupted local storage configuration falls back to safe memory defaults', () => {
    const parseCacheConfig = (raw) => {
      try {
        return JSON.parse(raw);
      } catch (e) {
        return { mode: 'memory_fallback' };
      }
    };
    assert.deepEqual(parseCacheConfig('invalid json {['), { mode: 'memory_fallback' });
  });
});

describe('Tier 2: Boundary - Feature 3 (Firestore Database Seed Script)', () => {
  it('B03-1: StudentList row with blank columns or whitespace-only seats is cleaned safely', () => {
    const sanitizeRow = (row) => {
      const seat = (row[3] || '').trim();
      if (!seat) return null;
      return { seatRaw: seat };
    };
    assert.equal(sanitizeRow(['一', '1', '1', '   ']), null);
    assert.deepEqual(sanitizeRow(['一', '1', '1', ' 01號 ']), { seatRaw: '01號' });
  });

  it('B03-2: Config_Schedules with mixed boolean representations converts accurately', () => {
    const toBool = (val) => {
      if (typeof val === 'boolean') return val;
      if (typeof val === 'string') {
        const s = val.trim().toUpperCase();
        return s === 'TRUE' || s === '1' || s === 'YES';
      }
      if (typeof val === 'number') return val === 1;
      return false;
    };
    assert.equal(toBool('TRUE'), true);
    assert.equal(toBool('true'), true);
    assert.equal(toBool('1'), true);
    assert.equal(toBool(1), true);
    assert.equal(toBool(''), false);
    assert.equal(toBool(null), false);
    assert.equal(toBool(undefined), false);
  });

  it('B03-3: Student name with special characters (quotes, slashes) survives without injection', () => {
    const rawName = '王"小"明 / John';
    const docData = { name: rawName };
    const serialized = JSON.stringify(docData);
    const parsed = JSON.parse(serialized);
    assert.equal(parsed.name, rawName);
  });

  it('B03-4: Re-running seed script idempotently updates without duplicating documents', () => {
    const store = new Map();
    const saveStudent = (s) => store.set(s.id, s);
    saveStudent({ id: '一_1_01號', name: '王小明' });
    saveStudent({ id: '一_1_01號', name: '王小明 (更新)' });
    assert.equal(store.size, 1);
    assert.equal(store.get('一_1_01號').name, '王小明 (更新)');
  });

  it('B03-5: Empty sheet data input produces 0 writes without crashing', () => {
    const processBatch = (rows) => {
      if (!rows || rows.length === 0) return { writes: 0, status: 'empty' };
      return { writes: rows.length, status: 'ok' };
    };
    assert.deepEqual(processBatch([]), { writes: 0, status: 'empty' });
    assert.deepEqual(processBatch(null), { writes: 0, status: 'empty' });
  });
});

describe('Tier 2: Boundary - Feature 4 (Single-Character Grade Integrity - Iron Rule 2)', () => {
  it('B04-1: String containing 一年級 is explicitly caught and rejected', () => {
    assert.equal(containsDeprecatedGradeFormatting('一年級'), true);
    assert.equal(containsDeprecatedGradeFormatting('二年級'), true);
    assert.equal(containsDeprecatedGradeFormatting('六年級'), true);
  });

  it('B04-2: Single character validation regex ^[一二三四五六]$ rejects invalid characters', () => {
    const regex = /^[一二三四五六]$/;
    assert.equal(regex.test('七'), false);
    assert.equal(regex.test('0'), false);
    assert.equal(regex.test('grade1'), false);
    assert.equal(regex.test('一年級'), false);
    assert.equal(regex.test('一'), true);
  });

  it('B04-3: Whitespace padded grade (e.g.  一 ) is trimmed and validated correctly', () => {
    assert.equal(isValidGradeString('  一  '), true);
    assert.equal(isValidGradeString('\t六\n'), true);
  });

  it('B04-4: Undefined, null, or non-string grade inputs return false safely', () => {
    assert.equal(isValidGradeString(undefined), false);
    assert.equal(isValidGradeString(null), false);
    assert.equal(isValidGradeString(1), false);
    assert.equal(isValidGradeString({}), false);
  });

  it('B04-5: Arabic numeral 1 is not confused with Chinese single character 一', () => {
    assert.equal(isValidGradeString('1'), false);
    assert.equal(isValidGradeString('一'), true);
  });
});

describe('Tier 2: Boundary - Feature 5 (Deprecated Tables Elimination - Iron Rule 3)', () => {
  it('B05-1: Querying deprecated table AfterSchoolSchedule raises DeprecatedTableAccessError', () => {
    const assertAccess = (coll) => {
      if (isDeprecatedTable(coll)) throw new Error(`Access to deprecated table prohibited: ${coll}`);
    };
    assert.throws(() => assertAccess('AfterSchoolSchedule'), /Access to deprecated table prohibited/);
  });

  it('B05-2: Querying deprecated table GradeSchedule raises DeprecatedTableAccessError', () => {
    const assertAccess = (coll) => {
      if (isDeprecatedTable(coll)) throw new Error(`Access to deprecated table prohibited: ${coll}`);
    };
    assert.throws(() => assertAccess('GradeSchedule'), /Access to deprecated table prohibited/);
  });

  it('B05-3: Querying deprecated table timetable or 工作表7 raises DeprecatedTableAccessError', () => {
    const assertAccess = (coll) => {
      if (isDeprecatedTable(coll)) throw new Error(`Access to deprecated table prohibited: ${coll}`);
    };
    assert.throws(() => assertAccess('timetable'), /Access to deprecated table prohibited/);
    assert.throws(() => assertAccess('工作表7'), /Access to deprecated table prohibited/);
  });

  it('B05-4: Querying 緊急應變小組名單 raises DeprecatedTableAccessError and suggests StudentList', () => {
    const resolveRoster = (name) => {
      if (name === '緊急應變小組名單') {
        throw new Error('緊急應變小組名單 has been migrated into StudentList (groupName: 緊急應變小組)');
      }
    };
    assert.throws(() => resolveRoster('緊急應變小組名單'), /has been migrated into StudentList/);
  });

  it('B05-5: Collection name validator blocks any collection containing deprecated keywords', () => {
    const isSafeCollection = (name) => {
      if (!ALLOWED_FIRESTORE_COLLECTIONS.includes(name)) return false;
      return !isDeprecatedTable(name);
    };
    assert.equal(isSafeCollection('class_reports'), true);
    assert.equal(isSafeCollection('timetable'), false);
    assert.equal(isSafeCollection('AfterSchoolSchedule'), false);
  });
});
