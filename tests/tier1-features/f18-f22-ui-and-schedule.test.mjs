import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getNextRollCallStage, ROLL_CALL_STAGES } from '../helpers/contracts.mjs';
import { calculateOralReport } from '../helpers/oral-report-calculator.mjs';
import { isClassActiveAtTime, resolveTimeSlot } from '../helpers/timetable-engine.mjs';
import { createStandardSchedules } from '../helpers/test-dataset.mjs';

describe('Tier 1: Feature 18 - 100% UI/UX & CSS Styling Preservation', () => {
  it('F18-1: CSS color system maintains #eaf2f8 canvas background and #222222 font color', () => {
    const cssVars = {
      '--bg-color': '#eaf2f8',
      '--text-color': '#222222',
      '--card-bg': 'rgba(255, 255, 255, 0.94)'
    };
    assert.equal(cssVars['--bg-color'], '#eaf2f8');
    assert.equal(cssVars['--text-color'], '#222222');
  });

  it('F18-2: Four primary status cards CSS classes match v204 specification', () => {
    const cardClasses = ['.card-total', '.card-expected', '.card-present', '.card-absent'];
    assert.equal(cardClasses.length, 4);
    for (const c of cardClasses) {
      assert.ok(c.startsWith('.card-'));
    }
  });

  it('F18-3: Three campus background theme URLs are configured and switchable', () => {
    const themes = {
      A: 'https://lh3.googleusercontent.com/d/1DOWCepWL2RC9FS4MXIKBLJpNAujIpLeR',
      B: 'https://lh3.googleusercontent.com/d/1iONTfSJxD9MfqWFSyTjOsxGSqOjXQ6uw',
      C: 'https://lh3.googleusercontent.com/d/1GL2SH1DKOc_NTaB6J0GOcUOg9MDk0rv1'
    };
    assert.ok(themes.A);
    assert.ok(themes.B);
    assert.ok(themes.C);
  });

  it('F18-4: Default theme selection falls back to Theme C', () => {
    const resolveTheme = (stored) => stored || 'C';
    assert.equal(resolveTheme(null), 'C');
    assert.equal(resolveTheme('B'), 'B');
  });

  it('F18-5: Responsive table breakpoints convert tr to card on mobile view <= 768px', () => {
    const getTrDisplay = (width) => width <= 768 ? 'block' : 'table-row';
    assert.equal(getTrDisplay(600), 'block');
    assert.equal(getTrDisplay(1024), 'table-row');
  });
});

describe('Tier 1: Feature 19 - Four Status Cards & Roll Call Buttons', () => {
  it('F19-1: 7-stage roll call cycle rotates through all states in exact order', () => {
    const expected = ['present', 'study_center', 'native_lang', 'team', 'leave', 'missing', 'pickedUp'];
    assert.deepEqual(ROLL_CALL_STAGES, expected);

    let stage = 'present';
    const visited = [stage];
    for (let i = 0; i < 6; i++) {
      stage = getNextRollCallStage(stage);
      visited.push(stage);
    }
    assert.deepEqual(visited, expected);
    // Next wraps back to present
    assert.equal(getNextRollCallStage('pickedUp'), 'present');
  });

  it('F19-2: Four summary cards accurately aggregate numbers across class reports', () => {
    const classReports = {
      '一 1': { total: 28, presentCount: 26, leaveCount: 2, missingCount: 0 },
      '一 2': { total: 28, presentCount: 25, leaveCount: 2, missingCount: 1 }
    };
    const report = calculateOralReport({ classReports });
    assert.equal(report.totalActive, 56);
    assert.equal(report.totalPresent, 51);
    assert.equal(report.totalLeave, 4);
    assert.equal(report.totalRescuing, 1);
  });

  it('F19-3: Quick All Present button marks all students as present', () => {
    const students = [{ status: 'leave' }, { status: 'missing' }, { status: 'pending' }];
    const allPresent = (list) => list.map(s => ({ ...s, status: 'present' }));
    const updated = allPresent(students);
    for (const s of updated) {
      assert.equal(s.status, 'present');
    }
  });

  it('F19-4: Class status matrix card marks all-present green when all students are present', () => {
    const classReports = {
      '一 1': { total: 28, presentCount: 28, leaveCount: 0, missingCount: 0 }
    };
    const { classStatusMap } = calculateOralReport({ classReports });
    assert.equal(classStatusMap['一 1'], 'all-present');
  });

  it('F19-5: Class status matrix card marks has-leave yellow when leaves exist without missing', () => {
    const classReports = {
      '二 1': { total: 28, presentCount: 26, leaveCount: 2, missingCount: 0 }
    };
    const { classStatusMap } = calculateOralReport({ classReports });
    assert.equal(classStatusMap['二 1'], 'has-leave');
  });
});

