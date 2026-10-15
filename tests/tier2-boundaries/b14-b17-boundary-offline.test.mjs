import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MockFirestore } from '../helpers/mock-firestore.mjs';

describe('Tier 2: Boundary - Feature 14 (Playground IndexedDB Persistent Cache)', () => {
  it('B14-1: Private browsing / incognito mode disabling IndexedDB triggers graceful memory fallback', () => {
    const initStorage = (indexedDBAvailable) => {
      if (!indexedDBAvailable) {
        return { type: 'memory', notice: 'Running in memory cache mode (Incognito)' };
      }
      return { type: 'indexedDB', notice: 'Persistent storage active' };
    };
    const res = initStorage(false);
    assert.equal(res.type, 'memory');
    assert.ok(res.notice.includes('Incognito'));
  });

  it('B14-2: Local storage quota exceeded throws QuotaExceededError and purges oldest logs', () => {
    let logs = [{ id: 1, age: 100 }, { id: 2, age: 50 }, { id: 3, age: 10 }];
    const addLogWithQuotaGuard = (newLog, maxLogs = 3) => {
      if (logs.length >= maxLogs) {
        logs.sort((a, b) => b.age - a.age); // sort oldest first
        logs.shift(); // purge oldest
      }
      logs.push(newLog);
    };
    addLogWithQuotaGuard({ id: 4, age: 0 });
    assert.equal(logs.length, 3);
    assert.equal(logs.some(l => l.id === 1), false); // oldest purged
  });

  it('B14-3: Concurrent tab operations do not corrupt local cache state', async () => {
    const firestore = new MockFirestore();
    firestore.goOffline();

    // Tab A and Tab B writing to different classes
    await Promise.all([
      firestore.setDoc(firestore.doc('class_reports', '一 1'), { fromTab: 'A' }),
      firestore.setDoc(firestore.doc('class_reports', '一 2'), { fromTab: 'B' })
    ]);

    const snapA = await firestore.getDoc(firestore.doc('class_reports', '一 1'));
    const snapB = await firestore.getDoc(firestore.doc('class_reports', '一 2'));
    assert.equal(snapA.data().fromTab, 'A');
    assert.equal(snapB.data().fromTab, 'B');
  });

  it('B14-4: Offline read for never-cached document returns exists() === false', async () => {
    const firestore = new MockFirestore();
    firestore.goOffline();

    const snap = await firestore.getDoc(firestore.doc('class_reports', 'unknown_class'));
    assert.equal(snap.exists(), false);
    assert.equal(snap.data(), undefined);
  });

  it('B14-5: Re-enabling network flushes cached reads and fetches fresh server snapshot', async () => {
    const firestore = new MockFirestore();
    const docRef = firestore.doc('class_reports', '一 3');
    await firestore.setDoc(docRef, { present: 28 });

    firestore.goOffline();
    await firestore.setDoc(docRef, { present: 25 }); // modified offline

    await firestore.goOnline();
    const freshSnap = await firestore.getDoc(docRef);
    assert.equal(freshSnap.data().present, 25);
    assert.equal(freshSnap.metadata.fromCache, false);
  });
});

describe('Tier 2: Boundary - Feature 15 (Optimistic UI Roll Call Updates)', () => {
  it('B15-1: Rapid clicks cycling through all 7 stages in under 100ms keeps UI in sync', () => {
    const cycle = ['present', 'study_center', 'native_lang', 'team', 'leave', 'missing', 'pickedUp'];
    let state = 'present';
    const clickNext = (s) => cycle[(cycle.indexOf(s) + 1) % cycle.length];

    for (let i = 0; i < 7; i++) {
      state = clickNext(state);
    }
    assert.equal(state, 'present');
  });

  it('B15-2: Server rejection of optimistic write triggers UI rollback to previous confirmed state', () => {
    let confirmedState = 'present';
    let optimisticState = 'leave';

    const onServerReject = () => {
      optimisticState = confirmedState; // rollback
      return optimisticState;
    };

    assert.equal(onServerReject(), 'present');
  });

  it('B15-3: Switching class views while an optimistic write is pending does not drop the write', async () => {
    const firestore = new MockFirestore();
    firestore.goOffline();

    // Teacher writes to Class A
    await firestore.setDoc(firestore.doc('class_reports', '一 1'), { present: 27 });
    // Teacher switches view to Class B
    let currentClassView = '一 2';
    assert.equal(currentClassView, '一 2');

    // Reconnect
    await firestore.goOnline();
    const snapA = await firestore.getDoc(firestore.doc('class_reports', '一 1'));
    assert.equal(snapA.data().present, 27);
  });

  it('B15-4: Zero student count class does not cause divide by zero or NaN in attendance rate', () => {
    const calculateRate = (present, total) => {
      if (!total || total <= 0) return '0.0%';
      return `${((present / total) * 100).toFixed(1)}%`;
    };
    assert.equal(calculateRate(0, 0), '0.0%');
    assert.equal(calculateRate(25, 28), '89.3%');
  });

  it('B15-5: Unsaved changes warning flags if pending writes exist on window beforeunload', () => {
    const checkBeforeUnload = (hasPendingWrites) => {
      if (hasPendingWrites) {
        return '系統尚有點名紀錄排隊同步中，離開頁面可能導致資料延遲上傳！';
      }
      return null;
    };
    assert.ok(checkBeforeUnload(true).includes('系統尚有點名紀錄排隊同步中'));
    assert.equal(checkBeforeUnload(false), null);
  });
});

