# 🏫 清水國小校園災難與演練即時點名通報系統 (V20.4 / V21.0)
> **新北市土城區清水國小校園緊急疏散、點名追蹤、抽離安全確認、危難檢傷與指揮中心彙整系統**

本系統專為校園強震等災難疏散情境設計，由原先 Google Apps Script (GAS) 架構全面升級為 **Vercel 前端託管 + Firebase Cloud Firestore 即時資料庫 + Supabase Auth 帳號權限管理**，100% 保留全校教職員熟悉的既有操作手感與 UI/UX 視覺佈局。

---

## 🌟 核心特色與架構優勢

1. **100% 保持既有 UI/UX 視覺與操作**：
   - 完全沿用導覽列、四大看板卡片佈局、三套動態背景主題、7 階點名按鈕循環。
   - 保留未接 5 次紅燈告警、檢傷黃紅卡陪同人數強制檢驗、操場雙層選單。
2. **毫秒級即時伺服器推播（Firebase Cloud Firestore）**：
   - 徹底終結舊版 3.5s~15s 之定時輪詢開銷。
   - 採用 `onSnapshot` 事件驅動雙向推播，導師點名變更在 **< 100ms** 內即時同步至指揮中心與抽離看板。
3. **操場極限斷網離線可用（Offline-First with IndexedDB）**：
   - 本地專屬 IndexedDB 快取資料庫 `qs_disaster_offline_v1`。
   - 操場無訊號時 **0ms 樂觀響應**，點名照常進行；連線恢復時依 FIFO 變更佇列自動排空同步至雲端。
4. **教職員身分與角色分級（Supabase Auth & RBAC）**：
   - 支援教職員帳號密碼登入、自動鎖定所屬班級。
   - 支援 6 種 RBAC 角色矩陣（指揮官、導師、抽離教師、檢傷救護、建物巡檢、訪客登記）。
   - 保留極端演練 `8888` 快速降級通行密碼。
5. **嚴格落實規格書四大鐵律**：
   - **鐵律 1**：乾淨標準之 Vercel 前端工程結構。
   - **鐵律 2**：年級字串維持單字大寫（「一」、「二」...），絕不強轉為「一年級」。
   - **鐵律 3**：嚴禁重建已廢棄舊表結構。
   - **鐵律 4**：抽離待確認（`pending`）狀態嚴格隔離，**搜救人數為 0 且卡片絕不染紅**。
   - **午餐時段校準**：平日上午時段截止對齊至 **12:40**（08:00~12:40），補齊週四全時段代碼映射。

---

## 📁 專案目錄結構

```
防災系統/
├── public/                       # Vercel 靜態發布目錄 (SPA)
│   ├── index.html                # 前端主頁面 (100% UI/UX 保真)
│   ├── css/
│   │   └── styles.css            # 完整樣式表 (含 3 套主題與響應式斷點)
│   └── js/
│       ├── app.js                # 核心應用程式邏輯 (四看板、時段判定、業務閉環)
│       ├── config.js             # 雲端服務設定封裝 (Firebase + Supabase)
│       ├── firestore-service.js  # Firestore 資料存取與 onSnapshot 監聽
│       ├── gas-bridge-adapter.js # GAS 橋接轉接器 (轉接 18 個後端函式)
│       ├── offline-manager.js    # IndexedDB 操場斷網離線持久化與同步佇列
│       └── supabase-auth.js      # Supabase Auth 帳號會話與 RBAC 權限管理
├── scripts/
│   └── seed-firestore.mjs        # 學生名冊 (2487人) 與作息規則 (26條) 一鍵匯入腳本
├── tests/                        # 325+ 項 Tier 1~4 全自動化測試套件
├── vercel.json                   # Vercel 路由轉發與安全性 HTTP 標頭設定
├── package.json                  # 專案相依性設定
└── .env.example                  # 環境變數設定範本
```

---

## 🚀 部署至 Vercel 步驟指引

### 步驟 1：建立 Firebase 專案與 Firestore
1. 前往 [Firebase Console](https://console.firebase.google.com/) 新增專案。
2. 建立 **Cloud Firestore**（先選擇 Production 模式）。
3. 在專案設定中新增 Web 應用程式，複製 Firebase SDK 設定（`apiKey`, `projectId`, `appId` 等）。

### 步驟 2：建立 Supabase 專案 (帳號管理)
1. 前往 [Supabase Dashboard](https://supabase.com/dashboard) 新增專案。
2. 進入 **Project Settings ➔ API**，複製 `Project URL` 與 `anon public key`。

### 步驟 3：在 Vercel 導入 GitHub 儲存庫
1. 登入 [Vercel](https://vercel.com/)，點擊 **Add New ➔ Project**。
2. 選擇連接您的 GitHub 儲存庫：`Disaster-prevention-system`。
3. 在 **Environment Variables**（環境變數）中新增以下變數（參考 `.env.example`）：
   - `VITE_FIREBASE_API_KEY`
   - `VITE_FIREBASE_AUTH_DOMAIN`
   - `VITE_FIREBASE_PROJECT_ID`
   - `VITE_FIREBASE_STORAGE_BUCKET`
   - `VITE_FIREBASE_MESSAGING_SENDER_ID`
   - `VITE_FIREBASE_APP_ID`
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `DRILL_DEFAULT_PASSWORD`（預設為 `8888`）
4. 點擊 **Deploy**，Vercel 將自動在幾秒內完成部署並生成正式網址！

---

## 🛠️ 本地開發與資料庫種子匯入

### 1. 安裝相依套件
```bash
npm install
```

### 2. 測試名冊種子資料（乾跑驗證）
```bash
npm run seed:dry-run
```
> 將精確驗證並解析 2,487 筆學生名冊與 26 筆作息規則。

### 3. 正式匯入名冊至 Firestore
取得 Firebase Admin Service Account Key 並放置於專案根目錄，執行：
```bash
npm run seed:firestore
```

### 4. 執行自動化測試套件
```bash
node tests/runner.mjs
```
> 將在 ~450ms 內極速跑完 325 項功能、邊界與全真避難演練情境測試。
