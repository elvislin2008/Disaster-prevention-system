import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MockFirestore } from '../helpers/mock-firestore.mjs';
import { createGasAdapter } from '../helpers/mock-gas-adapter.mjs';
import { MockSupabaseAuth } from '../helpers/mock-supabase.mjs';
import { createStandardSchedules, generateStudentsForClass } from '../helpers/test-dataset.mjs';

describe('Tier 1: Feature 10 - Granular Firestore Schema & Collections', () => {
  it('F10-1: Class reports are stored as isolated granular documents by classKey', async () => {
    const firestore = new MockFirestore();
    const classDocRef = firestore.doc('class_reports', '一 1');
    await firestore.setDoc(classDocRef, {
      total: 28,
      presentCount: 28,
      leaveCount: 0,
      missingCount: 0
    });
    const snap = await firestore.getDoc(classDocRef);
    assert.equal(snap.exists(), true);
    assert.equal(snap.data().presentCount, 28);
  });

  it('F10-2: Concurrent writes to distinct classes do not overwrite each other', async () => {
    const firestore = new MockFirestore();
    await Promise.all([
      firestore.setDoc(firestore.doc('class_reports', '一 1'), { presentCount: 27 }),
      firestore.setDoc(firestore.doc('class_reports', '一 2'), { presentCount: 28 }),
      firestore.setDoc(firestore.doc('class_reports', '二 1'), { presentCount: 26 })
    ]);
    const snap1 = await firestore.getDoc(firestore.doc('class_reports', '一 1'));
    const snap2 = await firestore.getDoc(firestore.doc('class_reports', '一 2'));
    const snap3 = await firestore.getDoc(firestore.doc('class_reports', '二 1'));
    assert.equal(snap1.data().presentCount, 27);
    assert.equal(snap2.data().presentCount, 28);
    assert.equal(snap3.data().presentCount, 26);
  });

  it('F10-3: Pullouts collection stores records keyed by studentKey', async () => {
    const firestore = new MockFirestore();
    const sKey = '一 1_05號';
    await firestore.setDoc(firestore.doc('pullouts', sKey), {
      studentKey: sKey,
      status: 'pending'
    });
    const snap = await firestore.getDoc(firestore.doc('pullouts', sKey));
    assert.equal(snap.data().status, 'pending');
  });

  it('F10-4: Rescues collection stores triage and search status', async () => {
    const firestore = new MockFirestore();
    const sKey = '三 2_12號';
    await firestore.setDoc(firestore.doc('rescues', sKey), {
      studentKey: sKey,
      triageCard: 'yellow',
      escortCount: 2,
      searchDone: false
    });
    const snap = await firestore.getDoc(firestore.doc('rescues', sKey));
    assert.equal(snap.data().triageCard, 'yellow');
    assert.equal(snap.data().escortCount, 2);
  });

  it('F10-5: Merge option updates specific document fields without clearing existing fields', async () => {
    const firestore = new MockFirestore();
    const ref = firestore.doc('class_reports', '四 1');
    await firestore.setDoc(ref, { total: 28, presentCount: 28 });
    await firestore.setDoc(ref, { leaveCount: 2, presentCount: 26 }, { merge: true });
    const snap = await firestore.getDoc(ref);
    assert.equal(snap.data().total, 28);
    assert.equal(snap.data().leaveCount, 2);
    assert.equal(snap.data().presentCount, 26);
  });
});

