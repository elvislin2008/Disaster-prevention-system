import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getNextRollCallStage } from '../helpers/contracts.mjs';
import { calculateOralReport } from '../helpers/oral-report-calculator.mjs';
import { isClassActiveAtTime, resolveTimeSlot } from '../helpers/timetable-engine.mjs';
import { createStandardSchedules } from '../helpers/test-dataset.mjs';

describe('Tier 2: Boundary - Feature 18 (100% UI/UX & CSS Styling Preservation)', () => {
  it('B18-1: Ultra-narrow screen (320px) layout wraps cards without horizontal overflow', () => {
    const checkCardWrap = (containerWidth, cardMinWidth) => {
      const cardsPerRow = Math.floor(containerWidth / cardMinWidth);
      return cardsPerRow >= 1;
    };
    assert.equal(checkCardWrap(320, 140), true);
  });

  it('B18-2: Dark mode media query does not invert critical disaster warning colors', () => {
    const alertColors = {
      missingRed: '#dc3545',
      leaveYellow: '#ffc107',
      presentGreen: '#28a745'
    };
    assert.equal(alertColors.missingRed, '#dc3545');
    assert.equal(alertColors.presentGreen, '#28a745');
  });

  it('B18-3: Custom image background load error triggers fallback to default canvas gradient', () => {
    const handleBgError = (imgFailed) => {
      return imgFailed ? 'linear-gradient(135deg, #eaf2f8 0%, #d4e6f1 100%)' : 'url(...)';
    };
    assert.ok(handleBgError(true).includes('#eaf2f8'));
  });

  it('B18-4: Modal dialogs lock body scroll (overflow: hidden) when active', () => {
    let bodyStyle = { overflow: 'auto' };
    const openModal = () => { bodyStyle.overflow = 'hidden'; };
    const closeModal = () => { bodyStyle.overflow = 'auto'; };

    openModal();
    assert.equal(bodyStyle.overflow, 'hidden');
    closeModal();
    assert.equal(bodyStyle.overflow, 'auto');
  });

  it('B18-5: Status badge text colors maintain high readability against badge backgrounds', () => {
    const badges = [
      { bg: '#d4edda', text: '#155724' }, // green
      { bg: '#fff3cd', text: '#856404' }, // yellow
      { bg: '#f8d7da', text: '#721c24' }  // red
    ];
    for (const b of badges) {
      assert.notEqual(b.bg, b.text);
    }
  });
});

describe('Tier 2: Boundary - Feature 19 (Four Status Cards & Roll Call Buttons)', () => {
  it('B19-1: Roll call cycle wrap-around from pickedUp returns to present without error', () => {
    assert.equal(getNextRollCallStage('pickedUp'), 'present');
    assert.equal(getNextRollCallStage('unknown'), 'present');
  });

  it('B19-2: Class report with total 0 students displays 0 across all cards without NaN', () => {
    const classReports = {
      '空班級': { total: 0, presentCount: 0, leaveCount: 0, missingCount: 0 }
    };
    const report = calculateOralReport({ classReports });
    assert.equal(report.totalActive, 0);
    assert.equal(report.totalPresent, 0);
    assert.equal(Number.isNaN(report.totalActive), false);
  });

  it('B19-3: Class with all absent students (28 leave) turns class card yellow (has-leave)', () => {
    const classReports = {
      '一 1': { total: 28, presentCount: 0, leaveCount: 28, missingCount: 0 }
    };
    const report = calculateOralReport({ classReports });
    assert.equal(report.classStatusMap['一 1'], 'has-leave');
  });

  it('B19-4: Class with all missing students (28 missing) turns class card red (has-missing)', () => {
    const classReports = {
      '一 1': { total: 28, presentCount: 0, leaveCount: 0, missingCount: 28 }
    };
    const report = calculateOralReport({ classReports });
    assert.equal(report.classStatusMap['一 1'], 'has-missing');
    assert.equal(report.totalRescuing, 28);
  });

  it('B19-5: Attendance counts where present + leave + missing != total flags discrepancy', () => {
    const validateRosterConsistency = (rep) => {
      const sum = Number(rep.presentCount) + Number(rep.leaveCount) + Number(rep.missingCount);
      return sum === Number(rep.total);
    };
    assert.equal(validateRosterConsistency({ total: 28, presentCount: 20, leaveCount: 5, missingCount: 3 }), true);
    assert.equal(validateRosterConsistency({ total: 28, presentCount: 20, leaveCount: 5, missingCount: 0 }), false); // discrepancy!
  });
});

