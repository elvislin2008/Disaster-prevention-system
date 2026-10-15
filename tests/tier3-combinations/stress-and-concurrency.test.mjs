import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MockFirestore } from '../helpers/mock-firestore.mjs';
import { createGasAdapter } from '../helpers/mock-gas-adapter.mjs';
import { createStandardSchedules, generate90Classes } from '../helpers/test-dataset.mjs';
import { calculateOralReport } from '../helpers/oral-report-calculator.mjs';
import { isClassActiveAtTime } from '../helpers/timetable-engine.mjs';

describe('Tier 3: Pairwise - Stress Testing and High Concurrency Workflows', () => {
  it('T3-16: 90 classes concurrent simulated roll call computes campus totals accurately', async () => {
    const firestore = new MockFirestore();
    const classes = generate90Classes(); // 90 classes * 28 students = 2520 students

    const promises = classes.map(c => {
      return firestore.setDoc(firestore.doc('class_reports', c.classKey), {
        total: 28,
        presentCount: 28,
        leaveCount: 0,
        missingCount: 0
      });
    });

    await Promise.all(promises);

    const reportsSnap = await firestore._getCollectionSnapshot('class_reports');
    assert.equal(reportsSnap.size, 90);

    const reports = {};
    for (const d of reportsSnap.docs) reports[d.id] = d.data();
    const oralReport = calculateOralReport({ classReports: reports });

    assert.equal(oralReport.totalActive, 2520);
    assert.equal(oralReport.totalPresent, 2520);
    assert.equal(oralReport.totalRescuing, 0);
  });

  it('T3-17: Stress test execution applies capped anomalies and updates oral report correctly', async () => {
    const firestore = new MockFirestore();
    const schedules = createStandardSchedules();
    const google = createGasAdapter({ firestore, schedules });

    await new Promise(resolve => {
      google.script.run.withSuccessHandler(resolve).runStressTest('mon_am');
    });

    const reportsSnap = await firestore._getCollectionSnapshot('class_reports');
    const rescuesSnap = await firestore._getCollectionSnapshot('rescues');
    const pulloutsSnap = await firestore._getCollectionSnapshot('pullouts');

    const reports = {};
    for (const d of reportsSnap.docs) reports[d.id] = d.data();
    const rescues = {};
    for (const d of rescuesSnap.docs) rescues[d.id] = d.data();
    const pullouts = {};
    for (const d of pulloutsSnap.docs) pullouts[d.id] = d.data().status;

    const oralReport = calculateOralReport({ classReports: reports, rescues, pullouts });
    // Capped: 2 missing in rescues, 2 hospital in rescues, 1 pending pullout (Iron Rule 4 => 0 rescue)
    assert.equal(oralReport.totalRescuing, 2);
    assert.equal(oralReport.totalHospital, 2);
  });

  it('T3-18: Concurrent updates from multiple teachers writing simultaneously complete without deadlocks', async () => {
    const firestore = new MockFirestore();
    const google = createGasAdapter({ firestore });

    const writes = [];
    for (let i = 1; i <= 20; i++) {
      const p = new Promise(resolve => {
        google.script.run
          .withSuccessHandler(resolve)
          .updateClassReportDelta(`一 ${i}`, { total: 28, presentCount: 28 });
      });
      writes.push(p);
    }

    const results = await Promise.all(writes);
    assert.equal(results.length, 20);
    for (const r of results) {
      assert.equal(r.success, true);
    }
  });

  it('T3-19: Clear all reports by commander resets all 90 class documents cleanly', async () => {
    const firestore = new MockFirestore();
    const google = createGasAdapter({ firestore });

    // Seed 10 classes
    for (let i = 1; i <= 10; i++) {
      await firestore.setDoc(firestore.doc('class_reports', `一 ${i}`), { total: 28, present: 28 });
    }

    const res = await new Promise(resolve => {
      google.script.run.withSuccessHandler(resolve).clearAllReports();
    });
    assert.equal(res.success, true);

    const reportsSnap = await firestore._getCollectionSnapshot('class_reports');
    assert.equal(reportsSnap.size, 0);
  });

  it('T3-20: Dynamic switch of simTimeMode re-filters active classes and updates oral report attendance', () => {
    const schedules = createStandardSchedules();
    const checkActiveAttendance = (mode) => {
      let activeCount = 0;
      for (const grade of ['一', '二', '三', '四', '五', '六']) {
        for (let c = 1; c <= 15; c++) {
          if (isClassActiveAtTime(grade, String(c), mode, schedules)) {
            activeCount += 28;
          }
        }
      }
      return activeCount;
    };

    // mon_am: all 90 classes active = 90 * 28 = 2520
    const monAmTotal = checkActiveAttendance('mon_am');
    assert.equal(monAmTotal, 2520);

    // mon_pm1: grades 1-2 dismissed (30 classes inactive), grades 3-6 active (60 classes = 1680)
    const monPm1Total = checkActiveAttendance('mon_pm1');
    assert.equal(monPm1Total, 1680);
  });
});
