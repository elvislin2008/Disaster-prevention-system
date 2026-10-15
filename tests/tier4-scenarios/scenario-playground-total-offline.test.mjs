import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MockFirestore } from '../helpers/mock-firestore.mjs';

describe('Tier 4: Scenario 2 - Playground Total Offline Roll Call with Delayed Reconnection', () => {
  it('Simulates complete cellular network drop on school playground with optimistic writes and flawless sync', async () => {
    const firestore = new MockFirestore();

    // 1. Evacuate to playground: cellular base station overloaded, go offline
    firestore.goOffline();
    assert.equal(firestore.isOnline, false);

    const offlineClassKeys = [
      '一 1', '一 2', '二 1', '二 2', '三 1',
      '三 2', '四 1', '四 2', '五 1', '六 1'
    ];

    // 2. Teachers submit roll call on their phones
    for (let i = 0; i < offlineClassKeys.length; i++) {
      const classKey = offlineClassKeys[i];
      const result = await firestore.setDoc(firestore.doc('class_reports', classKey), {
        total: 28,
        presentCount: 26,
        leaveCount: 2,
        missingCount: 0,
        offlineSubmittedAt: Date.now()
      });

      // Verify write succeeded in local cache with pending status
      assert.equal(result.fromCache, true);
      assert.equal(result.hasPendingWrites, true);
    }

    assert.equal(firestore.pendingQueue.length, 10);

    // 3. Teachers check their local UI: reads succeed instantly from local IndexedDB cache
    for (const classKey of offlineClassKeys) {
      const snap = await firestore.getDoc(firestore.doc('class_reports', classKey));
      assert.equal(snap.exists(), true);
      assert.equal(snap.data().presentCount, 26);
      assert.equal(snap.metadata.fromCache, true);
      assert.equal(snap.metadata.hasPendingWrites, true);
    }

    // 4. Delayed reconnection: after evacuation briefing, teachers connect to emergency WiFi
    await firestore.goOnline();
    assert.equal(firestore.isOnline, true);
    assert.equal(firestore.pendingQueue.length, 0, 'Mutation queue must be completely drained');

    // 5. Verify server store has all 10 class reports with hasPendingWrites: false
    for (const classKey of offlineClassKeys) {
      const serverSnap = await firestore.getDoc(firestore.doc('class_reports', classKey));
      assert.equal(serverSnap.exists(), true);
      assert.equal(serverSnap.data().presentCount, 26);
      assert.equal(serverSnap.data().leaveCount, 2);
      assert.equal(serverSnap.metadata.hasPendingWrites, false);
      assert.equal(serverSnap.metadata.fromCache, false);
    }
  });
});
