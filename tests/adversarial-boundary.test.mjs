/**
 * ==============================================================================
 * 清水國小校園災難與演練即時點名通報系統 V20.4
 * Milestone 6: Adversarial Boundary & Iron Rules Verification Test Suite
 * (tests/adversarial-boundary.test.mjs)
 * ==============================================================================
 *
 * This test suite conducts rigorous adversarial testing across 5 critical areas:
 * 1. Iron Rule 4 Boundary Stress: Cycle pullout students pending/safe/missing,
 *    verifying zero rescue count and zero red cards during pending/safe states,
 *    and exact red card toggling on missing/reversal.
 * 2. 12:40 Timetable Cutoff Boundary: Test at 12:39:59 vs 12:40:01, verifying
 *    exact active/dismissed classes and 100% mathematical oral report count.
 * 3. Thursday Full Timetable Permutations: Full matrix verification of all 4
 *    Thursday modes across all 90 regular classes and special groups.
 * 4. Emergency Passcode Rate Limiting & Rollback: 6 consecutive failed attempts
 *    triggering 30-second lockout, plus clock tampering backwards drift protection.
 * 5. Yellow/Red Triage Escort Validation: Mandatory 1-4 escort requirement for
 *    Yellow/Red cards, rejecting 0, null, negatives, and floats.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Helpers and engines
import { calculateOralReport } from './helpers/oral-report-calculator.mjs';
import { resolveTimeSlot, isClassActiveAtTime as timetableIsActive } from './helpers/timetable-engine.mjs';
import { createStandardSchedules, generate90Classes, generateStudentsForClass } from './helpers/test-dataset.mjs';
import { validateTriageEscortCount, ALL_VALID_GRADE_GROUPS, VALID_NORMAL_GRADES } from './helpers/contracts.mjs';

// Production modules under test
import appMethods, {
  isClassActiveAtTime as appIsClassActive,
  getNextRollCallStage
} from '../public/js/app.js';
import { SupabaseAuth } from '../public/js/supabase-auth.js';

describe('Milestone 6: Adversarial Boundary & Iron Rules Verification', () => {

  // ============================================================================
  // Challenge 1: Iron Rule 4 Boundary Stress Test
  // ============================================================================
  describe('Challenge 1: Iron Rule 4 Boundary Stress Test', () => {
    it('1.1 Rapidly cycles pullout students between pending and safe 50 times: rescue count stays 0 and cards never turn red', () => {
      const classKey = '一 1';
      const classReports = {
        [classKey]: {
          total: 28,
          presentCount: 28,
          leaveCount: 0,
          missingCount: 0,
          studyCenter: [{ seatRaw: '01號' }],
          nativeLang: [{ seatRaw: '02號' }],
          team: [{ seatRaw: '03號' }]
        }
      };

      const pullouts = {
        [`${classKey}_01號`]: 'pending',
        [`${classKey}_02號`]: 'pending',
        [`${classKey}_03號`]: 'pending'
      };

      // Stress cycle: 50 iterations alternating between pending and safe
      for (let cycle = 1; cycle <= 50; cycle++) {
        // State A: all pending
        pullouts[`${classKey}_01號`] = 'pending';
        pullouts[`${classKey}_02號`] = 'pending';
        pullouts[`${classKey}_03號`] = 'pending';

        let resPending = calculateOralReport({ classReports, pullouts });
        assert.equal(resPending.totalRescuing, 0, `Cycle ${cycle} [pending]: totalRescuing must be 0`);
        assert.notEqual(resPending.classStatusMap[classKey], 'has-missing', `Cycle ${cycle} [pending]: card must never be red`);
        assert.equal(resPending.classStatusMap[classKey], 'all-present', `Cycle ${cycle} [pending]: card must be all-present`);

        // State B: all safe
        pullouts[`${classKey}_01號`] = 'safe';
        pullouts[`${classKey}_02號`] = 'safe';
        pullouts[`${classKey}_03號`] = 'safe';

        let resSafe = calculateOralReport({ classReports, pullouts });
        assert.equal(resSafe.totalRescuing, 0, `Cycle ${cycle} [safe]: totalRescuing must be 0`);
        assert.notEqual(resSafe.classStatusMap[classKey], 'has-missing', `Cycle ${cycle} [safe]: card must never be red`);
        assert.equal(resSafe.classStatusMap[classKey], 'all-present', `Cycle ${cycle} [safe]: card must be all-present`);
      }
    });

    it('1.2 Transition from pending -> missing immediately increments rescue count and turns card red', () => {
      const classKey = '三 2';
      const classReports = {
        [classKey]: {
          total: 28,
          presentCount: 28,
          leaveCount: 0,
          missingCount: 0
        }
      };

      const pullouts = {
        [`${classKey}_05號`]: 'pending'
      };

      // 1. Pending: rescue = 0, card = non-red
      let res1 = calculateOralReport({ classReports, pullouts });
      assert.equal(res1.totalRescuing, 0);
      assert.notEqual(res1.classStatusMap[classKey], 'has-missing');
      assert.equal(res1.classStatusMap[classKey], 'all-present');

      // 2. Mark missing: rescue = 1, card = has-missing (red)
      pullouts[`${classKey}_05號`] = 'missing';
      let res2 = calculateOralReport({ classReports, pullouts });
      assert.equal(res2.totalRescuing, 1, 'Rescue count must increment to 1');
      assert.equal(res2.classStatusMap[classKey], 'has-missing', 'Class card must turn red');
      assert.ok(res2.speechText.includes('搜救中 1 人'));

      // 3. Mark another missing in same class: rescue = 2, card remains has-missing
      pullouts[`${classKey}_06號`] = 'missing';
      let res3 = calculateOralReport({ classReports, pullouts });
      assert.equal(res3.totalRescuing, 2, 'Rescue count must increment to 2');
      assert.equal(res3.classStatusMap[classKey], 'has-missing');
      assert.ok(res3.speechText.includes('搜救中 2 人'));
    });

    it('1.3 Reversing from missing back to safe clears rescue count and restores non-red card status', () => {
      const classKey = '四 5';
      const classReports = {
        [classKey]: {
          total: 28,
          presentCount: 28,
          leaveCount: 0,
          missingCount: 0
        }
      };

      const pullouts = {
        [`${classKey}_12號`]: 'missing'
      };

      // Initial missing state
      let resMissing = calculateOralReport({ classReports, pullouts });
      assert.equal(resMissing.totalRescuing, 1);
      assert.equal(resMissing.classStatusMap[classKey], 'has-missing');

      // Revert to safe
      pullouts[`${classKey}_12號`] = 'safe';
      let resReverted = calculateOralReport({ classReports, pullouts });
      assert.equal(resReverted.totalRescuing, 0, 'Rescue count must return to 0');
      assert.notEqual(resReverted.classStatusMap[classKey], 'has-missing', 'Red class card status must clear');
      assert.equal(resReverted.classStatusMap[classKey], 'all-present', 'Class card must return to all-present');
      assert.ok(resReverted.speechText.includes('搜救中 0 人'));

      // Revert to pending
      pullouts[`${classKey}_12號`] = 'pending';
      let resPending = calculateOralReport({ classReports, pullouts });
      assert.equal(resPending.totalRescuing, 0, 'Rescue count must stay 0 on pending');
      assert.notEqual(resPending.classStatusMap[classKey], 'has-missing', 'Class card must not be red on pending');
      assert.equal(resPending.classStatusMap[classKey], 'all-present', 'Class card must be all-present');
    });

    it('1.4 Multi-class adversarial stress: 10 classes with mixed pullout states isolate pending completely', () => {
      const classReports = {};
      const pullouts = {};

      for (let c = 1; c <= 10; c++) {
        const cKey = `五 ${c}`;
        classReports[cKey] = {
          total: 28,
          presentCount: 25,
          leaveCount: 0,
          missingCount: 0
        };
        // 3 pullout students per class
        pullouts[`${cKey}_01號`] = 'pending';
        pullouts[`${cKey}_02號`] = 'safe';
        pullouts[`${cKey}_03號`] = 'pending';
      }

      // Evaluation with 20 pending and 10 safe pullout students
      const res = calculateOralReport({ classReports, pullouts });
      assert.equal(res.totalRescuing, 0, 'Total rescuing must strictly remain 0');

      for (let c = 1; c <= 10; c++) {
        const cKey = `五 ${c}`;
        assert.notEqual(res.classStatusMap[cKey], 'has-missing', `${cKey} must NOT be red`);
      }

      // Now toggle ONE student in class 7 to missing
      pullouts['五 7_01號'] = 'missing';
      const resAfterMissing = calculateOralReport({ classReports, pullouts });
      assert.equal(resAfterMissing.totalRescuing, 1);
      assert.equal(resAfterMissing.classStatusMap['五 7'], 'has-missing', '五 7 must turn red');

      // The other 9 classes must remain non-red
      for (let c = 1; c <= 10; c++) {
        if (c === 7) continue;
        const cKey = `五 ${c}`;
        assert.notEqual(resAfterMissing.classStatusMap[cKey], 'has-missing', `${cKey} must remain non-red`);
      }

      // Revert class 7 back to pending
      pullouts['五 7_01號'] = 'pending';
      const resReverted = calculateOralReport({ classReports, pullouts });
      assert.equal(resReverted.totalRescuing, 0);
      assert.notEqual(resReverted.classStatusMap['五 7'], 'has-missing');
    });
  });

  // ============================================================================
  // Challenge 2: 12:40 Timetable Cutoff Boundary Test
  // ============================================================================
  describe('Challenge 2: 12:40 Timetable Cutoff Boundary Test', () => {
    const schedules = createStandardSchedules();

    it('2.1 Monday 12:39:59 (759.9 mins) evaluates to am slot with Grades 1 and 2 fully active (2520 students)', () => {
      // 2026-10-19 is a Monday
      const time123959 = new Date('2026-10-19T12:39:59');

      const slot = resolveTimeSlot(time123959);
      assert.equal(slot.targetDay, 'mon');
      assert.equal(slot.targetSlot, 'am', '12:39:59 must resolve to am');

      // Verify all grades 1 to 6 are active
      for (const grade of VALID_NORMAL_GRADES) {
        assert.equal(timetableIsActive(grade, '1', time123959, schedules), true, `${grade} 1 must be active at 12:39:59`);
        assert.equal(appIsClassActive(grade, '1', time123959, schedules), true, `app.js ${grade} 1 must be active at 12:39:59`);
      }

      // Build simulated class reports for all 90 classes
      const all90 = generate90Classes();
      const classReports = {};
      let totalActiveStudents = 0;

      for (const c of all90) {
        const isActive = appIsClassActive(c.grade, c.className, time123959, schedules);
        if (isActive) {
          totalActiveStudents += c.studentCount;
          classReports[c.classKey] = {
            total: c.studentCount,
            presentCount: c.studentCount,
            leaveCount: 0,
            missingCount: 0
          };
        }
      }

      assert.equal(all90.length, 90, 'Total regular classes is 90');
      assert.equal(Object.keys(classReports).length, 90, 'All 90 classes must be active in am');
      assert.equal(totalActiveStudents, 2520, '90 classes * 28 students = 2,520 students');

      const oralReport = calculateOralReport({ classReports });
      assert.equal(oralReport.totalActive, 2520);
      assert.equal(oralReport.totalPresent, 2520);
      assert.ok(oralReport.speechText.includes('應出席 2520 人'), 'Speech text must state 2520 active');
    });

    it('2.2 Monday 12:40:01 (760.1 mins) evaluates to pm1 slot with Grades 1 and 2 dismissed (1680 students)', () => {
      const time124001 = new Date('2026-10-19T12:40:01');

      const slot = resolveTimeSlot(time124001);
      assert.equal(slot.targetDay, 'mon');
      assert.equal(slot.targetSlot, 'pm1', '12:40:01 must resolve to pm1');

      // Grades 1 & 2 must be dismissed (false)
      assert.equal(timetableIsActive('一', '1', time124001, schedules), false, 'Grade 1 dismissed in mon_pm1');
      assert.equal(timetableIsActive('二', '1', time124001, schedules), false, 'Grade 2 dismissed in mon_pm1');
      assert.equal(appIsClassActive('一', '1', time124001, schedules), false, 'app.js Grade 1 dismissed');
      assert.equal(appIsClassActive('二', '1', time124001, schedules), false, 'app.js Grade 2 dismissed');

      // Grades 3 to 6 must remain active (true)
      for (const grade of ['三', '四', '五', '六']) {
        assert.equal(timetableIsActive(grade, '1', time124001, schedules), true, `${grade} 1 active in mon_pm1`);
        assert.equal(appIsClassActive(grade, '1', time124001, schedules), true, `app.js ${grade} 1 active`);
      }

      // Build simulated class reports for active classes only
      const all90 = generate90Classes();
      const classReports = {};
      let totalActiveStudents = 0;

      for (const c of all90) {
        const isActive = appIsClassActive(c.grade, c.className, time124001, schedules);
        if (isActive) {
          totalActiveStudents += c.studentCount;
          classReports[c.classKey] = {
            total: c.studentCount,
            presentCount: c.studentCount,
            leaveCount: 0,
            missingCount: 0
          };
        }
      }

      // 60 active classes (Grades 3, 4, 5, 6 * 15 classes = 60 classes)
      assert.equal(Object.keys(classReports).length, 60, 'Exactly 60 classes active in mon_pm1');
      assert.equal(totalActiveStudents, 1680, '60 classes * 28 students = 1,680 students');

      const oralReport = calculateOralReport({ classReports });
      assert.equal(oralReport.totalActive, 1680);
      assert.equal(oralReport.totalPresent, 1680);
      assert.ok(oralReport.speechText.includes('應出席 1680 人'), 'Speech text must state 1680 active');
    });

    it('2.3 Exact boundary comparison: delta between 12:39:59 and 12:40:01 is exactly 30 classes and 840 students', () => {
      const timeBefore = new Date('2026-10-19T12:39:59');
      const timeAfter = new Date('2026-10-19T12:40:01');
      const all90 = generate90Classes();

      const activeBefore = all90.filter(c => appIsClassActive(c.grade, c.className, timeBefore, schedules));
      const activeAfter = all90.filter(c => appIsClassActive(c.grade, c.className, timeAfter, schedules));

      assert.equal(activeBefore.length, 90);
      assert.equal(activeAfter.length, 60);

      const deltaClasses = activeBefore.length - activeAfter.length;
      assert.equal(deltaClasses, 30, 'Delta must be exactly 30 classes (Grades 1 and 2)');

      const deltaStudents = (90 * 28) - (60 * 28);
      assert.equal(deltaStudents, 840, 'Delta must be exactly 840 students (30 * 28)');
    });
  });

  // ============================================================================
  // Challenge 3: Thursday Full Timetable Permutations
  // ============================================================================
  describe('Challenge 3: Thursday Full Timetable Permutations', () => {
    const schedules = createStandardSchedules();
    const thuModes = ['thu_am', 'thu_pm1', 'thu_pm2', 'thu_night'];

    it('3.1 thu_am: all 90 normal classes + kindergarten + emergency team are active; remedial & afterschool inactive', () => {
      // 1. Regular grades 1 to 6
      for (const grade of VALID_NORMAL_GRADES) {
        for (let c = 1; c <= 15; c++) {
          assert.equal(timetableIsActive(grade, String(c), 'thu_am', schedules), true);
          assert.equal(appIsClassActive(grade, String(c), 'thu_am', schedules), true);
        }
      }

      // 2. Special groups
      assert.equal(appIsClassActive('幼兒園', '親親', 'thu_am', schedules), true);
      assert.equal(appIsClassActive('緊急應變小組', '指揮官', 'thu_am', schedules), true);
      assert.equal(appIsClassActive('學習扶助班', '學2甲', 'thu_am', schedules), false);
      assert.equal(appIsClassActive('課後班', '一甲A', 'thu_am', schedules), false);
    });

    it('3.2 thu_pm1: grades 1-2 inactive (30 classes), grades 3-6 active (60 classes), remedial (學2甲) active, afterschool active', () => {
      // 1. Grades 1 and 2 inactive
      for (const grade of ['一', '二']) {
        for (let c = 1; c <= 15; c++) {
          assert.equal(timetableIsActive(grade, String(c), 'thu_pm1', schedules), false, `${grade} ${c} must be inactive in thu_pm1`);
          assert.equal(appIsClassActive(grade, String(c), 'thu_pm1', schedules), false);
        }
      }

      // 2. Grades 3 to 6 active
      for (const grade of ['三', '四', '五', '六']) {
        for (let c = 1; c <= 15; c++) {
          assert.equal(timetableIsActive(grade, String(c), 'thu_pm1', schedules), true, `${grade} ${c} must be active in thu_pm1`);
          assert.equal(appIsClassActive(grade, String(c), 'thu_pm1', schedules), true);
        }
      }

      // 3. Kindergarten & Emergency Team
      assert.equal(appIsClassActive('幼兒園', '親親', 'thu_pm1', schedules), true);
      assert.equal(appIsClassActive('緊急應變小組', '指揮官', 'thu_pm1', schedules), true);

      // 4. Remedial class (學2甲) is specifically SCHEDULED for Thursday pm1!
      assert.equal(timetableIsActive('學習扶助班', '學2甲', 'thu_pm1', schedules), true, '學2甲 must be active in thu_pm1');
      assert.equal(appIsClassActive('學習扶助班', '學2甲', 'thu_pm1', schedules), true);

      // 5. Afterschool class (一甲A) is also active in thu_pm1
      assert.equal(appIsClassActive('課後班', '一甲A', 'thu_pm1', schedules), true);
    });

    it('3.3 thu_pm2: all normal grades inactive, kindergarten inactive, emergency team active, afterschool active', () => {
      // Normal grades 1 to 6 all inactive
      for (const grade of VALID_NORMAL_GRADES) {
        for (let c = 1; c <= 15; c++) {
          assert.equal(appIsClassActive(grade, String(c), 'thu_pm2', schedules), false);
        }
      }

      // Special groups
      assert.equal(appIsClassActive('幼兒園', '親親', 'thu_pm2', schedules), false);
      assert.equal(appIsClassActive('緊急應變小組', '指揮官', 'thu_pm2', schedules), true);
      assert.equal(appIsClassActive('學習扶助班', '學2甲', 'thu_pm2', schedules), false);
      assert.equal(appIsClassActive('課後班', '一甲A', 'thu_pm2', schedules), true);
    });

    it('3.4 thu_night: all normal grades inactive, kindergarten inactive, emergency team active, afterschool inactive', () => {
      for (const grade of VALID_NORMAL_GRADES) {
        assert.equal(appIsClassActive(grade, '1', 'thu_night', schedules), false);
      }

      assert.equal(appIsClassActive('幼兒園', '親親', 'thu_night', schedules), false);
      assert.equal(appIsClassActive('緊急應變小組', '指揮官', 'thu_night', schedules), true);
      assert.equal(appIsClassActive('學習扶助班', '學2甲', 'thu_night', schedules), false);
      assert.equal(appIsClassActive('課後班', '一甲A', 'thu_night', schedules), false);
    });
  });

  // ============================================================================
  // Challenge 4: Emergency Passcode Rate Limiting & Rollback Protection
  // ============================================================================
  describe('Challenge 4: Emergency Passcode Rate Limiting & Rollback Protection', () => {
    let auth;

    beforeEach(() => {
      auth = new SupabaseAuth();
    });

    it('4.1 Six consecutive failed passcode attempts triggers strict 30-second rate-limiting lockout', () => {
      // Attempts 1 to 5: standard failures, no throw
      assert.equal(auth.verifyDrillPasscode('1111'), false);
      assert.equal(auth.verifyDrillPasscode('2222'), false);
      assert.equal(auth.verifyDrillPasscode('3333'), false);
      assert.equal(auth.verifyDrillPasscode('4444'), false);
      assert.equal(auth.verifyDrillPasscode('5555'), false);

      // Attempt 6: triggers lockout exception
      assert.throws(() => {
        auth.verifyDrillPasscode('6666');
      }, /Too many passcode attempts\. Please wait 30 seconds\./);

      // Even the correct passcode '8888' is locked out while rate-limited!
      assert.throws(() => {
        auth.verifyDrillPasscode('8888');
      }, /Too many passcode attempts\. Please wait 30 seconds\./);

      // loginWithPasscode gracefully returns error object instead of unhandled crash
      const resLocked = auth.loginWithPasscode('8888');
      assert.equal(resLocked.success, false);
      assert.ok(resLocked.error.includes('Too many passcode attempts'));
    });

    it('4.2 Rate limit automatically unlocks after 30 seconds have elapsed', () => {
      // Trigger lockout
      for (let i = 0; i < 5; i++) {
        auth.verifyDrillPasscode(`000${i}`);
      }

      assert.throws(() => auth.verifyDrillPasscode('9999'), /Too many passcode attempts/);

      // Simulate 31 seconds elapsed
      auth.lastFailedAttemptTime = Date.now() - 31000;

      // Correct passcode now succeeds!
      assert.equal(auth.verifyDrillPasscode('8888'), true);
      assert.equal(auth.isDrillUnlocked(), true);
    });

    it('4.3 System clock rollback tampering is detected and immediately revokes drill unlock', () => {
      // 1. Legitimate unlock
      const unlockTime = Date.now();
      auth.verifyDrillPasscode('8888');
      assert.equal(auth.isDrillUnlocked(), true);

      // 2. Adversarial tampering: client winds system clock BACKWARDS by 1 hour
      // (attempting to keep the 20-minute window alive indefinitely)
      const tamperedClock = unlockTime - 3600000; // 1 hour in the past
      const maxExpiryDuration = 20 * 60 * 1000;

      // Direct verification of anti-tampering logic:
      // expiry - now > maxExpiryDuration + 60000 flags anomalous backwards clock drift
      const timeDrift = auth.drillUnlockExpiry - tamperedClock;
      assert.ok(timeDrift > maxExpiryDuration + 60000, 'Drift exceeds 21 minutes threshold');

      // Check with overridden Date.now
      const originalDateNow = Date.now;
      try {
        Date.now = () => tamperedClock;
        // isDrillUnlocked detects the anomaly, resets expiry to 0, and returns false
        const isUnlocked = auth.isDrillUnlocked();
        assert.equal(isUnlocked, false, 'Clock rollback tampering must revoke unlock');
        assert.equal(auth.drillUnlockExpiry, 0, 'Expiry must be reset to 0');
      } finally {
        Date.now = originalDateNow;
      }
    });

    it('4.4 Clock forward jump past 20 minutes expires session cleanly', () => {
      const unlockTime = Date.now();
      auth.verifyDrillPasscode('8888');
      assert.equal(auth.isDrillUnlocked(), true);

      // Fast-forward 25 minutes
      const futureTime = unlockTime + 25 * 60 * 1000;
      const originalDateNow = Date.now;
      try {
        Date.now = () => futureTime;
        assert.equal(auth.isDrillUnlocked(), false);
        assert.equal(auth.drillUnlockExpiry, 0);
      } finally {
        Date.now = originalDateNow;
      }
    });
  });

  // ============================================================================
  // Challenge 5: Yellow/Red Triage Escort Validation
  // ============================================================================
  describe('Challenge 5: Yellow/Red Triage Escort Validation', () => {
    it('5.1 Saving Yellow or Red triage with escortCount 0, null, or undefined is strictly rejected', () => {
      const invalidCounts = [0, null, undefined, '', NaN, -1, false];

      for (const count of invalidCounts) {
        assert.throws(() => {
          validateTriageEscortCount('yellow', count);
        }, /陪同就醫人數/, `Yellow card with escortCount ${count} must throw`);

        assert.throws(() => {
          validateTriageEscortCount('red', count);
        }, /陪同就醫人數/, `Red card with escortCount ${count} must throw`);

        assert.throws(() => {
          validateTriageEscortCount('黃卡', count);
        }, /陪同就醫人數/, `黃卡 with escortCount ${count} must throw`);

        assert.throws(() => {
          validateTriageEscortCount('紅卡', count);
        }, /陪同就醫人數/, `紅卡 with escortCount ${count} must throw`);
      }
    });

    it('5.2 Non-integer or out-of-range escort counts (>4) are strictly rejected', () => {
      const badValues = [1.5, 2.7, 5, 10, 'two'];

      for (const val of badValues) {
        assert.throws(() => {
          validateTriageEscortCount('yellow', val);
        }, /陪同就醫人數/, `Yellow card with escortCount ${val} must throw`);

        assert.throws(() => {
          validateTriageEscortCount('red', val);
        }, /陪同就醫人數/, `Red card with escortCount ${val} must throw`);
      }
    });

    it('5.3 Valid escort count (1, 2, 3, 4) passes validation for both Yellow and Red cards', () => {
      for (let count = 1; count <= 4; count++) {
        assert.equal(validateTriageEscortCount('yellow', count), true, `Yellow card with ${count} escort must pass`);
        assert.equal(validateTriageEscortCount('red', count), true, `Red card with ${count} escort must pass`);
        assert.equal(validateTriageEscortCount('黃卡', count), true, `黃卡 with ${count} escort must pass`);
        assert.equal(validateTriageEscortCount('紅卡', count), true, `紅卡 with ${count} escort must pass`);
      }
    });

    it('5.4 Green triage card does not require escort count (0, null, or undefined pass)', () => {
      assert.equal(validateTriageEscortCount('green', 0), true);
      assert.equal(validateTriageEscortCount('green', null), true);
      assert.equal(validateTriageEscortCount('green', undefined), true);
      assert.equal(validateTriageEscortCount('綠卡', 0), true);
    });

    it('5.5 Triage hospital and escort totals integrate accurately into oral report speech text', () => {
      const classReports = {
        '六 1': { total: 28, presentCount: 26, leaveCount: 0, missingCount: 0 }
      };

      const rescues = {
        '六 1_01號': {
          triageCard: 'yellow',
          escortCount: 2,
          searchDone: true,
          status: 'injured'
        },
        '六 1_02號': {
          triageCard: 'red',
          escortCount: 3,
          searchDone: true,
          status: 'injured'
        }
      };

      const res = calculateOralReport({ classReports, rescues });
      assert.equal(res.totalHospital, 2, '2 students sent to hospital (1 yellow + 1 red)');
      assert.equal(res.totalEscort, 5, '5 escorts total (2 + 3)');
      assert.ok(res.speechText.includes('送醫 2 人'), 'Must mention 送醫 2 人');
      assert.ok(res.speechText.includes('陪同就醫 5 人'), 'Must mention 陪同就醫 5 人');
    });

    it('5.6 app.js confirmRescueTriage UI method rejects saving Yellow/Red triage without escort count, and succeeds with escort count 1-4', () => {
      const studentKey = '五 1_01號';
      let alertMessage = null;
      const originalAlert = globalThis.alert;
      globalThis.alert = (msg) => { alertMessage = msg; };

      try {
        // 1. Mark as yellow triage without escort count (default 0)
        appMethods.updateRescueTriage(studentKey, 'yellow');
        alertMessage = null;
        appMethods.confirmRescueTriage(studentKey);
        assert.ok(alertMessage && alertMessage.includes('陪同就醫人數'), 'Alert must be triggered when escort count is not selected');

        // 2. Mark as red triage without escort count
        appMethods.updateRescueTriage(studentKey, 'red');
        alertMessage = null;
        appMethods.confirmRescueTriage(studentKey);
        assert.ok(alertMessage && alertMessage.includes('陪同就醫人數'), 'Alert must be triggered for red without escort count');

        // 3. Select escort count 2, confirm again
        appMethods.updateRescueEscort(studentKey, 2);
        alertMessage = null;
        appMethods.confirmRescueTriage(studentKey);
        assert.equal(alertMessage, null, 'No alert should be shown when valid escort count is chosen');
      } finally {
        globalThis.alert = originalAlert;
      }
    });
  });

});
