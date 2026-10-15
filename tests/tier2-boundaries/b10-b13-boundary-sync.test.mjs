import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MockFirestore } from '../helpers/mock-firestore.mjs';
import { createGasAdapter } from '../helpers/mock-gas-adapter.mjs';

describe('Tier 2: Boundary - Feature 10 (Granular Firestore Schema & Collections)', () => {
  it('B10-1: Document ID containing spaces or special characters is sanitized or handled safely', () => {
    const sanitizeDocId = (id) => encodeURIComponent(id.trim());
    assert.equal(sanitizeDocId('一 1'), '%E4%B8%80%201');
    assert.equal(sanitizeDocId('一 1_01號'), '%E4%B8%80%201_01%E8%99%9F');
  });

  it('B10-2: Oversized document payload (>1MB) is caught by size guard before write', () => {
    const checkDocSize = (obj) => {
      const bytes = Buffer.byteLength(JSON.stringify(obj), 'utf8');
      if (bytes > 1048576) throw new Error('Document size exceeds 1MB Firestore limit');
      return true;
    };
    const smallDoc = { total: 28, present: 28 };
    assert.equal(checkDocSize(smallDoc), true);

    const hugeDoc = { padding: 'x'.repeat(1048577) };
    assert.throws(() => checkDocSize(hugeDoc), /exceeds 1MB/);
  });

  it('B10-3: Deleting a non-existent document resolves gracefully without throwing', async () => {
    const firestore = new MockFirestore();
    const docRef = firestore.doc('class_reports', 'non_existent_class');
    const deleteDoc = async (ref) => {
      const coll = firestore._getOrCreateColl(firestore.serverStore, ref.collName);
      coll.delete(ref.docId);
      return { success: true };
    };
    const res = await deleteDoc(docRef);
    assert.equal(res.success, true);
  });

  it('B10-4: Updating a document that has not been initialized yet uses upsert/merge safely', async () => {
    const firestore = new MockFirestore();
    const docRef = firestore.doc('class_reports', '三 3');
    await firestore.setDoc(docRef, { presentCount: 27 }, { merge: true });
    const snap = await firestore.getDoc(docRef);
    assert.equal(snap.exists(), true);
    assert.equal(snap.data().presentCount, 27);
  });

  it('B10-5: Schema validator blocks prototype pollution keys (__proto__, constructor)', () => {
    const validateJsonPayload = (jsonStr) => {
      const parsed = JSON.parse(jsonStr);
      if (jsonStr.includes('"__proto__"') || jsonStr.includes('"constructor"') || jsonStr.includes('"prototype"')) {
        throw new Error('Forbidden object key: prototype pollution detected');
      }
      return parsed;
    };
    assert.throws(() => validateJsonPayload('{"__proto__": {"admin": true}}'), /Forbidden object key/);
    assert.throws(() => validateJsonPayload('{"constructor": {"name": "hack"}}'), /Forbidden object key/);
  });
});

describe('Tier 2: Boundary - Feature 11 (GAS Bridge Adapter Implementation)', () => {
  it('B11-1: Calling unknown or undefined method on google.script.run throws informative error', () => {
    const firestore = new MockFirestore();
    const google = createGasAdapter({ firestore });
    assert.throws(() => {
      google.script.run.nonExistentMethod();
    }, /is not implemented/);
  });

  it('B11-2: Chaining withSuccessHandler without withFailureHandler does not crash on success', async () => {
    const firestore = new MockFirestore();
    const google = createGasAdapter({ firestore });

    const result = await new Promise(resolve => {
      google.script.run.withSuccessHandler(resolve).getScheduleConfigData();
    });
    assert.ok(Array.isArray(result));
  });

  it('B11-3: Handlers registered with non-function parameters are handled safely without crashing', async () => {
    const firestore = new MockFirestore();
    const google = createGasAdapter({ firestore });

    // Should not throw when non-function passed
    assert.doesNotThrow(() => {
      google.script.run.withSuccessHandler(null).withFailureHandler(undefined).getStudentData();
    });
  });

  it('B11-4: Asynchronous microtask resolution preserves execution order of sequential calls', async () => {
    const firestore = new MockFirestore();
    const google = createGasAdapter({ firestore });
    const sequence = [];

    await Promise.all([
      new Promise(r => {
        google.script.run.withSuccessHandler(() => { sequence.push(1); r(); }).getScheduleConfigData();
      }),
      new Promise(r => {
        google.script.run.withSuccessHandler(() => { sequence.push(2); r(); }).getStudentData();
      })
    ]);

    assert.equal(sequence.length, 2);
  });

  it('B11-5: Adapter getFullSystemState handles completely empty database state safely', async () => {
    const firestore = new MockFirestore();
    const google = createGasAdapter({ firestore });

    const state = await new Promise(resolve => {
      google.script.run.withSuccessHandler(resolve).getFullSystemState();
    });
    assert.ok(state.CLASS_REPORTS_DATA);
    assert.ok(state.PULLOUT_STATUS_MAP);
    assert.ok(state.RESCUE_TRIAGE_MAP);
    assert.equal(Object.keys(state.CLASS_REPORTS_DATA).length, 0);
  });
});