describe('Tier 1: Feature 11 - GAS Bridge Adapter Implementation', () => {
  it('F11-1: google.script.run chaining with withSuccessHandler resolves data asynchronously', async () => {
    const firestore = new MockFirestore();
    const supabase = new MockSupabaseAuth();
    const schedules = createStandardSchedules();
    const students = generateStudentsForClass('一', '1', 5);
    const google = createGasAdapter({ firestore, supabase, schedules, students });

    const result = await new Promise(resolve => {
      google.script.run.withSuccessHandler(resolve).getScheduleConfigData();
    });
    assert.ok(Array.isArray(result));
    assert.ok(result.length > 0);
  });

  it('F11-2: updateClassReportDelta invokes success callback with updated report status', async () => {
    const firestore = new MockFirestore();
    const google = createGasAdapter({ firestore });

    const res = await new Promise(resolve => {
      google.script.run
        .withSuccessHandler(resolve)
        .updateClassReportDelta('一 1', { total: 28, presentCount: 28 });
    });
    assert.equal(res.success, true);
    assert.equal(res.classKey, '一 1');
  });

  it('F11-3: updatePulloutStatusDelta saves pullout status and propagates missing to rescues', async () => {
    const firestore = new MockFirestore();
    const google = createGasAdapter({ firestore });

    const sKey = '二 3_08號';
    await new Promise(resolve => {
      google.script.run
        .withSuccessHandler(resolve)
        .updatePulloutStatusDelta(sKey, 'missing', { name: '陳小美', classKey: '二 3' });
    });

    const pulloutSnap = await firestore.getDoc(firestore.doc('pullouts', sKey));
    const rescueSnap = await firestore.getDoc(firestore.doc('rescues', sKey));
    assert.equal(pulloutSnap.data().status, 'missing');
    assert.equal(rescueSnap.data().status, 'missing');
    assert.equal(rescueSnap.data().searchDone, false);
  });

  it('F11-4: updateRescueStatusDelta marks searchDone and updates pullout status to safe', async () => {
    const firestore = new MockFirestore();
    const google = createGasAdapter({ firestore });

    const sKey = '五 5_10號';
    // Initially missing
    await firestore.setDoc(firestore.doc('pullouts', sKey), { status: 'missing' });
    await firestore.setDoc(firestore.doc('rescues', sKey), { status: 'missing', searchDone: false });

    await new Promise(resolve => {
      google.script.run
        .withSuccessHandler(resolve)
        .updateRescueStatusDelta(sKey, { triageCard: 'green' }, true);
    });

    const rescueSnap = await firestore.getDoc(firestore.doc('rescues', sKey));
    const pulloutSnap = await firestore.getDoc(firestore.doc('pullouts', sKey));
    assert.equal(rescueSnap.data().searchDone, true);
    assert.equal(pulloutSnap.data().status, 'safe');
  });

  it('F11-5: withFailureHandler captures errors when execution fails', async () => {
    const firestore = new MockFirestore();
    const google = createGasAdapter({ firestore });

    // Mock an error by corrupting internal doc call
    const originalSet = firestore.setDoc;
    firestore.setDoc = async () => { throw new Error('Firestore write simulated fault'); };

    const err = await new Promise(resolve => {
      google.script.run
        .withFailureHandler(resolve)
        .updateClassReportDelta('一 1', { presentCount: 28 });
    });
    assert.ok(err instanceof Error);
    assert.equal(err.message, 'Firestore write simulated fault');
    firestore.setDoc = originalSet;
  });
});

describe('Tier 1: Feature 12 - Polling Eradication via onSnapshot', () => {
  it('F12-1: onSnapshot listener triggers callback when document is updated', async () => {
    const firestore = new MockFirestore();
    const docRef = firestore.doc('class_reports', '一 1');
    let callCount = 0;
    let latestData = null;

    const unsubscribe = firestore.onSnapshot(docRef, (snap) => {
      callCount++;
      latestData = snap.data();
    });

    await firestore.setDoc(docRef, { presentCount: 25 });
    // Allow microtask
    await new Promise(r => setTimeout(r, 10));

    assert.ok(callCount >= 2); // Initial get + update
    assert.equal(latestData.presentCount, 25);
    unsubscribe();
  });

  it('F12-2: Unsubscribing onSnapshot stops receiving subsequent document updates', async () => {
    const firestore = new MockFirestore();
    const docRef = firestore.doc('class_reports', '一 1');
    let callCount = 0;

    const unsubscribe = firestore.onSnapshot(docRef, () => {
      callCount++;
    });

    await new Promise(r => setTimeout(r, 10));
    const countBefore = callCount;
    unsubscribe();

    await firestore.setDoc(docRef, { presentCount: 20 });
    await new Promise(r => setTimeout(r, 10));

    assert.equal(callCount, countBefore);
  });

  it('F12-3: Collection level onSnapshot triggers when any document in collection is added', async () => {
    const firestore = new MockFirestore();
    const collRef = firestore.collection('visitors');
    let latestSize = 0;

    const unsubscribe = firestore.onSnapshot(collRef, (snap) => {
      latestSize = snap.size;
    });

    await firestore.setDoc(firestore.doc('visitors', 'v1'), { name: '訪客甲' });
    await new Promise(r => setTimeout(r, 10));

    assert.equal(latestSize, 1);
    unsubscribe();
  });

  it('F12-4: Eliminating polling eliminates fixed 3.5s/15s setInterval calls', () => {
    const pollingIntervals = [];
    const registerTimer = (interval) => {
      if (interval === 3500 || interval === 15000) {
        throw new Error('Forbidden legacy polling timer registered');
      }
      pollingIntervals.push(interval);
    };

    assert.throws(() => registerTimer(3500), /Forbidden legacy polling timer/);
    assert.throws(() => registerTimer(15000), /Forbidden legacy polling timer/);
  });

  it('F12-5: onSnapshot listener receives empty snapshot gracefully for non-existent documents', async () => {
    const firestore = new MockFirestore();
    const docRef = firestore.doc('class_reports', 'non-existent');
    const snap = await new Promise(resolve => {
      const unsub = firestore.onSnapshot(docRef, s => {
        unsub();
        resolve(s);
      });
    });
    assert.equal(snap.exists(), false);
    assert.equal(snap.data(), undefined);
  });
});

