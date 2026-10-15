import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { calculateOralReport } from '../helpers/oral-report-calculator.mjs';
import { validateTriageEscortCount } from '../helpers/contracts.mjs';

describe('Tier 3: Pairwise - Pullout Safe vs Missing Interaction Across Four Dashboards', () => {
  it('T3-6: Teacher marks student study_center -> pullout pending -> class card non-red, rescue count 0', () => {
    const classReports = {
      '一 1': { total: 28, presentCount: 27, leaveCount: 0, missingCount: 0 }
    };
    const pullouts = {
      '一 1_05號': 'pending'
    };
    const report = calculateOralReport({ classReports, pullouts });
    assert.equal(report.totalRescuing, 0);
    assert.notEqual(report.classStatusMap['一 1'], 'has-missing');
  });

  it('T3-7: Pullout teacher marks safe -> class card remains non-red, rescue count remains 0', () => {
    const classReports = {
      '一 1': { total: 28, presentCount: 27, leaveCount: 0, missingCount: 0 }
    };
    const pullouts = {
      '一 1_05號': 'safe'
    };
    const report = calculateOralReport({ classReports, pullouts });
    assert.equal(report.totalRescuing, 0);
    assert.notEqual(report.classStatusMap['一 1'], 'has-missing');
  });

  it('T3-8: Pullout teacher marks missing -> rescue triage receives student -> commander oral report rescue count +1 and class card turns red', () => {
    const classReports = {
      '一 1': { total: 28, presentCount: 27, leaveCount: 0, missingCount: 0 }
    };
    const pullouts = {
      '一 1_05號': 'missing'
    };
    const report = calculateOralReport({ classReports, pullouts });
    assert.equal(report.totalRescuing, 1);
    assert.equal(report.classStatusMap['一 1'], 'has-missing');
    assert.ok(report.speechText.includes('(搜救中 1 人)'));
  });

  it('T3-9: Rescue officer assesses missing student -> yellow card + 2 escorts -> marks search done -> hospital +1, escort +2, rescue 0', () => {
    const classReports = {
      '一 1': { total: 28, presentCount: 27, leaveCount: 0, missingCount: 0 }
    };
    const pullouts = {
      '一 1_05號': 'safe' // becomes safe upon searchDone
    };
    const rescues = {
      '一 1_05號': {
        triageCard: 'yellow',
        escortCount: 2,
        searchDone: true,
        status: 'found_injured'
      }
    };

    assert.equal(validateTriageEscortCount('yellow', 2), true);
    const report = calculateOralReport({ classReports, pullouts, rescues });

    assert.equal(report.totalHospital, 1);
    assert.equal(report.totalEscort, 2);
    assert.equal(report.totalRescuing, 0);
    assert.ok(report.speechText.includes('送醫 1 人'));
    assert.ok(report.speechText.includes('陪同就醫 2 人'));
    assert.ok(report.speechText.includes('(搜救中 0 人)'));
  });

  it('T3-10: Multiple pullouts across 3 categories (SC, NL, TM) resolve independently without cross-leak', () => {
    const classReports = {
      '二 1': { total: 28, presentCount: 25, leaveCount: 0, missingCount: 0 }
    };
    const pullouts = {
      '二 1_01號': 'safe',    // SC
      '二 1_02號': 'pending', // NL (Iron Rule 4)
      '二 1_03號': 'missing'  // TM
    };
    const report = calculateOralReport({ classReports, pullouts });
    // Only 03号 is missing!
    assert.equal(report.totalRescuing, 1);
    assert.equal(report.classStatusMap['二 1'], 'has-missing');
  });
});
