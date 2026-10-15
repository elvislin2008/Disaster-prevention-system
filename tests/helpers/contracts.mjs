/**
 * Interface contracts and specification validation schemas for campus disaster roll call system.
 */

// Iron Rule 2: Single-Character Grade Integrity
export const VALID_NORMAL_GRADES = ['一', '二', '三', '四', '五', '六'];
export const VALID_SPECIAL_GROUPS = ['幼兒園', '課後班', '學習扶助班', '緊急應變小組'];
export const ALL_VALID_GRADE_GROUPS = [...VALID_NORMAL_GRADES, ...VALID_SPECIAL_GROUPS];

export function isValidGradeString(grade) {
  if (typeof grade !== 'string') return false;
  const trimmed = grade.trim();
  if (VALID_NORMAL_GRADES.includes(trimmed)) return true;
  if (VALID_SPECIAL_GROUPS.includes(trimmed)) return true;
  return false;
}

export function containsDeprecatedGradeFormatting(grade) {
  if (typeof grade !== 'string') return false;
  return /[一二三四五六]年級/.test(grade);
}

// Iron Rule 3: Deprecated Tables Elimination
export const DEPRECATED_SHEETS_OR_COLLECTIONS = [
  'AfterSchoolSchedule',
  'GradeSchedule',
  'timetable',
  '工作表7',
  '緊急應變小組名單'
];

export function isDeprecatedTable(name) {
  return DEPRECATED_SHEETS_OR_COLLECTIONS.includes(name);
}

// Valid Firestore collections
export const ALLOWED_FIRESTORE_COLLECTIONS = [
  'system_config',
  'students',
  'class_reports',
  'pullouts',
  'rescues',
  'contacts',
  'visitors',
  'buildings',
  'attendance_logs',
  'stress_test_logs'
];

// RBAC Roles
export const VALID_ROLES = [
  'commander',
  'teacher',
  'pullout_teacher',
  'medical',
  'rescue_officer',
  'patrol',
  'inspector',
  'visitor_manager'
];

// 7-Stage Roll Call Cycle
export const ROLL_CALL_STAGES = [
  'present',      // 🟢 實到
  'study_center', // 🟣 學習中心 (A區塊)
  'native_lang',  // 🟠 本土語 (B區塊)
  'team',         // 🔵 團隊 (C區塊)
  'leave',        // 🟡 請假
  'missing',      // 🔴 失蹤
  'pickedUp'      // 🔵 已接回
];

export function getNextRollCallStage(currentStage) {
  const index = ROLL_CALL_STAGES.indexOf(currentStage);
  if (index === -1) return 'present';
  return ROLL_CALL_STAGES[(index + 1) % ROLL_CALL_STAGES.length];
}

// Triage validation: Yellow and Red triage cards strictly require 1-4 escort count
export function validateTriageEscortCount(cardColor, escortCount) {
  const color = (cardColor || '').toLowerCase();
  if (color === 'yellow' || color === 'red' || color === '黃卡' || color === '紅卡') {
    const num = Number(escortCount);
    if (!Number.isInteger(num) || num < 1 || num > 4) {
      throw new Error('⚠️ 選擇黃卡/紅卡時，請先點選【陪同就醫人數】(1~4人)才可 OK 送出！');
    }
    return true;
  }
  return true;
}

// 5-Missed-Call escalation rule
export function checkMissedCallsEscalation(count) {
  return Number(count) >= 5;
}

// 6 Buildings and 8 Safety Indicators
export const CAMPUS_BUILDINGS = [
  '慈愛樓', '至善樓', '維揚樓', '樂群樓', '弘德樓', '中山樓'
];

export const SAFETY_INDICATORS = [
  '結構塌陷', '傾斜', '梁柱龜裂', '外牆掉落',
  '相鄰建物危害', '地基土壤液化', '附屬設施危害', '瓦斯電線管路'
];
