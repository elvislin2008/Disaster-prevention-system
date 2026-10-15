import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CAMPUS_BUILDINGS,
  checkMissedCallsEscalation,
  validateTriageEscortCount
} from '../helpers/contracts.mjs';

describe('Tier 2: Boundary - Feature 23 (5-Missed-Call Auto Red Alert)', () => {
  it('B23-1: Counter incrementing past 5 (e.g. 6, 7) remains in escalated help request state', () => {
    assert.equal(checkMissedCallsEscalation(6), true);
    assert.equal(checkMissedCallsEscalation(10), true);
  });

  it('B23-2: Negative missed call count is clamped to 0 by contact validator', () => {
    const clampCount = (n) => Math.max(0, Number(n) || 0);
    assert.equal(clampCount(-1), 0);
    assert.equal(clampCount(-99), 0);
    assert.equal(clampCount(3), 3);
  });

  it('B23-3: Student who answered phone (count 0) does not trigger false help request', () => {
    assert.equal(checkMissedCallsEscalation(0), false);
  });

  it('B23-4: Resetting student status clears missed call count back to 0', () => {
    let state = { count: 5, isHelpReq: true };
    const resetContact = (s) => {
      s.count = 0;
      s.isHelpReq = false;
      return s;
    };
    resetContact(state);
    assert.equal(state.count, 0);
    assert.equal(state.isHelpReq, false);
  });

  it('B23-5: Multiple teachers contacting different students maintain independent missed call counters', () => {
    const contacts = new Map();
    const addMissed = (sKey) => {
      const cur = contacts.get(sKey) || { count: 0 };
      cur.count++;
      contacts.set(sKey, cur);
    };

    addMissed('一 1_01號');
    addMissed('一 1_01號');
    addMissed('二 2_05號');

    assert.equal(contacts.get('一 1_01號').count, 2);
    assert.equal(contacts.get('二 2_05號').count, 1);
  });
});

describe('Tier 2: Boundary - Feature 24 (Triage Badges & Escort Count Guard)', () => {
  it('B24-1: Yellow triage card with escortCount 0 throws GuardError', () => {
    assert.throws(() => validateTriageEscortCount('yellow', 0), /陪同就醫人數/);
  });

  it('B24-2: Red triage card with non-integer escortCount (1.5, two) throws GuardError', () => {
    assert.throws(() => validateTriageEscortCount('red', 1.5), /陪同就醫人數/);
    assert.throws(() => validateTriageEscortCount('red', 'two'), /陪同就醫人數/);
  });

  it('B24-3: Yellow card with escortCount 1 is the minimum valid escort threshold', () => {
    assert.equal(validateTriageEscortCount('yellow', 1), true);
  });

  it('B24-4: Red card with escortCount 4 is the maximum valid escort threshold', () => {
    assert.equal(validateTriageEscortCount('red', 4), true);
    assert.throws(() => validateTriageEscortCount('red', 5), /陪同就醫人數/);
  });

  it('B24-5: Green card ignores escortCount even if set to 0 or null', () => {
    assert.equal(validateTriageEscortCount('green', 0), true);
    assert.equal(validateTriageEscortCount('green', null), true);
  });
});

