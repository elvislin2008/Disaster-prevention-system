/**
 * Test dataset generator for 90 classes, students, and schedules.
 */
import { VALID_NORMAL_GRADES } from './contracts.mjs';

export function createStandardSchedules() {
  const schedules = [];

  // 1. Normal grades 1 to 6
  // Grade 1 & 2: Tue full day (am, pm1), others half day (am only)
  for (const grade of ['一', '二']) {
    schedules.push({
      groupName: grade,
      className: 'all',
      mon_am: true, mon_pm1: false, mon_pm2: false, mon_night: false,
      tue_am: true, tue_pm1: true,  tue_pm2: false, tue_night: false,
      wed_am: true, wed_pm1: false, wed_pm2: false, wed_night: false,
      thu_am: true, thu_pm1: false, thu_pm2: false, thu_night: false,
      fri_am: true, fri_pm1: false, fri_pm2: false, fri_night: false
    });
  }

  // Grade 3 & 4: Mon, Tue, Thu, Fri full day (am, pm1), Wed half day
  for (const grade of ['三', '四']) {
    schedules.push({
      groupName: grade,
      className: 'all',
      mon_am: true, mon_pm1: true, mon_pm2: false, mon_night: false,
      tue_am: true, tue_pm1: true, tue_pm2: false, tue_night: false,
      wed_am: true, wed_pm1: false, wed_pm2: false, wed_night: false,
      thu_am: true, thu_pm1: true, thu_pm2: false, thu_night: false,
      fri_am: true, fri_pm1: true, fri_pm2: false, fri_night: false
    });
  }

  // Grade 5 & 6: Mon, Tue, Thu, Fri full day (am, pm1), Wed half day
  for (const grade of ['五', '六']) {
    schedules.push({
      groupName: grade,
      className: 'all',
      mon_am: true, mon_pm1: true, mon_pm2: false, mon_night: false,
      tue_am: true, tue_pm1: true, tue_pm2: false, tue_night: false,
      wed_am: true, wed_pm1: false, wed_pm2: false, wed_night: false,
      thu_am: true, thu_pm1: true, thu_pm2: false, thu_night: false,
      fri_am: true, fri_pm1: true, fri_pm2: false, fri_night: false
    });
  }

  // Kindergarten
  schedules.push({
    groupName: '幼兒園',
    className: 'all',
    mon_am: true, mon_pm1: true, mon_pm2: false, mon_night: false,
    tue_am: true, tue_pm1: true, tue_pm2: false, tue_night: false,
    wed_am: true, wed_pm1: true, wed_pm2: false, wed_night: false,
    thu_am: true, thu_pm1: true, thu_pm2: false, thu_night: false,
    fri_am: true, fri_pm1: true, fri_pm2: false, fri_night: false
  });

  // Emergency Team
  schedules.push({
    groupName: '緊急應變小組',
    className: 'all',
    mon_am: true, mon_pm1: true, mon_pm2: true, mon_night: true,
    tue_am: true, tue_pm1: true, tue_pm2: true, tue_night: true,
    wed_am: true, wed_pm1: true, wed_pm2: true, wed_night: true,
    thu_am: true, thu_pm1: true, thu_pm2: true, thu_night: true,
    fri_am: true, fri_pm1: true, fri_pm2: true, fri_night: true
  });

  // Remedial class: 學2甲 in Thu pm1
  schedules.push({
    groupName: '學習扶助班',
    className: '學2甲',
    mon_am: false, mon_pm1: false, mon_pm2: false, mon_night: false,
    tue_am: false, tue_pm1: false, tue_pm2: false, tue_night: false,
    wed_am: false, wed_pm1: false, wed_pm2: false, wed_night: false,
    thu_am: false, thu_pm1: true,  thu_pm2: false, thu_night: false,
    fri_am: false, fri_pm1: false, fri_pm2: false, fri_night: false
  });

  // After school class: 一甲A in mon_pm1, mon_pm2
  schedules.push({
    groupName: '課後班',
    className: '一甲A',
    mon_am: false, mon_pm1: true, mon_pm2: true, mon_night: false,
    tue_am: false, tue_pm1: false, tue_pm2: true, tue_night: false,
    wed_am: false, wed_pm1: true, wed_pm2: true, wed_night: false,
    thu_am: false, thu_pm1: true, thu_pm2: true, thu_night: false,
    fri_am: false, fri_pm1: true, fri_pm2: true, fri_night: false
  });

  return schedules;
}

/**
 * Generate 90 normal classes (Grade 1-6 * classes 1-15).
 */
export function generate90Classes() {
  const classes = [];
  for (const grade of VALID_NORMAL_GRADES) {
    for (let c = 1; c <= 15; c++) {
      classes.push({
        grade,
        className: String(c),
        classKey: `${grade} ${c}`,
        studentCount: 28
      });
    }
  }
  return classes;
}

/**
 * Generate students for a class.
 */
export function generateStudentsForClass(grade, className, count = 28) {
  const students = [];
  for (let i = 1; i <= count; i++) {
    const seatRaw = `${String(i).padStart(2, '0')}號`;
    const studentKey = `${grade} ${className}_${seatRaw}`;
    students.push({
      groupName: grade,
      className: String(className),
      seatNum: i,
      seatRaw,
      name: `學生_${grade}${className}_${i}`,
      studentKey,
      parentName: `家長_${grade}${className}_${i}`,
      parentPhone: `09123456${String(i).padStart(2, '0')}`,
      teacherName: `導師_${grade}${className}`,
      teacherPhone: '0987654321'
    });
  }
  return students;
}
