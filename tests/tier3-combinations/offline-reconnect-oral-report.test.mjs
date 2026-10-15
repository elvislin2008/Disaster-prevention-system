import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MockFirestore } from '../helpers/mock-firestore.mjs';
import { calculateOralReport } from '../helpers/oral-report-calculator.mjs';

describe('Tier 3: Pairwise - Offline Teacher Roll Call -> Reconnect -> Sync -> Commander Dashboard', () => {
  it('T3-1: Offline roll call in 5 classes queues writes and immediately updates optimistic cache', async () => {
    const firestore = new MockFirestore();
    firestore.goOffline();

    for (let c = 1; c <= 5; c++) {
      await firestore.setDoc(firestore.doc('class_reports', `一 ${c}`), {
        total: 28,
        presentCount: 27,
        leaveCount: 1,
        missingCount: 0
      });
    }

    assert.equal(firestore.pendingQueue.length, 5);
    // Local cache read succeeds
    const snap1 = await firestore.getDoc(firestore.doc('class_reports', '一 1'));
    assert.equal(snap1.data().leaveCount, 1);
    assert.equal(snap1.metadata.hasPendingWrites, true);
  });

  it('T3-2: Reconnection drains all queued mutations and updates server collection snapshot', async () => {
    const firestore = new MockFirestore();
    firestore.goOffline();

    for (let c = 1; c <= 5; c++) {
      await firestore.setDoc(firestore.doc('class_reports', `一 ${c}`), {
        total: 28,
        presentCount: 27,
        leaveCount: 1,
        missingCount: 0
      });
    }

    await firestore.goOnline();
    assert.equal(firestore.pendingQueue.length, 0);

    const serverSnap = await firestore._getCollectionSnapshot('class_reports', false);
    assert.equal(serverSnap.size, 5);
  });

  it('T3-3: Commander dashboard onSnapshot listener receives drained reports and re-calculates speech text', async () => {
    const firestore = new MockFirestore();
    let latestSpeech = '';

    const unsub = firestore.onSnapshot(firestore.collection('class_reports'), snap => {
      const reports = {};
      for (const d of snap.docs) reports[d.id] = d.data();
      const report = calculateOralReport({ classReports: reports });
      latestSpeech = report.speechText;
    });

    firestore.goOffline();
    for (let c = 1; c <= 3; c++) {
      await firestore.setDoc(firestore.doc('class_reports', `二 ${c}`), {
        total: 28,
        presentCount: 26,
        leaveCount: 2,
        missingCount: 0
      });
    }

    await firestore.goOnline();
    await new Promise(r => setTimeout(r, 15));

    // 3 classes * 28 = 84 total, 3 * 26 = 78 present, 3 * 2 = 6 leave
    assert.ok(latestSpeech.includes('應出席 84 人'));
    assert.ok(latestSpeech.includes('現場出席人數 78 人'));
    assert.ok(latestSpeech.includes('請假 6 人'));
    unsub();
  });

  it('T3-4: Offline teacher marks 1 missing student -> reconnect -> commander oral report reflects rescue count', async () => {
    const firestore = new MockFirestore();
    firestore.goOffline();

    await firestore.setDoc(firestore.doc('class_reports', '三 1'), {
      total: 28,
      presentCount: 27,
      leaveCount: 0,
      missingCount: 1
    });

    await firestore.goOnline();
    const snap = await firestore.getDoc(firestore.doc('class_reports', '三 1'));
    const report = calculateOralReport({ classReports: { '三 1': snap.data() } });

    assert.equal(report.totalRescuing, 1);
    assert.equal(report.classStatusMap['三 1'], 'has-missing');
    assert.ok(report.speechText.includes('(搜救中 1 人)'));
  });

  it('T3-5: Status indicator transitions cleanly: online -> offline (pending: 2) -> online (pending: 0)', async () => {
    const firestore = new MockFirestore();
    const states = [];

    const recordStatus = () => {
      const isOnline = firestore.isOnline;
      const pending = firestore.pendingQueue.length;
      states.push({ isOnline, pending });
    };

    recordStatus(); // initial online
    firestore.goOffline();
    await firestore.setDoc(firestore.doc('class_reports', '一 1'), { p: 1 });
    await firestore.setDoc(firestore.doc('class_reports', '一 2'), { p: 2 });
    recordStatus(); // offline with 2

    await firestore.goOnline();
    recordStatus(); // back online with 0

    assert.deepEqual(states, [
      { isOnline: true, pending: 0 },
      { isOnline: false, pending: 2 },
      { isOnline: true, pending: 0 }
    ]);
  });
});
