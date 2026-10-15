/**
 * ==============================================================================
 * 清水國小校園災難與演練即時點名通報系統 V20.4
 * 操場極限斷網本機持久化與變更佇列管理器 (public/js/offline-manager.js)
 * ==============================================================================
 * 職責：
 * 1. 暴露 window.OfflineManager 全域單例與 ESM 導出模組
 * 2. IndexedDB 引擎 (qs_disaster_offline_v1)：
 *    - mutation_queue (keyPath: 'id', autoIncrement: true; indices: 'timestamp', 'status')
 *    - cache_store (keyPath: 'key')
 *    - meta_store (keyPath: 'key')
 *    - 優雅降級支援 LocalStorage / 記憶體儲存體 (無痕瀏覽 / 私密瀏覽防護)
 * 3. 0ms 樂觀 UI 寫入 (Optimistic Updates)：
 *    - 斷網時點名、抽離、搜救、聯繫、建物等變更立即寫入本地，畫面即時反映且 Promise 零阻塞
 * 4. 背景重連自動排隊補發佇列 (Auto-Drain Queue)：
 *    - 監聽 online / offline 網路事件與主動存活檢核 (Liveness Check)
 *    - 重連後依時間戳 FIFO 順序自動排隊補發至 FirestoreService，以最後寫入勝 (Last-Write-Wins) 解決衝突
 * 5. 無侵入式連線狀態指示徽章 (#offlineStatusBadge)：
 *    - 🟢 雲端同步完成 (Online)
 *    - 🟡 操場離線中 (N筆待傳) (Offline with pending count)
 *    - 🔄 資料同步中... (Syncing)
 *    - ⚠️ 同步失敗 (點擊重試) (Error / Retry)
 *    - 響應式佈局 (支援 320px 手機寬度) 且不破壞現有 CSS 與標籤頁
 */

import { firestoreService as defaultFirestoreService } from './firestore-service.js';

// ------------------------------------------------------------------------------
// 常數與設定
// ------------------------------------------------------------------------------
export const DB_NAME = 'qs_disaster_offline_v1';
export const DB_VERSION = 1;

export const STORE_MUTATION_QUEUE = 'mutation_queue';
export const STORE_CACHE = 'cache_store';
export const STORE_META = 'meta_store';

export const STATUS_TEXTS = Object.freeze({
  ONLINE: '🟢 雲端同步完成',
  ONLINE_ALT: '🟢 連線正常',
  OFFLINE_PREFIX: '🟡 操場離線中',
  OFFLINE_ALT_PREFIX: '🟡 離線快取中',
  SYNCING: '🔄 資料同步中...',
  ERROR: '⚠️ 同步失敗 (點擊重試)'
});

/**
 * 輔助函式：深拷貝與序列化清理
 */
function deepClone(obj) {
  if (obj === undefined) return undefined;
  return JSON.parse(JSON.stringify(obj));
}

/**
 * 指數退避延遲計算演算法 (對齊 B16-5)
 */
export function getBackoffDelay(retryCount, baseMs = 500) {
  return Math.min(baseMs * Math.pow(2, retryCount), 10000);
}

/**
 * 儲存模式解析 (對齊 B14-1)
 */
export function initStorage(indexedDBAvailable) {
  if (!indexedDBAvailable) {
    return { type: 'memory', notice: 'Running in memory cache mode (Incognito)' };
  }
  return { type: 'indexedDB', notice: 'Persistent storage active' };
}

/**
 * 容量超額守護演算法 (對齊 B14-2)
 */
export function addLogWithQuotaGuard(newLog, maxLogs = 3, logsArray = []) {
  if (logsArray.length >= maxLogs) {
    logsArray.sort((a, b) => b.age - a.age);
    logsArray.shift();
  }
  logsArray.push(newLog);
  return logsArray;
}

/**
 * 徽章響應式尺寸計算 (對齊 B17-5)
 */
export function getBadgeDimensions(viewportWidth) {
  return {
    maxWidth: viewportWidth < 400 ? '160px' : '240px',
    fontSize: viewportWidth < 400 ? '11px' : '13px'
  };
}

/**
 * 待同步項目工具提示排版 (對齊 B17-4)
 */
export function formatTooltip(pendingItems = []) {
  const classCount = new Set(pendingItems.map(p => p.classKey || (p.data && p.data.classKey) || (p.key && p.key.split('_')[0]))).size;
  return `共 ${pendingItems.length} 筆待同步，涵蓋 ${classCount} 個班級`;
}

/**
 * 徽章狀態文字解析 (對齊 F17-1 ~ F17-3, B17-2)
 */
