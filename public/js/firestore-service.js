/**
 * ==============================================================================
 * 清水國小校園災難與演練即時點名通報系統 V20.4
 * Firebase Cloud Firestore 資料層模組 (public/js/firestore-service.js)
 * ==============================================================================
 * 職責：
 * 1. 初始化 Firebase App 與 Cloud Firestore (支援 Web SDK 與高保真離線快取降級)
 * 2. 實作細粒度集合與班級獨立文件架構 (Granular Document-per-Class)
 *    - class_reports/{classKey}
 *    - pullouts/{studentKey}
 *    - rescues/{targetKey}
 *    - contacts/{studentKey}
 *    - visitors/{id}
 *    - buildings/{id}
 *    - system_config/state
 *    - system_config/schedules
 *    - students/{studentId}
 * 3. 實作 onSnapshot 伺服器即時推播監聽器 (<500ms 廣播延遲，徹底拔除輪詢)
 * 4. 操場極限斷網本機持久化快取 (IndexedDB / LocalStorage) 與連線自動排隊補發
 * 5. 恪守核心規格書鐵律：單字大寫年級字串、不建舊表、抽離待確認隔離保護
 */

// 鐵律 2 & 3 規範檢核常數
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

const ALLOWED_COLLECTIONS = new Set([
  'system_config',
  'students',
  'class_reports',
  'pullouts',
  'rescues',
  'contacts',
  'visitors',
  'buildings',
  'attendance_logs',
  'stress_test_logs'
]);

// 預設 6 大主建物名冊
const DEFAULT_BUILDINGS = [
  { id: 'ci_ai', name: '慈愛樓', sortOrder: 1 },
  { id: 'zhi_shan', name: '至善樓', sortOrder: 2 },
  { id: 'wei_yang', name: '維揚樓', sortOrder: 3 },
  { id: 'le_qun', name: '樂群樓', sortOrder: 4 },
  { id: 'hong_de', name: '弘德樓', sortOrder: 5 },
  { id: 'zhong_shan', name: '中山樓', sortOrder: 6 }
];

/**
 * 安全檢核與序列化輔助函式
 */
function sanitizeDocId(id) {
  if (id === null || id === undefined) return '';
  return String(id).trim();
}

function checkDocSize(data) {
  try {
    const jsonStr = JSON.stringify(data);
    const bytes = typeof Buffer !== 'undefined'
      ? Buffer.byteLength(jsonStr, 'utf8')
      : new TextEncoder().encode(jsonStr).length;
    if (bytes > 1048576) {
      throw new Error('Document size exceeds 1MB Firestore limit');
    }
  } catch (err) {
    if (err.message && err.message.includes('exceeds 1MB')) {
      throw err;
    }
    // 其他 JSON 序列化例外
  }
}

function checkPrototypePollution(data) {
  if (!data || typeof data !== 'object') return;
  const jsonStr = JSON.stringify(data);
  if (jsonStr.includes('"__proto__"') || jsonStr.includes('"constructor"') || jsonStr.includes('"prototype"')) {
    throw new Error('Forbidden object key: prototype pollution detected');
  }
}

function deepClone(obj) {
  if (obj === undefined) return undefined;
  return JSON.parse(JSON.stringify(obj));
}

/**
 * 高保真 Firestore 本機記憶體與 LocalStorage 快取儲存體
 * 支援完整的 onSnapshot 監聽、離線佇列排隊、連線自動補發與雙向推播
 */
class HighFidelityLocalFirestore {
  constructor(options = {}) {
    this.serverStore = new Map();         // collName -> Map(docId -> data)
    this.localCache = new Map();          // collName -> Map(docId -> data)
    this.docListeners = new Map();        // "coll/docId" -> Set(callback)
    this.collListeners = new Map();       // collName -> Set(callback)
    this.pendingQueue = [];               // 離線排隊寫入佇列
    this.isOnline = true;
    this.storagePrefix = options.storagePrefix || 'APP_FIRESTORE_';

    // 預先載入本機 LocalStorage 快取 (操場斷網保護)
    this._loadFromLocalStorage();
  }