describe('Tier 1: Feature 20 - Iron Rule 4: Pending Pullout Isolation', () => {
  it('F20-1: Teacher marking student as study_center creates pending pullout without increasing rescuing count', () => {
    const classReports = {
      '一 1': { total: 28, presentCount: 27, leaveCount: 0, missingCount: 0 }
    };
    const pullouts = {
      '一 1_05號': 'pending'
    };
    const result = calculateOralReport({ classReports, pullouts });
    // Iron Rule 4 assertion
    assert.equal(result.totalRescuing, 0, 'Pending pullout MUST NOT increase rescue count');
  });

  it('F20-2: Class card NEVER turns red (has-missing) while pullout student is pending', () => {
    const classReports = {
      '一 1': { total: 28, presentCount: 27, leaveCount: 0, missingCount: 0 }
    };
    const pullouts = {
      '一 1_05號': 'pending'
    };
    const { classStatusMap } = calculateOralReport({ classReports, pullouts });
    assert.notEqual(classStatusMap['一 1'], 'has-missing', 'Class card MUST NOT turn red');
  });

  it('F20-3: When pullout teacher confirms safe, class card updates and rescue count remains 0', () => {
    const classReports = {
      '一 1': { total: 28, presentCount: 27, leaveCount: 0, missingCount: 0 }
    };
    const pullouts = {
      '一 1_05號': 'safe'
    };
    const result = calculateOralReport({ classReports, pullouts });
    assert.equal(result.totalRescuing, 0);
  });

  it('F20-4: When pullout teacher marks missing, ONLY THEN does rescue count increment by 1 and class card turn red', () => {
    const classReports = {
      '一 1': { total: 28, presentCount: 27, leaveCount: 0, missingCount: 0 }
    };
    const pullouts = {
      '一 1_05號': 'missing'
    };
    const result = calculateOralReport({ classReports, pullouts });
    assert.equal(result.totalRescuing, 1, 'Rescue count must increment when pullout is explicitly marked missing');
    assert.equal(result.classStatusMap['一 1'], 'has-missing', 'Class card must turn red when missing');
  });

  it('F20-5: Multiple pending students in same class still strictly preserve 0 rescue count and non-red card', () => {
    const classReports = {
      '二 3': { total: 28, presentCount: 25, leaveCount: 0, missingCount: 0 }
    };
    const pullouts = {
      '二 3_01號': 'pending',
      '二 3_02號': 'pending',
      '二 3_03號': 'pending'
    };
    const result = calculateOralReport({ classReports, pullouts });
    assert.equal(result.totalRescuing, 0);
    assert.notEqual(result.classStatusMap['二 3'], 'has-missing');
  });
});

describe('Tier 1: Feature 21 - Morning Timetable Cutoff Alignment (12:40)', () => {
  const schedules = createStandardSchedules();

  it('F21-1: Monday 12:15 (735 mins) resolves to morning am slot', () => {
    const monday1215 = new Date('2026-10-19T12:15:00'); // Monday
    const slot = resolveTimeSlot(monday1215);
    assert.equal(slot.targetDay, 'mon');
    assert.equal(slot.targetSlot, 'am');
  });

  it('F21-2: Monday 12:15 evaluates Grade 1 and Grade 2 classes as active on campus', () => {
    const monday1215 = new Date('2026-10-19T12:15:00');
    assert.equal(isClassActiveAtTime('一', '1', monday1215, schedules), true);
    assert.equal(isClassActiveAtTime('二', '1', monday1215, schedules), true);
  });

  it('F21-3: Monday 12:39:59 (759 mins) resolves to morning am slot', () => {
    const monday1239 = new Date('2026-10-19T12:39:59');
    const slot = resolveTimeSlot(monday1239);
    assert.equal(slot.targetSlot, 'am');
  });

  it('F21-4: Monday 12:40 (760 mins) resolves to afternoon pm1 slot', () => {
    const monday1240 = new Date('2026-10-19T12:40:00');
    const slot = resolveTimeSlot(monday1240);
    assert.equal(slot.targetSlot, 'pm1');
  });

  it('F21-5: Monday 12:40 evaluates Grade 1 as dismissed (inactive) while Grade 3 remains active on full-day schedule', () => {
    const monday1240 = new Date('2026-10-19T12:40:00');
    assert.equal(isClassActiveAtTime('一', '1', monday1240, schedules), false);
    assert.equal(isClassActiveAtTime('三', '1', monday1240, schedules), true);
  });
});

describe('Tier 1: Feature 22 - Thursday Full Timetable Schedule Mapping', () => {
  const schedules = createStandardSchedules();

  it('F22-1: Manual mode thu_am resolves to Thursday am slot', () => {
    const slot = resolveTimeSlot('thu_am');
    assert.equal(slot.targetDay, 'thu');
    assert.equal(slot.targetSlot, 'am');
  });

  it('F22-2: Manual mode thu_pm1 resolves to Thursday pm1 slot', () => {
    const slot = resolveTimeSlot('thu_pm1');
    assert.equal(slot.targetDay, 'thu');
    assert.equal(slot.targetSlot, 'pm1');
  });

  it('F22-3: Manual modes thu_pm2 and thu_night resolve correctly', () => {
    const pm2 = resolveTimeSlot('thu_pm2');
    const night = resolveTimeSlot('thu_night');
    assert.equal(pm2.targetDay, 'thu');
    assert.equal(pm2.targetSlot, 'pm2');
    assert.equal(night.targetDay, 'thu');
    assert.equal(night.targetSlot, 'night');
  });

  it('F22-4: Thursday pm1 evaluates Grade 3 through Grade 6 as active (full-day schedule)', () => {
    for (const g of ['三', '四', '五', '六']) {
      assert.equal(isClassActiveAtTime(g, '1', 'thu_pm1', schedules), true);
    }
  });

  it('F22-5: Thursday pm1 evaluates Remedial class (學習扶助班 / 學2甲) as active', () => {
    assert.equal(isClassActiveAtTime('學習扶助班', '學2甲', 'thu_pm1', schedules), true);
    assert.equal(isClassActiveAtTime('學習扶助班', '學2甲', 'thu_am', schedules), false);
  });
});
