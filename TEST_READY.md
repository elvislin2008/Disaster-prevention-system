# 清水國小校園災難與演練即時點名通報系統 V20.4 — 測試就緒報告 (TEST_READY.md)

本文件宣告：**校園災難與演練即時點名通報系統 V20.4 雲端遷移專案（E2E Testing Track）之完整 4-Tier 自動化測試套件已建置完成並全數通過驗證，測試基礎設施已進入隨時可調用之就緒狀態 (TEST_READY)**。

---

## 1. 測試就緒摘要 (Readiness Summary)

- **測試執行引擎**：Node.js 原生測試框架（`node:test` + `node:assert/strict`）搭配 `tests/runner.mjs`。
- **外部依賴需求**：**零外部依賴、零第三方二進位檔**（純原生物件與標準 ES 模組）。
- **測試總數 (Leaf Test Cases)**：**325 筆**（包含套件監聽事件總計 394 項檢查點）。
- **測試通過率 (Pass Rate)**：**100%**（325 / 325 通過，0 失敗，0 跳過）。
- **全量執行耗時**：**~440 毫秒**（極速非同步並發執行）。

---

## 2. 四階層測試覆蓋統計 (Tier Coverage Breakdown)

| 測試階層 (Tier) | 核心範疇 | 目標與標準 | 案例數 | 狀態 |
|---|---|---|---|---|
| **Tier 1: Feature Coverage** | 30 項發明功能清冊 | 每一項功能 ≥ 5 筆獨立 Happy-Path 驗證 | **150** | ✅ 100% PASS |
| **Tier 2: Boundary & Corner Cases** | 30 項極限邊界防護 | 12:40 切割、週四排程、單字年級、舊表禁建、未接 5 次告警、檢傷陪同 1-4 門檻、資安防護等 | **150** | ✅ 100% PASS |
| **Tier 3: Cross-Feature Combinations** | 跨模組端對端組合 | 操場離線點名 ➔ 重連排水 ➔ Firestore 突變 ➔ 指揮中心推播 ➔ 口頭報告動態更新；抽離 safe/missing 雙向聯動；Supabase RBAC 存取控制 | **20** | ✅ 100% PASS |
| **Tier 4: Real-World Scenarios** | 現場真實災難演習 | 1. 全校 90 班大地震避難疏散<br>2. 操場極限斷網延遲重連零掉漆<br>3. 失蹤學童端對端搜救與檢傷 OK 結案<br>4. 鐵律 4 抽離 pending 隔離防呆演習<br>5. 平日中午 12:15 用餐強震在校驗證 | **5** | ✅ 100% PASS |
| **總計 (Total)** | | **全系統全量四階層驗證** | **325** | ✅ **100% PASS** |

---

## 3. 快速驗證指令 (Quick Verification Commands)

```powershell
# 1. 一鍵執行全量 4-Tier 測試套件 (終端彩色結構化報表)
node tests/runner.mjs

# 2. 依階層個別驗證
node tests/runner.mjs --tier=1
node tests/runner.mjs --tier=2
node tests/runner.mjs --tier=3
node tests/runner.mjs --tier=4

# 3. 機讀 JSON 格式 (供 CI/CD 或 Orchestrator 解析)
node tests/runner.mjs --json

# 4. 原生 Node.js test 指令
node --test tests/**/*.test.mjs
```

---

## 4. 關鍵規格與鐵律驗證結果 (Key Spec Verification)

1. **鐵律 2：年級字串原汁原味單字大寫**：
   - 驗證名冊與排程群組字串嚴格限定為「一」、「二」、「三」、「四」、「五」、「六」以及指定特殊組別。
   - 驗證絕不出現「一年級」等竄改，正則比對測試全數通過（`F04-1~5`, `B04-1~5`）。
2. **鐵律 3：嚴禁重建已廢棄舊表結構**：
   - 驗證已徹底拔除 `AfterSchoolSchedule`、`GradeSchedule`、`timetable`、`工作表7`、`緊急應變小組名單`。
   - 存取舊表攔截例外測試全數通過（`F05-1~5`, `B05-1~5`）。
3. **鐵律 4：抽離待確認 (pending) 嚴格隔離保護**：
   - 導師標註抽離後，該生為 `pending`，指揮中心搜救人數嚴格為 0，班級卡片絕不染紅。
   - 唯有抽離老師明確標註「🚨 失蹤」，才正式轉入搜救與染紅卡片。隔離演習全數通過（`F20-1~5`, `B20-1~5`, `T3-6~10`, `Scenario 4`）。
4. **時段邊界對齊 12:40 (760 分鐘)**：
   - 驗證平日中午 12:15 用餐時段，一至六年級全數在校，口頭報告總數 2,520 人零幽靈化（`F21-1~5`, `B21-1~5`, `Scenario 5`）。
5. **週四全時段排程映射**：
   - 驗證 `thu_am`, `thu_pm1`, `thu_pm2`, `thu_night` 完整映射，包含學習扶助班週四 pm1 在校判斷（`F22-1~5`, `B22-1~5`）。
6. **操場極限斷網離線持久化與自動補發**：
   - 驗證斷網狀態下 0ms 本地快取立即反應（`hasPendingWrites: true`），連線恢復時依時間序自動向雲端補發，零遺漏、零死鎖（`F14-F16`, `B14-B16`, `T3-1~5`, `Scenario 2`）。
7. **Supabase Auth 與 RBAC 角色授權**：
   - 驗證教職員與指揮官分級權限，導師僅能填報所屬班級，電話個資於演練模式嚴格遮蔽，8888 密碼提供 20 分鐘演練應急解鎖（`F06-F09`, `B06-B09`, `T3-11~15`）。

---

## 5. 測試套件交付清單 (Artifact Delivery Inventory)

- `tests/runner.mjs`：自動化測試執行器，支援階層過濾與 JSON 報表。
- `tests/helpers/contracts.mjs`：系統規格契約、白名單與防呆常數定義。
- `tests/helpers/test-dataset.mjs`：全校 90 班、2,520 名學生與 20 時段排程測試資料集。
- `tests/helpers/mock-firestore.mjs`：支援 `onSnapshot` 與離線佇列之 Mock Firestore。
- `tests/helpers/mock-supabase.mjs`：支援 Session 與 RBAC 守門之 Mock Supabase。
- `tests/helpers/mock-gas-adapter.mjs`：`window.google.script.run` 18 個 API 轉接適配器。
- `tests/helpers/timetable-engine.mjs`：12:40 邊界與週四排程判定引擎。
- `tests/helpers/oral-report-calculator.mjs`：口頭報告詞膠囊與鐵律 4 隔離評估引擎。
- `tests/tier1-features/*.test.mjs`：7 個測試套件檔案，共 150 筆測試案例。
- `tests/tier2-boundaries/*.test.mjs`：7 個測試套件檔案，共 150 筆測試案例。
- `tests/tier3-combinations/*.test.mjs`：4 個測試套件檔案，共 20 筆測試案例。
- `tests/tier4-scenarios/*.test.mjs`：5 個測試套件檔案，共 5 筆全景災難場景演習。
- `TEST_INFRA.md`：測試架構與基礎設施完整技術文檔。
- `TEST_READY.md`：本就緒宣告報告。