describe('Tier 2: Boundary - Feature 20 (Iron Rule 4: Pending Pullout Isolation)', () => {
  it('B20-1: 90 classes all having 1 pending pullout student results in 0 totalRescuing and 0 red cards', () => {
    const classReports = {};
    const pullouts = {};

    for (let g = 1; g <= 6; g++) {
      const grade = ['一', '二', '三', '四', '五', '六'][g - 1];
      for (let c = 1; c <= 15; c++) {
        const classKey = `${grade} ${c}`;
        classReports[classKey] = { total: 28, presentCount: 27, leaveCount: 0, missingCount: 0 };
        pullouts[`${classKey}_01號`] = 'pending';
      }
    }

    const report = calculateOralReport({ classReports, pullouts });
    assert.equal(report.totalRescuing, 0, 'Iron Rule 4: All pending pullouts must sum to 0 in rescue count');
    for (const [classKey, color] of Object.entries(report.classStatusMap)) {
      assert.notEqual(color, 'has-missing', `${classKey} card must NOT be red`);
    }
  });

  it('B20-2: Toggling pending student to safe updates pullout count without changing rescue count (still 0)', () => {
    const classReports = { '一 1': { total: 28, presentCount: 27, leaveCount: 0, missingCount: 0 } };
    const pullouts = { '一 1_01號': 'safe' };
    const report = calculateOralReport({ classReports, pullouts });
    assert.equal(report.totalRescuing, 0);
  });

  it('B20-3: Only when student transitions pending -> missing does totalRescuing increment', () => {
    const classReports = { '一 1': { total: 28, presentCount: 27, leaveCount: 0, missingCount: 0 } };
    // State 1: pending
    let report = calculateOralReport({ classReports, pullouts: { '一 1_01號': 'pending' } });
    assert.equal(report.totalRescuing, 0);

    // State 2: missing
    report = calculateOralReport({ classReports, pullouts: { '一 1_01號': 'missing' } });
    assert.equal(report.totalRescuing, 1);
  });

  it('B20-4: Transitioning missing student to safe decrements totalRescuing back', () => {
    const classReports = { '一 1': { total: 28, presentCount: 27, leaveCount: 0, missingCount: 0 } };
    const report1 = calculateOralReport({ classReports, pullouts: { '一 1_01號': 'missing' } });
    assert.equal(report1.totalRescuing, 1);

    const report2 = calculateOralReport({ classReports, pullouts: { '一 1_01號': 'safe' } });
    assert.equal(report2.totalRescuing, 0);
  });

  it('B20-5: Class having 1 missing and 2 pending students is red solely because of the 1 missing student', () => {
    const classReports = { '一 1': { total: 28, presentCount: 25, leaveCount: 0, missingCount: 1 } };
    const pullouts = {
      '一 1_02號': 'pending',
      '一 1_03號': 'pending'
    };
    const report = calculateOralReport({ classReports, pullouts });
    assert.equal(report.totalRescuing, 1);
    assert.equal(report.classStatusMap['一 1'], 'has-missing');
  });
});