  _loadFromLocalStorage() {
    if (typeof window === 'undefined' || !window.localStorage) return;
    try {
      const DATA_VER_KEY = 'APP_FIRESTORE_DATA_VERSION';
      const CURRENT_DATA_VER = '115_ACADEMIC_2144';
      if (window.localStorage.getItem(DATA_VER_KEY) !== CURRENT_DATA_VER) {
        // 清理過期的一~六年級 1~30 班快取，避免污染 115 學年度官方班級 (101~615)
        window.localStorage.removeItem(this.storagePrefix + 'students');
        window.localStorage.setItem(DATA_VER_KEY, CURRENT_DATA_VER);
      }

      ALLOWED_COLLECTIONS.forEach(collName => {
        const raw = window.localStorage.getItem(this.storagePrefix + collName);
        if (raw) {
          const parsed = JSON.parse(raw);
          const map = this._getOrCreateMap(this.localCache, collName);
          const sMap = this._getOrCreateMap(this.serverStore, collName);
          for (const [id, val] of Object.entries(parsed)) {
            map.set(id, val);
            sMap.set(id, val);
          }
        }
      });
    } catch (e) {
      // 忽略 LocalStorage 存取限制
    }
  }

  _persistCollection(collName) {
    if (typeof window === 'undefined' || !window.localStorage) return;
    try {
      const map = this.localCache.get(collName);
      if (!map) return;
      const obj = {};
      for (const [id, val] of map.entries()) {
        obj[id] = val;
      }
      window.localStorage.setItem(this.storagePrefix + collName, JSON.stringify(obj));
    } catch (e) {
      // 忽略容量限制例外
    }
  }

  _getOrCreateMap(store, collName) {
    if (!store.has(collName)) {
      store.set(collName, new Map());
    }
    return store.get(collName);
  }

  goOffline() {
    this.isOnline = false;
  }

  async goOnline() {
    this.isOnline = true;
    // 依序排隊補發離線累積之寫入操作
    while (this.pendingQueue.length > 0) {
      const op = this.pendingQueue.shift();
      const coll = this._getOrCreateMap(this.serverStore, op.collName);
      if (op.type === 'set') {
        const existing = coll.get(op.docId) || {};
        const merged = op.merge ? { ...existing, ...op.data } : { ...op.data };
        coll.set(op.docId, merged);
      } else if (op.type === 'delete') {
        coll.delete(op.docId);
      }
      this._notifyDoc(op.collName, op.docId, false);
      this._notifyColl(op.collName, false);
      this._persistCollection(op.collName);
    }
  }

  async setDoc(docRef, data, options = {}) {
    checkPrototypePollution(data);
    checkDocSize(data);

    const { collName, docId } = docRef;
    if (FORBIDDEN_COLLECTIONS.has(collName)) {
      throw new Error(`Iron Rule 3 Violation: Collection '${collName}' is deprecated and strictly forbidden.`);
    }

    const merge = Boolean(options && options.merge);
    const cleanData = deepClone(data);

    // 1. 立即更新本地快取 (0ms 樂觀更新 - 符合 R3)
    const localColl = this._getOrCreateMap(this.localCache, collName);
    const existingLocal = localColl.get(docId) || {};
    const newLocal = merge ? { ...existingLocal, ...cleanData } : { ...cleanData };
    localColl.set(docId, newLocal);
    this._persistCollection(collName);

    // 2. 離線處理
    if (!this.isOnline) {
      this.pendingQueue.push({
        type: 'set',
        collName,
        docId,
        data: cleanData,
        merge,
        timestamp: Date.now()
      });
      this._notifyDoc(collName, docId, true);
      this._notifyColl(collName, true);
      return { fromCache: true, hasPendingWrites: true };
    }

    // 3. 在線直接更新雲端模擬庫
    const serverColl = this._getOrCreateMap(this.serverStore, collName);
    const existingServer = serverColl.get(docId) || {};
    const newServer = merge ? { ...existingServer, ...cleanData } : { ...cleanData };
    serverColl.set(docId, newServer);

    this._notifyDoc(collName, docId, false);
    this._notifyColl(collName, false);
    return { fromCache: false, hasPendingWrites: false };
  }

