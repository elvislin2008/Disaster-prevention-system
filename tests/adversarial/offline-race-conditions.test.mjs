import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MockFirestore } from '../helpers/mock-firestore.mjs';
import { FirestoreService } from '../../public/js/firestore-service.js';

describe('Adversarial Verification: 2. Offline Disconnect Race Conditions', () => {
  it('ADV-2.1: Abrupt disconnect mid-rollcall captures mutations optimistically and queues safely', async () => {
    const fs = new FirestoreService();
    await fs.init();
    await fs.clearAllData();

    // 1. Initial online writes
    await fs.setClassReport('一 1', { total: 28, presentCount: 28, leaveCount: 0 });
    assert.equal(fs.isOnline(), true);
    assert.equal(fs.hasPendingWrites(), false);

    // 2. Abrupt network disconnect
    fs.goOffline();
    assert.equal(fs.isOnline(), false);

    // 3. Roll call operations during total outage
    const write1 = await fs.setClassReport('一 1', { presentCount: 27, leaveCount: 1 });
    assert.equal(write1.fromCache, true);
    assert.equal(write1.hasPendingWrites, true);
    assert.equal(fs.hasPendingWrites(), true);

    // Local optimistic read succeeds immediately
    const optimisticSnap = await fs.getClassReport('一 1');
    assert.equal(optimisticSnap.presentCount, 27);
    assert.equal(optimisticSnap.leaveCount, 1);
  });

  it('ADV-2.2: Rapid offline state toggles (present -> missing -> leave) drain in FIFO order with Last-Write-Wins (LWW) and zero data loss', async () => {
    const fs = new FirestoreService();
    await fs.init();
    await fs.clearAllData();

    const studentKey = '一 1_01號';
    const classKey = '一 1';

    // Step 0: Initial state (online)
    await fs.setClassReport(classKey, {
      total: 28,
      presentCount: 28,
      missingCount: 0,
      leaveCount: 0,
      studentStatus: { [studentKey]: 'present' }
    });

    // Step 1: Disconnect network
    fs.goOffline();

    // Step 2: Toggle 1: Mark as missing
    const toggle1 = await fs.setClassReport(classKey, {
      presentCount: 27,
      missingCount: 1,
      leaveCount: 0,
      studentStatus: { [studentKey]: 'missing' },
      toggleSeq: 1,
      lastAction: 'marked_missing'
    }, { merge: true });
    assert.equal(toggle1.hasPendingWrites, true);

    // Verify local cache reflects toggle 1
    let localSnap = await fs.getClassReport(classKey);
    assert.equal(localSnap.studentStatus[studentKey], 'missing');
    assert.equal(localSnap.missingCount, 1);

    // Step 3: Toggle 2: Mark as leave
    const toggle2 = await fs.setClassReport(classKey, {
      presentCount: 27,
      missingCount: 0,
      leaveCount: 1,
      studentStatus: { [studentKey]: 'leave' },
      toggleSeq: 2,
      lastAction: 'marked_leave'
    }, { merge: true });
    assert.equal(toggle2.hasPendingWrites, true);

    // Verify local cache reflects toggle 2
    localSnap = await fs.getClassReport(classKey);
    assert.equal(localSnap.studentStatus[studentKey], 'leave');
    assert.equal(localSnap.leaveCount, 1);
    assert.equal(localSnap.missingCount, 0);

    // Step 4: Verify pending queue maintains strict FIFO order
    const queue = fs.localStore.pendingQueue;
    assert.equal(queue.length, 2, 'Pending queue must contain exactly 2 queued mutations');
    assert.equal(queue[0].data.toggleSeq, 1, 'First queued op must be toggleSeq 1');
    assert.equal(queue[1].data.toggleSeq, 2, 'Second queued op must be toggleSeq 2');
    assert.ok(queue[0].timestamp <= queue[1].timestamp, 'FIFO ordering by timestamp must hold');

    // Step 5: Delayed reconnection
    await fs.goOnline();
    assert.equal(fs.isOnline(), true);
    assert.equal(fs.hasPendingWrites(), false, 'Mutation queue must be completely drained');
    assert.equal(fs.localStore.pendingQueue.length, 0);

    // Step 6: Verify server store matches Last-Write-Wins (LWW) and zero data loss
    const finalServerReport = await fs.getClassReport(classKey);
    assert.ok(finalServerReport);
    assert.equal(finalServerReport.total, 28, 'Preserved total attendance');
    assert.equal(finalServerReport.studentStatus[studentKey], 'leave', 'Final state must be LEAVE (LWW)');
    assert.equal(finalServerReport.missingCount, 0);
    assert.equal(finalServerReport.leaveCount, 1);
    assert.equal(finalServerReport.toggleSeq, 2);
    assert.equal(finalServerReport.lastAction, 'marked_leave');
  });

  it('ADV-2.3: Interleaved offline mutations across multiple collections drain atomically without collisions', async () => {
    const firestore = new MockFirestore();

    // Go offline
    firestore.goOffline();

    // Class report write
    await firestore.setDoc(firestore.doc('class_reports', '二 3'), {
      total: 28,
      presentCount: 26,
      leaveCount: 1,
      missingCount: 1
    });

    // Pullout write
    await firestore.setDoc(firestore.doc('pullouts', '二 3_07號'), {
      status: 'pending',
      type: 'studyCenter'
    });

    // Rescue write
    await firestore.setDoc(firestore.doc('rescues', '二 3_08號'), {
      status: 'searching',
      locationFound: '2F走廊'
    });

    // Contact write
    await firestore.setDoc(firestore.doc('contacts', '二 3_08號'), {
      status: '聯繫中',
      count: 2,
      isHelpReq: false
    });

    assert.equal(firestore.pendingQueue.length, 4);

    // Delayed reconnection
    await firestore.goOnline();
    assert.equal(firestore.pendingQueue.length, 0);

    // Check all collections on server store
    const cSnap = await firestore.getDoc(firestore.doc('class_reports', '二 3'));
    const pSnap = await firestore.getDoc(firestore.doc('pullouts', '二 3_07號'));
    const rSnap = await firestore.getDoc(firestore.doc('rescues', '二 3_08號'));
    const ctSnap = await firestore.getDoc(firestore.doc('contacts', '二 3_08號'));

    assert.equal(cSnap.data().missingCount, 1);
    assert.equal(pSnap.data().status, 'pending');
    assert.equal(rSnap.data().locationFound, '2F走廊');
    assert.equal(ctSnap.data().count, 2);
  });

  it('ADV-2.4: Offline delete followed by recreate properly propagates to server upon reconnection', async () => {
    const fs = new FirestoreService();
    await fs.init();
    await fs.clearAllData();

    await fs.setClassReport('三 1', { total: 28, presentCount: 28 });

    fs.goOffline();
    // Delete offline
    await fs.deleteClassReport('三 1');
    assert.equal(await fs.getClassReport('三 1'), null);

    // Recreate offline with new payload
    await fs.setClassReport('三 1', { total: 28, presentCount: 25, leaveCount: 3 });
    const localRecreated = await fs.getClassReport('三 1');
    assert.equal(localRecreated.presentCount, 25);

    // Reconnect
    await fs.goOnline();
    const serverRecreated = await fs.getClassReport('三 1');
    assert.ok(serverRecreated);
    assert.equal(serverRecreated.presentCount, 25);
    assert.equal(serverRecreated.leaveCount, 3);
  });
});