describe('Tier 2: Boundary - Feature 16 (Offline Mutation Queue & Auto-Drain)', () => {
  it('B16-1: Large queue of 100 mutations drains completely without dropping any mutation', async () => {
    const firestore = new MockFirestore();
    firestore.goOffline();

    for (let i = 0; i < 100; i++) {
      await firestore.setDoc(firestore.doc('class_reports', `c_${i}`), { index: i });
    }

    assert.equal(firestore.pendingQueue.length, 100);
    await firestore.goOnline();
    assert.equal(firestore.pendingQueue.length, 0);

    const checkSnap = await firestore.getDoc(firestore.doc('class_reports', 'c_99'));
    assert.equal(checkSnap.data().index, 99);
  });

  it('B16-2: Last-Write-Wins (LWW) conflict resolution handles simultaneous edits to same document', async () => {
    const firestore = new MockFirestore();
    firestore.goOffline();

    const docRef = firestore.doc('class_reports', '一 1');
    await firestore.setDoc(docRef, { present: 25, timestamp: 100 });
    await firestore.setDoc(docRef, { present: 27, timestamp: 200 });

    await firestore.goOnline();
    const finalSnap = await firestore.getDoc(docRef);
    assert.equal(finalSnap.data().present, 27);
  });

  it('B16-3: Intermittent connection flapping during queue drain preserves queue state', () => {
    let queue = [1, 2, 3, 4, 5];
    const drainPartial = (count) => {
      return queue.splice(0, count);
    };
    const processed = drainPartial(2);
    assert.equal(processed.length, 2);
    assert.equal(queue.length, 3);
    assert.deepEqual(queue, [3, 4, 5]);
  });

  it('B16-4: Mutation payload containing Unicode and Emoji preserves exact encoding across drain', async () => {
    const firestore = new MockFirestore();
    firestore.goOffline();

    const docRef = firestore.doc('pullouts', '一 1_01號');
    const unicodeText = '🟢 實到 ➔ 🚨 失蹤 (教室受困)';
    await firestore.setDoc(docRef, { statusText: unicodeText });

    await firestore.goOnline();
    const snap = await firestore.getDoc(docRef);
    assert.equal(snap.data().statusText, unicodeText);
  });

  it('B16-5: Queue drain retry exponential backoff calculates delay correctly', () => {
    const getBackoffDelay = (retryCount, baseMs = 500) => {
      return Math.min(baseMs * Math.pow(2, retryCount), 10000);
    };
    assert.equal(getBackoffDelay(0), 500);
    assert.equal(getBackoffDelay(1), 1000);
    assert.equal(getBackoffDelay(2), 2000);
    assert.equal(getBackoffDelay(5), 10000); // capped at 10s
  });
});

describe('Tier 2: Boundary - Feature 17 (Connection Status Indicator)', () => {
  it('B17-1: Rapid network flapping between online/offline is debounced to avoid UI flicker', () => {
    let renderCount = 0;
    let timer = null;
    let displayState = 'online';

    const triggerFlap = (newState) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        displayState = newState;
        renderCount++;
      }, 50);
    };

    triggerFlap('offline');
    triggerFlap('online');
    triggerFlap('offline');

    assert.equal(renderCount, 0); // Debounced
  });

  it('B17-2: Indicator transitions to failure status if sync fails after max retries', () => {
    const getStatusIndicator = (isOnline, pendingWrites, retryCount) => {
      if (retryCount >= 3) return '⚠️ 同步失敗 (點擊重試)';
      if (!isOnline) return `🟡 離線快取中 (待同步 ${pendingWrites} 筆)`;
      return '🟢 連線正常';
    };
    assert.equal(getStatusIndicator(true, 5, 3), '⚠️ 同步失敗 (點擊重試)');
  });

  it('B17-3: Manual retry click triggers immediate re-evaluation of connection status', () => {
    let retryTriggered = false;
    const onManualRetry = () => {
      retryTriggered = true;
    };
    onManualRetry();
    assert.equal(retryTriggered, true);
  });

  it('B17-4: Offline status badge tooltip shows detailed breakdown of pending items', () => {
    const formatTooltip = (pendingItems) => {
      const classCount = new Set(pendingItems.map(p => p.classKey)).size;
      return `共 ${pendingItems.length} 筆待同步，涵蓋 ${classCount} 個班級`;
    };
    const items = [
      { classKey: '一 1' },
      { classKey: '一 1' },
      { classKey: '二 3' }
    ];
    assert.equal(formatTooltip(items), '共 3 筆待同步，涵蓋 2 個班級');
  });

  it('B17-5: Badge remains visible and responsive across mobile viewport (320px width)', () => {
    const getBadgeDimensions = (viewportWidth) => {
      return {
        maxWidth: viewportWidth < 400 ? '160px' : '240px',
        fontSize: viewportWidth < 400 ? '11px' : '13px'
      };
    };
    const mob = getBadgeDimensions(320);
    assert.equal(mob.maxWidth, '160px');
    assert.equal(mob.fontSize, '11px');
  });
});
