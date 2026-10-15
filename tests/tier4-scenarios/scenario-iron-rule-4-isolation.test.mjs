import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { calculateOralReport } from '../helpers/oral-report-calculator.mjs';

describe('Tier 4: Scenario 4 - Iron Rule 4 Isolation Drill', () => {
  it('Verifies pending pullout status is strictly isolated: missing count is 0, class card never turns red', () => {
    // 1. Initial State: Grade 1 Class 1 has 28 students
    const classReports = {
      '一 1': { total: 28, presentCount: 27, leaveCount: 0, missingCount: 0 },
      '二 3': { total: 28, presentCount: 27, leaveCount: 0, missingCount: 0 },
      '四 5': { total: 28, presentCount: 27, leaveCount: 0, missingCount: 0 }
    };

    // 2. Teachers mark 3 students for pullout:
    // - 一 1_05號 in 🟣 學習中心
    // - 二 3_12號 in 🟠 本土語
    // - 四 5_02號 in 🔵 團隊活動
    const pullouts = {
      '一 1_05號': 'pending',
      '二 3_12號': 'pending',
      '四 5_02號': 'pending'
    };

    // 3. Commander inspects dashboard
    let oralReport = calculateOralReport({ classReports, pullouts });

    // IRON RULE 4 VERIFICATION:
    // Missing count MUST BE 0!
    assert.equal(oralReport.totalRescuing, 0, 'Iron Rule 4: grandRescuing must be 0 for pending pullouts');

    // Cards MUST NOT be red (.has-missing)
    assert.notEqual(oralReport.classStatusMap['一 1'], 'has-missing', '一 1 card must NOT turn red');
    assert.notEqual(oralReport.classStatusMap['二 3'], 'has-missing', '二 3 card must NOT turn red');
    assert.notEqual(oralReport.classStatusMap['四 5'], 'has-missing', '四 5 card must NOT turn red');

    assert.ok(oralReport.speechText.includes('(搜救中 0 人)'), 'Speech text must report 0 rescuing');

    // 4. Learning center teacher confirms 一 1_05號 is SAFE
    pullouts['一 1_05號'] = 'safe';
    oralReport = calculateOralReport({ classReports, pullouts });
    assert.equal(oralReport.totalRescuing, 0);
    assert.notEqual(oralReport.classStatusMap['一 1'], 'has-missing');

    // 5. Native language teacher discovers 二 3_12號 is MISSING (did not show up to classroom)
    // Teacher clicks 🚨 失蹤
    pullouts['二 3_12號'] = 'missing';
    oralReport = calculateOralReport({ classReports, pullouts });

    // ONLY NOW does rescue count increase to 1, and ONLY 二 3 turns red!
    assert.equal(oralReport.totalRescuing, 1, 'Only explicitly marked missing pullout counts towards rescue');
    assert.equal(oralReport.classStatusMap['二 3'], 'has-missing', '二 3 card must now turn red');
    assert.notEqual(oralReport.classStatusMap['一 1'], 'has-missing', '一 1 card must still NOT be red');
    assert.notEqual(oralReport.classStatusMap['四 5'], 'has-missing', '四 5 card must still NOT be red');

    assert.ok(oralReport.speechText.includes('(搜救中 1 人)'));
  });
});