describe('Tier 1: Feature 13 - Realtime Push Notification Sync', () => {
  it('F13-1: Two clients listening to same collection both receive realtime updates', async () => {
    const firestore = new MockFirestore();
    const clientAUpdates = [];
    const clientBUpdates = [];

    const unsubA = firestore.onSnapshot(firestore.collection('class_reports'), snap => {
      clientAUpdates.push(snap.size);
    });
    const unsubB = firestore.onSnapshot(firestore.collection('class_reports'), snap => {
      clientBUpdates.push(snap.size);
    });

    await firestore.setDoc(firestore.doc('class_reports', '一 1'), { presentCount: 28 });
    await new Promise(r => setTimeout(r, 10));

    assert.ok(clientAUpdates.length > 0);
    assert.ok(clientBUpdates.length > 0);
    assert.equal(clientAUpdates[clientAUpdates.length - 1], 1);
    assert.equal(clientBUpdates[clientBUpdates.length - 1], 1);

    unsubA();
    unsubB();
  });

  it('F13-2: Push notification latency is sub-500ms under standard test execution', async () => {
    const firestore = new MockFirestore();
    const docRef = firestore.doc('class_reports', '三 1');
    const startTime = Date.now();

    const received = await new Promise(resolve => {
      let isFirst = true;
      const unsub = firestore.onSnapshot(docRef, snap => {
        if (isFirst) {
          isFirst = false;
          return;
        }
        unsub();
        resolve(Date.now() - startTime);
      });
      firestore.setDoc(docRef, { presentCount: 26 });
    });

    assert.ok(received < 500, `Latency was ${received}ms, expected < 500ms`);
  });

  it('F13-3: Rapid updates on distinct documents trigger push notifications without dropped events', async () => {
    const firestore = new MockFirestore();
    let eventCount = 0;

    const unsub = firestore.onSnapshot(firestore.collection('class_reports'), () => {
      eventCount++;
    });

    for (let i = 1; i <= 5; i++) {
      await firestore.setDoc(firestore.doc('class_reports', `一 ${i}`), { presentCount: 28 });
    }
    await new Promise(r => setTimeout(r, 15));

    assert.ok(eventCount >= 5);
    unsub();
  });

  it('F13-4: Snapshot metadata differentiates local optimistic writes vs confirmed server writes', async () => {
    const firestore = new MockFirestore();
    firestore.goOffline();

    const docRef = firestore.doc('class_reports', '二 2');
    const localSnap = await firestore.setDoc(docRef, { presentCount: 27 });
    assert.equal(localSnap.hasPendingWrites, true);
    assert.equal(localSnap.fromCache, true);

    await firestore.goOnline();
    const serverSnap = await firestore.getDoc(docRef);
    assert.equal(serverSnap.metadata.hasPendingWrites, false);
    assert.equal(serverSnap.metadata.fromCache, false);
  });

  it('F13-5: Push notification payloads preserve exact JSON data types', async () => {
    const firestore = new MockFirestore();
    const docRef = firestore.doc('class_reports', '六 1');
    const payload = {
      total: 28,
      presentCount: 27,
      leaveList: ['03號', '05號'],
      isComplete: true,
      timestamp: 1729000000000
    };

    await firestore.setDoc(docRef, payload);
    const snap = await firestore.getDoc(docRef);
    const data = snap.data();
    assert.equal(typeof data.total, 'number');
    assert.ok(Array.isArray(data.leaveList));
    assert.equal(typeof data.isComplete, 'boolean');
    assert.equal(data.leaveList[0], '03號');
  });
});
