import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MockFirestore } from '../helpers/mock-firestore.mjs';
import { createGasAdapter } from '../helpers/mock-gas-adapter.mjs';
import { checkMissedCallsEscalation, validateTriageEscortCount } from '../helpers/contracts.mjs';
import { calculateOralReport } from '../helpers/oral-report-calculator.mjs';

describe('Tier 4: Scenario 3 - End-to-End Missing Student Workflow', () => {
  it('Simulates complete lifecycle: missing mark -> 5 missed calls -> yellow triage + 2 escorts -> OK resolution', async () => {
    const firestore = new MockFirestore();
    const google = createGasAdapter({ firestore });

    const studentKey = '五 3_08號';
    const classKey = '五 3';

    // Step 1: Teacher marks student missing with location notes
    await new Promise(resolve => {
      google.script.run
        .withSuccessHandler(resolve)
        .updateClassReportDelta(classKey, {
          total: 28,
          presentCount: 27,
          leaveCount: 0,
          missingCount: 1,
          missingStudents: [{
            studentKey,
            locationTag: '📌 走廊受困',
            locationNote: '三樓東側走廊防煙門附近'
          }]
        });
    });

    await new Promise(resolve => {
      google.script.run
        .withSuccessHandler(resolve)
        .updateRescueStatusDelta(studentKey, {
          studentKey,
          classKey,
          name: '王小明',
          locationTag: '📌 走廊受困',
          locationNote: '三樓東側走廊防煙門附近',
          status: 'missing'
        }, false);
    });

    // Step 2: Verify class card turns red and oral report reflects 1 missing
    const repSnap1 = await firestore.getDoc(firestore.doc('class_reports', classKey));
    let oralReport = calculateOralReport({ classReports: { [classKey]: repSnap1.data() } });
    assert.equal(oralReport.totalRescuing, 1);
    assert.equal(oralReport.classStatusMap[classKey], 'has-missing');
    assert.ok(oralReport.speechText.includes('(搜救中 1 人)'));

    // Step 3: Teacher attempts 5 calls to parent without answer -> Auto 5-missed-call escalation
    let missedCount = 0;
    for (let call = 1; call <= 5; call++) {
      missedCount++;
      const isEscalated = checkMissedCallsEscalation(missedCount);
      await new Promise(resolve => {
        google.script.run
          .withSuccessHandler(resolve)
          .updateContactStateDelta(studentKey, { count: missedCount }, isEscalated);
      });
    }

    const contactSnap = await firestore.getDoc(firestore.doc('contacts', studentKey));
    assert.equal(contactSnap.data().count, 5);
    assert.equal(contactSnap.data().isHelpReq, true, '5 missed calls must trigger help request to commander');

    // Step 4: Search & rescue team locates student injured -> assigns Yellow Triage Card
    // Guard verification: attempting to submit Yellow card with 0 escorts is BLOCKED
    assert.throws(() => validateTriageEscortCount('yellow', 0), /陪同就醫人數/);

    // Valid: 2 escorts selected
    assert.equal(validateTriageEscortCount('yellow', 2), true);

    // Step 5: Rescue officer completes search and clicks OK confirmation
    await new Promise(resolve => {
      google.script.run
        .withSuccessHandler(resolve)
        .updateRescueStatusDelta(studentKey, {
          triageCard: 'yellow',
          escortCount: 2,
          notes: '右腳踝扭傷，由 2 名學生陪同醫護組送醫'
        }, true); // searchDone = true
    });

    const rescueSnap = await firestore.getDoc(firestore.doc('rescues', studentKey));
    assert.equal(rescueSnap.data().searchDone, true);
    assert.equal(rescueSnap.data().triageCard, 'yellow');
    assert.equal(rescueSnap.data().escortCount, 2);

    // Step 6: Teacher updates class report (missing student is now resolved/hospitalized)
    await new Promise(resolve => {
      google.script.run
        .withSuccessHandler(resolve)
        .updateClassReportDelta(classKey, {
          total: 28,
          presentCount: 27,
          leaveCount: 0,
          missingCount: 0 // missing resolved
        });
    });

    // Step 7: Final oral report verification
    const repSnap2 = await firestore.getDoc(firestore.doc('class_reports', classKey));
    oralReport = calculateOralReport({
      classReports: { [classKey]: repSnap2.data() },
      rescues: { [studentKey]: rescueSnap.data() }
    });

    assert.equal(oralReport.totalRescuing, 0, 'Rescuing count must be 0 after search done');
    assert.equal(oralReport.totalHospital, 1, 'Hospital count must be 1');
    assert.equal(oralReport.totalEscort, 2, 'Escort count must be 2');
    assert.notEqual(oralReport.classStatusMap[classKey], 'has-missing', 'Class card must NOT be red after search resolved');
    assert.ok(oralReport.speechText.includes('送醫 1 人'));
    assert.ok(oralReport.speechText.includes('陪同就醫 2 人'));
    assert.ok(oralReport.speechText.includes('(搜救中 0 人)'));
  });
});