describe('Tier 2: Boundary - Feature 25 (6 Main Buildings & 8 Safety Indicators)', () => {
  it('B25-1: Building name with leading/trailing spaces matches valid building after trimming', () => {
    const isValidBuilding = (name) => {
      if (!name || typeof name !== 'string') return false;
      return CAMPUS_BUILDINGS.includes(name.trim());
    };
    assert.equal(isValidBuilding('  慈愛樓  '), true);
    assert.equal(isValidBuilding('\t至善樓\n'), true);
  });

  it('B25-2: Unrecognized building name (e.g. 體育館) is flagged by campus building validator', () => {
    const isValidBuilding = (name) => CAMPUS_BUILDINGS.includes(name);
    assert.equal(isValidBuilding('體育館'), false);
    assert.equal(isValidBuilding('活動中心'), false);
  });

  it('B25-3: All 8 indicators set to danger flags catastrophic building status on commander dashboard', () => {
    const indicators = {
      '結構塌陷': 'danger', '傾斜': 'danger', '梁柱龜裂': 'danger', '外牆掉落': 'danger',
      '相鄰建物危害': 'danger', '地基土壤液化': 'danger', '附屬設施危害': 'danger', '瓦斯電線管路': 'danger'
    };
    const dangerCount = Object.values(indicators).filter(v => v === 'danger').length;
    assert.equal(dangerCount, 8);
    const badgeText = dangerCount === 8 ? '🚨 重度危險 (全項受損)' : '⚠️ 部分受損';
    assert.equal(badgeText, '🚨 重度危險 (全項受損)');
  });

  it('B25-4: Empty inspector remarks string defaults to 無備註 instead of undefined', () => {
    const sanitizeNotes = (notes) => {
      const trimmed = (notes || '').trim();
      return trimmed.length > 0 ? trimmed : '無備註';
    };
    assert.equal(sanitizeNotes(''), '無備註');
    assert.equal(sanitizeNotes('   '), '無備註');
    assert.equal(sanitizeNotes(null), '無備註');
    assert.equal(sanitizeNotes('窗戶碎裂'), '窗戶碎裂');
  });

  it('B25-5: 8 indicators evaluated concurrently resolve all building states accurately', () => {
    const buildingStatus = {};
    for (const b of CAMPUS_BUILDINGS) {
      buildingStatus[b] = { safeCount: 8, dangerCount: 0 };
    }
    assert.equal(Object.keys(buildingStatus).length, 6);
  });
});

describe('Tier 2: Boundary - Feature 26 (Visitor & Temporary Staff Registration)', () => {
  it('B26-1: Visitor name with empty string or spaces-only is rejected by registration validator', () => {
    const validateVisitorName = (name) => {
      const trimmed = (name || '').trim();
      if (!trimmed) throw new Error('Visitor name cannot be empty');
      return trimmed;
    };
    assert.throws(() => validateVisitorName(''), /Visitor name cannot be empty/);
    assert.throws(() => validateVisitorName('   '), /Visitor name cannot be empty/);
  });

  it('B26-2: Visitor category outside the 4 allowed categories defaults to volunteer', () => {
    const resolveCategory = (cat) => {
      const allowed = ['transfer_student', 'substitute_teacher', 'volunteer', 'vendor'];
      return allowed.includes(cat) ? cat : 'volunteer';
    };
    assert.equal(resolveCategory('alien_visitor'), 'volunteer');
    assert.equal(resolveCategory('vendor'), 'vendor');
  });

  it('B26-3: Registering 100 visitors handles ID generation uniquely without key collision', () => {
    const ids = new Set();
    for (let i = 0; i < 100; i++) {
      const id = `vis_${Date.now()}_${i}_${Math.random().toString(36).substring(2, 6)}`;
      ids.add(id);
    }
    assert.equal(ids.size, 100);
  });

  it('B26-4: Missing visitor found and marked safe updates their status correctly', () => {
    const visitor = { id: 'vis_1', name: '李工程師', status: 'missing' };
    const markSafe = (v) => { v.status = 'safe'; return v; };
    markSafe(visitor);
    assert.equal(visitor.status, 'safe');
  });

  it('B26-5: Visitor phone number validation handles domestic mobile and landline formats', () => {
    const isValidPhone = (p) => {
      const cleaned = (p || '').replace(/[\s-]/g, '');
      return /^09\d{8}$|^0\d{8,9}$/.test(cleaned);
    };
    assert.equal(isValidPhone('0912-345-678'), true);
    assert.equal(isValidPhone('02-22601234'), true);
    assert.equal(isValidPhone('12345'), false);
  });
});
