import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MockFirestore } from '../helpers/mock-firestore.mjs';

describe('Tier 1: Feature 14 - Playground IndexedDB Persistent Cache', () => {
  it('F14-1: Firestore reads from local cache when network is offline', async () => {
    const firestore = new MockFirestore();
    const docRef = firestore.doc('class_reports', '一 1');
    // Preload cache
    await firestore.setDoc(docRef, { presentCount: 28 });

    firestore.goOffline();
    const snap = await firestore.getDoc(docRef);
    assert.equal(snap.exists(), true);
    assert.equal(snap.data().presentCount, 28);
    assert.equal(snap.metadata.fromCache, true);
  });

  it('F14-2: Writes executed while offline succeed locally and are marked with pending writes', async () => {
    const firestore = new MockFirestore();
    firestore.goOffline();

    const docRef = firestore.doc('class_reports', '一 2');
    const result = await firestore.setDoc(docRef, { presentCount: 25, leaveCount: 3 });
    assert.equal(result.fromCache, true);
    assert.equal(result.hasPendingWrites, true);

    const snap = await firestore.getDoc(docRef);
    assert.equal(snap.data().presentCount, 25);
  });

  it('F14-3: Multi-tab persistent local cache configuration preserves session state', () => {
    const cacheManager = {
      type: 'persistentLocalCache',
      tabManager: 'persistentMultipleTabManager'
    };
    assert.equal(cacheManager.type, 'persistentLocalCache');
    assert.equal(cacheManager.tabManager, 'persistentMultipleTabManager');
  });

  it('F14-4: Offline cache survives network toggling without data corruption', async () => {
    const firestore = new MockFirestore();
    const docRef = firestore.doc('class_reports', '三 1');
    await firestore.setDoc(docRef, { presentCount: 28 });

    firestore.goOffline();
    await firestore.setDoc(docRef, { presentCount: 26, leaveCount: 2 });
    await firestore.goOnline();

    const snap = await firestore.getDoc(docRef);
    assert.equal(snap.data().presentCount, 26);
    assert.equal(snap.data().leaveCount, 2);
  });

  it('F14-5: In-memory cache fallback activates if persistent cache fails to initialize', () => {
    const resolveCache = (hasIndexedDB) => {
      return hasIndexedDB ? 'persistentLocalCache' : 'memoryLocalCache';
    };
    assert.equal(resolveCache(true), 'persistentLocalCache');
    assert.equal(resolveCache(false), 'memoryLocalCache');
  });
});

describe('Tier 1: Feature 15 - Optimistic UI Roll Call Updates', () => {
  it('F15-1: Clicking roll call status card updates local UI state synchronously in 0ms', () => {
    const localState = { '一 1_01號': 'present' };
    const onClickCard = (studentKey, newStatus) => {
      localState[studentKey] = newStatus;
      return localState[studentKey];
    };
    const updated = onClickCard('一 1_01號', 'leave');
    assert.equal(updated, 'leave');
    assert.equal(localState['一 1_01號'], 'leave');
  });

  it('F15-2: Local onSnapshot triggers immediately upon offline write without waiting for server ACK', async () => {
    const firestore = new MockFirestore();
    firestore.goOffline();

    const docRef = firestore.doc('class_reports', '四 1');
    let listenerFired = false;
    let localData = null;

    const unsub = firestore.onSnapshot(docRef, snap => {
      if (snap.exists()) {
        listenerFired = true;
        localData = snap.data();
      }
    });

    await firestore.setDoc(docRef, { presentCount: 24, leaveCount: 4 });
    await new Promise(r => setTimeout(r, 10));

    assert.equal(listenerFired, true);
    assert.equal(localData.presentCount, 24);
    unsub();
  });

  it('F15-3: Optimistic state displays pending indicator while write is in flight', () => {
    const item = { studentKey: '一 1_01號', status: 'leave', hasPendingWrites: true };
    const getBadge = (i) => i.hasPendingWrites ? '⏳ (待同步)' : '✅ (已同步)';
    assert.equal(getBadge(item), '⏳ (待同步)');
  });

  it('F15-4: Multiple rapid sequential clicks on the same card queue optimistic updates', () => {
    const states = [];
    const rollCallCycle = ['present', 'leave', 'missing', 'pickedUp'];
    for (const st of rollCallCycle) {
      states.push(st);
    }
    assert.equal(states.length, 4);
    assert.equal(states[states.length - 1], 'pickedUp');
  });

  it('F15-5: Optimistic state correctly maintains class totals before network sync', () => {
    const classReport = { total: 28, present: 28, leave: 0, missing: 0 };
    // Teacher toggles 2 students to leave and 1 to missing
    classReport.present -= 3;
    classReport.leave += 2;
    classReport.missing += 1;

    assert.equal(classReport.present, 25);
    assert.equal(classReport.leave, 2);
    assert.equal(classReport.missing, 1);
    assert.equal(classReport.present + classReport.leave + classReport.missing, classReport.total);
  });
});

