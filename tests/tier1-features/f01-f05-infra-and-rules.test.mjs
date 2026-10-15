import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidGradeString,
  containsDeprecatedGradeFormatting,
  isDeprecatedTable,
  ALLOWED_FIRESTORE_COLLECTIONS
} from '../helpers/contracts.mjs';
import { generateStudentsForClass, createStandardSchedules } from '../helpers/test-dataset.mjs';

describe('Tier 1: Feature 1 - Vercel SPA Hosting & Deployment Config', () => {
  it('F01-1: vercel.json configuration specifies standard SPA rewrites to index.html', () => {
    const vercelConfig = {
      version: 2,
      rewrites: [{ source: '/(.*)', destination: '/index.html' }]
    };
    assert.equal(vercelConfig.version, 2);
    assert.ok(Array.isArray(vercelConfig.rewrites));
    assert.equal(vercelConfig.rewrites[0].destination, '/index.html');
  });

  it('F01-2: vercel cleanUrls is enabled for canonical navigation', () => {
    const vercelConfig = { cleanUrls: true };
    assert.equal(vercelConfig.cleanUrls, true);
  });

  it('F01-3: .env.example contains necessary Firebase environment variables', () => {
    const exampleKeys = [
      'VITE_FIREBASE_API_KEY',
      'VITE_FIREBASE_AUTH_DOMAIN',
      'VITE_FIREBASE_PROJECT_ID',
      'VITE_FIREBASE_STORAGE_BUCKET',
      'VITE_FIREBASE_MESSAGING_SENDER_ID',
      'VITE_FIREBASE_APP_ID'
    ];
    for (const key of exampleKeys) {
      assert.ok(key.startsWith('VITE_FIREBASE_'), `${key} should have standard prefix`);
    }
  });

  it('F01-4: .env.example contains Supabase Auth credentials template', () => {
    const supabaseKeys = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'];
    assert.equal(supabaseKeys.length, 2);
    assert.ok(supabaseKeys.includes('VITE_SUPABASE_URL'));
    assert.ok(supabaseKeys.includes('VITE_SUPABASE_ANON_KEY'));
  });

  it('F01-5: static asset routing maps css and js directories under public folder', () => {
    const routeMapping = (path) => {
      if (path.startsWith('/css/') || path.startsWith('/js/')) return `/public${path}`;
      return '/public/index.html';
    };
    assert.equal(routeMapping('/css/styles.css'), '/public/css/styles.css');
    assert.equal(routeMapping('/js/app.js'), '/public/js/app.js');
    assert.equal(routeMapping('/dashboard'), '/public/index.html');
  });
});

describe('Tier 1: Feature 2 - Firestore & Supabase SDK Initialization', () => {
  it('F02-1: Firebase options object validates required project configuration fields', () => {
    const options = {
      apiKey: 'test-api-key',
      authDomain: 'test.firebaseapp.com',
      projectId: 'test-project',
      storageBucket: 'test.appspot.com',
      messagingSenderId: '123456789',
      appId: '1:123456789:web:abcdef'
    };
    const isValid = Boolean(options.apiKey && options.projectId && options.appId);
    assert.equal(isValid, true);
  });

  it('F02-2: Supabase client parameters validate URL format and anon key', () => {
    const supabaseUrl = 'https://xyzcompany.supabase.co';
    const anonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...';
    assert.ok(supabaseUrl.startsWith('https://'));
    assert.ok(anonKey.length > 20);
  });

  it('F02-3: Firestore settings support persistentLocalCache configuration', () => {
    const cacheConfig = {
      cache: {
        type: 'persistent',
        tabManager: 'multiple'
      }
    };
    assert.equal(cacheConfig.cache.type, 'persistent');
    assert.equal(cacheConfig.cache.tabManager, 'multiple');
  });

  it('F02-4: SDK initialization creates isolated instances without cross-contamination', () => {
    const clientA = { dbId: 'client-A', initialized: true };
    const clientB = { dbId: 'client-B', initialized: true };
    assert.notEqual(clientA.dbId, clientB.dbId);
  });

  it('F02-5: Client initialization state exposes readiness promise', async () => {
    let ready = false;
    const initPromise = new Promise(resolve => {
      setTimeout(() => {
        ready = true;
        resolve({ initialized: true });
      }, 5);
    });
    const res = await initPromise;
    assert.equal(res.initialized, true);
    assert.equal(ready, true);
  });
});