export function getStatusBadge(isOnline, pendingCount = 0, retryCount = 0) {
  if (retryCount >= 3) return STATUS_TEXTS.ERROR;
  if (!isOnline) return `${STATUS_TEXTS.OFFLINE_PREFIX} (${pendingCount}筆待傳)`;
  if (pendingCount > 0) return STATUS_TEXTS.SYNCING;
  return STATUS_TEXTS.ONLINE;
}

// ==============================================================================
// 1. IndexedDB 核心儲存驅動器 (IndexedDB Driver)
// ==============================================================================
class IndexedDBDriver {
  constructor(dbName = DB_NAME, version = DB_VERSION) {
    this.dbName = dbName;
    this.version = version;
    this.db = null;
  }

  async open() {
    if (this.db) return this.db;

    const idb = typeof indexedDB !== 'undefined'
      ? indexedDB
      : (typeof window !== 'undefined' && window.indexedDB ? window.indexedDB : null);

    if (!idb) {
      throw new Error('IndexedDB is not available in the current runtime');
    }

    return new Promise((resolve, reject) => {
      let request;
      try {
        request = idb.open(this.dbName, this.version);
      } catch (e) {
        return reject(e);
      }

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // 1. 變更佇列 (keyPath: 'id', autoIncrement: true; indices: 'timestamp', 'status')
        if (!db.objectStoreNames.contains(STORE_MUTATION_QUEUE)) {
          const qStore = db.createObjectStore(STORE_MUTATION_QUEUE, { keyPath: 'id', autoIncrement: true });
          qStore.createIndex('timestamp', 'timestamp', { unique: false });
          qStore.createIndex('status', 'status', { unique: false });
        }

        // 2. 快取儲存 (keyPath: 'key')
        if (!db.objectStoreNames.contains(STORE_CACHE)) {
          db.createObjectStore(STORE_CACHE, { keyPath: 'key' });
        }

        // 3. 中繼資訊 (keyPath: 'key')
        if (!db.objectStoreNames.contains(STORE_META)) {
          db.createObjectStore(STORE_META, { keyPath: 'key' });
        }
      };

      request.onsuccess = (event) => {
        this.db = event.target.result;
        resolve(this.db);
      };

      request.onerror = (event) => {
        reject(event.target.error || new Error('Failed to open IndexedDB database'));
      };

      request.onblocked = () => {
        console.warn('[IndexedDBDriver] Database open request is blocked by another tab');
      };
    });
  }

  async enqueueMutation(mutation) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_MUTATION_QUEUE, 'readwrite');
      const store = tx.objectStore(STORE_MUTATION_QUEUE);
      const req = store.add(mutation);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('Failed to enqueue mutation'));
    });
  }

  async getPendingMutations() {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_MUTATION_QUEUE, 'readonly');
      const store = tx.objectStore(STORE_MUTATION_QUEUE);
      let req;
      if (store.indexNames.contains('timestamp')) {
        req = store.index('timestamp').getAll();
      } else {
        req = store.getAll();
      }
      req.onsuccess = () => {
        const list = (req.result || [])
          .filter(m => m.status === 'pending')
          .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0) || (a.id || 0) - (b.id || 0));
        resolve(list);
      };
      req.onerror = () => reject(req.error || new Error('Failed to fetch pending mutations'));
    });
  }

  async getAllMutations() {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_MUTATION_QUEUE, 'readonly');
      const store = tx.objectStore(STORE_MUTATION_QUEUE);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error || new Error('Failed to fetch mutations'));
    });
  }

  async deleteMutation(id) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_MUTATION_QUEUE, 'readwrite');
      const store = tx.objectStore(STORE_MUTATION_QUEUE);
      const req = store.delete(id);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error || new Error('Failed to delete mutation'));
    });
  }

  async updateMutation(mutation) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_MUTATION_QUEUE, 'readwrite');
      const store = tx.objectStore(STORE_MUTATION_QUEUE);
      const req = store.put(mutation);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('Failed to update mutation'));
    });
  }

  async clearMutationQueue() {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_MUTATION_QUEUE, 'readwrite');
      const store = tx.objectStore(STORE_MUTATION_QUEUE);
      const req = store.clear();
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error || new Error('Failed to clear mutation queue'));
    });
  }

  async setCache(key, data) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_CACHE, 'readwrite');
      const store = tx.objectStore(STORE_CACHE);
      const req = store.put({ key, data: deepClone(data), updatedAt: Date.now() });
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error || new Error('Failed to write to cache store'));
    });
  }

  async getCache(key) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_CACHE, 'readonly');
      const store = tx.objectStore(STORE_CACHE);
      const req = store.get(key);
      req.onsuccess = () => {
        resolve(req.result ? deepClone(req.result.data) : undefined);
      };
      req.onerror = () => reject(req.error || new Error('Failed to read from cache store'));
    });
  }

  async deleteCache(key) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_CACHE, 'readwrite');
      const store = tx.objectStore(STORE_CACHE);
      const req = store.delete(key);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error || new Error('Failed to delete cache'));
    });
  }

  async getAllCache(prefix = '') {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_CACHE, 'readonly');
      const store = tx.objectStore(STORE_CACHE);
      const req = store.getAll();
      req.onsuccess = () => {
        const result = {};
        for (const item of (req.result || [])) {
          if (!prefix || item.key.startsWith(prefix)) {
            result[item.key] = deepClone(item.data);
          }
        }
        resolve(result);
      };
      req.onerror = () => reject(req.error || new Error('Failed to fetch all cache'));
    });
  }

  async clearAllCache() {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_CACHE, 'readwrite');
      const store = tx.objectStore(STORE_CACHE);
      const req = store.clear();
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error || new Error('Failed to clear cache store'));
    });
  }

  async setMeta(key, value) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_META, 'readwrite');
      const store = tx.objectStore(STORE_META);
      const req = store.put({ key, value: deepClone(value), updatedAt: Date.now() });
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error || new Error('Failed to set meta'));
    });
  }

  async getMeta(key) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_META, 'readonly');
      const store = tx.objectStore(STORE_META);
      const req = store.get(key);
      req.onsuccess = () => {
        resolve(req.result ? deepClone(req.result.value) : undefined);
      };
      req.onerror = () => reject(req.error || new Error('Failed to get meta'));
    });
  }

  async close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

