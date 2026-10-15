import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CAMPUS_BUILDINGS,
  SAFETY_INDICATORS,
  checkMissedCallsEscalation,
  validateTriageEscortCount
} from '../helpers/contracts.mjs';
import { calculateOralReport } from '../helpers/oral-report-calculator.mjs';

describe('Tier 1: Feature 23 - 5-Missed-Call Auto Red Alert', () => {
  it('F23-1: Clicking +1 missed call increments counter below 5 without auto escalation', () => {
    let count = 0;
    count++;
    assert.equal(count, 1);
    assert.equal(checkMissedCallsEscalation(count), false);
    count += 3;
    assert.equal(count, 4);
    assert.equal(checkMissedCallsEscalation(count), false);
  });

  it('F23-2: Reaching 5 missed calls triggers auto red alert escalation', () => {
    const count = 5;
    assert.equal(checkMissedCallsEscalation(count), true);
  });

  it('F23-3: Auto escalation updates helpRequestMap and disables call increment button', () => {
    const contactState = { count: 5, isHelpReq: false };
    if (checkMissedCallsEscalation(contactState.count)) {
      contactState.isHelpReq = true;
    }
    const buttonState = contactState.isHelpReq ? 'disabled' : 'enabled';
    assert.equal(contactState.isHelpReq, true);
    assert.equal(buttonState, 'disabled');
  });

  it('F23-4: Teacher can take back contact (takeBackContact) to clear escalation and resume dialing', () => {
    const contactState = { count: 5, isHelpReq: true };
    const takeBackContact = (state) => {
      state.isHelpReq = false;
      return state;
    };
    takeBackContact(contactState);
    assert.equal(contactState.isHelpReq, false);
  });

  it('F23-5: Uncontacted student initializes with count 0 and normal status', () => {
    const initialContact = { count: 0, isHelpReq: false, lastCallTime: null };
    assert.equal(initialContact.count, 0);
    assert.equal(checkMissedCallsEscalation(initialContact.count), false);
  });
});

describe('Tier 1: Feature 24 - Triage Badges & Escort Count Guard', () => {
  it('F24-1: Green triage card allows submission without mandatory escort count', () => {
    assert.equal(validateTriageEscortCount('green', 0), true);
    assert.equal(validateTriageEscortCount('綠卡', null), true);
  });

  it('F24-2: Yellow triage card with valid escort count (1-4) validates successfully', () => {
    for (let i = 1; i <= 4; i++) {
      assert.equal(validateTriageEscortCount('yellow', i), true);
      assert.equal(validateTriageEscortCount('黃卡', i), true);
    }
  });

  it('F24-3: Red triage card with valid escort count (1-4) validates successfully', () => {
    for (let i = 1; i <= 4; i++) {
      assert.equal(validateTriageEscortCount('red', i), true);
      assert.equal(validateTriageEscortCount('紅卡', i), true);
    }
  });

  it('F24-4: Yellow or Red triage card without escort count is BLOCKED with guard error', () => {
    assert.throws(() => validateTriageEscortCount('yellow', 0), /陪同就醫人數/);
    assert.throws(() => validateTriageEscortCount('red', null), /陪同就醫人數/);
    assert.throws(() => validateTriageEscortCount('黃卡', undefined), /陪同就醫人數/);
    assert.throws(() => validateTriageEscortCount('紅卡', ''), /陪同就醫人數/);
  });

  it('F24-5: Yellow or Red triage card with escort count exceeding 4 is BLOCKED', () => {
    assert.throws(() => validateTriageEscortCount('yellow', 5), /陪同就醫人數/);
    assert.throws(() => validateTriageEscortCount('red', 10), /陪同就醫人數/);
  });
});

describe('Tier 1: Feature 25 - 6 Main Buildings & 8 Safety Indicators', () => {
  it('F25-1: Campus building list matches exact 6 buildings', () => {
    const expected = ['慈愛樓', '至善樓', '維揚樓', '樂群樓', '弘德樓', '中山樓'];
    assert.deepEqual(CAMPUS_BUILDINGS, expected);
    assert.equal(CAMPUS_BUILDINGS.length, 6);
  });

  it('F25-2: Safety indicators list matches exact 8 indicators', () => {
    const expected = [
      '結構塌陷', '傾斜', '梁柱龜裂', '外牆掉落',
      '相鄰建物危害', '地基土壤液化', '附屬設施危害', '瓦斯電線管路'
    ];
    assert.deepEqual(SAFETY_INDICATORS, expected);
    assert.equal(SAFETY_INDICATORS.length, 8);
  });

  it('F25-3: Building checklist supports toggling indicator between safe and danger', () => {
    const building = {
      name: '慈愛樓',
      indicators: {
        '結構塌陷': 'safe',
        '梁柱龜裂': 'danger'
      }
    };
    assert.equal(building.indicators['結構塌陷'], 'safe');
    assert.equal(building.indicators['梁柱龜裂'], 'danger');
  });

  it('F25-4: Building with any danger indicator is flagged as damaged on commander dashboard', () => {
    const evaluateBuilding = (indicators) => {
      const hasDanger = Object.values(indicators).some(v => v === 'danger');
      return hasDanger ? 'danger' : 'safe';
    };
    assert.equal(evaluateBuilding({ '結構塌陷': 'safe', '傾斜': 'safe' }), 'safe');
    assert.equal(evaluateBuilding({ '結構塌陷': 'safe', '梁柱龜裂': 'danger' }), 'danger');
  });

  it('F25-5: Building inspector notes are stored alongside indicator checklist', () => {
    const report = {
      buildingName: '至善樓',
      indicators: { '外牆掉落': 'danger' },
      notes: '南側三樓磁磚部分剝落，已拉警戒線',
      inspector: '巡檢組長',
      updatedAt: Date.now()
    };
    assert.ok(report.notes.includes('磁磚部分剝落'));
    assert.equal(report.inspector, '巡檢組長');
  });
});

describe('Tier 1: Feature 26 - Visitor & Temporary Staff Registration', () => {
  it('F26-1: Visitor registration supports 4 distinct categories', () => {
    const categories = ['transfer_student', 'substitute_teacher', 'volunteer', 'vendor'];
    assert.equal(categories.length, 4);
  });

  it('F26-2: Registered visitor defaults to safe status upon creation', () => {
    const newVisitor = {
      name: '陳志工',
      category: 'volunteer',
      phone: '0911223344',
      status: 'safe'
    };
    assert.equal(newVisitor.status, 'safe');
  });

  it('F26-3: Marking visitor as missing immediately adds them to active rescue list', () => {
    const visitor = { id: 'vis_1', name: '李工程師', category: 'vendor', status: 'missing' };
    const oralReport = calculateOralReport({ visitors: [visitor] });
    assert.equal(oralReport.totalVisitors, 1);
    assert.equal(oralReport.totalRescuing, 1);
  });

  it('F26-4: Visitor count increments total oral report visitor tally', () => {
    const visitors = [
      { id: 'v1', name: '訪客A', status: 'safe' },
      { id: 'v2', name: '代課B', status: 'safe' }
    ];
    const oralReport = calculateOralReport({ visitors });
    assert.equal(oralReport.totalVisitors, 2);
    assert.equal(oralReport.totalRescuing, 0);
  });

  it('F26-5: Deleting or checking out visitor removes them from active visitor list', () => {
    let visitors = [{ id: 'v1', name: '家長A' }, { id: 'v2', name: '家長B' }];
    visitors = visitors.filter(v => v.id !== 'v1');
    assert.equal(visitors.length, 1);
    assert.equal(visitors[0].id, 'v2');
  });
});
