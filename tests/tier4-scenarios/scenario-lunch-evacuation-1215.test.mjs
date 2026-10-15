import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createStandardSchedules, generate90Classes } from '../helpers/test-dataset.mjs';
import { isClassActiveAtTime, resolveTimeSlot } from '../helpers/timetable-engine.mjs';
import { calculateOralReport } from '../helpers/oral-report-calculator.mjs';

describe('Tier 4: Scenario 5 - Weekday Lunch Evacuation at 12:15 PM', () => {
  const schedules = createStandardSchedules();

  it('Simulates Monday 12:15 lunch earthquake: verifies Grades 1 and 2 are active and included in roll call', () => {
    // 1. Earthquake strikes at 12:15 PM on Monday (October 19, 2026)
    const earthquakeTime = new Date('2026-10-19T12:15:00');
    const slot = resolveTimeSlot(earthquakeTime);

    // Assert that 12:15 (735 mins) falls in morning am slot (cutoff is 12:40 / 760 mins)
    assert.equal(slot.targetDay, 'mon');
    assert.equal(slot.targetSlot, 'am', '12:15 PM must resolve to am slot before 12:40 cutoff');

    // 2. Verify all Grade 1 and Grade 2 classes are evaluated as ACTIVE on campus
    for (let c = 1; c <= 15; c++) {
      assert.equal(
        isClassActiveAtTime('一', String(c), earthquakeTime, schedules),
        true,
        `Grade 1 Class ${c} must be active during 12:15 lunch`
      );
      assert.equal(
        isClassActiveAtTime('二', String(c), earthquakeTime, schedules),
        true,
        `Grade 2 Class ${c} must be active during 12:15 lunch`
      );
    }

    // 3. Contrast with flawed legacy boundary (< 720 / 12:00 PM)
    const legacySlotAt1215 = (currentMinutes) => {
      // Legacy code bug: if (currentMinutes < 720) return "am"; else return "pm1";
      return currentMinutes < 720 ? 'am' : 'pm1';
    };
    const minutes1215 = 12 * 60 + 15; // 735
    assert.equal(legacySlotAt1215(minutes1215), 'pm1');
    // Under legacy bug, pm1 is FALSE for Grade 1 & 2 on Monday, causing 840 students to be missed!
    const grade1Schedule = schedules.find(s => s.groupName === '一');
    assert.equal(grade1Schedule.mon_pm1, false, 'Grade 1 pm1 is false (dismissed)');

    // 4. In our fixed system, all 90 classes across Grades 1 to 6 are active
    const classes = generate90Classes();
    const activeClasses = classes.filter(c => isClassActiveAtTime(c.grade, c.className, earthquakeTime, schedules));
    assert.equal(activeClasses.length, 90, 'All 90 classes must be active during lunch evacuation');

    // 5. Simulate 12:15 lunch roll call:
    // Grade 1 Class 3 has 1 student who was trapped in bathroom during lunch
    const classReports = {};
    for (const c of activeClasses) {
      if (c.classKey === '一 3') {
        classReports[c.classKey] = { total: 28, presentCount: 27, leaveCount: 0, missingCount: 1 };
      } else {
        classReports[c.classKey] = { total: 28, presentCount: 28, leaveCount: 0, missingCount: 0 };
      }
    }

    const oralReport = calculateOralReport({ classReports });
    assert.equal(oralReport.totalActive, 2520, 'Total expected students must include all 2520 students');
    assert.equal(oralReport.totalRescuing, 1, 'Grade 1 Class 3 trapped student is correctly counted in rescue');
    assert.equal(oralReport.classStatusMap['一 3'], 'has-missing');
    assert.ok(oralReport.speechText.includes('全校教職員工及學生應出席 2520 人'));
    assert.ok(oralReport.speechText.includes('(搜救中 1 人)'));
  });
});