  async getDoc(docRef) {
    const { collName, docId } = docRef;
    let data;
    let fromCache = false;

    if (!this.isOnline) {
      const localColl = this._getOrCreateMap(this.localCache, collName);
      data = localColl.get(docId);
      fromCache = true;
    } else {
      const serverColl = this._getOrCreateMap(this.serverStore, collName);
      data = serverColl.get(docId);
      if (data === undefined) {
        const localColl = this._getOrCreateMap(this.localCache, collName);
        data = localColl.get(docId);
        if (data !== undefined) fromCache = true;
      }
    }

    const hasPending = this.pendingQueue.some(q => q.collName === collName && q.docId === docId);

    return {
      id: docId,
      exists: () => data !== undefined,
      data: () => deepClone(data),
      metadata: {
        fromCache,
        hasPendingWrites: hasPending
      }
    };
  }

  async deleteDoc(docRef) {
    const { collName, docId } = docRef;
    const localColl = this._getOrCreateMap(this.localCache, collName);
    localColl.delete(docId);
    this._persistCollection(collName);

    if (!this.isOnline) {
      this.pendingQueue.push({ type: 'delete', collName, docId, timestamp: Date.now() });
      this._notifyDoc(collName, docId, true);
      this._notifyColl(collName, true);
      return { success: true };
    }

    const serverColl = this._getOrCreateMap(this.serverStore, collName);
    serverColl.delete(docId);

    this._notifyDoc(collName, docId, false);
    this._notifyColl(collName, false);
    return { success: true };
  }

  async getDocs(collectionRef) {
    const { collName } = collectionRef;
    return this._getCollectionSnapshot(collName, !this.isOnline);
  }

  async _getCollectionSnapshot(collName, isOffline) {
    const store = (isOffline || !this.isOnline) ? this.localCache : this.serverStore;
    const coll = this._getOrCreateMap(store, collName);
    const docs = [];
    for (const [id, data] of coll.entries()) {
      docs.push({
        id,
        data: () => deepClone(data),
        metadata: {
          fromCache: !this.isOnline,
          hasPendingWrites: this.pendingQueue.some(q => q.collName === collName && q.docId === id)
        }
      });
    }
    return {
      docs,
      empty: docs.length === 0,
      size: docs.length,
      metadata: {
        fromCache: !this.isOnline,
        hasPendingWrites: this.pendingQueue.some(q => q.collName === collName)
      }
    };
  }

  onSnapshot(targetRef, onNext, onError) {
    if (typeof onNext !== 'function') return () => {};

    if (targetRef.type === 'doc') {
      const { collName, docId } = targetRef;
      const key = `${collName}/${docId}`;
      if (!this.docListeners.has(key)) {
        this.docListeners.set(key, new Set());
      }
      const set = this.docListeners.get(key);
      set.add(onNext);

      // 觸發初始快照事件 (<500ms 立即回呼)
      this.getDoc(targetRef)
        .then(snap => onNext(snap))
        .catch(err => { if (typeof onError === 'function') onError(err); });

      let unsubscribed = false;
      return () => {
        if (unsubscribed) return;
        unsubscribed = true;
        set.delete(onNext);
      };
    } else if (targetRef.type === 'collection') {
      const { collName } = targetRef;
      if (!this.collListeners.has(collName)) {
        this.collListeners.set(collName, new Set());
      }
      const set = this.collListeners.get(collName);
      set.add(onNext);

      this._getCollectionSnapshot(collName, !this.isOnline)
        .then(snap => onNext(snap))
        .catch(err => { if (typeof onError === 'function') onError(err); });

      let unsubscribed = false;
      return () => {
        if (unsubscribed) return;
        unsubscribed = true;
        set.delete(onNext);
      };
    }

    return () => {};
  }

  _notifyDoc(collName, docId, fromCache) {
    const key = `${collName}/${docId}`;
    const set = this.docListeners.get(key);
    if (set && set.size > 0) {
      queueMicrotask(() => {
        this.getDoc({ collName, docId, type: 'doc' }).then(snap => {
          for (const cb of set) {
            try { cb(snap); } catch (e) { /* 靜默處理回呼例外 */ }
          }
        });
      });
    }
  }

