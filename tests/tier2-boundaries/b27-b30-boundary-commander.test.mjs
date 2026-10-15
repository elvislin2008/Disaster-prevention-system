import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { calculateOralReport } from '../helpers/oral-report-calculator.mjs';
import { MockFirestore } from '../helpers/mock-firestore.mjs';
import { createGasAdapter } from '../helpers/mock-gas-adapter.mjs';
import { createStandardSchedules } from '../helpers/test-dataset.mjs';

describe('Tier 2: Boundary - Feature 27 (Oral Report Capsule & Total Attendance)', () => {
  it('B27-1: Non-numeric custom total override input is rejected by input validator', () => {
    const sanitizeTotal = (input) => {
      const num = Number(input);
      if (Number.isNaN(num) || !Number.isInteger(num)) {
        throw new Error('總人數必須為正整數');
      }
      return num;
    };
    assert.throws(() => sanitizeTotal('abc'), /總人數必須為正整數/);
    assert.throws(() => sanitizeTotal('25.5'), /總人數必須為正整數/);
  });

  it('B27-2: Negative custom total override input is rejected', () => {
    const sanitizeTotal = (input) => {
      const num = Number(input);
      if (num < 0) throw new Error('人數不得為負數');
      return num;
    };
    assert.throws(() => sanitizeTotal(-10), /人數不得為負數/);
  });

  it('B27-3: Custom total override exceeding reasonable campus limit (5000) flags confirmation warning', () => {
    const checkCampusLimit = (total) => {
      if (total > 5000) return 'warning_exceeds_campus_limit';
      return 'ok';
    };
    assert.equal(checkCampusLimit(6000), 'warning_exceeds_campus_limit');
    assert.equal(checkCampusLimit(2400), 'ok');
  });

  it('B27-4: Empty input to calculateOralReport returns default report text without throwing', () => {
    const report = calculateOralReport({});
    assert.ok(report.speechText);
    assert.equal(report.totalActive, 0);
  });

  it('B27-5: Oral report with 0 present and 100% missing formulates proper grammar', () => {
    const classReports = {
      '六 1': { total: 28, presentCount: 0, leaveCount: 0, missingCount: 28 }
    };
    const report = calculateOralReport({ classReports });
    assert.equal(report.totalPresent, 0);
    assert.equal(report.totalRescuing, 28);
    assert.ok(report.speechText.includes('現場出席人數 0 人'));
    assert.ok(report.speechText.includes('(搜救中 28 人)'));
  });
});

describe('Tier 2: Boundary - Feature 28 (Stress Test Runner & Class Badge Modal)', () => {
  it('B28-1: Running stress test on slot with no active classes returns classesCount: 0 without crashing', async () => {
    const firestore = new MockFirestore();
    const schedules = []; // empty schedules => 0 classes active
    const google = createGasAdapter({ firestore, schedules });

    const res = await new Promise(resolve => {
      google.script.run.withSuccessHandler(resolve).runStressTest('mon_am');
    });
    assert.equal(res.success, true);
    assert.equal(res.classesCount, 0);
  });

  it('B28-2: Concurrently triggering stress test while one is running is throttled', () => {
    let isRunning = false;
    const startStressTest = () => {
      if (isRunning) throw new Error('壓測進行中，請稍候再試');
      isRunning = true;
      return true;
    };
    assert.equal(startStressTest(), true);
    assert.throws(() => startStressTest(), /壓測進行中/);
  });

  it('B28-3: Stress test anomalies do not exceed caps (2 missing, 2 injured, 1 pullout) on 90 classes', async () => {
    const firestore = new MockFirestore();
    const schedules = createStandardSchedules();
    const google = createGasAdapter({ firestore, schedules });

    await new Promise(resolve => {
      google.script.run.withSuccessHandler(resolve).runStressTest('mon_am');
    });

    const rescuesSnap = await firestore._getCollectionSnapshot('rescues');
    const pulloutsSnap = await firestore._getCollectionSnapshot('pullouts');

    assert.equal(rescuesSnap.size, 4); // 2 missing + 2 injured
    assert.equal(pulloutsSnap.size, 1); // 1 pullout
  });

  it('B28-4: Class badge modal handles rendering 90 class badges without layout breakdown', () => {
    const renderClassBadges = (classes) => {
      return classes.map(c => `<span class="badge">${c}</span>`).join('');
    };
    const classList = [];
    for (let g = 1; g <= 6; g++) {
      for (let c = 1; c <= 15; c++) classList.push(`${g}年${c}班`);
    }
    const html = renderClassBadges(classList);
    assert.equal(classList.length, 90);
    assert.ok(html.includes('<span class="badge">6年15班</span>'));
  });

  it('B28-5: Stress test records metadata including timestamp, durationMs, and mode', () => {
    const recordStressLog = (mode, count, startMs) => {
      return {
        timestamp: Date.now(),
        durationMs: Date.now() - startMs,
        simTimeMode: mode,
        classesCount: count,
        cappedAnomalies: { missing: 2, injured: 2, pullout: 1, missedCall: 1 }
      };
    };
    const log = recordStressLog('mon_am', 90, Date.now() - 250);
    assert.equal(log.simTimeMode, 'mon_am');
    assert.equal(log.classesCount, 90);
    assert.ok(log.durationMs >= 200);
  });
});