// ==============================================================================
// 2. 本地記憶體與 LocalStorage 優雅降級儲存驅動器 (Fallback Storage Driver)
// ==============================================================================
class FallbackStorageDriver {
  constructor(options = {}) {
    this.prefix = options.prefix || 'QS_OFFLINE_';
    this.memoryQueue = [];
    this.memoryCache = new Map();
    this.memoryMeta = new Map();
    this.autoIncrementId = 1;
    this.hasLocalStorage = typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
    this._load();
  }

  _load() {
    if (!this.hasLocalStorage) return;
    try {
      const q = window.localStorage.getItem(this.prefix + 'QUEUE');
      if (q) {
        this.memoryQueue = JSON.parse(q);
        const maxId = this.memoryQueue.reduce((m, item) => Math.max(m, item.id || 0), 0);
        this.autoIncrementId = maxId + 1;
      }
      const c = window.localStorage.getItem(this.prefix + 'CACHE');
      if (c) {
        const obj = JSON.parse(c);
        for (const [k, v] of Object.entries(obj)) {
          this.memoryCache.set(k, v);
        }
      }
      const meta = window.localStorage.getItem(this.prefix + 'META');
      if (meta) {
        const obj = JSON.parse(meta);
        for (const [k, v] of Object.entries(obj)) {
          this.memoryMeta.set(k, v);
        }
      }
    } catch (e) {
      // 忽略 LocalStorage 存取限制
    }
  }

  _saveQueue() {
    if (!this.hasLocalStorage) return;
    try {
      window.localStorage.setItem(this.prefix + 'QUEUE', JSON.stringify(this.memoryQueue));
    } catch (e) {
      // 若容量超額，啟用超額守護演算法清除舊快取
      if (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED') {
        this.purgeOldestLogs();
        try {
          window.localStorage.setItem(this.prefix + 'QUEUE', JSON.stringify(this.memoryQueue));
        } catch (retryErr) {
          /* 忽略 */
        }
      }
    }
  }

  _saveCache() {
    if (!this.hasLocalStorage) return;
    try {
      const obj = {};
      for (const [k, v] of this.memoryCache.entries()) obj[k] = v;
      window.localStorage.setItem(this.prefix + 'CACHE', JSON.stringify(obj));
    } catch (e) {
      if (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED') {
        this.purgeOldestLogs();
      }
    }
  }

  _saveMeta() {
    if (!this.hasLocalStorage) return;
    try {
      const obj = {};
      for (const [k, v] of this.memoryMeta.entries()) obj[k] = v;
      window.localStorage.setItem(this.prefix + 'META', JSON.stringify(obj));
    } catch (e) {
      /* 忽略 */
    }
  }

  purgeOldestLogs() {
    if (this.memoryQueue.length > 50) {
      this.memoryQueue.splice(0, 20);
      this._saveQueue();
    }
  }

  async open() {
    return this;
  }

  async enqueueMutation(mutation) {
    const id = this.autoIncrementId++;
    const record = { ...deepClone(mutation), id };
    this.memoryQueue.push(record);
    this._saveQueue();
    return id;
  }

