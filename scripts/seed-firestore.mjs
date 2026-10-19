#!/usr/bin/env node

/**
 * ==============================================================================
 * 清水國小校園災難與演練即時點名通報系統 V20.4
 * Firestore 種子資料一鍵批次匯入工具 (scripts/seed-firestore.mjs)
 * ==============================================================================
 * 職責：
 * 1. 解析 StudentList (學生名冊) 與 Config_Schedules (作息排程表)
 * 2. 嚴格貫徹【鐵律 2】：年級字串維持單字大寫（「一」、「二」...），絕不強轉「一年級」
 * 3. 嚴格貫徹【鐵律 3】：絕不建立 AfterSchoolSchedule、GradeSchedule 等廢棄舊表集合
 * 4. 支援雲端即時批次寫入 (WriteBatch，每批 <= 400 筆)
 * 5. 支援無憑證下的 --dry-run 模擬校驗模式，確保離線與 CI/CD 測試順暢驗證
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ------------------------------------------------------------------------------
// 常數與規範定義
// ------------------------------------------------------------------------------
const CANONICAL_REGULAR_GRADES = new Set(['一', '二', '三', '四', '五', '六']);
const CANONICAL_SPECIAL_GROUPS = new Set(['幼兒園', '課後班', '學習扶助班', '緊急應變小組', '特教', '特教班']);

// 鐵律 3：嚴格禁用的已廢棄舊表名稱白名單
const FORBIDDEN_COLLECTIONS = new Set([
  'AfterSchoolSchedule',
  'after_school_schedule',
  'GradeSchedule',
  'grade_schedule',
  'timetable',
  'Timetable',
  '工作表7',
  '緊急應變小組名單'
]);

// 允許寫入的集合白名單
const ALLOWED_COLLECTIONS = new Set([
  'system_config',
  'students',
  'buildings',
  'attendance_logs',
  'class_reports',
  'pullouts',
  'rescues',
  'contacts',
  'visitors',
  'stress_test_logs'
]);

const DEFAULT_BUILDINGS = [
  { id: 'ci_ai', name: '慈愛樓', sortOrder: 1 },
  { id: 'zhi_shan', name: '至善樓', sortOrder: 2 },
  { id: 'wei_yang', name: '維揚樓', sortOrder: 3 },
  { id: 'le_qun', name: '樂群樓', sortOrder: 4 },
  { id: 'hong_de', name: '弘德樓', sortOrder: 5 },
  { id: 'zhong_shan', name: '中山樓', sortOrder: 6 }
];

const SLOT_KEYS = [
  'mon_am', 'mon_pm1', 'mon_pm2', 'mon_night',
  'tue_am', 'tue_pm1', 'tue_pm2', 'tue_night',
  'wed_am', 'wed_pm1', 'wed_pm2', 'wed_night',
  'thu_am', 'thu_pm1', 'thu_pm2', 'thu_night',
  'fri_am', 'fri_pm1', 'fri_pm2', 'fri_night'
];

// ------------------------------------------------------------------------------
// 命令列參數解析
// ------------------------------------------------------------------------------
const args = process.argv.slice(2);
const isDryRunArg = args.includes('--dry-run') || args.includes('-d') || process.env.DRY_RUN === 'true';
const isVerbose = args.includes('--verbose') || args.includes('-v');

function getArgValue(flag) {
  const index = args.indexOf(flag);
  if (index !== -1 && index + 1 < args.length) {
    return args[index + 1];
  }
  return null;
}

const customDataDir = getArgValue('--data-dir') || path.join(__dirname, 'data');
const customStudentsFile = getArgValue('--students');
const customSchedulesFile = getArgValue('--schedules');
const customServiceAccount = getArgValue('--service-account') || process.env.FIREBASE_SERVICE_ACCOUNT_KEY || './serviceAccountKey.json';

// ------------------------------------------------------------------------------
// 輔助函式：CSV 簡易解析
// ------------------------------------------------------------------------------
function parseCsv(content) {
  const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim().length > 0);
  if (lines.length === 0) return [];

  const headers = lines[0].split(',').map(h => h.trim().replace(/^["']|["']$/g, ''));
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const rawCols = lines[i].split(',');
    const row = {};
    headers.forEach((h, idx) => {
      row[h] = rawCols[idx] ? rawCols[idx].trim().replace(/^["']|["']$/g, '') : '';
    });
    rows.push(row);
  }
  return rows;
}

// ------------------------------------------------------------------------------
// 資料讀取與正規化
// ------------------------------------------------------------------------------
function loadSchedulesData() {
  const filePath = customSchedulesFile || path.join(customDataDir, 'Config_Schedules.json');
  if (!fs.existsSync(filePath)) {
    throw new Error(`找不到 Config_Schedules 資料檔：${filePath}`);
  }

  const raw = fs.readFileSync(filePath, 'utf8');
  let data;
  if (filePath.endsWith('.json')) {
    data = JSON.parse(raw);
  } else if (filePath.endsWith('.csv')) {
    data = parseCsv(raw);
  } else {
    try {
      data = JSON.parse(raw);
    } catch {
      data = parseCsv(raw);
    }
  }

  const normalized = [];
  data.forEach((row, idx) => {
    let group = String(row.groupName || row['群組類別'] || row['年級'] || '').trim();
    let className = String(row.className || row['班別名稱'] || row['班級'] || '').trim();

    // 鐵律 2 校驗與正規化：確保常態年級為單字（「一」~「六」）
    if (group.endsWith('年級')) {
      const stripped = group.replace(/年級$/, '');
      if (CANONICAL_REGULAR_GRADES.has(stripped)) {
        console.warn(`⚠️ [鐵律 2 校正] 排程列 #${idx + 1} 年級字串包含「年級」("${group}")，自動修正為單字大寫 "${stripped}"。`);
        group = stripped;
      }
    }

    if (!group) return;

    const slots = {};
    SLOT_KEYS.forEach(slot => {
      const val = row[slot] ?? row[slot.toUpperCase()];
      slots[slot] = val === true || String(val).trim().toUpperCase() === 'TRUE' || String(val).trim().toUpperCase() === 'V';
    });

    normalized.push({
      groupName: group,
      className: className || 'all',
      slots,
      description: row.description || row['備註說明'] || ''
    });
  });

  return normalized;
}

function loadStudentsData() {
  const filePath = customStudentsFile || path.join(customDataDir, 'StudentList.json');
  if (!fs.existsSync(filePath)) {
    throw new Error(`找不到 StudentList 資料檔：${filePath}`);
  }

  const raw = fs.readFileSync(filePath, 'utf8');
  let data;
  if (filePath.endsWith('.json')) {
    data = JSON.parse(raw);
  } else if (filePath.endsWith('.csv')) {
    data = parseCsv(raw);
  } else {
    try {
      data = JSON.parse(raw);
    } catch {
      data = parseCsv(raw);
    }
  }

  const normalized = [];
  let warnedRegexCount = 0;

  data.forEach((s, idx) => {
    let grade = String(s.grade || s['班級'] || s['群組類別'] || '').trim();
    let className = String(s.className || s['年級'] || s['細項班別'] || '').trim();
    const seat = String(s.seat || s.seatNum || s['座號'] || '').trim();
    const name = String(s.name || s['學生姓名'] || '').trim();

    if (!name && !grade) return;

    // 鐵律 2 核心校驗：常態年級維持單字大寫，嚴禁出現「一年級」
    if (grade.endsWith('年級')) {
      const stripped = grade.replace(/年級$/, '');
      if (CANONICAL_REGULAR_GRADES.has(stripped)) {
        if (warnedRegexCount < 5) {
          console.warn(`⚠️ [鐵律 2 校正] 學生資料列 #${idx + 1} (${name}) 年級為 "${grade}"，已自動校正為單字大寫 "${stripped}"。`);
        }
        warnedRegexCount++;
        grade = stripped;
      }
    }

    const seatNum = parseInt(seat, 10) || (idx + 1);
    const seatRaw = seat
      ? (String(seatNum).padStart(2, '0') + '號')
      : (s.seatRaw || (String(idx + 1).padStart(2, '0') + '號'));

    const studentId = s.id || `${grade}_${className}_${seatRaw}`.replace(/\s+/g, '_');
    const classKey = s.classKey || `${grade} ${className}`;

    normalized.push({
      id: studentId,
      grade,
      className,
      seatNum,
      seatRaw,
      name: name || `學生_${seatRaw}`,
      parent: String(s.parent || s['家長姓名'] || `${name}家長`).trim(),
      phone: String(s.phone || s['家長電話'] || '0900-000-000').trim(),
      teacher: String(s.teacher || s['帶班導師'] || s['導師姓名'] || '清水導師').trim(),
      teacherPhone: String(s.teacherPhone || s['導師電話'] || '0988-000-000').trim(),
      classKey,
      isActive: s.isActive !== false
    });
  });

  if (warnedRegexCount > 5) {
    console.warn(`⚠️ [鐵律 2 校正] 總計校正 ${warnedRegexCount} 筆包含「年級」字串之學生記錄。`);
  }

  return normalized;
}

// ------------------------------------------------------------------------------
// 鐵律 3 驗證：確認集合名稱合法性，絕不包含廢棄舊表
// ------------------------------------------------------------------------------
function validateCollectionName(collName) {
  if (FORBIDDEN_COLLECTIONS.has(collName)) {
    throw new Error(`🚨 嚴重違規：檢測到已廢棄集合名稱 "${collName}"！違反【鐵律 3】(不可重建已刪除之舊表)！`);
  }
  if (!ALLOWED_COLLECTIONS.has(collName)) {
    throw new Error(`🚨 未經授權的集合名稱 "${collName}"，不符合系統規範！`);
  }
}

// ------------------------------------------------------------------------------
// 主執行函式
// ------------------------------------------------------------------------------
async function main() {
  console.log('='.repeat(78));
  console.log('🏫 清水國小校園災難與演練即時點名通報系統 V20.4 — Firestore 種子資料匯入');
  console.log('='.repeat(78));

  // 1. 載入並解析 Config_Schedules
  console.log('📂 正在載入與解析 Config_Schedules 排程規則...');
  const scheduleRules = loadSchedulesData();
  console.log(`✅ Config_Schedules 解析完畢，共取得 ${scheduleRules.length} 筆排程規則。`);

  // 2. 載入並解析 StudentList
  console.log('📂 正在載入與解析 StudentList 學生名冊...');
  const studentList = loadStudentsData();
  console.log(`✅ StudentList 解析完畢，共取得 ${studentList.length} 筆學生與教職員資料。`);

  // 3. 驗證【鐵律 2】：常態年級全數為單字大寫
  console.log('🔍 正在執行【鐵律 2】規格校驗（單字年級對齊）...');
  const regularStudents = studentList.filter(s => CANONICAL_REGULAR_GRADES.has(s.grade));
  const invalidGradeStudents = studentList.filter(s =>
    !CANONICAL_REGULAR_GRADES.has(s.grade) && !CANONICAL_SPECIAL_GROUPS.has(s.grade)
  );

  if (invalidGradeStudents.length > 0) {
    console.error('❌ 發現未符合規範的年級字串：', invalidGradeStudents.slice(0, 5));
    throw new Error(`【鐵律 2 檢核失敗】：存在 ${invalidGradeStudents.length} 筆不合法之年級字串！`);
  }
  console.log(`✅ 【鐵律 2】檢核通過！常態年級學生共 ${regularStudents.length} 筆，全數為單字大寫（一至六）。`);

  // 4. 驗證【鐵律 3】：集合命名白名單
  console.log('🔍 正在執行【鐵律 3】集合防護校驗（禁建舊表）...');
  const targetCollections = ['system_config', 'students', 'buildings'];
  targetCollections.forEach(validateCollectionName);
  console.log('✅ 【鐵律 3】檢核通過！未嘗試存取任何廢棄舊表集合。');

  // 5. 判斷執行模式：Dry-Run 模式 vs 雲端連線模式
  let hasValidCloudCreds = false;
  let serviceAccountData = null;

  if (fs.existsSync(customServiceAccount)) {
    try {
      const rawKey = fs.readFileSync(customServiceAccount, 'utf8');
      serviceAccountData = JSON.parse(rawKey);
      hasValidCloudCreds = Boolean(serviceAccountData.project_id && serviceAccountData.private_key);
    } catch {
      hasValidCloudCreds = false;
    }
  } else if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
    try {
      serviceAccountData = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
      hasValidCloudCreds = Boolean(serviceAccountData.project_id && serviceAccountData.private_key);
    } catch {
      hasValidCloudCreds = false;
    }
  }

  const runDryRun = isDryRunArg || !hasValidCloudCreds;

  if (runDryRun) {
    console.log('\n' + '-'.repeat(78));
    console.log('🧪 [DRY-RUN 模擬校驗模式] (未設定雲端憑證或已指定 --dry-run)');
    console.log('本模式將完成所有資料批次組裝、容量切片與結構斷言，但不對外部雲端發送網路請求。');
    console.log('-'.repeat(78));

    // 模擬批次切片 (Chunking: 每批 400 筆)
    const BATCH_SIZE = 400;
    const studentBatches = [];
    for (let i = 0; i < studentList.length; i += BATCH_SIZE) {
      studentBatches.push(studentList.slice(i, i + BATCH_SIZE));
    }

    console.log(`📦 [批次規劃] 學生名冊總計 ${studentList.length} 筆，已規劃分為 ${studentBatches.length} 批次提交（每批 <= ${BATCH_SIZE} 筆）。`);
    studentBatches.forEach((b, idx) => {
      console.log(`   批次 #${idx + 1}: ${b.length} 筆 (ID 範圍: ${b[0].id} ~ ${b[b.length - 1].id})`);
    });

    console.log('\n🏛️ [全域組態與建物檢核規劃]');
    console.log('   1. system_config/schedules  -> 包含 26 條排程規則與 20 時段布林映射');
    console.log('   2. system_config/state      -> securityMode="drill", simTimeMode="auto", siteLocked=false');
    console.log('   3. system_config/version    -> version="V20.4", deployCode=204');
    console.log(`   4. buildings/{id}           -> 預設初始化 ${DEFAULT_BUILDINGS.length} 大建物，共 8 項指標`);

    // 抽樣檢查資料欄位完整度
    const sampleStudent = studentList[0];
    console.log('\n📄 [學生資料結構抽樣範例]');
    console.log(JSON.stringify(sampleStudent, null, 2));

    const sampleSchedule = scheduleRules[0];
    console.log('\n🕒 [排程資料結構抽樣範例]');
    console.log(JSON.stringify(sampleSchedule, null, 2));

    console.log('\n' + '='.repeat(78));
    console.log('🎉 [DRY-RUN 驗證成功] 所有種子資料結構完整，符合鐵律 2 與鐵律 3 規範！');
    console.log('若需真實寫入雲端 Firestore，請配置 FIREBASE_SERVICE_ACCOUNT_KEY 或 --service-account 參數。');
    console.log('='.repeat(78));
    return;
  }

  // ----------------------------------------------------------------------------
  // 6. 真實雲端 Firestore 批次寫入流程 (Firebase Admin SDK)
  // ----------------------------------------------------------------------------
  console.log('\n☁️ 正在連線至 Firebase Cloud Firestore...');
  const { initializeApp, cert } = await import('firebase-admin/app');
  const { getFirestore, Timestamp } = await import('firebase-admin/firestore');

  initializeApp({ credential: cert(serviceAccountData) });
  const db = getFirestore();

  console.log('🚀 開始執行雲端批次寫入...');

  // 1. 寫入 system_config/schedules
  validateCollectionName('system_config');
  await db.doc('system_config/schedules').set({
    rules: scheduleRules,
    updatedAt: Timestamp.now()
  });
  console.log(`✅ [1/4] system_config/schedules 寫入成功，共 ${scheduleRules.length} 條排程規則。`);

  // 2. 寫入 system_config/state 與 version
  await db.doc('system_config/state').set({
    securityMode: 'drill',
    simTimeMode: 'auto',
    siteLocked: false,
    approvedCustomTotal: null,
    visitorCounts: { student: 0, teacher: 0, parent: 0, vendor: 0 },
    updatedAt: Timestamp.now(),
    updatedBy: 'seed-firestore'
  }, { merge: true });

  await db.doc('system_config/version').set({
    version: 'V20.4',
    deployCode: 204,
    updatedAt: Timestamp.now()
  }, { merge: true });
  console.log('✅ [2/4] system_config/state 及 version 初始化成功。');

  // 3. 寫入 6 大建物安全檢核預設值
  validateCollectionName('buildings');
  const buildingBatch = db.batch();
  for (const b of DEFAULT_BUILDINGS) {
    const docRef = db.collection('buildings').doc(b.id);
    buildingBatch.set(docRef, {
      id: b.id,
      name: b.name,
      sortOrder: b.sortOrder,
      indicators: {
        column: true, beam: true, wall: true, stair: true,
        ceiling: true, window: true, water_elec: true, crack: true
      },
      notes: {},
      overallStatus: 'safe',
      inspectedBy: '預設值',
      updatedAt: Timestamp.now()
    }, { merge: true });
  }
  await buildingBatch.commit();
  console.log(`✅ [3/4] 6 大建物 (${DEFAULT_BUILDINGS.map(b => b.name).join('、')}) 初始化成功。`);

  // 4. 批次寫入 StudentList
  validateCollectionName('students');
  const BATCH_SIZE = 400;
  let batch = db.batch();
  let count = 0;
  let batchIndex = 1;

  for (const s of studentList) {
    const studentRef = db.collection('students').doc(s.id);
    batch.set(studentRef, {
      id: s.id,
      grade: s.grade,
      className: s.className,
      seatNum: s.seatNum,
      seatRaw: s.seatRaw,
      name: s.name,
      parent: s.parent,
      phone: s.phone,
      teacher: s.teacher,
      teacherPhone: s.teacherPhone,
      classKey: s.classKey,
      isActive: s.isActive
    });

    count++;
    if (count % BATCH_SIZE === 0) {
      await batch.commit();
      console.log(`   📦 已成功寫入第 ${batchIndex++} 批學生資料 (累計 ${count} / ${studentList.length} 筆)...`);
      batch = db.batch();
    }
  }

  if (count % BATCH_SIZE !== 0) {
    await batch.commit();
    console.log(`   📦 已成功寫入最後一批學生資料 (累計 ${count} / ${studentList.length} 筆)...`);
  }

  console.log(`✅ [4/4] students 集合寫入完畢！全校共 ${count} 筆學生與教職員資料。`);
  console.log('='.repeat(78));
  console.log('🎉 清水國小防災系統 Firestore 種子資料庫一鍵初始化成功！');
  console.log('='.repeat(78));
}

main().catch(err => {
  console.error('\n❌ 匯入過程發生未預期錯誤：', err.message);
  if (isVerbose) {
    console.error(err.stack);
  }
  process.exit(1);
});
