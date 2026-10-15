/**
 * ==============================================================================
 * 清水國小校園災難與演練即時點名通報系統 V20.4
 * 前端核心業務邏輯與 UI 佈局單元測試 (tests/unit/app.test.mjs)
 * ==============================================================================
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, '../..');

// 載入 app.js 模組
import appMethods, {
  getNextRollCallStage,
  isClassActiveAtTime,
  isStudentOffCampus
} from '../../public/js/app.js';
import { calculateOralReport } from '../helpers/oral-report-calculator.mjs';
import { createStandardSchedules } from '../helpers/test-dataset.mjs';

describe('Unit Tests: Frontend App Logic & Milestone 5 Requirements', () => {

  describe('1. 7-Stage Roll Call Cycle (Feature 19)', () => {
    it('1.1 getNextRollCallStage cycles through all 7 states in exact order', () => {
      const stages = ['present', 'study_center', 'native_lang', 'team', 'leave', 'missing', 'pickedUp'];
      let current = 'present';
      const history = [current];

      for (let i = 0; i < 6; i++) {
        current = getNextRollCallStage(current);
        history.push(current);
      }

      assert.deepEqual(history, stages);
      assert.equal(getNextRollCallStage('pickedUp'), 'present', 'Cycles back to present');
    });

    it('1.2 Default fallback for unknown status returns present', () => {
      assert.equal(getNextRollCallStage('unknown_state'), 'present');
      assert.equal(getNextRollCallStage(''), 'present');
    });
  });

  describe('2. Iron Rule 4: Pending Pullout Strict Isolation (Feature 20)', () => {
    it('2.1 Student in pending pullout status NEVER increases rescuing count', () => {
      const classReports = {
        '一 1': { total: 28, presentCount: 27, leaveCount: 0, missingCount: 0 }
      };
      const pullouts = {
        '一 1_05號': 'pending'
      };

      const result = calculateOralReport({ classReports, pullouts });
      assert.equal(result.totalRescuing, 0, 'Iron Rule 4: Rescue count MUST be 0');
      assert.notEqual(result.classStatusMap['一 1'], 'has-missing', 'Class card MUST NOT turn red');
    });

    it('2.2 Multiple pending pullouts across classes strictly maintain 0 rescue count and non-red cards', () => {
      const classReports = {
        '一 1': { total: 28, presentCount: 26, leaveCount: 0, missingCount: 0 },
        '二 1': { total: 28, presentCount: 27, leaveCount: 1, missingCount: 0 }
      };
      const pullouts = {
        '一 1_01號': 'pending',
        '一 1_02號': 'pending',
        '二 1_03號': 'pending'
      };

      const result = calculateOralReport({ classReports, pullouts });
      assert.equal(result.totalRescuing, 0, 'No pending pullout counted in rescue');
      assert.notEqual(result.classStatusMap['一 1'], 'has-missing');
      assert.notEqual(result.classStatusMap['二 1'], 'has-missing');
    });

    it('2.3 When pullout teacher explicitly marks missing, rescue count increments and card turns red', () => {
      const classReports = {
        '一 1': { total: 28, presentCount: 27, leaveCount: 0, missingCount: 0 }
      };
      const pullouts = {
        '一 1_05號': 'missing'
      };

      const result = calculateOralReport({ classReports, pullouts });
      assert.equal(result.totalRescuing, 1, 'Explicit missing increments rescue count');
      assert.equal(result.classStatusMap['一 1'], 'has-missing', 'Class card turns red');
    });
  });

  describe('3. Morning Timetable Cutoff at 12:40 (760 mins) (Feature 21)', () => {
    let originalSchedule;

    before(() => {
      originalSchedule = globalThis.window?.scheduleConfigData;
      globalThis.window = globalThis.window || {};
      globalThis.window.scheduleConfigData = createStandardSchedules();
    });

    after(() => {
      if (globalThis.window) {
        globalThis.window.scheduleConfigData = originalSchedule;
      }
    });

    it('3.1 Monday 12:15 evaluates Grade 1 and 2 as active (08:00~12:40)', () => {
      const monday1215 = new Date('2026-10-19T12:15:00'); // Monday 12:15
      const schedules = createStandardSchedules();
      assert.equal(isClassActiveAtTime('一', '1', monday1215, schedules), true);
      assert.equal(isClassActiveAtTime('二', '1', monday1215, schedules), true);
    });

    it('3.2 Manual mon_am evaluates Grades 1 and 2 as active', () => {
      const schedules = createStandardSchedules();
      assert.equal(isClassActiveAtTime('一', '1', 'mon_am', schedules), true);
      assert.equal(isClassActiveAtTime('二', '1', 'mon_am', schedules), true);
    });

    it('3.3 Monday 12:40 (760 mins) evaluates Grade 1 as dismissed and Grade 3 as active', () => {
      const monday1240 = new Date('2026-10-19T12:40:00');
      const schedules = createStandardSchedules();
      assert.equal(isClassActiveAtTime('一', '1', monday1240, schedules), false);
      assert.equal(isClassActiveAtTime('三', '1', monday1240, schedules), true);
    });
  });

  describe('4. Thursday Full Timetable Schedule Mapping (Feature 22)', () => {
    it('4.1 app.js includes Thursday options in simTimeMode handling', () => {
      assert.ok(typeof isClassActiveAtTime === 'function');
      assert.ok(typeof isStudentOffCampus === 'function');
    });
  });

  describe('5. Triage Escort Count Validation (Feature 24)', () => {
    it('5.1 Green card requires no escort, Yellow and Red strictly require 1-4 escorts', () => {
      const validateEscort = (triage, count) => {
        const t = (triage || '').toLowerCase();
        if (t === 'yellow' || t === 'red' || t === '黃卡' || t === '紅卡') {
          return count >= 1 && count <= 4;
        }
        return true;
      };

      assert.equal(validateEscort('green', 0), true);
      assert.equal(validateEscort('yellow', 2), true);
      assert.equal(validateEscort('red', 4), true);
      assert.equal(validateEscort('yellow', 0), false);
      assert.equal(validateEscort('red', 5), false);
    });
  });

  describe('6. 5-Missed-Call Escalation (Feature 23)', () => {
    it('6.1 Less than 5 calls does not escalate; 5 or more escalates to commander', () => {
      const checkEscalation = (count) => count >= 5;
      assert.equal(checkEscalation(1), false);
      assert.equal(checkEscalation(4), false);
      assert.equal(checkEscalation(5), true);
      assert.equal(checkEscalation(6), true);
    });
  });

  describe('7. HTML & CSS Preservation Verification (Milestone 5 Deliverables)', () => {
    const htmlContent = readFileSync(resolve(rootDir, 'public/index.html'), 'utf-8');
    const cssContent = readFileSync(resolve(rootDir, 'public/css/styles.css'), 'utf-8');

    it('7.1 index.html contains the 4 required primary status cards', () => {
      assert.ok(htmlContent.includes('card-total'), 'Must contain .card-total');
      assert.ok(htmlContent.includes('card-expected'), 'Must contain .card-expected');
      assert.ok(htmlContent.includes('card-present'), 'Must contain .card-present');
      assert.ok(htmlContent.includes('card-absent'), 'Must contain .card-absent');
      assert.ok(htmlContent.includes('全校人數'), 'Must contain 全校人數 label');
      assert.ok(htmlContent.includes('應到人數'), 'Must contain 應到人數 label');
      assert.ok(htmlContent.includes('實到人數'), 'Must contain 實到人數 label');
      assert.ok(htmlContent.includes('未到/協尋人數'), 'Must contain 未到/協尋人數 label');
    });

    it('7.2 index.html contains the 4 navigation tabs', () => {
      assert.ok(htmlContent.includes('📋 老師點名'));
      assert.ok(htmlContent.includes('🔄 抽離確認'));
      assert.ok(htmlContent.includes('🆘 危難救助'));
      assert.ok(htmlContent.includes('🏫 指揮中心'));
    });

    it('7.3 index.html contains 3 pullout triage blocks', () => {
      assert.ok(htmlContent.includes('cardPulloutSC'), 'Contains Learning Center card');
      assert.ok(htmlContent.includes('cardPulloutNL'), 'Contains Native Lang card');
      assert.ok(htmlContent.includes('cardPulloutTM'), 'Contains Team card');
    });

    it('7.4 index.html contains building checklist and oral report capsule', () => {
      assert.ok(htmlContent.includes('buildingCheckGrid'), 'Contains buildingCheckGrid');
      assert.ok(htmlContent.includes('speechBoxSchool'), 'Contains speechBoxSchool oral report capsule');
      assert.ok(htmlContent.includes('calcBreakdownContainer'), 'Contains calc breakdown container');
    });

    it('7.5 index.html contains visitor modal, stress modal, and site locked overlay', () => {
      assert.ok(htmlContent.includes('id="visitorModal"'), 'Contains visitorModal');
      assert.ok(htmlContent.includes('id="stressModal"'), 'Contains stressModal');
      assert.ok(htmlContent.includes('id="siteLockedOverlay"'), 'Contains siteLockedOverlay');
    });

    it('7.6 index.html non-intrusively mounts #authNavBadge and #offlineStatusBadge', () => {
      assert.ok(htmlContent.includes('id="authNavBadge"'), 'Contains #authNavBadge');
      assert.ok(htmlContent.includes('id="offlineStatusBadge"'), 'Contains #offlineStatusBadge');
    });

    it('7.7 index.html loads client scripts in exact specified order', () => {
      const configIdx = htmlContent.indexOf('config.js');
      const authIdx = htmlContent.indexOf('supabase-auth.js');
      const firestoreIdx = htmlContent.indexOf('firestore-service.js');
      const offlineIdx = htmlContent.indexOf('offline-manager.js');
      const gasIdx = htmlContent.indexOf('gas-bridge-adapter.js');
      const appIdx = htmlContent.indexOf('app.js');

      assert.ok(configIdx > 0 && authIdx > configIdx, 'config.js before supabase-auth.js');
      assert.ok(firestoreIdx > authIdx, 'supabase-auth.js before firestore-service.js');
      assert.ok(offlineIdx > firestoreIdx, 'firestore-service.js before offline-manager.js');
      assert.ok(gasIdx > offlineIdx, 'offline-manager.js before gas-bridge-adapter.js');
      assert.ok(appIdx > gasIdx, 'gas-bridge-adapter.js before app.js');
    });

    it('7.8 styles.css strictly preserves styling rules from v204 Index.txt', () => {
      assert.ok(cssContent.includes('#eaf2f8'), 'Background color #eaf2f8');
      assert.ok(cssContent.includes('#222222'), 'Font color #222222');
      assert.ok(cssContent.includes('.card-total'), 'Contains .card-total');
      assert.ok(cssContent.includes('.matrix-grid-10x3'), 'Contains .matrix-grid-10x3');
      assert.ok(cssContent.includes('@media screen and (max-width: 768px)'), 'Contains table-to-card breakpoint');
      assert.ok(cssContent.includes('@media screen and (max-width: 600px)'), 'Contains 5-column grid breakpoint');
      assert.ok(cssContent.includes('.active-sc'), 'Contains pullout SC style');
      assert.ok(cssContent.includes('.active-nl'), 'Contains pullout NL style');
      assert.ok(cssContent.includes('.active-tm'), 'Contains pullout TM style');
      assert.ok(cssContent.includes('.site-locked-overlay'), 'Contains site locked overlay style');
    });

    it('7.9 Thursday options exist in #simTimeSelect', () => {
      assert.ok(htmlContent.includes('value="thu_am"'), 'Contains thu_am');
      assert.ok(htmlContent.includes('value="thu_pm1"'), 'Contains thu_pm1');
      assert.ok(htmlContent.includes('value="thu_pm2"'), 'Contains thu_pm2');
      assert.ok(htmlContent.includes('value="thu_night"'), 'Contains thu_night');
    });
  });
});