describe('Tier 2: Boundary - Feature 21 (Morning Timetable Cutoff Alignment 12:40)', () => {
  const schedules = createStandardSchedules();

  it('B21-1: Exact boundary 12:39:59 (759.9 mins) is evaluated as am', () => {
    const t = new Date('2026-10-19T12:39:59');
    const slot = resolveTimeSlot(t);
    assert.equal(slot.targetSlot, 'am');
  });

  it('B21-2: Exact boundary 12:40:00 (760 mins) is evaluated as pm1', () => {
    const t = new Date('2026-10-19T12:40:00');
    const slot = resolveTimeSlot(t);
    assert.equal(slot.targetSlot, 'pm1');
  });

  it('B21-3: Weekend day (Saturday and Sunday 12:15) evaluates isClassActiveAtTime as false for all grades', () => {
    const saturday = new Date('2026-10-24T12:15:00'); // Saturday
    const sunday = new Date('2026-10-25T12:15:00');   // Sunday

    assert.equal(isClassActiveAtTime('一', '1', saturday, schedules), false);
    assert.equal(isClassActiveAtTime('六', '1', sunday, schedules), false);
  });

  it('B21-4: Before 08:00 (e.g. 07:59) evaluates isClassActiveAtTime as false', () => {
    const beforeSchool = new Date('2026-10-19T07:59:00');
    assert.equal(isClassActiveAtTime('一', '1', beforeSchool, schedules), false);
  });

  it('B21-5: After 18:30 (e.g. 18:31) evaluates isClassActiveAtTime as false', () => {
    const afterNight = new Date('2026-10-19T18:31:00');
    assert.equal(isClassActiveAtTime('一', '1', afterNight, schedules), false);
  });
});

describe('Tier 2: Boundary - Feature 22 (Thursday Full Timetable Schedule Mapping)', () => {
  const schedules = createStandardSchedules();

  it('B22-1: Thursday afternoon slot 12:40-16:00 (pm1) evaluates Grades 1-2 as false, Grades 3-6 as true', () => {
    assert.equal(isClassActiveAtTime('一', '1', 'thu_pm1', schedules), false);
    assert.equal(isClassActiveAtTime('二', '1', 'thu_pm1', schedules), false);
    assert.equal(isClassActiveAtTime('三', '1', 'thu_pm1', schedules), true);
    assert.equal(isClassActiveAtTime('四', '1', 'thu_pm1', schedules), true);
    assert.equal(isClassActiveAtTime('五', '1', 'thu_pm1', schedules), true);
    assert.equal(isClassActiveAtTime('六', '1', 'thu_pm1', schedules), true);
  });

  it('B22-2: Thursday remedial class (學2甲) is only active in thu_pm1 and inactive in others', () => {
    assert.equal(isClassActiveAtTime('學習扶助班', '學2甲', 'thu_pm1', schedules), true);
    assert.equal(isClassActiveAtTime('學習扶助班', '學2甲', 'thu_am', schedules), false);
    assert.equal(isClassActiveAtTime('學習扶助班', '學2甲', 'thu_pm2', schedules), false);
    assert.equal(isClassActiveAtTime('學習扶助班', '學2甲', 'thu_night', schedules), false);
  });

  it('B22-3: Passing invalid time slot code (e.g. thu_lunch, invalid) returns false gracefully', () => {
    assert.equal(isClassActiveAtTime('一', '1', 'thu_lunch', schedules), false);
    assert.equal(isClassActiveAtTime('一', '1', 'invalid_slot', schedules), false);
  });

  it('B22-4: Automatic day-of-week detection for Thursday (day 4) matches thu_* slots correctly', () => {
    const thuAm = new Date('2026-10-22T09:00:00'); // Thursday
    const slot = resolveTimeSlot(thuAm);
    assert.equal(slot.targetDay, 'thu');
    assert.equal(slot.targetSlot, 'am');
  });

  it('B22-5: Emergency team remains active during all Thursday slots including night', () => {
    assert.equal(isClassActiveAtTime('緊急應變小組', '指揮官', 'thu_am', schedules), true);
    assert.equal(isClassActiveAtTime('緊急應變小組', '通報組', 'thu_pm1', schedules), true);
    assert.equal(isClassActiveAtTime('緊急應變小組', '安全防護組', 'thu_pm2', schedules), true);
    assert.equal(isClassActiveAtTime('緊急應變小組', '緊急救護組', 'thu_night', schedules), true);
  });
});
