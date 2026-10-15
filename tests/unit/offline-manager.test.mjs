import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  OfflineManager,
  offlineManager,
  DB_NAME,
  DB_VERSION,
  STORE_MUTATION_QUEUE,
  STORE_CACHE,
  STORE_META,
  STATUS_TEXTS,
  getStatusBadge,
  getBackoffDelay,
  initStorage,
  addLogWithQuotaGuard,
  getBadgeDimensions,
  formatTooltip
} from '../../public/js/offline-manager.js';
import { MockFirestore } from '../helpers/mock-firestore.mjs';

describe('Unit Tests: OfflineManager (Milestone 4)', () => {
  let mgr;
  let mockFs;

  beforeEach(async () => {
    mockFs = new MockFirestore();
    mgr = new OfflineManager({
      firestoreService: mockFs,
      initialOnline: true,
      maxRetries: 3
    });
    await mgr.init();
    await mgr.clearQueue();
    await mgr.clearAllCache();
  });

  describe('1. Global Singleton & Export Bindings', () => {
    it('1.1 offlineManager singleton is exported and attached to globalThis', () => {
      assert.ok(offlineManager instanceof OfflineManager);
      assert.equal(typeof globalThis.OfflineManager, 'object');
      assert.equal(globalThis.OfflineManager, offlineManager);
    });

    it('1.2 Database constants match exact milestone specifications', () => {
      assert.equal(DB_NAME, 'qs_disaster_offline_v1');
      assert.equal(DB_VERSION, 1);
      assert.equal(STORE_MUTATION_QUEUE, 'mutation_queue');
      assert.equal(STORE_CACHE, 'cache_store');
      assert.equal(STORE_META, 'meta_store');
    });

    it('1.3 Helper utilities comply with specification and boundary rules', () => {
      // B14-1
      assert.equal(initStorage(false).type, 'memory');
      assert.ok(initStorage(false).notice.includes('Incognito'));
      assert.equal(initStorage(true).type, 'indexedDB');

      // B16-5
      assert.equal(getBackoffDelay(0), 500);
      assert.equal(getBackoffDelay(1), 1000);
      assert.equal(getBackoffDelay(2), 2000);
      assert.equal(getBackoffDelay(5), 10000);

      // B17-5
      assert.equal(getBadgeDimensions(320).maxWidth, '160px');
      assert.equal(getBadgeDimensions(320).fontSize, '11px');
      assert.equal(getBadgeDimensions(500).maxWidth, '240px');

      // B14-2
      const logs = [{ id: 1, age: 100 }, { id: 2, age: 50 }, { id: 3, age: 10 }];
      addLogWithQuotaGuard({ id: 4, age: 0 }, 3, logs);
      assert.equal(logs.length, 3);
      assert.equal(logs.some(l => l.id === 1), false);
    });

    it('1.4 IndexedDB Driver initializes qs_disaster_offline_v1 with required stores and indices', async () => {
      // Create mock IndexedDB environment
      const mockStores = new Map();
      const mockDb = {
        name: DB_NAME,
        version: DB_VERSION,
        objectStoreNames: {
          contains: (n) => mockStores.has(n)
        },
        createObjectStore: (name, opts) => {
          const indices = new Map();
          const storeData = new Map();
          let autoId = 1;
          const storeObj = {
            name,
            keyPath: opts.keyPath,
            autoIncrement: opts.autoIncrement,
            indices,
            data: storeData,
            indexNames: { contains: (idx) => indices.has(idx) },
            createIndex: (idxName, kPath, iOpts) => {
              indices.set(idxName, { keyPath: kPath, ...iOpts });
            },
            index: (idxName) => ({
              getAll: () => ({
                result: Array.from(storeData.values()),
                set onsuccess(cb) { queueMicrotask(cb); }
              })
            }),
            add: (item) => {
              const id = opts.autoIncrement ? autoId++ : item[opts.keyPath];
              const rec = { ...item, id };
              storeData.set(id, rec);
              return { result: id, set onsuccess(cb) { queueMicrotask(cb); } };
            },
            put: (item) => {
              const k = item[opts.keyPath];
              storeData.set(k, item);
              return { result: k, set onsuccess(cb) { queueMicrotask(cb); } };
            },
            get: (k) => ({
              result: storeData.get(k),
              set onsuccess(cb) { queueMicrotask(cb); }
            }),
            getAll: () => ({
              result: Array.from(storeData.values()),
              set onsuccess(cb) { queueMicrotask(cb); }
            }),
            delete: (k) => {
              storeData.delete(k);
              return { result: undefined, set onsuccess(cb) { queueMicrotask(cb); } };
            },
            clear: () => {
              storeData.clear();
              return { result: undefined, set onsuccess(cb) { queueMicrotask(cb); } };
            }
          };
          mockStores.set(name, storeObj);
          return storeObj;
        },
        transaction: (storeNames, mode) => {
          const sName = Array.isArray(storeNames) ? storeNames[0] : storeNames;
          const store = mockStores.get(sName);
          return {
            objectStore: () => store,
            set oncomplete(cb) { queueMicrotask(cb); }
          };
        },
        close: () => {}
      };

      const mockIndexedDB = {
        open: (name, version) => {
          assert.equal(name, 'qs_disaster_offline_v1');
          assert.equal(version, 1);
          const req = {
            set onupgradeneeded(cb) {
              queueMicrotask(() => {
                cb({ target: { result: mockDb } });
                if (req.onsuccess) req.onsuccess({ target: { result: mockDb } });
              });
            },
            set onsuccess(cb) { this._success = cb; },
            get onsuccess() { return this._success; }
          };
          return req;
        }
      };

      const originalIDB = globalThis.indexedDB;
      globalThis.indexedDB = mockIndexedDB;

      try {
        const idbMgr = new OfflineManager({
          firestoreService: mockFs,
          initialOnline: false
        });
        await idbMgr.init();

        assert.equal(idbMgr.storageType, 'indexedDB');

        // Verify Object Stores
        assert.ok(mockStores.has(STORE_MUTATION_QUEUE));
        assert.ok(mockStores.has(STORE_CACHE));
        assert.ok(mockStores.has(STORE_META));

        const qStore = mockStores.get(STORE_MUTATION_QUEUE);
        assert.equal(qStore.keyPath, 'id');
        assert.equal(qStore.autoIncrement, true);
        assert.ok(qStore.indices.has('timestamp'));
        assert.equal(qStore.indices.get('timestamp').keyPath, 'timestamp');
        assert.equal(qStore.indices.get('timestamp').unique, false);
        assert.ok(qStore.indices.has('status'));
        assert.equal(qStore.indices.get('status').keyPath, 'status');
        assert.equal(qStore.indices.get('status').unique, false);

        const cacheStore = mockStores.get(STORE_CACHE);
        assert.equal(cacheStore.keyPath, 'key');

        const metaStore = mockStores.get(STORE_META);
        assert.equal(metaStore.keyPath, 'key');

        // Verify operations work through IndexedDBDriver
        await idbMgr.recordClassReport('一 1', { presentCount: 27 });
        const pending = await idbMgr.getPendingMutations();
        assert.equal(pending.length, 1);
        assert.equal(pending[0].data.presentCount, 27);

        idbMgr.destroy();
      } finally {
        globalThis.indexedDB = originalIDB;
      }
    });
  });

  describe('2. 0ms Optimistic UI Updates & Cache Reflection', () => {
    it('2.1 Offline roll call write returns immediately with fromCache and hasPendingWrites flags', async () => {
      mgr.goOffline();
      assert.equal(mgr.isOnline, false);

      const result = await mgr.recordClassReport('一 1', {
        total: 28,
        presentCount: 26,
        leaveCount: 2,
        missingCount: 0
      });

      assert.equal(result.success, true);
      assert.equal(result.fromCache, true);
      assert.equal(result.hasPendingWrites, true);
      assert.equal(result.key, '一 1');

      // 0ms cache read reflects update immediately
      const cached = await mgr.getCachedDoc('class_reports', '一 1');
      assert.ok(cached);
      assert.equal(cached.presentCount, 26);
      assert.equal(cached.leaveCount, 2);
    });

    it('2.2 Offline pullout record writes to local cache and queues mutation', async () => {
      mgr.goOffline();
      const sKey = '二 1_05號';

      const res = await mgr.recordPullout(sKey, {
        studentKey: sKey,
        status: 'pending',
        type: 'studyCenter'
      });

      assert.equal(res.success, true);
      assert.equal(res.fromCache, true);

      const cached = await mgr.getCachedDoc('pullouts', sKey);
      assert.equal(cached.status, 'pending');
      assert.equal(cached.type, 'studyCenter');

      const count = await mgr.getPendingCount();
      assert.equal(count, 1);
    });

    it('2.3 Offline rescue, contact, and building records update cache seamlessly', async () => {
      mgr.goOffline();

      await mgr.recordRescue('三 1_10號', { triage: 'yellow', escortCount: 2, searchDone: false });
      await mgr.recordContact('三 1_10號', { status: '聯繫中', count: 3, isHelpReq: false });
      await mgr.recordBuilding('慈愛樓', { submitted: true, indicators: { column: true, beam: true } });

      const rescue = await mgr.getCachedDoc('rescues', '三 1_10號');
      const contact = await mgr.getCachedDoc('contacts', '三 1_10號');
      const building = await mgr.getCachedDoc('buildings', '慈愛樓');

      assert.equal(rescue.triage, 'yellow');
      assert.equal(contact.count, 3);
      assert.equal(building.submitted, true);

      assert.equal(await mgr.getPendingCount(), 3);
    });

    it('2.4 getAllCachedDocs aggregates all entries under a collection namespace', async () => {
      mgr.goOffline();
      await mgr.recordClassReport('一 1', { presentCount: 28 });
      await mgr.recordClassReport('一 2', { presentCount: 27 });
      await mgr.recordClassReport('二 1', { presentCount: 26 });

      const all = await mgr.getAllCachedDocs('class_reports');
      assert.equal(Object.keys(all).length, 3);
      assert.equal(all['一 1'].presentCount, 28);
      assert.equal(all['一 2'].presentCount, 27);
      assert.equal(all['二 1'].presentCount, 26);
    });
  });

  describe('3. Background Reconnect Auto-Drain & Last-Write-Wins', () => {
    it('3.1 Multiple offline mutations queue in strict FIFO chronological order', async () => {
      mgr.goOffline();

      await mgr.recordClassReport('一 1', { step: 1, text: 'First' });
      await mgr.recordClassReport('一 1', { step: 2, text: 'Second' });
      await mgr.recordClassReport('一 1', { step: 3, text: 'Third' });

      const pending = await mgr.getPendingMutations();
      assert.equal(pending.length, 3);
      assert.equal(pending[0].data.step, 1);
      assert.equal(pending[1].data.step, 2);
      assert.equal(pending[2].data.step, 3);
    });

    it('3.2 goOnline automatically drains all queued mutations to FirestoreService with Last-Write-Wins', async () => {
      mgr.goOffline();

      // Teacher edits Class A twice while offline
      await mgr.recordClassReport('一 1', { total: 28, presentCount: 25, leaveCount: 3 });
      await mgr.recordClassReport('一 1', { total: 28, presentCount: 27, leaveCount: 1 });

      // Teacher edits Class B
      await mgr.recordClassReport('一 2', { total: 28, presentCount: 28, leaveCount: 0 });

      assert.equal(await mgr.getPendingCount(), 3);

      // Reconnect
      await mgr.goOnline();
      assert.equal(mgr.isOnline, true);
      assert.equal(await mgr.getPendingCount(), 0);

      // Verify Firestore reflects latest state (Last-Write-Wins)
      const snap1 = await mockFs.getDoc(mockFs.doc('class_reports', '一 1'));
      const snap2 = await mockFs.getDoc(mockFs.doc('class_reports', '一 2'));

      assert.equal(snap1.data().presentCount, 27);
      assert.equal(snap1.data().leaveCount, 1);
      assert.equal(snap2.data().presentCount, 28);
    });

    it('3.3 Unicode and Emoji strings are preserved accurately across queue and drain', async () => {
      mgr.goOffline();

      const unicodeNote = '🟢 實到 26 人，1 人請假，1 人 🚨 失蹤 (教室受困📌)';
      await mgr.recordRescue('四 1_01號', {
        name: '王小明',
        note: unicodeNote,
        status: 'searching'
      });

      await mgr.goOnline();
      const snap = await mockFs.getDoc(mockFs.doc('rescues', '四 1_01號'));
      assert.equal(snap.data().note, unicodeNote);
    });

    it('3.4 Intermittent connection drop during queue drain preserves unprocessed queue items', async () => {
      mgr.goOffline();

      await mgr.recordClassReport('五 1', { presentCount: 25 });
      await mgr.recordClassReport('五 2', { presentCount: 26 });
      await mgr.recordClassReport('五 3', { presentCount: 27 });

      assert.equal(await mgr.getPendingCount(), 3);

      // Mock failure on the second item
      let callCount = 0;
      const originalSetDoc = mockFs.setDoc.bind(mockFs);
      mockFs.setDoc = async (docRef, data, options) => {
        callCount++;
        if (callCount === 2) {
          throw new Error('Network dropped during transfer');
        }
        return originalSetDoc(docRef, data, options);
      };

      mgr.isOnline = true;
      const drainResult = await mgr.syncPendingMutations();

      assert.equal(drainResult.status, 'error');
      assert.equal(drainResult.drainedCount, 1);
      assert.equal(drainResult.remaining, 2);

      const remainingPending = await mgr.getPendingMutations();
      assert.equal(remainingPending.length, 2);
      assert.equal(remainingPending[0].key, '五 2');
      assert.equal(remainingPending[1].key, '五 3');

      // Restore mockFs and retry
      mockFs.setDoc = originalSetDoc;
      const retryResult = await mgr.retrySync();
      assert.equal(retryResult.status, 'success');
      assert.equal(await mgr.getPendingCount(), 0);
    });
  });

  describe('4. Non-Intrusive Connection Status Badge', () => {
    it('4.1 getStatusBadge formats correct text for Online, Offline, Syncing, and Error states', () => {
      // Online
      assert.equal(getStatusBadge(true, 0, 0), STATUS_TEXTS.ONLINE);
      assert.equal(getStatusBadge(true, 0, 0), '🟢 雲端同步完成');

      // Offline with pending count
      assert.equal(getStatusBadge(false, 5, 0), '🟡 操場離線中 (5筆待傳)');
      assert.equal(getStatusBadge(false, 1, 0), '🟡 操場離線中 (1筆待傳)');

      // Syncing
      assert.equal(getStatusBadge(true, 3, 0), '🔄 資料同步中...');

      // Error after max retries
      assert.equal(getStatusBadge(true, 3, 3), '⚠️ 同步失敗 (點擊重試)');
      assert.equal(getStatusBadge(false, 3, 4), '⚠️ 同步失敗 (點擊重試)');
    });

    it('4.2 formatTooltip formats tooltip with pending item count and unique class count', () => {
      const pendingItems = [
        { classKey: '一 1' },
        { classKey: '一 1' },
        { classKey: '二 3' },
        { classKey: '三 2' }
      ];
      assert.equal(formatTooltip(pendingItems), '共 4 筆待同步，涵蓋 3 個班級');
    });

    it('4.3 DOM Badge updates dynamically when badge element is provided', async () => {
      // Create a mock DOM element
      const mockElement = {
        textContent: '',
        className: '',
        title: '',
        dataset: {},
        classList: {
          classes: new Set(),
          add(c) { this.classes.add(c); },
          remove(c) { this.classes.delete(c); },
          contains(c) { return this.classes.has(c); }
        }
      };

      mgr.badgeElement = mockElement;

      // Online
      mgr.updateBadge(STATUS_TEXTS.ONLINE);
      assert.equal(mockElement.textContent, STATUS_TEXTS.ONLINE);
      assert.ok(mockElement.classList.contains('badge-online'));

      // Offline
      mgr.isOnline = false;
      mgr.updateBadge('🟡 操場離線中 (3筆待傳)', [{ classKey: '一 1' }, { classKey: '一 2' }]);
      assert.equal(mockElement.textContent, '🟡 操場離線中 (3筆待傳)');
      assert.ok(mockElement.classList.contains('badge-offline'));
      assert.ok(mockElement.title.includes('共 2 筆待同步'));

      // Syncing
      mgr.updateBadge(STATUS_TEXTS.SYNCING);
      assert.equal(mockElement.textContent, STATUS_TEXTS.SYNCING);
      assert.ok(mockElement.classList.contains('badge-syncing'));

      // Error
      mgr.updateBadge(STATUS_TEXTS.ERROR);
      assert.equal(mockElement.textContent, STATUS_TEXTS.ERROR);
      assert.ok(mockElement.classList.contains('badge-error'));
    });
  });

  describe('5. Event Subscriptions & Liveness', () => {
    it('5.1 onStatusChange notifies listeners when online/offline changes occur', () => {
      let firedEvent = null;
      const unsub = mgr.onStatusChange((evt) => {
        firedEvent = evt;
      });

      mgr.goOffline();
      assert.ok(firedEvent);
      assert.equal(firedEvent.isOnline, false);

      mgr.isOnline = true;
      mgr._notifyStatusChange();
      assert.equal(firedEvent.isOnline, true);

      unsub();
      firedEvent = null;
      mgr.goOffline();
      assert.equal(firedEvent, null);
    });

    it('5.2 onSyncComplete notifies listeners with drained count upon sync completion', async () => {
      mgr.goOffline();
      await mgr.recordClassReport('六 1', { presentCount: 28 });

      let syncResult = null;
      mgr.onSyncComplete((res) => {
        syncResult = res;
      });

      await mgr.goOnline();
      assert.ok(syncResult);
      assert.equal(syncResult.drainedCount, 1);
      assert.ok(syncResult.timestamp > 0);
    });

    it('5.3 checkLiveness returns boolean according to network environment', async () => {
      const isAlive = await mgr.checkLiveness();
      assert.equal(typeof isAlive, 'boolean');
    });

    it('5.4 destroy cleanly clears listeners, timers, and storage', () => {
      mgr.onStatusChange(() => {});
      mgr.onSyncComplete(() => {});
      assert.equal(mgr._statusListeners.size, 1);
      assert.equal(mgr._syncListeners.size, 1);

      mgr.destroy();
      assert.equal(mgr._statusListeners.size, 0);
      assert.equal(mgr._syncListeners.size, 0);
    });
  });

  describe('6. Boundary Guard: 100-Mutation Heavy Stress Enqueue and Drain', () => {
    it('6.1 Handles 100 offline mutations without corruption and drains completely (B16-1)', async () => {
      mgr.goOffline();

      for (let i = 0; i < 100; i++) {
        await mgr.recordClassReport(`班級_${i}`, { index: i, count: 28 });
      }

      assert.equal(await mgr.getPendingCount(), 100);

      await mgr.goOnline();
      assert.equal(await mgr.getPendingCount(), 0);

      const checkSnap = await mockFs.getDoc(mockFs.doc('class_reports', '班級_99'));
      assert.equal(checkSnap.data().index, 99);
    });
  });
});
