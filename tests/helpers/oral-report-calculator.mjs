/**
 * Oral Report & Status Evaluator adhering to Iron Rule 4.
 */

export function calculateOralReport({
  classReports = {},
  pullouts = {}, // studentKey -> 'pending' | 'safe' | 'missing'
  rescues = {},  // targetKey -> { triageCard, escortCount, searchDone, status }
  visitors = [], // list of visitors
  customTotal = null
}) {
  let totalActive = 0;
  let totalPresent = 0;
  let totalLeave = 0;
  let totalRescuing = 0;
  let totalHospital = 0;
  let totalEscort = 0;
  let totalVisitors = visitors.length;

  const classStatusMap = {};

  // 1. Process Class Reports
  for (const [classKey, rep] of Object.entries(classReports)) {
    const total = Number(rep.total || 0);
    const present = Number(rep.presentCount || 0);
    const leave = Number(rep.leaveCount || 0);
    const missing = Number(rep.missingCount || 0);

    totalActive += total;
    totalPresent += present;
    totalLeave += leave;
    totalRescuing += missing;

    let cardColor = 'pending'; // 待填報
    if (total > 0 && present === total) {
      cardColor = 'all-present'; // 全到 綠底
    } else if (missing > 0) {
      cardColor = 'has-missing'; // 有失蹤 紅底
    } else if (leave > 0) {
      cardColor = 'has-leave';   // 有請假 黃底
    } else if (total > 0) {
      cardColor = 'partial-present';
    }
    classStatusMap[classKey] = cardColor;
  }

  // 2. Process Pullouts (CRITICAL: Iron Rule 4)
  // 'pending' state is strictly ISOLATED. Never increment totalRescuing!
  // Only 'missing' state is added to rescue.
  for (const [sKey, status] of Object.entries(pullouts)) {
    const classKey = sKey.split('_')[0];
    if (status === 'missing') {
      // Pullout explicitly marked missing by pullout teacher
      // Check if not already counted in rescues
      if (!rescues[sKey]) {
        totalRescuing += 1;
      }
      if (classStatusMap[classKey] && classStatusMap[classKey] !== 'has-missing') {
        classStatusMap[classKey] = 'has-missing';
      }
    } else if (status === 'pending') {
      // Iron Rule 4: DO NOTHING!
      // Must NOT add to totalRescuing.
      // Must NOT turn classStatusMap to 'has-missing'.
    }
  }

  // 3. Process Rescues & Triage
  for (const [key, rescue] of Object.entries(rescues)) {
    const isDone = Boolean(rescue.searchDone);
    const card = (rescue.triageCard || '').toLowerCase();
    const escort = Number(rescue.escortCount || 0);

    if (!isDone && rescue.status === 'missing') {
      // Already counted if from class report, otherwise check
    }

    if (card === 'yellow' || card === 'red' || card === '黃卡' || card === '紅卡') {
      totalHospital += 1;
      totalEscort += escort;
    }
  }

  // 4. Visitors marked missing
  for (const vis of visitors) {
    if (vis.status === 'missing' || vis.isMissing) {
      totalRescuing += 1;
    }
  }

  const effectiveTotal = (customTotal !== null && customTotal !== undefined) ? Number(customTotal) : totalActive;

  const speechText = `全校教職員工及學生應出席 ${effectiveTotal} 人，請假 ${totalLeave} 人，送醫 ${totalHospital} 人，陪同就醫 ${totalEscort} 人，現場出席人數 ${totalPresent} 人，另有校外人士 ${totalVisitors} 名，報告完畢。(搜救中 ${totalRescuing} 人)`;

  return {
    speechText,
    totalActive: effectiveTotal,
    totalLeave,
    totalHospital,
    totalEscort,
    totalPresent,
    totalVisitors,
    totalRescuing,
    classStatusMap
  };
}
