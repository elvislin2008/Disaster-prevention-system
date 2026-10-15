import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MockFirestore } from '../helpers/mock-firestore.mjs';
import { generate90Classes } from '../helpers/test-dataset.mjs';
import { calculateOralReport } from '../helpers/oral-report-calculator.mjs';

describe('Tier 4: Scenario 1 - Full 90-Class Earthquake Evacuation Simulation', () => {
  it('Simulates concurrent roll call across all 90 classes with realistic disaster breakdown', async () => {
    const firestore = new MockFirestore();
    const classes = generate90Classes(); // 90 classes, 28 students each = 2520

    // Simulate evacuation roll call:
    // 85 classes all present (28)
    // 3 classes with 2 leaves each (26 present, 2 leave)
    // 2 classes with 1 missing each (27 present, 1 missing)
    const writePromises = classes.map((c, idx) => {
      let presentCount = 28;
      let leaveCount = 0;
      let missingCount = 0;

      if (idx >= 85 && idx < 88) {
        presentCount = 26;
        leaveCount = 2;
      } else if (idx >= 88) {
        presentCount = 27;
        missingCount = 1;
      }

      return firestore.setDoc(firestore.doc('class_reports', c.classKey), {
        total: 28,
        presentCount,
        leaveCount,
        missingCount,
        timestamp: Date.now()
      });
    });

    const results = await Promise.all(writePromises);
    assert.equal(results.length, 90);

    // Read full collection
    const snapshot = await firestore._getCollectionSnapshot('class_reports', false);
    assert.equal(snapshot.size, 90);

    const reports = {};
    for (const d of snapshot.docs) {
      reports[d.id] = d.data();
    }

    // Oral report calculation
    const oralReport = calculateOralReport({ classReports: reports });

    // Assertions
    assert.equal(oralReport.totalActive, 2520, 'Total campus active students must be 2520');
    assert.equal(oralReport.totalLeave, 6, 'Total leaves must be 6 (3 classes * 2)');
    assert.equal(oralReport.totalRescuing, 2, 'Total missing must be 2 (2 classes * 1)');
    assert.equal(oralReport.totalPresent, 2512, 'Total present must be 2512 (2520 - 6 - 2)');

    // Check class card color matrix
    let allPresentCount = 0;
    let hasLeaveCount = 0;
    let hasMissingCount = 0;

    for (const color of Object.values(oralReport.classStatusMap)) {
      if (color === 'all-present') allPresentCount++;
      if (color === 'has-leave') hasLeaveCount++;
      if (color === 'has-missing') hasMissingCount++;
    }

    assert.equal(allPresentCount, 85);
    assert.equal(hasLeaveCount, 3);
    assert.equal(hasMissingCount, 2);

    // Validate generated canonical speech text
    const expectedSpeech = '全校教職員工及學生應出席 2520 人，請假 6 人，送醫 0 人，陪同就醫 0 人，現場出席人數 2512 人，另有校外人士 0 名，報告完畢。(搜救中 2 人)';
    assert.equal(oralReport.speechText, expectedSpeech);
  });
});
