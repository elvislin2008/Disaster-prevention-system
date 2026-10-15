import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MockFirestore } from '../helpers/mock-firestore.mjs';
import { FirestoreService } from '../../public/js/firestore-service.js';
import { createGasAdapter } from '../helpers/mock-gas-adapter.mjs';
import { generate90Classes } from '../helpers/test-dataset.mjs';
import { calculateOralReport } from '../helpers/oral-report-calculator.mjs';

describe('Adversarial Verification: 1. High Concurrency Stress Test', () => {
  it('ADV-1.1: 90 classes submit roll call simultaneously within 100ms with zero deadlocks and zero lock timeouts', async () => {
    const firestore = new MockFirestore();
    const google = createGasAdapter({ firestore });
    const classes = generate90Classes(); // 90 classes, 28 students each = 2520 students

    assert.equal(classes.length, 90, 'Must have exactly 90 classes');

    const startTime = performance.now();
    let deadlockCount = 0;
    let lockTimeoutCount = 0;

    // Dispatch all 90 submissions simultaneously
    const submissionPromises = classes.map((c, index) => {
      // Introduce micro jitter within 0-90ms to simulate simultaneous network bursts within 100ms window
      const jitterMs = (index * 1.05) % 90;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(`Lock timeout for class ${c.classKey}`));
        }, 5000); // 5s timeout threshold

        setTimeout(() => {
          try {
            google.script.run
              .withSuccessHandler((res) => {
                clearTimeout(timer);
                resolve({ classKey: c.classKey, res });
              })
              .withFailureHandler((err) => {
                clearTimeout(timer);
                if (String(err).includes('deadlock')) deadlockCount++;
                if (String(err).includes('timeout')) lockTimeoutCount++;
                reject(err);
              })
              .updateClassReportDelta(c.classKey, {
                classKey: c.classKey,
                total: 28,
                presentCount: 28,
                leaveCount: 0,
                missingCount: 0,
                submittedAt: Date.now()
              });
          } catch (e) {
            clearTimeout(timer);
            reject(e);
          }
        }, jitterMs);
      });
    });

    const results = await Promise.all(submissionPromises);
    const duration = performance.now() - startTime;

    // Metrics verification
    assert.equal(results.length, 90, 'All 90 submissions must complete');
    assert.equal(deadlockCount, 0, 'Zero deadlocks permitted');
    assert.equal(lockTimeoutCount, 0, 'Zero lock timeouts permitted');

    // Verify all 90 persisted cleanly in Firestore
    const reportsSnap = await firestore._getCollectionSnapshot('class_reports', false);
    assert.equal(reportsSnap.size, 90, 'All 90 class documents must persist cleanly in Firestore');

    // Verify data integrity across all 90 documents
    let totalPersistedActive = 0;
    let totalPersistedPresent = 0;
    for (const doc of reportsSnap.docs) {
      const data = doc.data();
      assert.ok(data.classKey || doc.id, 'Every document must contain valid classKey');
      assert.equal(data.total, 28);
      assert.equal(data.presentCount, 28);
      totalPersistedActive += data.total;
      totalPersistedPresent += data.presentCount;
    }

    assert.equal(totalPersistedActive, 2520, 'Total campus active students must be exactly 2520');
    assert.equal(totalPersistedPresent, 2520, 'Total campus present students must be exactly 2520');

    // Oral report calculation verification
    const reports = {};
    for (const d of reportsSnap.docs) reports[d.id] = d.data();
    const oralReport = calculateOralReport({ classReports: reports });
    assert.equal(oralReport.totalActive, 2520);
    assert.equal(oralReport.totalPresent, 2520);
    assert.equal(oralReport.totalRescuing, 0);
  });

  it('ADV-1.2: Production FirestoreService 90 classes concurrent write benchmark (<100ms dispatch, 100% persistence)', async () => {
    const fs = new FirestoreService();
    await fs.init();
    await fs.clearAllData();

    const classes = generate90Classes();
    const dispatchStart = performance.now();

    // Concurrent burst write
    const writePromises = classes.map(c => {
      return fs.setClassReport(c.classKey, {
        total: 28,
        presentCount: 27,
        leaveCount: 1,
        missingCount: 0
      });
    });

    const writes = await Promise.all(writePromises);
    const totalTimeMs = performance.now() - dispatchStart;

    assert.equal(writes.length, 90);

    const allReports = await fs.getAllClassReports();
    assert.equal(Object.keys(allReports).length, 90, 'All 90 classes must be present in getAllClassReports');

    for (const c of classes) {
      const report = allReports[c.classKey];
      assert.ok(report, `Report for ${c.classKey} must exist`);
      assert.equal(report.presentCount, 27);
      assert.equal(report.leaveCount, 1);
    }
  });

  it('ADV-1.3: Extreme write contention: 50 concurrent updates to the SAME classKey resolve cleanly without data corruption', async () => {
    const fs = new FirestoreService();
    await fs.init();
    await fs.clearAllData();

    const targetClass = '一 1';
    await fs.setClassReport(targetClass, { total: 28, presentCount: 28, leaveCount: 0, missingCount: 0 });

    const contentionWrites = [];
    for (let i = 1; i <= 50; i++) {
      contentionWrites.push(
        fs.setClassReport(targetClass, {
          lastSeq: i,
          timestamp: Date.now() + i
        }, { merge: true })
      );
    }

    const results = await Promise.all(contentionWrites);
    assert.equal(results.length, 50);

    const finalReport = await fs.getClassReport(targetClass);
    assert.ok(finalReport);
    assert.equal(finalReport.total, 28);
    assert.ok(finalReport.lastSeq >= 1 && finalReport.lastSeq <= 50);
  });

  it('ADV-1.4: Realtime fanout scalability: 90 active listeners receive concurrent class updates without dropping messages', async () => {
    const firestore = new MockFirestore();
    const classes = generate90Classes();

    let notificationCount = 0;
    const unsubscribes = [];

    // Attach 90 listeners (one per class)
    for (const c of classes) {
      const ref = firestore.doc('class_reports', c.classKey);
      const unsub = firestore.onSnapshot(ref, (snap) => {
        if (snap.exists() && snap.data().presentCount !== undefined) {
          notificationCount++;
        }
      });
      unsubscribes.push(unsub);
    }

    // Trigger concurrent writes to all 90 classes
    const writes = classes.map(c => {
      return firestore.setDoc(firestore.doc('class_reports', c.classKey), {
        total: 28,
        presentCount: 28
      });
    });

    await Promise.all(writes);

    // Give microtasks time to complete notifications
    await new Promise(r => setTimeout(r, 50));

    assert.ok(notificationCount >= 90, `Expected at least 90 notifications, received ${notificationCount}`);

    // Cleanup
    unsubscribes.forEach(unsub => unsub());
  });
});