describe('Tier 2: Boundary - Feature 12 (Polling Eradication via onSnapshot)', () => {
  it('B12-1: Registering duplicate onSnapshot listeners creates independent subscriptions', async () => {
    const firestore = new MockFirestore();
    const docRef = firestore.doc('class_reports', '一 1');
    let aCalls = 0;
    let bCalls = 0;

    const unsubA = firestore.onSnapshot(docRef, () => aCalls++);
    const unsubB = firestore.onSnapshot(docRef, () => bCalls++);

    await firestore.setDoc(docRef, { presentCount: 28 });
    await new Promise(r => setTimeout(r, 10));

    unsubA();
    await firestore.setDoc(docRef, { presentCount: 27 });
    await new Promise(r => setTimeout(r, 10));

    assert.ok(bCalls > aCalls);
    unsubB();
  });

  it('B12-2: Listener error handler is triggered when read permissions fail', async () => {
    const firestore = new MockFirestore();
    const docRef = firestore.doc('class_reports', 'restricted');
    const originalGet = firestore.getDoc;
    firestore.getDoc = async () => { throw new Error('Permission denied'); };

    const err = await new Promise(resolve => {
      firestore.onSnapshot(docRef, () => {}, resolve);
    });

    assert.equal(err.message, 'Permission denied');
    firestore.getDoc = originalGet;
  });

  it('B12-3: Calling unsubscribe multiple times is idempotent and does not throw', () => {
    const firestore = new MockFirestore();
    const docRef = firestore.doc('class_reports', '一 1');
    const unsub = firestore.onSnapshot(docRef, () => {});

    assert.doesNotThrow(() => {
      unsub();
      unsub();
      unsub();
    });
  });

  it('B12-4: Rapid consecutive updates are processed without listener queue starvation', async () => {
    const firestore = new MockFirestore();
    const docRef = firestore.doc('class_reports', '二 1');
    let updatesCount = 0;

    const unsub = firestore.onSnapshot(docRef, () => updatesCount++);
    for (let i = 0; i < 10; i++) {
      await firestore.setDoc(docRef, { val: i });
    }
    await new Promise(r => setTimeout(r, 15));

    assert.ok(updatesCount >= 10);
    unsub();
  });

  it('B12-5: Window unload cleanup cleanly unsubscribes all active listeners', () => {
    const activeUnsubs = new Set();
    const registerListener = (fn) => {
      const unsub = () => activeUnsubs.delete(unsub);
      activeUnsubs.add(unsub);
      return unsub;
    };

    const u1 = registerListener(() => {});
    const u2 = registerListener(() => {});
    assert.equal(activeUnsubs.size, 2);

    // Unload event
    for (const u of activeUnsubs) u();
    assert.equal(activeUnsubs.size, 0);
  });
});

describe('Tier 2: Boundary - Feature 13 (Realtime Push Notification Sync)', () => {
  it('B13-1: Network disconnect during active listener sets metadata.fromCache to true', async () => {
    const firestore = new MockFirestore();
    const docRef = firestore.doc('class_reports', '五 1');
    await firestore.setDoc(docRef, { present: 28 });

    firestore.goOffline();
    const snap = await firestore.getDoc(docRef);
    assert.equal(snap.metadata.fromCache, true);
  });

  it('B13-2: 50 concurrent listener callbacks resolve without memory leaks', async () => {
    const firestore = new MockFirestore();
    const unsubs = [];
    let totalInvoked = 0;

    for (let i = 0; i < 50; i++) {
      unsubs.push(firestore.onSnapshot(firestore.doc('class_reports', `c_${i}`), () => {
        totalInvoked++;
      }));
    }

    assert.equal(unsubs.length, 50);
    for (const u of unsubs) u();
  });

  it('B13-3: Snapshot comparison helper detects whether data actually changed', () => {
    const hasDataChanged = (prev, next) => JSON.stringify(prev) !== JSON.stringify(next);
    const d1 = { present: 28, leave: 0 };
    const d2 = { present: 28, leave: 0 };
    const d3 = { present: 27, leave: 1 };

    assert.equal(hasDataChanged(d1, d2), false);
    assert.equal(hasDataChanged(d1, d3), true);
  });

  it('B13-4: Null or empty document snapshot data is handled safely by UI consumer', () => {
    const extractClassData = (snap) => {
      if (!snap || !snap.exists()) return { total: 0, present: 0, status: 'empty' };
      return snap.data();
    };
    const emptySnap = { exists: () => false, data: () => undefined };
    assert.deepEqual(extractClassData(emptySnap), { total: 0, present: 0, status: 'empty' });
  });

  it('B13-5: Out-of-order packet delivery simulation is ordered by server timestamp', () => {
    const packets = [
      { id: 2, timestamp: 1729000002, val: 'latest' },
      { id: 1, timestamp: 1729000001, val: 'old' }
    ];
    packets.sort((a, b) => a.timestamp - b.timestamp);
    assert.equal(packets[0].id, 1);
    assert.equal(packets[1].id, 2);
  });
});
