/**
 * ==============================================================================
 * 清水國小校園災難與演練即時點名通報系統 V20.4
 * 教職員帳號權限 (users 集合) 一鍵寫入 Firestore 工具
 * ==============================================================================
 */

const PROJECT_ID = process.env.VITE_FIREBASE_PROJECT_ID || 'disaster-prevention-syst-7169e';
const API_KEY = process.env.VITE_FIREBASE_API_KEY || 'AIzaSyBsLYXXrxxHIrgCvhgcS09xi9DGOUInfOc';

const BASE_URL = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const COMMIT_URL = `${BASE_URL}:commit?key=${API_KEY}`;

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
  console.log('='.repeat(75));
  console.log(`👥 清水國小校園防災系統 — 教職員權限名冊 (users) 一鍵寫入 Firestore`);
  console.log(`🎯 目標專案：${PROJECT_ID}`);
  console.log('='.repeat(75));

  const users = [
    // 1. 總指揮官
    {
      email: 'poyilin59@gmail.com',
      name: '林總指揮官',
      role: 'commander',
      assignedGrade: '',
      assignedClass: '',
      title: '防災應變總指揮官'
    },
    {
      email: 'commander@qs.edu.tw',
      name: '校長 (總指揮官)',
      role: 'commander',
      assignedGrade: '',
      assignedClass: '',
      title: '總指揮官'
    },
    // 2. 專責職能組
    {
      email: 'pullout@qs.edu.tw',
      name: '特教組長 (抽離教師)',
      role: 'pullout_teacher',
      assignedGrade: '',
      assignedClass: '',
      title: '抽離專責確認教師'
    },
    {
      email: 'medical@qs.edu.tw',
      name: '健康中心護理師 (緊急救護)',
      role: 'medical',
      assignedGrade: '',
      assignedClass: '',
      title: '緊急救護檢傷官'
    },
    {
      email: 'inspector@qs.edu.tw',
      name: '總務主任 (建物巡檢)',
      role: 'inspector',
      assignedGrade: '',
      assignedClass: '',
      title: '建物安全巡檢組長'
    },
    {
      email: 'visitor@qs.edu.tw',
      name: '警衛室組員 (訪客登記)',
      role: 'visitor_manager',
      assignedGrade: '',
      assignedClass: '',
      title: '校外外來人員登記組'
    }
  ];

  // 3. 各年級導師 (6 個年級，各 30 班，共 180 位班級導師)
  const gradeChars = ['一', '二', '三', '四', '五', '六'];
  for (let gIdx = 0; gIdx < 6; gIdx++) {
    const gradeNum = gIdx + 1;
    const gradeChar = gradeChars[gIdx];

    for (let c = 1; c <= 30; c++) {
      users.push({
        email: `teacher${gradeNum}_${c}@qs.edu.tw`,
        name: `${gradeChar}年${c}班導師`,
        role: 'teacher',
        assignedGrade: gradeChar,
        assignedClass: String(c),
        title: `${gradeChar}年${c}班導師`
      });
    }
  }

  console.log(`📋 準備寫入 ${users.length} 位教職員之權限設定檔...`);

  const writes = users.map(user => {
    return {
      update: {
        name: `projects/${PROJECT_ID}/databases/(default)/documents/users/${user.email}`,
        fields: toFirestoreFields({
          email: user.email,
          name: user.name,
          role: user.role,
          assignedGrade: user.assignedGrade,
          assignedClass: user.assignedClass,
          title: user.title,
          updatedAt: Date.now()
        })
      }
    };
  });

  // 每批最多 400 筆 (Firestore REST API 上限 500)
  const BATCH_SIZE = 400;
  for (let i = 0; i < writes.length; i += BATCH_SIZE) {
    const chunk = writes.slice(i, i + BATCH_SIZE);
    console.log(`🚀 正在寫入第 ${i + 1} ~ ${i + chunk.length} 筆資料至 users 集合...`);
    await commitBatch(chunk);
  }

  console.log('='.repeat(75));
  console.log(`✅ 成功！已將 ${users.length} 筆教職員權限設定檔完整寫入 Firestore「users」集合！`);
  console.log(`\n權限摘要：`);
  console.log(`  - 總指揮官 (commander) : poyilin59@gmail.com, commander@qs.edu.tw`);
  console.log(`  - 抽離教師 (pullout)   : pullout@qs.edu.tw`);
  console.log(`  - 緊急救護 (medical)   : medical@qs.edu.tw`);
  console.log(`  - 建物巡檢 (inspector) : inspector@qs.edu.tw`);
  console.log(`  - 訪客登記 (visitor)   : visitor@qs.edu.tw`);
  console.log(`  - 班級導師 (180 班)    : teacher1_1@qs.edu.tw ~ teacher6_30@qs.edu.tw (一 1 ~ 六 30)`);
  console.log('='.repeat(75));
}

main().catch(err => {
  console.error('❌ 寫入失敗：', err);
  process.exit(1);
});