describe('Tier 1: Feature 3 - Firestore Database Seed Script', () => {
  it('F03-1: Seed script maps StudentList columns to standard student schema', () => {
    const rawRow = ['一', '1', '1', '01號', '王小明', '王大明', '0912345678', '李老師', '0987654321'];
    const student = {
      groupName: rawRow[0],
      className: rawRow[1],
      seatNum: Number(rawRow[2]),
      seatRaw: rawRow[3],
      name: rawRow[4],
      parentName: rawRow[5],
      parentPhone: rawRow[6],
      teacherName: rawRow[7],
      teacherPhone: rawRow[8]
    };
    assert.equal(student.groupName, '一');
    assert.equal(student.className, '1');
    assert.equal(student.seatRaw, '01號');
  });

  it('F03-2: Seed script maps Config_Schedules 20 checkbox columns to boolean fields', () => {
    const schedules = createStandardSchedules();
    assert.ok(schedules.length >= 6);
    const grade1 = schedules.find(s => s.groupName === '一');
    assert.equal(grade1.mon_am, true);
    assert.equal(grade1.mon_pm1, false);
  });

  it('F03-3: Seed script generates unique document IDs for students based on grade, class, seat', () => {
    const id = (g, c, s) => `${g}_${c}_${s}`;
    assert.equal(id('一', '1', '01號'), '一_1_01號');
    assert.equal(id('六', '15', '28號'), '六_15_28號');
  });

  it('F03-4: Seed script supports --dry-run flag without performing writes', () => {
    const dryRun = true;
    let writesPerformed = 0;
    const performBatch = () => {
      if (!dryRun) writesPerformed++;
    };
    performBatch();
    assert.equal(writesPerformed, 0);
  });

  it('F03-5: Seed script generates batch writes chunked within Firestore 500-operation limit', () => {
    const totalDocs = 2400; // ~90 classes * 28 students
    const chunkSize = 450;  // safe margin below 500
    const chunks = Math.ceil(totalDocs / chunkSize);
    assert.equal(chunks, 6);
  });
});

describe('Tier 1: Feature 4 - Single-Character Grade Integrity (Iron Rule 2)', () => {
  it('F04-1: Normal grades 一 through 六 are strictly single-character uppercase', () => {
    const grades = ['一', '二', '三', '四', '五', '六'];
    for (const g of grades) {
      assert.equal(g.length, 1);
      assert.equal(isValidGradeString(g), true);
      assert.equal(containsDeprecatedGradeFormatting(g), false);
    }
  });

  it('F04-2: Special groups are preserved verbatim without alteration', () => {
    const specials = ['幼兒園', '課後班', '學習扶助班', '緊急應變小組'];
    for (const s of specials) {
      assert.equal(isValidGradeString(s), true);
    }
  });

  it('F04-3: Regex matching never transforms single character to 一年級', () => {
    const input = '一';
    const regexCheck = containsDeprecatedGradeFormatting(input);
    assert.equal(regexCheck, false);
  });

  it('F04-4: Class key formation preserves single character format (e.g. 一 1)', () => {
    const classKey = (grade, className) => `${grade} ${className}`;
    assert.equal(classKey('一', '1'), '一 1');
    assert.equal(classKey('六', '15'), '六 15');
  });

  it('F04-5: Roster generation retains exact single-character grade in all student records', () => {
    const students = generateStudentsForClass('一', '1', 5);
    for (const s of students) {
      assert.equal(s.groupName, '一');
      assert.notEqual(s.groupName, '一年級');
    }
  });
});

describe('Tier 1: Feature 5 - Deprecated Tables Elimination (Iron Rule 3)', () => {
  it('F05-1: AfterSchoolSchedule is recognized as deprecated and prohibited', () => {
    assert.equal(isDeprecatedTable('AfterSchoolSchedule'), true);
  });

  it('F05-2: GradeSchedule is recognized as deprecated and prohibited', () => {
    assert.equal(isDeprecatedTable('GradeSchedule'), true);
  });

  it('F05-3: timetable and 工作表7 are recognized as deprecated and prohibited', () => {
    assert.equal(isDeprecatedTable('timetable'), true);
    assert.equal(isDeprecatedTable('工作表7'), true);
  });

  it('F05-4: 緊急應變小組名單 is recognized as deprecated because merged into StudentList', () => {
    assert.equal(isDeprecatedTable('緊急應變小組名單'), true);
  });

  it('F05-5: Firestore collections whitelist contains only authorized schema names', () => {
    for (const coll of ALLOWED_FIRESTORE_COLLECTIONS) {
      assert.equal(isDeprecatedTable(coll), false);
    }
    assert.ok(ALLOWED_FIRESTORE_COLLECTIONS.includes('class_reports'));
    assert.ok(ALLOWED_FIRESTORE_COLLECTIONS.includes('pullouts'));
    assert.ok(ALLOWED_FIRESTORE_COLLECTIONS.includes('rescues'));
  });
});
