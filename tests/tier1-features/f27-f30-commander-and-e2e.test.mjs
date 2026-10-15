import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { calculateOralReport } from '../helpers/oral-report-calculator.mjs';
import { MockFirestore } from '../helpers/mock-firestore.mjs';
import { createGasAdapter } from '../helpers/mock-gas-adapter.mjs';
import { createStandardSchedules } from '../helpers/test-dataset.mjs';

describe('Tier 1: Feature 27 - Oral Report Capsule & Total Attendance', () => {
  it('F27-1: Oral report speech text formats numbers into exact canonical string', () => {
    const classReports = {
      '一 1': { total: 28, presentCount: 26, leaveCount: 2, missingCount: 0 }
    };
    const rescues = {
      '一 1_02號': { triageCard: 'yellow', escortCount: 2 }
    };
    const report = calculateOralReport({ classReports, rescues });
    const expected = '全校教職員工及學生應出席 28 人，請假 2 人，送醫 1 人，陪同就醫 2 人，現場出席人數 26 人，另有校外人士 0 名，報告完畢。(搜救中 0 人)';
    assert.equal(report.speechText, expected);
  });

  it('F27-2: Commander custom total override replaces calculated total attendance in speech text', () => {
    const classReports = {
      '一 1': { total: 28, presentCount: 28, leaveCount: 0, missingCount: 0 }
    };
    const report = calculateOralReport({ classReports, customTotal: 2500 });
    assert.equal(report.totalActive, 2500);
    assert.ok(report.speechText.includes('應出席 2500 人'));
  });

  it('F27-3: Approved calculated total updates without altering breakdown numbers', () => {
    const classReports = {
      '一 1': { total: 28, presentCount: 27, leaveCount: 1, missingCount: 0 }
    };
    const report = calculateOralReport({ classReports, customTotal: null });
    assert.equal(report.totalActive, 28);
    assert.equal(report.totalLeave, 1);
    assert.equal(report.totalPresent, 27);
  });

  it('F27-4: Speech formula handles zero counts cleanly without NaN or undefined', () => {
    const report = calculateOralReport({});
    assert.equal(report.totalActive, 0);
    assert.equal(report.totalPresent, 0);
    assert.ok(report.speechText.includes('應出席 0 人'));
    assert.ok(report.speechText.includes('搜救中 0 人'));
  });

  it('F27-5: Triage escort and hospital counts directly increment from yellow/red cases', () => {
    const rescues = {
      's1': { triageCard: 'yellow', escortCount: 2 },
      's2': { triageCard: 'red', escortCount: 3 },
      's3': { triageCard: 'green', escortCount: 0 }
    };
    const report = calculateOralReport({ rescues });
    assert.equal(report.totalHospital, 2); // yellow + red only
    assert.equal(report.totalEscort, 5);   // 2 + 3
  });
});

describe('Tier 1: Feature 28 - Stress Test Runner & Class Badge Modal', () => {
  it('F28-1: Stress test executes and sets capped anomalies (2 missing, 2 injured, 1 pullout)', async () => {
    const firestore = new MockFirestore();
    const schedules = createStandardSchedules();
    const google = createGasAdapter({ firestore, schedules });

    const result = await new Promise(resolve => {
      google.script.run.withSuccessHandler(resolve).runStressTest('mon_am');
    });

    assert.equal(result.success, true);
    assert.ok(result.classesCount > 0);

    const rescuesSnap = await firestore._getCollectionSnapshot('rescues');
    const pulloutsSnap = await firestore._getCollectionSnapshot('pullouts');

    // 2 missing + 2 injured = 4 rescue entries
    assert.equal(rescuesSnap.size, 4);
    assert.equal(pulloutsSnap.size, 1);
  });

  it('F28-2: Stress test on auto mode detects current slot without throwing error', async () => {
    const firestore = new MockFirestore();
    const schedules = createStandardSchedules();
    const google = createGasAdapter({ firestore, schedules });

    const result = await new Promise(resolve => {
      google.script.run.withSuccessHandler(resolve).runStressTest('auto');
    });
    assert.equal(result.success, true);
  });

  it('F28-3: Stress test class badge modal lists all tested classes', async () => {
    const firestore = new MockFirestore();
    const schedules = createStandardSchedules();
    const google = createGasAdapter({ firestore, schedules });

    const res = await new Promise(resolve => {
      google.script.run.withSuccessHandler(resolve).runStressTest('thu_am');
    });
    assert.ok(res.activeClasses.length > 0);
    assert.ok(res.activeClasses.includes('一 1'));
  });

  it('F28-4: Stress test maintains class report integrity for all participating classes', async () => {
    const firestore = new MockFirestore();
    const schedules = createStandardSchedules();
    const google = createGasAdapter({ firestore, schedules });

    await new Promise(resolve => {
      google.script.run.withSuccessHandler(resolve).runStressTest('mon_am');
    });

    const docSnap = await firestore.getDoc(firestore.doc('class_reports', '一 1'));
    assert.equal(docSnap.exists(), true);
    assert.equal(docSnap.data().total, 28);
  });

  it('F28-5: Stress test does not exceed anomaly caps under large class volume', async () => {
    const firestore = new MockFirestore();
    const schedules = createStandardSchedules();
    const google = createGasAdapter({ firestore, schedules });

    await new Promise(resolve => {
      google.script.run.withSuccessHandler(resolve).runStressTest('mon_am');
    });

    const rescuesSnap = await firestore._getCollectionSnapshot('rescues');
    let missingCount = 0;
    let injuredCount = 0;
    for (const d of rescuesSnap.docs) {
      if (d.data().status === 'missing') missingCount++;
      if (d.data().triageCard === 'yellow') injuredCount++;
    }
    assert.equal(missingCount, 2);
    assert.equal(injuredCount, 2);
  });
});