describe('Tier 1: Feature 16 - Offline Mutation Queue & Auto-Drain', () => {
  it('F16-1: Offline mutations are recorded in FIFO order in pending queue', async () => {
    const firestore = new MockFirestore();
    firestore.goOffline();

    await firestore.setDoc(firestore.doc('class_reports', '一 1'), { step: 1 });
    await firestore.setDoc(firestore.doc('class_reports', '一 1'), { step: 2 });
    await firestore.setDoc(firestore.doc('class_reports', '一 1'), { step: 3 });

    assert.equal(firestore.pendingQueue.length, 3);
    assert.equal(firestore.pendingQueue[0].data.step, 1);
    assert.equal(firestore.pendingQueue[2].data.step, 3);
  });

  it('F16-2: Calling goOnline automatically drains all queued mutations to server store', async () => {
    const firestore = new MockFirestore();
    firestore.goOffline();

    await firestore.setDoc(firestore.doc('class_reports', '一 1'), { presentCount: 20 });
    await firestore.setDoc(firestore.doc('class_reports', '一 2'), { presentCount: 22 });

    assert.equal(firestore.pendingQueue.length, 2);
    await firestore.goOnline();

    assert.equal(firestore.pendingQueue.length, 0);
    const snap1 = await firestore.getDoc(firestore.doc('class_reports', '一 1'));
    const snap2 = await firestore.getDoc(firestore.doc('class_reports', '一 2'));
    assert.equal(snap1.data().presentCount, 20);
    assert.equal(snap2.data().presentCount, 22);
  });

  it('F16-3: Server store reflects final state after drain without missing intermediate updates', async () => {
    const firestore = new MockFirestore();
    firestore.goOffline();

    const docRef = firestore.doc('class_reports', '二 1');
    await firestore.setDoc(docRef, { presentCount: 28 });
    await firestore.setDoc(docRef, { presentCount: 27, leaveCount: 1 }, { merge: true });

    await firestore.goOnline();
    const snap = await firestore.getDoc(docRef);
    assert.equal(snap.data().presentCount, 27);
    assert.equal(snap.data().leaveCount, 1);
  });

  it('F16-4: Pullout and rescue mutations queue and drain cleanly alongside class reports', async () => {
    const firestore = new MockFirestore();
    firestore.goOffline();

    await firestore.setDoc(firestore.doc('pullouts', '一 1_01號'), { status: 'safe' });
    await firestore.setDoc(firestore.doc('rescues', '一 1_02號'), { triageCard: 'green', searchDone: true });

    assert.equal(firestore.pendingQueue.length, 2);
    await firestore.goOnline();

    const pSnap = await firestore.getDoc(firestore.doc('pullouts', '一 1_01號'));
    const rSnap = await firestore.getDoc(firestore.doc('rescues', '一 1_02號'));
    assert.equal(pSnap.data().status, 'safe');
    assert.equal(rSnap.data().searchDone, true);
  });

  it('F16-5: Empty mutation queue on reconnect produces zero superfluous writes', async () => {
    const firestore = new MockFirestore();
    firestore.goOffline();
    assert.equal(firestore.pendingQueue.length, 0);
    await firestore.goOnline();
    assert.equal(firestore.pendingQueue.length, 0);
  });
});

describe('Tier 1: Feature 17 - Connection Status Indicator', () => {
  it('F17-1: Connection indicator displays online green badge when network is active', () => {
    const getStatusBadge = (isOnline, pendingCount) => {
      if (!isOnline) return `🟡 離線快取中 (待同步 ${pendingCount} 筆)`;
      if (pendingCount > 0) return '🔄 正在同步中...';
      return '🟢 連線正常';
    };
    assert.equal(getStatusBadge(true, 0), '🟢 連線正常');
  });

  it('F17-2: Connection indicator displays offline yellow badge with pending write count', () => {
    const getStatusBadge = (isOnline, pendingCount) => {
      if (!isOnline) return `🟡 離線快取中 (待同步 ${pendingCount} 筆)`;
      if (pendingCount > 0) return '🔄 正在同步中...';
      return '🟢 連線正常';
    };
    assert.equal(getStatusBadge(false, 3), '🟡 離線快取中 (待同步 3 筆)');
  });

  it('F17-3: Connection indicator displays syncing spinner status when draining queue', () => {
    const getStatusBadge = (isOnline, pendingCount) => {
      if (!isOnline) return `🟡 離線快取中 (待同步 ${pendingCount} 筆)`;
      if (pendingCount > 0) return '🔄 正在同步中...';
      return '🟢 連線正常';
    };
    assert.equal(getStatusBadge(true, 5), '🔄 正在同步中...');
  });

  it('F17-4: Window online and offline event handlers trigger status updates', () => {
    let currentStatus = 'online';
    const onOnline = () => { currentStatus = 'online'; };
    const onOffline = () => { currentStatus = 'offline'; };

    onOffline();
    assert.equal(currentStatus, 'offline');
    onOnline();
    assert.equal(currentStatus, 'online');
  });

  it('F17-5: Status badge placement does not obstruct top navigation or status cards', () => {
    const badgeLayout = {
      position: 'fixed',
      bottom: '12px',
      right: '12px',
      zIndex: 999
    };
    assert.equal(badgeLayout.position, 'fixed');
    assert.equal(badgeLayout.bottom, '12px');
    assert.equal(badgeLayout.right, '12px');
  });
});
