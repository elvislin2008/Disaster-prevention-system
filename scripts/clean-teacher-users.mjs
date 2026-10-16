/**
 * ==============================================================================
 * 清水國小校園災難與演練即時點名通報系統 V20.4
 * 清理 Firestore 中 180 筆導師帳號 (導師無需登入，直接點名)
 * 僅保留總指揮官等核心管理權限
 * ==============================================================================
 */

const PROJECT_ID = process.env.VITE_FIREBASE_PROJECT_ID || 'disaster-prevention-syst-7169e';
const API_KEY = process.env.VITE_FIREBASE_API_KEY || 'AIzaSyBsLYXXrxxHIrgCvhgcS09xi9DGOUInfOc';

const BASE_URL = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const COMMIT_URL = `${BASE_URL}:commit?key=${API_KEY}`;

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
  console.log(`🧹 清水國小校園防災系統 — 清理導師帳號 (導師免登入直接點名)`);
  console.log(`🎯 目標專案：${PROJECT_ID}`);
  console.log('='.repeat(75));

  const deletes = [];

  // 清除 6 個年級各 30 班的 teacherX_Y 文件
  for (let g = 1; g <= 6; g++) {
    for (let c = 1; c <= 30; c++) {
      const email = `teacher${g}_${c}@qs.edu.tw`;
      // 同時刪除 unencoded 與 encoded 形式
      deletes.push({
        delete: `projects/${PROJECT_ID}/databases/(default)/documents/users/${email}`
      });
      deletes.push({
        delete: `projects/${PROJECT_ID}/databases/(default)/documents/users/${encodeURIComponent(email)}`
      });
    }
  }

  console.log(`🗑️ 準備刪除 ${deletes.length / 2} 位導師文件...`);

  const BATCH_SIZE = 400;
  for (let i = 0; i < deletes.length; i += BATCH_SIZE) {
    const chunk = deletes.slice(i, i + BATCH_SIZE);
    console.log(`🚀 正在批次刪除第 ${i + 1} ~ ${i + chunk.length} 筆...`);
    await commitBatch(chunk);
  }

  console.log('='.repeat(75));
  console.log(`✅ 成功！已從 Firestore 移除所有導師帳號！`);
  console.log(`📌 現狀：導師完全無需登入、無需帳號密碼，打開網頁選班級即可 0 門檻直接點名！`);
  console.log(`🔐 僅「指揮中心」嚴格由總指揮官 (poyilin59@gmail.com) 密碼防護！`);
  console.log('='.repeat(75));
}

main().catch(err => {
  console.error('❌ 刪除失敗：', err);
  process.exit(1);
});