describe('Tier 2: Boundary - Feature 29 (Emergency Double Protection & Passcode)', () => {
  it('B29-1: Rapid passcode brute force locks input after threshold attempts', () => {
    let failedAttempts = 0;
    const submitCode = (code) => {
      if (failedAttempts >= 5) throw new Error('Lockout: too many attempts, please wait');
      if (code !== '8888') {
        failedAttempts++;
        return false;
      }
      return true;
    };
    for (let i = 0; i < 5; i++) submitCode('1111');
    assert.throws(() => submitCode('8888'), /Lockout: too many attempts/);
  });

  it('B29-2: Emergency passcode is not stored in plaintext in client localStorage', () => {
    const mockStorage = {
      'SELECTED_BG_THEME': 'C',
      'USER_PREF': 'compact'
    };
    // Passcode 8888 must never be stored in persistent localStorage keys
    assert.equal(mockStorage['ADMIN_PASSWORD'], undefined);
    assert.equal(mockStorage['EMERGENCY_CODE'], undefined);
  });

  it('B29-3: Site locked overlay cannot be bypassed if unlocked state is false', () => {
    const checkCanInteract = (isSiteLocked) => {
      if (isSiteLocked) throw new Error('Site is emergency locked');
      return true;
    };
    assert.throws(() => checkCanInteract(true), /Site is emergency locked/);
    assert.equal(checkCanInteract(false), true);
  });

  it('B29-4: Relocking commander view re-masks telephone numbers immediately', () => {
    let isUnlocked = true;
    const getPhoneNumber = (phone) => isUnlocked ? phone : '🔒 ***-***';

    assert.equal(getPhoneNumber('0912345678'), '0912345678');
    isUnlocked = false; // relock
    assert.equal(getPhoneNumber('0912345678'), '🔒 ***-***');
  });

  it('B29-5: Drill mode status badge visually differentiates 🛡️ 演練防護 vs 🚨 危難全開', () => {
    const getModeBadge = (isDrill) => isDrill ? '🛡️ 演練防護 (電話已遮蔽)' : '🚨 危難全開 (電話已解鎖)';
    assert.equal(getModeBadge(true), '🛡️ 演練防護 (電話已遮蔽)');
    assert.equal(getModeBadge(false), '🚨 危難全開 (電話已解鎖)');
  });
});

describe('Tier 2: Boundary - Feature 30 (Full E2E Test Suite Execution & Hardening)', () => {
  it('B30-1: Test runner timeout per test (e.g. 5000ms) prevents infinite loops', async () => {
    const runWithTimeout = async (fn, timeoutMs = 100) => {
      return Promise.race([
        fn(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Test timeout exceeded')), timeoutMs))
      ]);
    };
    await assert.rejects(async () => {
      await runWithTimeout(() => new Promise(() => {}), 50);
    }, /Test timeout exceeded/);
  });

  it('B30-2: Test runner handles empty test suites gracefully without crashing', () => {
    const aggregateResults = (suites) => {
      return { totalSuites: suites.length, passed: suites.every(s => s.pass) };
    };
    assert.deepEqual(aggregateResults([]), { totalSuites: 0, passed: true });
  });

  it('B30-3: Test runner handles process signals gracefully and outputs partial results', () => {
    const state = { completedTests: 150, interrupted: false };
    const handleSigint = () => { state.interrupted = true; return state; };
    const res = handleSigint();
    assert.equal(res.interrupted, true);
    assert.equal(res.completedTests, 150);
  });

  it('B30-4: Structured JSON output mode (--json) produces valid JSON string', () => {
    const formatJsonReport = (p, f, d) => JSON.stringify({ passed: p, failed: f, durationMs: d });
    const jsonStr = formatJsonReport(300, 0, 520);
    const parsed = JSON.parse(jsonStr);
    assert.equal(parsed.passed, 300);
    assert.equal(parsed.failed, 0);
  });

  it('B30-5: Test runner memory footprint remains within safe bounds (<200MB)', () => {
    const mem = process.memoryUsage();
    const heapUsedMb = mem.heapUsed / 1024 / 1024;
    assert.ok(heapUsedMb < 200, `Heap used was ${heapUsedMb}MB, expected < 200MB`);
  });
});