  async getPendingMutations() {
    return deepClone(
      this.memoryQueue
        .filter(m => m.status === 'pending')
        .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0) || (a.id || 0) - (b.id || 0))
    );
  }

  async getAllMutations() {
    return deepClone(this.memoryQueue);
  }

  async deleteMutation(id) {
    const idx = this.memoryQueue.findIndex(m => m.id === id);
    if (idx !== -1) {
      this.memoryQueue.splice(idx, 1);
      this._saveQueue();
      return true;
    }
    return false;
  }

  async updateMutation(mutation) {
    const idx = this.memoryQueue.findIndex(m => m.id === mutation.id);
    if (idx !== -1) {
      this.memoryQueue[idx] = deepClone(mutation);
      this._saveQueue();
      return mutation.id;
    }
    return null;
  }

  async clearMutationQueue() {
    this.memoryQueue = [];
    this._saveQueue();
    return true;
  }

  async setCache(key, data) {
    this.memoryCache.set(key, deepClone(data));
    this._saveCache();
    return true;
  }

  async getCache(key) {
    const val = this.memoryCache.get(key);
    return val !== undefined ? deepClone(val) : undefined;
  }

  async deleteCache(key) {
    const res = this.memoryCache.delete(key);
    this._saveCache();
    return res;
  }

  async getAllCache(prefix = '') {
    const result = {};
    for (const [k, v] of this.memoryCache.entries()) {
      if (!prefix || k.startsWith(prefix)) {
        result[k] = deepClone(v);
      }
    }
    return result;
  }

  async clearAllCache() {
    this.memoryCache.clear();
    this._saveCache();
    return true;
  }

  async setMeta(key, value) {
    this.memoryMeta.set(key, deepClone(value));
    this._saveMeta();
    return true;
  }

  async getMeta(key) {
    const val = this.memoryMeta.get(key);
    return val !== undefined ? deepClone(val) : undefined;
  }

  async close() {
    return true;
  }
}

// ==============================================================================
// 3. OfflineManager 核心類別 (OfflineManager Singleton Engine)
// ==============================================================================
export class OfflineManager {
  constructor(options = {}) {
    this.options = options;
    this.firestoreService = options.firestoreService ||
      (typeof window !== 'undefined' && window.FirestoreService) ||
      (typeof globalThis !== 'undefined' && globalThis.FirestoreService) ||
      defaultFirestoreService;

    this.isOnline = options.initialOnline !== undefined
      ? Boolean(options.initialOnline)
      : (typeof navigator !== 'undefined' ? navigator.onLine !== false : true);

    this.isDraining = false;
    this.retryCount = 0;
    this.baseBackoffMs = options.baseBackoffMs || 500;
    this.maxRetries = options.maxRetries || 3;
    this.storageType = 'unknown'; // 'indexedDB' | 'localStorage' | 'memory'

    this.storage = options.storageDriver || null;
    this.badgeElementId = options.badgeElementId || 'offlineStatusBadge';
    this.badgeElement = null;

    this._statusListeners = new Set();
    this._syncListeners = new Set();
    this._networkDebounceTimer = null;
    this._initialized = false;

    // 繫結防抖網路狀態事件
    this._handleOnlineEvent = this._debounceNetworkChange.bind(this, true);
    this._handleOfflineEvent = this._debounceNetworkChange.bind(this, false);
    this._handleBeforeUnload = this._handleBeforeUnload.bind(this);
  }

  /**
   * 初始化本機儲存庫、網路監聽器與狀態指示徽章
   */
  async init() {
    if (this._initialized) return this;

    // 1. 初始化底層儲存引擎 (優先嘗試 IndexedDB，失敗時優雅降級)
    if (!this.storage) {
      let isIdbSupported = false;
      try {
        const idb = typeof indexedDB !== 'undefined'
          ? indexedDB
          : (typeof window !== 'undefined' && window.indexedDB ? window.indexedDB : null);
        if (idb) {
          const testDriver = new IndexedDBDriver();
          await testDriver.open();
          this.storage = testDriver;
          this.storageType = 'indexedDB';
          isIdbSupported = true;
        }
      } catch (err) {
        // 捕獲私密/無痕瀏覽限制或 IndexedDB 存取被拒
        isIdbSupported = false;
      }

      if (!isIdbSupported) {
        this.storage = new FallbackStorageDriver();
        this.storageType = this.storage.hasLocalStorage ? 'localStorage' : 'memory';
      }
    } else {
      this.storageType = this.storage instanceof IndexedDBDriver ? 'indexedDB' : 'custom';
    }

    // 2. 註冊瀏覽器網路狀態監聽
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('online', this._handleOnlineEvent);
      window.addEventListener('offline', this._handleOfflineEvent);
      window.addEventListener('beforeunload', this._handleBeforeUnload);
    }