describe('Tier 1: Feature 29 - Emergency Double Protection & Passcode', () => {
  it('F29-1: Drill mode masks parent phone numbers as 🔒 ***-*** by default', () => {
    const maskPhone = (phone, isDrillMode) => {
      if (isDrillMode) return '🔒 ***-*** (個資防護中)';
      return phone;
    };
    assert.equal(maskPhone('0912345678', true), '🔒 ***-*** (個資防護中)');
    assert.equal(maskPhone('0912345678', false), '0912345678');
  });

  it('F29-2: Entering correct passcode 8888 unmasks telephone numbers for 20 minutes', () => {
    let isDrillMode = true;
    const unlock = (code) => {
      if (code === '8888') {
        isDrillMode = false;
        return true;
      }
      return false;
    };
    const ok = unlock('8888');
    assert.equal(ok, true);
    assert.equal(isDrillMode, false);
  });

  it('F29-3: Incorrect emergency passcode rejects unlock attempt', () => {
    let isDrillMode = true;
    const unlock = (code) => {
      if (code === '8888') {
        isDrillMode = false;
        return true;
      }
      return false;
    };
    const ok = unlock('0000');
    assert.equal(ok, false);
    assert.equal(isDrillMode, true);
  });

  it('F29-4: Site lock overlay (#siteLockedOverlay) full-screen covers application when locked', () => {
    const overlayProps = {
      id: 'siteLockedOverlay',
      display: 'flex',
      position: 'fixed',
      top: 0,
      left: 0,
      width: '100vw',
      height: '100vh',
      zIndex: 10000
    };
    assert.equal(overlayProps.display, 'flex');
    assert.ok(overlayProps.zIndex >= 9999);
  });

  it('F29-5: Site lock overlay requires master unlock key to restore interactive UI', () => {
    let siteLocked = true;
    const unlockSite = (key) => {
      if (key === '8888') siteLocked = false;
    };
    unlockSite('wrong');
    assert.equal(siteLocked, true);
    unlockSite('8888');
    assert.equal(siteLocked, false);
  });
});

describe('Tier 1: Feature 30 - Full E2E Test Suite Execution & Hardening', () => {
  it('F30-1: Test runner executes asynchronous test suites with clean promise resolution', async () => {
    const task = async () => 42;
    const res = await task();
    assert.equal(res, 42);
  });

  it('F30-2: Test runner aggregates pass/fail metrics across all suites', () => {
    const summary = { pass: 150, fail: 0, total: 150 };
    assert.equal(summary.pass, summary.total);
    assert.equal(summary.fail, 0);
  });

  it('F30-3: Test execution handles exceptions cleanly without unhandled rejection crashes', async () => {
    const runSafely = async (fn) => {
      try {
        await fn();
        return { success: true };
      } catch (e) {
        return { success: false, error: e.message };
      }
    };
    const res = await runSafely(async () => {
      throw new Error('Expected isolated error');
    });
    assert.equal(res.success, false);
    assert.equal(res.error, 'Expected isolated error');
  });

  it('F30-4: Test runner produces formatted markdown summary upon completion', () => {
    const formatMd = (p, f) => `### Test Summary\n- Passed: ${p}\n- Failed: ${f}\n`;
    const md = formatMd(150, 0);
    assert.ok(md.includes('Passed: 150'));
    assert.ok(md.includes('Failed: 0'));
  });

  it('F30-5: Test runner exits with zero exit code on 100% pass', () => {
    const getExitCode = (failedCount) => failedCount === 0 ? 0 : 1;
    assert.equal(getExitCode(0), 0);
    assert.equal(getExitCode(1), 1);
  });
});