  _notifyColl(collName, fromCache) {
    const set = this.collListeners.get(collName);
    if (set && set.size > 0) {
      queueMicrotask(() => {
        this._getCollectionSnapshot(collName, fromCache).then(snap => {
          for (const cb of set) {
            try { cb(snap); } catch (e) { /* 靜默處理回呼例外 */ }
          }
        });
      });
    }
  }

  doc(collName, docId) {
    const cleanId = sanitizeDocId(docId);
    return { collName, docId: cleanId, type: 'doc' };
  }

  collection(collName) {
    return { collName, type: 'collection' };
  }
}

/**
 * ==============================================================================
 * FirestoreService 核心封裝類別
 * ==============================================================================
 */
export class FirestoreService {
  constructor(options = {}) {
    this.options = options;
    this.app = null;
    this.db = null;
    this._isCloudLive = false;
    this._initialized = false;
    this.activeSubscriptions = new Set();

    // 預設初始化高保真本地儲存庫
    this.localStore = new HighFidelityLocalFirestore(options);

    // 註冊頁面關閉時的乾淨監聽解除 (符合 B12-5)
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('beforeunload', () => this.clearAllSubscriptions());
      window.addEventListener('online', () => this.goOnline());
      window.addEventListener('offline', () => this.goOffline());
    }
  }

  // ============================================================================
  // 1. 初始化與 Firebase SDK 連結
  // ============================================================================

  async init() {
    if (this._initialized) return this;
    this._initialized = true;

    const appConfig = (typeof window !== 'undefined' && window.__APP_CONFIG__) ||
                      (typeof globalThis !== 'undefined' && globalThis.__APP_CONFIG__) ||
                      null;

    const firebaseConfig = (appConfig && typeof appConfig.getFirebaseConfig === 'function')
      ? appConfig.getFirebaseConfig()
      : {};

    const isLiveConfigured = appConfig && typeof appConfig.isFirebaseConfigured === 'function'
      ? appConfig.isFirebaseConfigured()
      : false;

    // 檢查全域環境或模組引入
    let fbApp = null;
    let firestoreInstance = null;

    if (isLiveConfigured) {
      try {
        if (typeof window !== 'undefined' && window.firebase && typeof window.firebase.initializeApp === 'function') {
          // Firebase Compat SDK
          fbApp = window.firebase.apps && window.firebase.apps.length > 0
            ? window.firebase.app()
            : window.firebase.initializeApp(firebaseConfig);
          firestoreInstance = window.firebase.firestore();
          this._isCloudLive = true;
        } else {
          // 嘗試動態載入 Modular SDK
          try {
            const { initializeApp } = await import('firebase/app');
            const { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } = await import('firebase/firestore');
            fbApp = initializeApp(firebaseConfig);
            try {
              firestoreInstance = initializeFirestore(fbApp, {
                localCache: persistentLocalCache({
                  tabManager: persistentMultipleTabManager()
                })
              });
            } catch (cacheErr) {
              // IndexedDB 快取初始化失敗時降級為標準 firestore
              const { getFirestore } = await import('firebase/firestore');
              firestoreInstance = getFirestore(fbApp);
            }
            this._isCloudLive = true;
          } catch (modErr) {
            // 未安裝 modular sdk
          }
        }
      } catch (err) {
        console.warn('[FirestoreService] 雲端 Firebase Client 初始化失敗，採用高保真離線快取儲存體：', err);
      }
    }

    this.app = fbApp;
    this.db = firestoreInstance || this.localStore;
    return this;
  }

  isOnline() {
    return this.localStore.isOnline;
  }

  goOffline() {
    this.localStore.goOffline();
    if (this._isCloudLive && this.db && typeof this.db.disableNetwork === 'function') {
      try { this.db.disableNetwork(); } catch (e) { /* ignore */ }
    }
  }

  async goOnline() {
    await this.localStore.goOnline();
    if (this._isCloudLive && this.db && typeof this.db.enableNetwork === 'function') {
      try { await this.db.enableNetwork(); } catch (e) { /* ignore */ }
    }
  }

  hasPendingWrites() {
    return this.localStore.pendingQueue.length > 0;
  }

  clearAllSubscriptions() {
    for (const unsub of this.activeSubscriptions) {
      try { unsub(); } catch (e) { /* ignore */ }
    }
    this.activeSubscriptions.clear();
  }

  _registerSubscription(unsub) {
    const safeUnsub = () => {
      this.activeSubscriptions.delete(safeUnsub);
      try { unsub(); } catch (e) { /* ignore */ }
    };
    this.activeSubscriptions.add(safeUnsub);
    return safeUnsub;
  }

  // ============================================================================
  // 2. 核心底層文件與集合參照 (doc, collection, getDoc, setDoc, deleteDoc)
  // ============================================================================

  doc(collName, docId) {
    const cleanId = sanitizeDocId(docId);
    if (this._isCloudLive && this.db && typeof this.db.collection === 'function') {
      try {
        const cloudRef = this.db.collection(collName).doc(cleanId);
        cloudRef.collName = collName;
        cloudRef.docId = cleanId;
        return cloudRef;
      } catch (e) {
        console.warn('[FirestoreService] 建立雲端文件參照失敗，回退至本地：', e);
      }
    }
    return this.localStore.doc(collName, docId);
  }

  collection(collName) {
    if (this._isCloudLive && this.db && typeof this.db.collection === 'function') {
      try {
        const cloudColl = this.db.collection(collName);
        cloudColl.collName = collName;
        return cloudColl;
      } catch (e) {
        console.warn('[FirestoreService] 建立雲端集合參照失敗，回退至本地：', e);
      }
    }
    return this.localStore.collection(collName);
  }

  async getDoc(docRef) {
    if (this._isCloudLive && docRef && typeof docRef.get === 'function') {
      try {
        const snap = await docRef.get();
        return snap;
      } catch (e) {
        console.warn('[FirestoreService] 雲端 getDoc 異常，回退至本地快取：', e);
      }
    }
    return this.localStore.getDoc(docRef);
  }

  async setDoc(docRef, data, options = {}) {
    try {
      this.localStore.setDoc(docRef, data, options).catch(() => {});
    } catch (e) {}

    if (this._isCloudLive && docRef && typeof docRef.set === 'function') {
      try {
        return await docRef.set(data, options);
      } catch (e) {
        console.warn('[FirestoreService] 雲端 setDoc 失敗，已保留本地：', e);
      }
    }
    return this.localStore.setDoc(docRef, data, options);
  }

  async deleteDoc(docRef) {
    try {
      this.localStore.deleteDoc(docRef).catch(() => {});
    } catch (e) {}

    if (this._isCloudLive && docRef && typeof docRef.delete === 'function') {
      try {
        return await docRef.delete();
      } catch (e) {
        console.warn('[FirestoreService] 雲端 deleteDoc 失敗：', e);
      }
    }
    return this.localStore.deleteDoc(docRef);
  }

  async getDocs(collectionRef) {
    if (this._isCloudLive && collectionRef && typeof collectionRef.get === 'function') {
      try {
        const snap = await collectionRef.get();
        return snap;
      } catch (e) {
        console.warn('[FirestoreService] 雲端 getDocs 異常，回退至本地快取：', e);
      }
    }
    return this.localStore.getDocs(collectionRef);
  }

  onSnapshot(targetRef, onNext, onError) {
    if (this._isCloudLive && targetRef && typeof targetRef.onSnapshot === 'function') {
      try {
        const unsub = targetRef.onSnapshot(onNext, onError);
        return this._registerSubscription(unsub);
      } catch (e) {
        console.warn('[FirestoreService] 雲端 onSnapshot 異常，回退至本地：', e);
      }
    }
    const unsub = this.localStore.onSnapshot(targetRef, onNext, onError);
    return this._registerSubscription(unsub);
  }

  // ============================================================================
  // 3. 班級點名細粒度作業 (class_reports/{classKey})
  // ============================================================================

  async getClassReport(classKey) {
    const ref = this.doc('class_reports', classKey);
    const snap = await this.getDoc(ref);
    return snap.exists() ? snap.data() : null;
  }

  async setClassReport(classKey, data, options = { merge: true }) {
    const ref = this.doc('class_reports', classKey);
    const payload = {
      ...data,
      classKey: sanitizeDocId(classKey),
      updatedAt: Date.now()
    };
    return this.setDoc(ref, payload, options);
  }

  async deleteClassReport(classKey) {
    const ref = this.doc('class_reports', classKey);
    return this.deleteDoc(ref);
  }

  async getAllClassReports() {
    const snap = await this.getDocs(this.collection('class_reports'));
    const result = {};
    for (const doc of snap.docs) {
      result[doc.id] = doc.data();
    }
    return result;
  }

  // ============================================================================
  // 4. 抽離學生追蹤作業 (pullouts/{studentKey})
  // ============================================================================

  async getPullout(studentKey) {
    const ref = this.doc('pullouts', studentKey);
    const snap = await this.getDoc(ref);
    return snap.exists() ? snap.data() : null;
  }

  async setPullout(studentKey, data, options = { merge: true }) {
    const ref = this.doc('pullouts', studentKey);
    const payload = {
      ...data,
      studentKey: sanitizeDocId(studentKey),
      updatedAt: Date.now()
    };
    return this.setDoc(ref, payload, options);
  }

  async deletePullout(studentKey) {
    const ref = this.doc('pullouts', studentKey);
    return this.deleteDoc(ref);
  }

  async getAllPullouts() {
    const snap = await this.getDocs(this.collection('pullouts'));
    const result = {};
    for (const doc of snap.docs) {
      result[doc.id] = doc.data();
    }
    return result;
  }

  // ============================================================================
  // 5. 危難搜救與檢傷分類 (rescues/{targetKey})
  // ============================================================================

  async getRescue(targetKey) {
    const ref = this.doc('rescues', targetKey);
    const snap = await this.getDoc(ref);
    return snap.exists() ? snap.data() : null;
  }

  async setRescue(targetKey, data, options = { merge: true }) {
    const ref = this.doc('rescues', targetKey);
    const payload = {
      ...data,
      targetKey: sanitizeDocId(targetKey),
      updatedAt: Date.now()
    };
    return this.setDoc(ref, payload, options);
  }

  async deleteRescue(targetKey) {
    const ref = this.doc('rescues', targetKey);
    return this.deleteDoc(ref);
  }

  async getAllRescues() {
    const snap = await this.getDocs(this.collection('rescues'));
    const result = {};
    for (const doc of snap.docs) {
      result[doc.id] = doc.data();
    }
    return result;
  }

  // ============================================================================
  // 6. 家長緊急聯繫與未接累計 (contacts/{studentKey})
  // ============================================================================

  async getContact(studentKey) {
    const ref = this.doc('contacts', studentKey);
    const snap = await this.getDoc(ref);
    return snap.exists() ? snap.data() : null;
  }

  async setContact(studentKey, data, options = { merge: true }) {
    const ref = this.doc('contacts', studentKey);
    const payload = {
      ...data,
      studentKey: sanitizeDocId(studentKey),
      updatedAt: Date.now()
    };
    return this.setDoc(ref, payload, options);
  }

  async getAllContacts() {
    const snap = await this.getDocs(this.collection('contacts'));
    const result = {};
    for (const doc of snap.docs) {
      result[doc.id] = doc.data();
    }
    return result;
  }

  // ============================================================================
  // 7. 校外及臨時人員登記 (visitors/{id})
  // ============================================================================

  async getVisitor(id) {
    const ref = this.doc('visitors', id);
    const snap = await this.getDoc(ref);
    return snap.exists() ? snap.data() : null;
  }

  async setVisitor(id, data, options = { merge: true }) {
    const ref = this.doc('visitors', id);
    const payload = {
      ...data,
      id: sanitizeDocId(id),
      updatedAt: Date.now()
    };
    return this.setDoc(ref, payload, options);
  }

  async deleteVisitor(id) {
    const ref = this.doc('visitors', id);
    return this.deleteDoc(ref);
  }

  async getAllVisitors() {
    const snap = await this.getDocs(this.collection('visitors'));
    return snap.docs.map(doc => doc.data());
  }

  // ============================================================================
  // 8. 建物巡檢 6 大主建物與 8 大指標 (buildings/{id})
  // ============================================================================

  async getBuilding(idOrName) {
    const ref = this.doc('buildings', idOrName);
    const snap = await this.getDoc(ref);
    return snap.exists() ? snap.data() : null;
  }

  async setBuilding(idOrName, data, options = { merge: true }) {
    const ref = this.doc('buildings', idOrName);
    const payload = {
      ...data,
      buildingName: sanitizeDocId(idOrName),
      updatedAt: Date.now()
    };
    return this.setDoc(ref, payload, options);
  }

  async getAllBuildings() {
    const snap = await this.getDocs(this.collection('buildings'));
    const result = {};
    for (const doc of snap.docs) {
      result[doc.id] = doc.data();
    }
    return result;
  }

  // ============================================================================
  // 9. 全域狀態與作息排程 (system_config)
  // ============================================================================

  async getSystemState() {
    const ref = this.doc('system_config', 'state');
    const snap = await this.getDoc(ref);
    return snap.exists() ? snap.data() : {
      securityMode: 'drill',
      simTimeMode: 'auto',
      siteLocked: false,
      approvedCustomTotal: null,
      visitorCounts: { student: 0, teacher: 0, parent: 0, vendor: 0 }
    };
  }

  async setSystemState(data, options = { merge: true }) {
    const ref = this.doc('system_config', 'state');
    return this.setDoc(ref, { ...data, updatedAt: Date.now() }, options);
  }

  async getScheduleConfig() {
    const ref = this.doc('system_config', 'schedules');
    const snap = await this.getDoc(ref);
    return snap.exists() ? snap.data().rules || [] : [];
  }

  async setScheduleConfig(rules) {
    const ref = this.doc('system_config', 'schedules');
    return this.setDoc(ref, { rules, updatedAt: Date.now() }, { merge: true });
  }

  // ============================================================================
  // 10. 學生基本資料主檔 (students/{studentId})
  // ============================================================================

  async getStudent(studentId) {
    const ref = this.doc('students', studentId);
    const snap = await this.getDoc(ref);
    return snap.exists() ? snap.data() : null;
  }

  async setStudent(studentId, data) {
    const ref = this.doc('students', studentId);
    return this.setDoc(ref, { ...data, id: sanitizeDocId(studentId) }, { merge: true });
  }

  async getStudents() {
    const snap = await this.getDocs(this.collection('students'));
    return snap.docs.map(doc => doc.data());
  }

  // ============================================================================
  // 11. 清理與重置作業 (clearAllData, clearCollection)
  // ============================================================================

  async clearCollection(collName) {
    const localColl = this.localStore._getOrCreateMap(this.localStore.localCache, collName);
    const serverColl = this.localStore._getOrCreateMap(this.localStore.serverStore, collName);
    localColl.clear();
    serverColl.clear();
    this.localStore._persistCollection(collName);
    this.localStore._notifyColl(collName, false);

    if (this._isCloudLive && this.db && typeof this.db.collection === 'function') {
      try {
        const cloudColl = this.db.collection(collName);
        const snap = await cloudColl.get();
        if (snap && snap.docs && snap.docs.length > 0) {
          const batch = (typeof this.db.batch === 'function') ? this.db.batch() : null;
          if (batch) {
            for (const doc of snap.docs) {
              batch.delete(doc.ref);
            }
            await batch.commit();
          } else {
            await Promise.all(snap.docs.map(doc => doc.ref.delete()));
          }
        }
      } catch (e) {
        console.warn(`[FirestoreService] 雲端清空集合 ${collName} 失敗：`, e);
      }
    }
  }

  async clearAllData() {
    const clearList = ['class_reports', 'pullouts', 'rescues', 'contacts', 'visitors'];
    for (const coll of clearList) {
      await this.clearCollection(coll);
    }

    // 重置 6 大建物為安全初始值
    for (const b of DEFAULT_BUILDINGS) {
      await this.setBuilding(b.name, {
        buildingName: b.name,
        submitted: false,
        indicators: {
          column: true, beam: true, wall: true, stair: true,
          ceiling: true, window: true, water_elec: true, crack: true
        },
        notes: {}
      });
    }

    // 重置系統全域狀態
    await this.setSystemState({
      securityMode: 'drill',
      simTimeMode: 'auto',
      siteLocked: false,
      approvedCustomTotal: null,
      visitorCounts: { student: 0, teacher: 0, parent: 0, vendor: 0 }
    });

    return { success: true };
  }

  // ============================================================================
  // 12. onSnapshot 即時伺服器推播訂閱器 (<500ms 廣播延遲)
  // ============================================================================

  subscribeClassReports(callback, onError) {
    return this.onSnapshot(this.collection('class_reports'), snap => {
      const reports = {};
      for (const d of snap.docs) {
        reports[d.id] = d.data();
      }
      callback(reports, snap);
    }, onError);
  }

  subscribePullouts(callback, onError) {
    return this.onSnapshot(this.collection('pullouts'), snap => {
      const pullouts = {};
      for (const d of snap.docs) {
        pullouts[d.id] = d.data().status;
      }
      callback(pullouts, snap);
    }, onError);
  }

  subscribeRescues(callback, onError) {
    return this.onSnapshot(this.collection('rescues'), snap => {
      const rescues = {};
      for (const d of snap.docs) {
        rescues[d.id] = d.data();
      }
      callback(rescues, snap);
    }, onError);
  }

  subscribeContacts(callback, onError) {
    return this.onSnapshot(this.collection('contacts'), snap => {
      const contacts = {};
      const helpRequests = {};
      for (const d of snap.docs) {
        const item = d.data();
        contacts[d.id] = item;
        if (item.isHelpReq || item.helpRequested) {
          helpRequests[d.id] = true;
        }
      }
      callback({ contacts, helpRequests }, snap);
    }, onError);
  }

  subscribeVisitors(callback, onError) {
    return this.onSnapshot(this.collection('visitors'), snap => {
      const visitors = snap.docs.map(d => d.data());
      callback(visitors, snap);
    }, onError);
  }

  subscribeBuildings(callback, onError) {
    return this.onSnapshot(this.collection('buildings'), snap => {
      const buildings = {};
      for (const d of snap.docs) {
        buildings[d.id] = d.data();
      }
      callback(buildings, snap);
    }, onError);
  }

  subscribeSystemState(callback, onError) {
    return this.onSnapshot(this.doc('system_config', 'state'), snap => {
      const state = snap.exists() ? snap.data() : {
        securityMode: 'drill',
        simTimeMode: 'auto',
        siteLocked: false,
        approvedCustomTotal: null,
        visitorCounts: { student: 0, teacher: 0, parent: 0, vendor: 0 }
      };
      callback(state, snap);
    }, onError);
  }

  subscribeStudents(callback, onError) {
    return this.onSnapshot(this.collection('students'), snap => {
      const students = snap.docs.map(d => d.data());
      callback(students, snap);
    }, onError);
  }

  // ----------------------------------------------------------------------------
  // PROJECT.md 介面契約別名 (subscribeTo*)
  // ----------------------------------------------------------------------------
  subscribeToClassReports(cb, err) { return this.subscribeClassReports(cb, err); }
  subscribeToPullouts(cb, err) { return this.subscribePullouts(cb, err); }
  subscribeToRescues(cb, err) { return this.subscribeRescues(cb, err); }
  subscribeToContacts(cb, err) { return this.subscribeContacts(cb, err); }
  subscribeToVisitors(cb, err) { return this.subscribeVisitors(cb, err); }
  subscribeToBuildings(cb, err) { return this.subscribeBuildings(cb, err); }
  subscribeToSystemState(cb, err) { return this.subscribeSystemState(cb, err); }
  subscribeToStudents(cb, err) { return this.subscribeStudents(cb, err); }
}

// 建立全域單例
export const firestoreService = new FirestoreService();

// 掛載至全域
if (typeof window !== 'undefined') {
  window.FirestoreService = firestoreService;
}
if (typeof globalThis !== 'undefined') {
  globalThis.FirestoreService = firestoreService;
}

export default firestoreService;
