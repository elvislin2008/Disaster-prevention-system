/**
 * ==============================================================================
 * 清水國小校園災難與演練即時點名通報系統 V20.4
 * 端對端即時同步、操場離線佇列與 UI 權限整合測試 (tests/unit/realtime-integration.test.mjs)
 * ==============================================================================
 * 
 * 本測試套件針對 Reviewer 1 審查意見 (Findings 1, 2, 3, 4) 建立高強度整合測試：
 * 1. [Finding 1 & 3] 徹底消除測試孤島，將 gasBridgeAdapter.initRealtimeSync 直連 app.js:syncRemoteState，
 *    驗證細粒度增量推播 (class_reports, pullouts, rescues, contacts, visitors, buildings, system_state)
 *    絕不洗白或清空現有各狀態字典。
 * 2. [Finding 2] 驗證操場極限離線時點名寫入鏈路直通 OfflineManager，於 IndexedDB (qs_disaster_offline_v1)
 *    排隊堆疊，徽章計數精確，連線恢復時自動排水 (drain) 並觸發雲端即時同步。
 * 3. [Finding 4] 驗證 AuthManager.canEditClass 於 app.js 前端 UI 之防護鏈路：
 *    - 導師登入後僅可編輯其所屬指派班級，點選他班時呈現唯讀檢視與非侵入式警示，禁止竄改。
 *    - 總指揮官具備全校班級編輯特權。
 *    - 8888 演練通行碼具備緊急覆蓋特權，鎖定後權限立即還原。
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { FirestoreService } from '../../public/js/firestore-service.js';
import { GASBridgeAdapter, createGasAdapter } from '../../public/js/gas-bridge-adapter.js';
import { OfflineManager, STATUS_TEXTS } from '../../public/js/offline-manager.js';
import { SupabaseAuth } from '../../public/js/supabase-auth.js';
import appMethods, {
  loadSavedFullState,
  syncRemoteState,
  submitAttendance,
  onClassClick,
  renderMatrix
} from '../../public/js/app.js';

// ==============================================================================
// 輕量級 Mock DOM 輔助器 (支援 Node.js 環境下的 UI 與權限元件測試)
// ==============================================================================
function setupMockDom() {
  const elements = new Map();

  const createElement = (tag) => {
    const el = {
      tagName: tag.toUpperCase(),
      id: '',
      className: '',
      innerText: '',
      innerHTML: '',
      title: '',
      disabled: false,
      style: {},
      children: [],
      addEventListener() {},
      removeEventListener() {},
      querySelector() { return createElement('div'); },
      querySelectorAll() { return []; },
      classList: {
        _classes: new Set(),
        add(...cls) {
          cls.forEach(c => this._classes.add(c));
          el.className = Array.from(this._classes).join(' ');
        },
        remove(...cls) {
          cls.forEach(c => this._classes.delete(c));
          el.className = Array.from(this._classes).join(' ');
        },
        contains(c) {
          return this._classes.has(c);
        }
      },
      appendChild(child) {
        if (!child) return child;
        child.parentNode = this;
        this.children.push(child);
        return child;
      },
      insertBefore(newChild, refChild) {
        if (!newChild) return newChild;
        newChild.parentNode = this;
        const idx = this.children.indexOf(refChild);
        if (idx !== -1) {
          this.children.splice(idx, 0, newChild);
        } else {
          this.children.push(newChild);
        }
        return newChild;
      },
      setAttribute(k, v) { this[k] = v; },
      getAttribute(k) { return this[k]; }
    };
    return el;
  };

  const getElementById = (id) => {
    if (!elements.has(id)) {
      const el = createElement('div');
      el.id = id;
      elements.set(id, el);
    }
    return elements.get(id);
  };

  globalThis.document = {
    createElement,
    getElementById
  };
  globalThis.window = globalThis.window || {};
  globalThis.window.document = globalThis.document;

  return { elements, getElementById, createElement };
}

// ==============================================================================
// 狀態讀取輔助函式 (擷取 app.js 內部當前所有狀態)
// ==============================================================================
function getAppCurrentState() {
  if (typeof appMethods.getAppState === 'function') {
    return appMethods.getAppState();
  }
  if (globalThis.window && globalThis.window.classReports) {
    return {
      classReports: globalThis.window.classReports,
      pulloutStatusMap: globalThis.window.pulloutStatusMap,
      rescueTriageMap: globalThis.window.rescueTriageMap,
      contactStates: globalThis.window.contactStates,
      searchStatusMap: globalThis.window.searchStatusMap,
      buildingStatusMap: globalThis.window.buildingStatusMap,
      visitorList: globalThis.window.visitorList,
      visitorCounts: globalThis.window.visitorCounts
    };
  }

  // 透過 saveFullSystemStateToBackend 攔截全量狀態鏡像
  let captured = null;
  const originalGoogle = globalThis.google;
  globalThis.google = {
    script: {
      run: {
        saveFullSystemState: (payload) => { captured = payload; }
      }
    }
  };
  try {
    if (typeof appMethods.saveFullSystemStateToBackend === 'function') {
      appMethods.saveFullSystemStateToBackend();
    }
  } finally {
    globalThis.google = originalGoogle;
  }
  return captured || {};
}

describe('Integration Tests: Real-time Sync & OfflineManager Pipeline (Findings 1, 2, 3, 4)', () => {
  let firestore;
  let adapter;
  let offlineMgr;
  let auth;
  let mockDom;
  let unsubRealtime;

  beforeEach(async () => {
    mockDom = setupMockDom();

    // 1. 初始化 Firestore 服務
    firestore = new FirestoreService();
    await firestore.init();
    await firestore.clearAllData();

    // 2. 初始化 OfflineManager
    offlineMgr = new OfflineManager({
      firestoreService: firestore,
      initialOnline: true,
      maxRetries: 3
    });
    await offlineMgr.init();
    await offlineMgr.clearQueue();
    await offlineMgr.clearAllCache();

    // 3. 初始化 GASBridgeAdapter (注入 firestore 與 offlineManager)
    adapter = new GASBridgeAdapter({ firestore, offlineManager: offlineMgr });

    // 4. 初始化 SupabaseAuth
    auth = new SupabaseAuth();
    globalThis.window.AuthManager = auth;
    globalThis.AuthManager = auth;
    globalThis.window.OfflineManager = offlineMgr;
    globalThis.OfflineManager = offlineMgr;

    // 5. 初始化 app.js 基底狀態
    loadSavedFullState({
      classReports: {
        '一 1': { grade: '一', className: '1', total: 28, presentCount: 28, missing: [] },
        '二 1': { grade: '二', className: '1', total: 29, presentCount: 29, missing: [] }
      },
      pulloutStatusMap: {
        '一 1_01號': 'study_center'
      },
      rescueTriageMap: {
        '一 1_02號': { triage: 'yellow', escortCount: 2, status: 'injured' }
      },
      searchStatusMap: {
        '一 1_02號': false
      },
      contactStates: {
        '一 1_03號': { status: '通話中', dialCount: 1 }
      },
      helpRequestMap: {},
      buildingStatusMap: {
        '慈愛樓': { '1': true }
      },
      visitorCounts: { student: 1, teacher: 0, parent: 0, vendor: 0 },
      visitorList: [{ id: 'v1', category: 'student', name: '外校生A', count: 1 }],
      securityMode: 'drill',
      simTimeMode: 'mon_am'
    });
  });

  afterEach(() => {
    if (typeof unsubRealtime === 'function') {
      unsubRealtime();
      unsubRealtime = null;
    }
    if (offlineMgr) {
      offlineMgr.destroy();
    }
  });

  // ============================================================================
  // Suite 1: 端對端即時增量推播與狀態防洗白測試 (Findings 1 & 3)
  // ============================================================================
  describe('1. Real-time Granular Delta Pipeline (gasBridgeAdapter.initRealtimeSync ➔ app.js:syncRemoteState)', () => {

    it('1.1 Granular class_reports push updates target class WITHOUT wiping other classes or pullout/rescue maps', async () => {
      // 直連 initRealtimeSync ➔ syncRemoteState
      unsubRealtime = adapter.initRealtimeSync((delta) => {
        syncRemoteState(delta);
      });

      // 模擬雲端收到「一 1」點名異動
      await firestore.setClassReport('一 1', {
        grade: '一',
        className: '1',
        total: 28,
        presentCount: 25,
        leave: [{ seatRaw: '05號', name: '王小明' }],
        missing: []
      });

      // 等候防抖與事件派發 (20ms 防抖 + microtask)
      await new Promise(r => setTimeout(r, 60));

      const state = getAppCurrentState();

      // 驗證 1: 目標班級成功更新
      assert.ok(state.classReports['一 1'], '一 1 report exists');
      assert.equal(state.classReports['一 1'].presentCount, 25, '一 1 presentCount updated to 25');

      // 驗證 2 [核心修復]: 未受異動之「二 1」班級資料完好如初，絕未遭清空！
      assert.ok(state.classReports['二 1'], '二 1 report MUST be preserved');
      assert.equal(state.classReports['二 1'].total, 29, '二 1 total preserved');

      // 驗證 3 [核心修復]: 抽離狀態表完好保留，絕未重置為 {}
      assert.ok(state.pulloutStatusMap, 'pulloutStatusMap exists');
      assert.equal(state.pulloutStatusMap['一 1_01號'], 'study_center', 'Pullout state preserved');

      // 驗證 4 [核心修復]: 檢傷搜救表完好保留
      assert.ok(state.rescueTriageMap, 'rescueTriageMap exists');
      assert.equal(state.rescueTriageMap['一 1_02號'].triage, 'yellow', 'Rescue triage preserved');

      // 驗證 5: 建物與訪客資料完好保留
      assert.ok(state.buildingStatusMap['慈愛樓'], 'Building status preserved');
      assert.equal(state.visitorCounts.student, 1, 'Visitor counts preserved');
    });

    it('1.2 Granular pullouts push updates pullout map WITHOUT wiping classReports', async () => {
      unsubRealtime = adapter.initRealtimeSync((delta) => {
        syncRemoteState(delta);
      });

      // 模擬抽離教師標註「一 1_05號」本土語安全確認
      await firestore.setPullout('一 1_05號', {
        studentKey: '一 1_05號',
        status: 'safe',
        updatedAt: Date.now()
      });

      await new Promise(r => setTimeout(r, 60));

      const state = getAppCurrentState();

      // 驗證 pulloutStatusMap 增量合併
      assert.equal(state.pulloutStatusMap['一 1_05號'], 'safe');
      assert.equal(state.pulloutStatusMap['一 1_01號'], 'study_center', 'Pre-existing pullout preserved');

      // 驗證全校點名紀錄 100% 留存
      assert.ok(state.classReports['一 1']);
      assert.ok(state.classReports['二 1']);
    });

    it('1.3 Granular rescues push updates triage and searchDone status WITHOUT wiping existing maps', async () => {
      unsubRealtime = adapter.initRealtimeSync((delta) => {
        syncRemoteState(delta);
      });

      // 模擬搜救小組尋獲「一 1_02號」並標註為尋獲 (searchDone: true)
      await firestore.setRescue('一 1_02號', {
        studentKey: '一 1_02號',
        triage: 'yellow',
        escortCount: 2,
        status: 'injured',
        searchDone: true,
        updatedAt: Date.now()
      });

      await new Promise(r => setTimeout(r, 60));

      const state = getAppCurrentState();

      // 驗證搜救紀錄與尋獲標記
      assert.ok(state.rescueTriageMap['一 1_02號']);
      assert.equal(state.rescueTriageMap['一 1_02號'].searchDone, true);
      assert.equal(state.searchStatusMap['一 1_02號'], true, 'searchStatusMap synchronized');

      // 驗證其餘集合毫髮無傷
      assert.ok(state.classReports['一 1']);
      assert.ok(state.pulloutStatusMap['一 1_01號']);
    });

    it('1.4 Granular contacts push updates contact status and help request flag', async () => {
      unsubRealtime = adapter.initRealtimeSync((delta) => {
        syncRemoteState(delta);
      });

      await firestore.setContact('一 1_03號', {
        status: '已聯繫',
        dialCount: 2,
        isHelpReq: true,
        updatedAt: Date.now()
      });

      await new Promise(r => setTimeout(r, 60));

      const state = getAppCurrentState();
      assert.equal(state.contactStates['一 1_03號'].status, '已聯繫');
      assert.equal(state.helpRequestMap['一 1_03號'], true);
      assert.ok(state.classReports['一 1']);
    });

    it('1.5 Granular buildings push updates safety check indicators', async () => {
      unsubRealtime = adapter.initRealtimeSync((delta) => {
        syncRemoteState(delta);
      });

      await firestore.setBuilding('至善樓', { '2': true, '4': true });
      await new Promise(r => setTimeout(r, 60));

      const state = getAppCurrentState();
      assert.ok(state.buildingStatusMap['至善樓']);
      assert.equal(state.buildingStatusMap['至善樓']['2'], true);
      assert.equal(state.buildingStatusMap['慈愛樓']['1'], true, 'Existing building preserved');
    });

    it('1.6 Granular system_state push updates securityMode and simTimeMode safely', async () => {
      unsubRealtime = adapter.initRealtimeSync((delta) => {
        syncRemoteState(delta);
      });

      await firestore.setDoc(firestore.doc('system_config', 'state'), {
        securityMode: 'disaster',
        simTimeMode: 'thu_pm1',
        approvedCustomTotal: 2500
      });

      await new Promise(r => setTimeout(r, 60));

      const state = getAppCurrentState();
      assert.equal(state.securityMode, 'disaster');
      assert.equal(state.simTimeMode, 'thu_pm1');
      assert.equal(state.approvedCustomTotal, 2500);
      assert.ok(state.classReports['一 1'], 'Class reports intact');
    });

    it('1.7 Full system state payload maintains complete backward compatibility', () => {
      // 模擬舊版 GAS 或全量載入
      syncRemoteState({
        classReports: {
          '三 1': { total: 27, presentCount: 27 }
        },
        pulloutStatusMap: {
          '三 1_01號': 'team'
        }
      });

      const state = getAppCurrentState();
      assert.ok(state.classReports['三 1']);
      assert.equal(state.pulloutStatusMap['三 1_01號'], 'team');
    });

    it('1.8 Concurrent multi-collection burst writes within 20ms merge into batch and apply ALL collections without loss', async () => {
      unsubRealtime = adapter.initRealtimeSync((delta) => {
        syncRemoteState(delta);
      });

      await Promise.all([
        firestore.setPullout('一 1_01號', { studentKey: '一 1_01號', status: 'missing' }),
        firestore.setRescue('一 1_01號', { triage: 'red', status: 'missing' })
      ]);

      await new Promise(r => setTimeout(r, 60));

      const state = getAppCurrentState();
      assert.equal(state.pulloutStatusMap['一 1_01號'], 'missing', 'Pullout must be updated');
      assert.ok(state.rescueTriageMap['一 1_01號'], 'Rescue must be updated');
    });
  });

  // ============================================================================
  // Suite 2: 操場極限斷網離線佇列與上線自動排水測試 (Finding 2)
  // ============================================================================
  describe('2. OfflineManager Mutation Queue & Reconnect Drain Pipeline (Finding 2)', () => {

    it('2.1 Offline roll call write enqueues mutation into IndexedDB queue and reflects on badge', async () => {
      // 1. 切換為操場斷網狀態
      offlineMgr.isOnline = false;

      // 2. 透過 adapter 送出點名紀錄 (模擬 app.js submitAttendance 呼叫)
      const testReport = {
        grade: '一',
        className: '1',
        total: 28,
        presentCount: 24,
        missing: [{ seatRaw: '03號', name: '林小華' }]
      };

      const result = await new Promise(resolve => {
        const runner = adapter.getScriptRunner();
        runner.withSuccessHandler(resolve).updateClassReportDelta('一 1', testReport);
      });

      // 3. 驗證回傳具備離線快取與待同步標記
      assert.ok(result);
      assert.equal(result.fromCache, true, 'Result flagged fromCache');
      assert.equal(result.hasPendingWrites, true, 'Result flagged hasPendingWrites');

      // 4. 驗證 OfflineManager 變更佇列中確實有 1 筆待同步紀錄
      const pendingList = await offlineMgr.getPendingMutations();
      assert.equal(pendingList.length, 1, '1 mutation in pending queue');
      assert.equal(pendingList[0].collection, 'class_reports');
      assert.equal(pendingList[0].key, '一 1');
      assert.equal(pendingList[0].data.presentCount, 24);

      // 5. 驗證連線狀態指示徽章反映待傳筆數
      const badge = offlineMgr.getStatusBadge();
      assert.equal(badge.isOnline, false);
      assert.equal(badge.pendingCount, 1);
      assert.ok(badge.text.includes('1筆待傳'));
    });

    it('2.2 Consecutive offline roll call mutations stack in FIFO order', async () => {
      offlineMgr.isOnline = false;

      const runner1 = adapter.getScriptRunner();
      await new Promise(r => runner1.withSuccessHandler(r).updateClassReportDelta('一 1', { presentCount: 25 }));

      const runner2 = adapter.getScriptRunner();
      await new Promise(r => runner2.withSuccessHandler(r).updateClassReportDelta('一 2', { presentCount: 26 }));

      const runner3 = adapter.getScriptRunner();
      await new Promise(r => runner3.withSuccessHandler(r).updateClassReportDelta('二 1', { presentCount: 27 }));

      const pendingList = await offlineMgr.getPendingMutations();
      assert.equal(pendingList.length, 3, '3 mutations stacked');
      assert.equal(pendingList[0].key, '一 1');
      assert.equal(pendingList[1].key, '一 2');
      assert.equal(pendingList[2].key, '二 1');

      const badge = offlineMgr.getStatusBadge();
      assert.equal(badge.pendingCount, 3);
      assert.ok(badge.text.includes('3筆待傳'));
    });

    it('2.3 Reconnection automatically drains offline queue to Firestore and pushes to app.js', async () => {
      offlineMgr.isOnline = false;

      // 監聽即時推播
      unsubRealtime = adapter.initRealtimeSync((delta) => {
        syncRemoteState(delta);
      });

      // 離線提交「一 1」與「二 1」點名
      const runner1 = adapter.getScriptRunner();
      await new Promise(r => runner1.withSuccessHandler(r).updateClassReportDelta('一 1', {
        grade: '一', className: '1', total: 28, presentCount: 22
      }));

      const runner2 = adapter.getScriptRunner();
      await new Promise(r => runner2.withSuccessHandler(r).updateClassReportDelta('二 1', {
        grade: '二', className: '1', total: 29, presentCount: 23
      }));

      assert.equal((await offlineMgr.getPendingMutations()).length, 2);

      // 恢復連線並觸發佇列排水
      offlineMgr.isOnline = true;
      const drainResult = await offlineMgr.syncPendingMutations();

      assert.equal(drainResult.success, true);
      assert.equal(drainResult.drainedCount, 2);

      // 驗證佇列已清空為 0 筆
      const remaining = await offlineMgr.getPendingMutations();
      assert.equal(remaining.length, 0, 'Pending queue drained to 0');

      // 驗證狀態徽章回到綠色正常在線
      const badge = offlineMgr.getStatusBadge();
      assert.equal(badge.pendingCount, 0);
      assert.equal(badge.status, 'online');

      // 驗證 Firestore 已收到資料並經由 onSnapshot 傳遞給 app.js
      await new Promise(r => setTimeout(r, 60));

      const appState = getAppCurrentState();
      assert.equal(appState.classReports['一 1'].presentCount, 22);
      assert.equal(appState.classReports['二 1'].presentCount, 23);
    });
  });

  // ============================================================================
  // Suite 3: 導師點名權限 UI Guard 與 8888 覆蓋測試 (Finding 4)
  // ============================================================================
  describe('3. Teacher UI Roll Call Guard & Auth RBAC Integration (Finding 4)', () => {

    it('3.1 Logged-in teacher can edit assigned class ("一 1")', async () => {
      // 1. 登入為「一 1」帶班導師
      await auth.login('teacher1_1@qs.edu.tw', 'tea123456');
      assert.equal(auth.getUserRole(), 'teacher');
      assert.equal(auth.canEditClass('一', '1'), true);

      // 2. 模擬導師開啟「一 1」點名視窗
      // 設定全校學生名冊假資料
      appMethods.setupData([
        { grade: '一', className: '1', seatRaw: '01號', seatNum: 1, name: '學生甲' },
        { grade: '一', className: '1', seatRaw: '02號', seatNum: 2, name: '學生乙' }
      ]);

      // 模擬點擊「一 1」
      onClassClick('1');

      // 3. 驗證未出現唯讀警示標籤
      const warnBox = mockDom.getElementById('teacherClassAuthWarn');
      assert.ok(!warnBox || warnBox.style.display === 'none', 'No warning banner for assigned class');

      // 4. 驗證送出點名按鈕可正常使用
      const btnSubmit = mockDom.getElementById('btnSubmitAttendance');
      assert.equal(btnSubmit.disabled, false);
      assert.notEqual(btnSubmit.innerText, '🔒 唯讀檢視中 (非本班帶班導師)');
    });

    it('3.2 Logged-in teacher viewing non-assigned class ("一 2") triggers read-only guard', async () => {
      // 1. 登入為「一 1」帶班導師
      await auth.login('teacher1_1@qs.edu.tw', 'tea123456');
      assert.equal(auth.canEditClass('一', '2'), false, 'Cannot edit 一 2');

      appMethods.setupData([
        { grade: '一', className: '2', seatRaw: '01號', seatNum: 1, name: '學生丙' }
      ]);

      // 2. 導師切換至「一 2」
      onClassClick('2');

      // 3. 驗證唯讀警示橫幅自動掛載並呈現
      const warnBox = mockDom.getElementById('teacherClassAuthWarn');
      assert.ok(warnBox, 'Warning box created');
      assert.equal(warnBox.style.display, 'flex');
      assert.ok(warnBox.innerHTML.includes('唯讀檢視模式'), 'Includes readonly notice');
      assert.ok(warnBox.innerHTML.includes('非 一 2 之帶班導師') || warnBox.innerHTML.includes('一 2'), 'Mentions class name');

      // 4. 驗證送出點名按鈕遭停用 (disabled = true)
      const btnSubmit = mockDom.getElementById('btnSubmitAttendance');
      assert.equal(btnSubmit.disabled, true, 'Submit button disabled');
      assert.ok(btnSubmit.innerText.includes('唯讀檢視中') || btnSubmit.innerText.includes('非本班帶班導師'));

      // 5. 驗證送出點名防呆攔截
      let alertMsg = null;
      globalThis.alert = (msg) => { alertMsg = msg; };
      const submitSuccess = submitAttendance(false);
      assert.equal(submitSuccess, false, 'submitAttendance blocked');
      assert.ok(alertMsg && alertMsg.includes('權限不足'), 'Alert warns about insufficient permission');
    });

    it('3.3 Commander role can freely edit all classes across all grades', async () => {
      await auth.login('commander@qs.edu.tw', 'cmd123456');
      assert.equal(auth.getUserRole(), 'commander');
      assert.equal(auth.canEditClass('一', '1'), true);
      assert.equal(auth.canEditClass('一', '2'), true);
      assert.equal(auth.canEditClass('六', '10'), true);

      appMethods.setupData([
        { grade: '一', className: '2', seatRaw: '01號', seatNum: 1, name: '學生丙' }
      ]);
      onClassClick('2');

      const warnBox = mockDom.getElementById('teacherClassAuthWarn');
      assert.ok(!warnBox || warnBox.style.display === 'none', 'Commander has no warning banner');

      const btnSubmit = mockDom.getElementById('btnSubmitAttendance');
      assert.equal(btnSubmit.disabled, false);
    });

    it('3.4 Drill mode passcode (8888) overrides class restriction for teacher', async () => {
      // 1. 導師登入「一 1」
      await auth.login('teacher1_1@qs.edu.tw', 'tea123456');

      // 2. 切換至「一 2」，原先受唯讀防護
      appMethods.setupData([
        { grade: '一', className: '2', seatRaw: '01號', seatNum: 1, name: '學生丙' }
      ]);
      onClassClick('2');
      let btnSubmit = mockDom.getElementById('btnSubmitAttendance');
      assert.equal(btnSubmit.disabled, true);

      // 3. 輸入演練通行碼 8888 解鎖
      const unlockRes = auth.loginWithPasscode('8888');
      assert.equal(unlockRes.success, true);
      assert.equal(auth.getUserRole(), 'commander', 'Role overridden to commander via 8888');
      assert.equal(auth.canEditClass('一', '2'), true, 'canEditClass overridden to true');

      // 4. 再次點擊「一 2」，唯讀防護解除
      onClassClick('2');
      btnSubmit = mockDom.getElementById('btnSubmitAttendance');
      assert.equal(btnSubmit.disabled, false, 'Submit button re-enabled');

      const warnBox = mockDom.getElementById('teacherClassAuthWarn');
      assert.ok(!warnBox || warnBox.style.display === 'none', 'Warning banner hidden');

      // 5. 退出 8888 演練通行碼
      auth.lockDrill();
      assert.equal(auth.getUserRole(), 'teacher', 'Role restored to teacher');
      assert.equal(auth.canEditClass('一', '2'), false, 'Restriction restored');

      // 6. 重新點擊「一 2」，唯讀防護再次生效
      onClassClick('2');
      btnSubmit = mockDom.getElementById('btnSubmitAttendance');
      assert.equal(btnSubmit.disabled, true, 'Submit button re-locked');
    });

    it('3.5 Unauthenticated visitor in offline drill defaults to unrestricted roll call', async () => {
      // 模擬未登入狀態 (操場直接離線演習點名)
      await auth.logout();
      assert.equal(auth.getUserRole(), 'visitor');

      appMethods.setupData([
        { grade: '二', className: '1', seatRaw: '01號', seatNum: 1, name: '學生丁' }
      ]);
      onClassClick('1');

      const btnSubmit = mockDom.getElementById('btnSubmitAttendance');
      assert.equal(btnSubmit.disabled, false, 'Visitor not locked out during drill');
    });
  });
});