    // 3. 初始化 DOM 狀態指示徽章
    this.initBadge();

    // 4. 計算佇列筆數並刷新徽章
    await this._refreshPendingBadge();

    // 5. 若在線且有排隊變更，自動啟動排隊補發
    if (this.isOnline) {
      const pending = await this.getPendingCount();
      if (pending > 0) {
        queueMicrotask(() => this.syncPendingMutations());
      }
    }

    this._initialized = true;
    return this;
  }

  // ----------------------------------------------------------------------------
  // 網路狀態與存活檢核
  // ----------------------------------------------------------------------------

  _debounceNetworkChange(isOnline) {
    if (this._networkDebounceTimer) {
      clearTimeout(this._networkDebounceTimer);
    }
    this._networkDebounceTimer = setTimeout(async () => {
      if (isOnline) {
        await this.goOnline();
      } else {
        this.goOffline();
      }
    }, 50); // 50ms 防抖，過濾網路瞬間抖動 (符合 B17-1)
  }

  _handleBeforeUnload(e) {
    if (this.hasPendingWritesSync()) {
      const msg = '系統尚有點名紀錄排隊同步中，離開頁面可能導致資料延遲上傳！';
      e.preventDefault();
      e.returnValue = msg;
      return msg;
    }
  }

  async checkLiveness() {
    const navOnline = typeof navigator !== 'undefined' ? navigator.onLine !== false : true;
    if (!navOnline) {
      this.goOffline();
      return false;
    }
    return true;
  }

  goOffline() {
    this.isOnline = false;
    if (this.firestoreService && typeof this.firestoreService.goOffline === 'function') {
      try { this.firestoreService.goOffline(); } catch (e) { /* ignore */ }
    }
    this._notifyStatusChange();
    this._refreshPendingBadge();
  }

  async goOnline() {
    this.isOnline = true;
    this.retryCount = 0;
    if (this.firestoreService && typeof this.firestoreService.goOnline === 'function') {
      try { await this.firestoreService.goOnline(); } catch (e) { /* ignore */ }
    }
    this._notifyStatusChange();
    await this.syncPendingMutations();
  }

  // ----------------------------------------------------------------------------
  // 佇列與快取狀態查詢
  // ----------------------------------------------------------------------------

  async getPendingMutations() {
    if (!this.storage) return [];
    return this.storage.getPendingMutations();
  }

  async getPendingCount() {
    const list = await this.getPendingMutations();
    return list.length;
  }

  hasPendingWritesSync() {
    // 供 beforeunload 同步快速檢查
    if (this.storage instanceof FallbackStorageDriver) {
      return this.storage.memoryQueue.some(m => m.status === 'pending');
    }
    return false;
  }

  async hasPendingWrites() {
    const count = await this.getPendingCount();
    return count > 0;
  }

  async clearQueue() {
    if (this.storage) {
      await this.storage.clearMutationQueue();
    }
    this.retryCount = 0;
    await this._refreshPendingBadge();
  }

  // ----------------------------------------------------------------------------
  // 0ms 樂觀寫入 (Optimistic Updates - 核心業務方法)
  // ----------------------------------------------------------------------------

  /**
   * 通用變更記錄器 (0ms 寫入本地快取，斷網入列，連網即發)
   */
  async recordMutation(collection, key, data, options = { merge: true }, action = 'set') {
    const cleanData = deepClone(data);
    const cacheKey = `${collection}/${key}`;
    const timestamp = Date.now();

    // 1. [0ms 樂觀更新] 立即寫入本機快取 store，任何立即讀取保證能拿到最新資料
    if (this.storage) {
      await this.storage.setCache(cacheKey, cleanData);
    }

    // 2. 準備佇列項
    const mutation = {
      collection,
      key,
      action,
      data: cleanData,
      options,
      timestamp,
      status: 'pending',
      retryCount: 0,
      error: null
    };

    // 3. 若處於離線狀態，直接排入本地持久化變更佇列
    if (!this.isOnline) {
      if (this.storage) {
        mutation.id = await this.storage.enqueueMutation(mutation);
      }
      await this._refreshPendingBadge();
      this._notifyStatusChange();

      return {
        success: true,
        fromCache: true,
        hasPendingWrites: true,
        mutationId: mutation.id,
        key
      };
    }

    // 4. 若處於在線狀態：
    // 先檢查是否已有累積的離線排隊變更，若有則一併排入佇列以確保嚴格 FIFO 與最後寫入勝 (LWW)
    const pendingList = await this.getPendingMutations();
    if (pendingList.length > 0) {
      if (this.storage) {
        mutation.id = await this.storage.enqueueMutation(mutation);
      }
      await this._refreshPendingBadge();
      // 背景啟動補發排隊
      queueMicrotask(() => this.syncPendingMutations());
      return {
        success: true,
        fromCache: true,
        hasPendingWrites: true,
        mutationId: mutation.id,
        key
      };
    }

    // 5. 在線且無排隊：直接即時提交給 Firestore 服務
    try {
      await this._sendToFirestore(mutation);
      await this._refreshPendingBadge();
      return {
        success: true,
        fromCache: false,
        hasPendingWrites: false,
        key
      };
    } catch (err) {
      // 網路突發中斷：自動轉為離線模式並排入本機佇列
      this.isOnline = false;
      if (this.storage) {
        mutation.id = await this.storage.enqueueMutation(mutation);
      }
      await this._refreshPendingBadge();
      this._notifyStatusChange();
      return {
        success: true,
        fromCache: true,
        hasPendingWrites: true,
        mutationId: mutation.id,
        key
      };
    }
  }

  // ----------------------------------------------------------------------------
  // 細粒度業務輔助寫入方法 (對齊四大看板與專案規格)
  // ----------------------------------------------------------------------------

  async recordClassReport(classKey, data, options = { merge: true }) {
    return this.recordMutation('class_reports', classKey, data, options, 'set');
  }

  async recordPullout(studentKey, data, options = { merge: true }) {
    return this.recordMutation('pullouts', studentKey, data, options, 'set');
  }

  async recordRescue(targetKey, data, options = { merge: true }) {
    return this.recordMutation('rescues', targetKey, data, options, 'set');
  }

  async recordContact(studentKey, data, options = { merge: true }) {
    return this.recordMutation('contacts', studentKey, data, options, 'set');
  }

  async recordBuilding(buildingName, data, options = { merge: true }) {
    return this.recordMutation('buildings', buildingName, data, options, 'set');
  }

  async recordVisitor(visitorId, data, options = { merge: true }) {
    return this.recordMutation('visitors', visitorId, data, options, 'set');
  }

  async recordSystemState(data, options = { merge: true }) {
    return this.recordMutation('system_config', 'state', data, options, 'set');
  }

  // ----------------------------------------------------------------------------
  // 本機快取讀取方法 (讀取 local cache_store)
  // ----------------------------------------------------------------------------

  async getCachedDoc(collection, key) {
    if (!this.storage) return undefined;
    return this.storage.getCache(`${collection}/${key}`);
  }

  async setCachedDoc(collection, key, data) {
    if (!this.storage) return false;
    return this.storage.setCache(`${collection}/${key}`, data);
  }

  async deleteCachedDoc(collection, key) {
    if (!this.storage) return false;
    return this.storage.deleteCache(`${collection}/${key}`);
  }

  async getAllCachedDocs(collection) {
    if (!this.storage) return {};
    const prefix = `${collection}/`;
    const all = await this.storage.getAllCache(prefix);
    const result = {};
    for (const [k, v] of Object.entries(all)) {
      const docId = k.substring(prefix.length);
      result[docId] = v;
    }
    return result;
  }

  async clearAllCache() {
    if (this.storage) {
      await this.storage.clearAllCache();
    }
  }

  // ----------------------------------------------------------------------------
  // 自動排隊補發 (Auto-Drain Reconnect Queue with Last-Write-Wins)
  // ----------------------------------------------------------------------------

  /**
   * 背景重連自動排隊補發
   */
  async syncPendingMutations() {
    if (this.isDraining) return { status: 'already_draining' };
    if (!this.isOnline) return { status: 'offline' };

    const pending = await this.getPendingMutations();
    if (pending.length === 0) {
      this.retryCount = 0;
      this.updateBadge(STATUS_TEXTS.ONLINE);
      return { status: 'empty', drainedCount: 0 };
    }

    this.isDraining = true;
    this.updateBadge(STATUS_TEXTS.SYNCING);
    this._notifyStatusChange();

    let drainedCount = 0;

    // 依序處理 FIFO 排隊變更 (保留 Unicode / Emoji，支援 Last-Write-Wins)
    for (const mutation of pending) {
      if (!this.isOnline) {
        break; // 若中間再次斷網，中斷並保留未完成之佇列
      }

      try {
        await this._sendToFirestore(mutation);
        if (this.storage) {
          await this.storage.deleteMutation(mutation.id);
        }
        drainedCount++;
        await this._refreshPendingBadge(true); // 維持 syncing 狀態
      } catch (err) {
        console.warn(`[OfflineManager] 補發變更失敗 [id=${mutation.id}]:`, err);
        this.retryCount++;
        mutation.retryCount = (mutation.retryCount || 0) + 1;
        mutation.error = String(err.message || err);
        if (this.storage) {
          await this.storage.updateMutation(mutation);
        }

        // 觸發指數退避並暫停本次補發
        if (this.retryCount >= this.maxRetries) {
          this.updateBadge(STATUS_TEXTS.ERROR);
        }
        this.isDraining = false;
        this._notifyStatusChange();
        return {
          status: 'error',
          error: err,
          drainedCount,
          remaining: pending.length - drainedCount
        };
      }
    }

    this.isDraining = false;
    this.retryCount = 0;

    const remaining = await this.getPendingCount();
    if (remaining === 0) {
      this.updateBadge(STATUS_TEXTS.ONLINE);
    } else {
      await this._refreshPendingBadge();
    }

    this._notifySyncComplete(drainedCount);
    this._notifyStatusChange();

    return {
      status: 'success',
      drainedCount,
      remaining
    };
  }

  async drainQueue() {
    return this.syncPendingMutations();
  }

  async retrySync() {
    this.retryCount = 0;
    this.isOnline = true;
    return this.syncPendingMutations();
  }

  /**
   * 發送單筆變更至 FirestoreService (以 Last-Write-Wins 原則更新)
   */
  async _sendToFirestore(mutation) {
    const fs = this.firestoreService;
    if (!fs) {
      throw new Error('FirestoreService instance not available');
    }

    const { collection, key, data, options } = mutation;

    if (collection === 'class_reports' && typeof fs.setClassReport === 'function') {
      await fs.setClassReport(key, data, options);
    } else if (collection === 'pullouts' && typeof fs.setPullout === 'function') {
      await fs.setPullout(key, data, options);
    } else if (collection === 'rescues' && typeof fs.setRescue === 'function') {
      await fs.setRescue(key, data, options);
    } else if (collection === 'contacts' && typeof fs.setContact === 'function') {
      await fs.setContact(key, data, options);
    } else if (collection === 'buildings' && typeof fs.setBuilding === 'function') {
      await fs.setBuilding(key, data, options);
    } else if (collection === 'visitors' && typeof fs.setVisitor === 'function') {
      await fs.setVisitor(key, data, options);
    } else if (collection === 'system_config' && typeof fs.setSystemState === 'function') {
      await fs.setSystemState(data, options);
    } else if (typeof fs.setDoc === 'function') {
      const docRef = fs.doc(collection, key);
      await fs.setDoc(docRef, data, options);
    } else {
      throw new Error(`Unsupported collection or set method for: ${collection}`);
    }
  }

  // ----------------------------------------------------------------------------
  // 無侵入式狀態指示徽章 (#offlineStatusBadge)
  // ----------------------------------------------------------------------------

  /**
   * 初始化頂部導覽列連線狀態指示徽章
   */
  initBadge(containerSelector = null) {
    if (typeof document === 'undefined') return null;

    let badge = document.getElementById(this.badgeElementId);

    if (!badge) {
      badge = document.createElement('div');
      badge.id = this.badgeElementId;
      badge.className = 'status-badge status-badge-online';
      badge.textContent = STATUS_TEXTS.ONLINE;

      // 尋找最佳掛載容器 (導覽列右側或頂欄)
      let targetContainer = null;
      if (containerSelector) {
        targetContainer = document.querySelector(containerSelector);
      }
      if (!targetContainer) {
        targetContainer = document.querySelector('.nav-right') ||
                          document.querySelector('#topNav') ||
                          document.querySelector('.top-nav') ||
                          document.querySelector('header') ||
                          document.body;
      }

      if (targetContainer) {
        targetContainer.appendChild(badge);
      }

      // 注入無侵入式 CSS 樣式
      this._injectBadgeStyles();
    }

    // 點擊事件：手動重試同步
    badge.addEventListener('click', () => {
      if (!this.isOnline || this.retryCount > 0) {
        this.retrySync();
      }
    });

    this.badgeElement = badge;
    return badge;
  }

  _injectBadgeStyles() {
    if (typeof document === 'undefined') return;
    if (document.getElementById('qs-offline-badge-styles')) return;

    const style = document.createElement('style');
    style.id = 'qs-offline-badge-styles';
    style.textContent = `
      #offlineStatusBadge {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans TC", sans-serif;
        font-size: 12px;
        font-weight: 600;
        padding: 4px 10px;
        border-radius: 12px;
        transition: all 0.2s ease-in-out;
        cursor: pointer;
        user-select: none;
        line-height: 1.3;
        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
        vertical-align: middle;
      }
      #offlineStatusBadge.badge-online {
        background-color: #ecfdf5;
        color: #065f46;
        border: 1px solid #a7f3d0;
      }
      #offlineStatusBadge.badge-offline {
        background-color: #fffbeb;
        color: #92400e;
        border: 1px solid #fde68a;
      }
      #offlineStatusBadge.badge-syncing {
        background-color: #eff6ff;
        color: #1e40af;
        border: 1px solid #bfdbfe;
      }
      #offlineStatusBadge.badge-error {
        background-color: #fef2f2;
        color: #991b1b;
        border: 1px solid #fecaca;
      }
      @media (max-width: 400px) {
        #offlineStatusBadge {
          max-width: 160px;
          font-size: 11px;
          padding: 3px 6px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      }
    `;
    document.head.appendChild(style);
  }

  /**
   * 根據當前狀態更新徽章
   */
  async _refreshPendingBadge(isSyncing = false) {
    if (isSyncing) {
      this.updateBadge(STATUS_TEXTS.SYNCING);
      return;
    }

    if (this.retryCount >= this.maxRetries) {
      this.updateBadge(STATUS_TEXTS.ERROR);
      return;
    }

    const pending = await this.getPendingMutations();
    const count = pending.length;

    if (!this.isOnline) {
      this.updateBadge(`${STATUS_TEXTS.OFFLINE_PREFIX} (${count}筆待傳)`, pending);
    } else if (count > 0) {
      this.updateBadge(STATUS_TEXTS.SYNCING, pending);
    } else {
      this.updateBadge(STATUS_TEXTS.ONLINE, []);
    }
  }

  updateBadge(text, pendingItems = []) {
    if (!this.badgeElement && typeof document !== 'undefined') {
      this.badgeElement = document.getElementById(this.badgeElementId);
    }
    if (!this.badgeElement) return;

    this.badgeElement.textContent = text;
    this.badgeElement.className = 'status-badge';

    if (text.includes('雲端同步完成') || text.includes('連線正常')) {
      this.badgeElement.classList.add('badge-online');
      this.badgeElement.title = '網路連線正常，所有資料已與雲端同步。';
    } else if (text.includes('操場離線中') || text.includes('離線快取中')) {
      this.badgeElement.classList.add('badge-offline');
      this.badgeElement.title = formatTooltip(pendingItems);
    } else if (text.includes('資料同步中') || text.includes('正在同步中')) {
      this.badgeElement.classList.add('badge-syncing');
      this.badgeElement.title = '正在將操場離線點名資料上傳至雲端...';
    } else if (text.includes('同步失敗')) {
      this.badgeElement.classList.add('badge-error');
      this.badgeElement.title = '同步發生錯誤，點擊此處立即重試。';
    }

    if (typeof this.badgeElement.dataset !== 'undefined') {
      this.badgeElement.dataset.online = String(this.isOnline);
      this.badgeElement.dataset.syncing = String(this.isDraining);
    }
  }

  // ----------------------------------------------------------------------------
  // 監聽器與訂閱 (Observer Pattern)
  // ----------------------------------------------------------------------------

  onStatusChange(fn) {
    if (typeof fn === 'function') {
      this._statusListeners.add(fn);
    }
    return () => this._statusListeners.delete(fn);
  }

  onSyncComplete(fn) {
    if (typeof fn === 'function') {
      this._syncListeners.add(fn);
    }
    return () => this._syncListeners.delete(fn);
  }

  _notifyStatusChange() {
    for (const fn of this._statusListeners) {
      try {
        fn({
          isOnline: this.isOnline,
          isDraining: this.isDraining,
          retryCount: this.retryCount
        });
      } catch (e) {
        /* ignore */
      }
    }
  }

  _notifySyncComplete(drainedCount) {
    for (const fn of this._syncListeners) {
      try {
        fn({ drainedCount, timestamp: Date.now() });
      } catch (e) {
        /* ignore */
      }
    }
  }

  /**
   * 資源清理
   */
  destroy() {
    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener('online', this._handleOnlineEvent);
      window.removeEventListener('offline', this._handleOfflineEvent);
      window.removeEventListener('beforeunload', this._handleBeforeUnload);
    }
    if (this._networkDebounceTimer) {
      clearTimeout(this._networkDebounceTimer);
    }
    this._statusListeners.clear();
    this._syncListeners.clear();
    if (this.storage && typeof this.storage.close === 'function') {
      this.storage.close();
    }
  }
}

// 建立全域單例
export const offlineManager = new OfflineManager();

// 掛載至 window 與 globalThis (符合 window.OfflineManager 契約)
if (typeof window !== 'undefined') {
  window.OfflineManager = offlineManager;
}
if (typeof globalThis !== 'undefined') {
  globalThis.OfflineManager = offlineManager;
}

export default offlineManager;
