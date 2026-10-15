import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROJECT_ID = process.env.VITE_FIREBASE_PROJECT_ID || 'disaster-prevention-syst-7169e';
const API_KEY = process.env.VITE_FIREBASE_API_KEY || 'AIzaSyBsLYXXrxxHIrgCvhgcS09xi9DGOUInfOc';

const BASE_URL = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const COMMIT_URL = `${BASE_URL}:commit?key=${API_KEY}`;

// 將 JavaScript 物件轉換為 Firestore REST API 的 Value 格式
function toFirestoreValue(val) {
  if (val === null || val === undefined) {
    return { nullValue: null };
  }
  if (typeof val === 'boolean') {
    return { booleanValue: val };
  }
  if (typeof val === 'number') {
    if (Number.isInteger(val)) {
      return { integerValue: String(val) };
    }
    return { doubleValue: val };
  }
  if (typeof val === 'string') {
    return { stringValue: val };
  }
  if (Array.isArray(val)) {
    return {
      arrayValue: {
        values: val.map(toFirestoreValue)
      }
    };
  }
  if (typeof val === 'object') {
    const fields = {};
    for (const [k, v] of Object.entries(val)) {
      fields[k] = toFirestoreValue(v);
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(val) };
}

function toFirestoreFields(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) {
    fields[k] = toFirestoreValue(v);
  }
  return fields;
}

async function commitBatch(writes) {
  const res = await fetch(COMMIT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ writes })
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`HTTP ${res.status}: ${errorText}`);
  }
  return res.json();
}

async function main() {
  console.log('='.repeat(78));
  console.log(`🏫 清水國小校園防災系統 — 雲端 Firestore 一鍵極速匯入工具`);
  console.log(`🎯 目標專案：${PROJECT_ID}`);
  console.log('='.repeat(78));

  // 1. 載入資料
  const dataDir = path.join(__dirname, 'data');
  const studentListFile = path.join(dataDir, 'StudentList.json');
  const scheduleConfigFile = path.join(dataDir, 'Config_Schedules.json');

  if (!fs.existsSync(studentListFile)) {
    throw new Error(`找不到檔案: ${studentListFile}`);
  }
  const students = JSON.parse(fs.readFileSync(studentListFile, 'utf8'));
  console.log(`📂 已讀取學生名冊：${students.length} 筆`);

  let schedules = [];
  if (fs.existsSync(scheduleConfigFile)) {
    schedules = JSON.parse(fs.readFileSync(scheduleConfigFile, 'utf8'));
    console.log(`📂 已讀取排程規則：${schedules.length} 筆`);
  }

  // 2. 準備所有寫入清單 (Writes)
  const allWrites = [];

  // A. 系統排程與組態
  allWrites.push({
    update: {
      name: `projects/${PROJECT_ID}/databases/(default)/documents/system_config/schedules`,
      fields: toFirestoreFields({
        rules: schedules,
        updatedAt: new Date().toISOString()
      })
    }
  });

  allWrites.push({
    update: {
      name: `projects/${PROJECT_ID}/databases/(default)/documents/system_config/state`,
      fields: toFirestoreFields({
        securityMode: 'drill',
        simTimeMode: 'auto',
        siteLocked: false,
        approvedCustomTotal: null,
        visitorCounts: { student: 0, teacher: 0, parent: 0, vendor: 0 },
        updatedAt: new Date().toISOString(),
        updatedBy: 'seed-rest'
      })
    }
  });

  allWrites.push({
    update: {
      name: `projects/${PROJECT_ID}/databases/(default)/documents/system_config/version`,
      fields: toFirestoreFields({
        version: 'V20.4',
        deployCode: 204,
        updatedAt: new Date().toISOString()
      })
    }
  });

  // B. 6 大建物安全檢核預設值
  const DEFAULT_BUILDINGS = [
    { id: 'ci_ai', name: '慈愛樓', sortOrder: 1 },
    { id: 'zhi_shan', name: '至善樓', sortOrder: 2 },
    { id: 'wei_yang', name: '維揚樓', sortOrder: 3 },
    { id: 'le_qun', name: '樂群樓', sortOrder: 4 },
    { id: 'hong_de', name: '弘德樓', sortOrder: 5 },
    { id: 'zhong_shan', name: '中山樓', sortOrder: 6 }
  ];

  for (const b of DEFAULT_BUILDINGS) {
    allWrites.push({
      update: {
        name: `projects/${PROJECT_ID}/databases/(default)/documents/buildings/${b.id}`,
        fields: toFirestoreFields({
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
          updatedAt: new Date().toISOString()
        })
      }
    });
  }

  // C. 全校 6637 筆學生名冊
  for (const s of students) {
    const docId = encodeURIComponent(s.id);
    allWrites.push({
      update: {
        name: `projects/${PROJECT_ID}/databases/(default)/documents/students/${docId}`,
        fields: toFirestoreFields({
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
          isActive: s.isActive !== false
        })
      }
    });
  }

  console.log(`📦 總計待寫入文件數：${allWrites.length} 份`);

  // 3. 執行批次寫入 (每批 300 筆，小於 Firestore 限制 500)
  const BATCH_SIZE = 300;
  const totalBatches = Math.ceil(allWrites.length / BATCH_SIZE);
  console.log(`🚀 開始分批寫入 Firestore（共 ${totalBatches} 個批次）...\n`);

  let successCount = 0;
  const startTime = Date.now();

  for (let bIdx = 0; bIdx < totalBatches; bIdx++) {
    const chunk = allWrites.slice(bIdx * BATCH_SIZE, (bIdx + 1) * BATCH_SIZE);
    process.stdout.write(`⏳ 正在寫入批次 [${bIdx + 1}/${totalBatches}] (${chunk.length} 筆)... `);

    try {
      await commitBatch(chunk);
      successCount += chunk.length;
      const pct = ((successCount / allWrites.length) * 100).toFixed(1);
      console.log(`✔ 成功！(累計 ${successCount}/${allWrites.length}，進度: ${pct}%)`);
    } catch (err) {
      console.log(`❌ 失敗！`);
      console.error(`\n🚨 寫入錯誤原因：`, err.message);

      if (err.message.includes('403') || err.message.includes('PERMISSION_DENIED')) {
        console.log('\n' + '='.repeat(78));
        console.log('💡 [權限提示] 您的 Firestore 安全規則目前阻擋了寫入存取。');
        console.log('請前往 Firebase Console ➔ Firestore Database ➔「規則 (Rules)」分頁：');
        console.log('將規則暫時設定為測試模式：');
        console.log(`
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if true;
    }
  }
}
        `);
        console.log('點擊「發布 (Publish)」後，重新執行本腳本即可一鍵完成！');
        console.log('='.repeat(78));
      }
      process.exit(1);
    }

    // 稍微間隔 100ms 避免頻率限制
    await new Promise(r => setTimeout(r, 100));
  }

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('\n' + '='.repeat(78));
  console.log(`🎉 恭喜！全校 ${successCount} 筆名冊與排程資料已全數寫入 Firebase Firestore！`);
  console.log(`⏱️ 總耗時：${durationSec} 秒`);
  console.log('='.repeat(78));
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
