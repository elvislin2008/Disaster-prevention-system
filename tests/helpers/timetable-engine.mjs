/**
 * Authoritative Timetable and Schedule Engine for V20.4 Migration.
 * Corrects morning boundary to 12:40 (760 mins) and supports Thursday schedule codes.
 */

export function resolveTimeSlot(timeOrMode) {
  if (typeof timeOrMode === 'string' && timeOrMode !== 'auto') {
    // Explicit manual mode mapping
    const mode = timeOrMode.trim();
    if (mode === 'mon_am') return { targetDay: 'mon', targetSlot: 'am' };
    if (mode === 'mon_pm1') return { targetDay: 'mon', targetSlot: 'pm1' };
    if (mode === 'mon_pm2') return { targetDay: 'mon', targetSlot: 'pm2' };
    if (mode === 'tue_pm') return { targetDay: 'tue', targetSlot: 'pm1' };
    if (mode === 'wed_pm1') return { targetDay: 'wed', targetSlot: 'pm1' };
    if (mode === 'wed_pm2') return { targetDay: 'wed', targetSlot: 'pm2' };
    if (mode === 'thu_am') return { targetDay: 'thu', targetSlot: 'am' };
    if (mode === 'thu_pm1') return { targetDay: 'thu', targetSlot: 'pm1' };
    if (mode === 'thu_pm2') return { targetDay: 'thu', targetSlot: 'pm2' };
    if (mode === 'thu_night') return { targetDay: 'thu', targetSlot: 'night' };
    if (mode === 'fri_pm') return { targetDay: 'fri', targetSlot: 'pm1' };
    if (mode === 'night') return { targetDay: 'mon', targetSlot: 'night' };
    
    // Pattern: {day}_{slot}
    const match = mode.match(/^(mon|tue|wed|thu|fri)_(am|pm1|pm2|night)$/);
    if (match) {
      return { targetDay: match[1], targetSlot: match[2] };
    }
    return null;
  }

  // Dynamic Date or auto
  const date = timeOrMode instanceof Date ? timeOrMode : new Date();
  const dayIndex = date.getDay(); // 0 is Sun, 6 is Sat
  if (dayIndex === 0 || dayIndex === 6) return null; // Weekend inactive

  const dayKeys = ['', 'mon', 'tue', 'wed', 'thu', 'fri'];
  const targetDay = dayKeys[dayIndex];
  if (!targetDay) return null;

  const currentMinutes = date.getHours() * 60 + date.getMinutes();

  // 08:00 (480) - 18:30 (1110)
  if (currentMinutes < 480 || currentMinutes >= 1110) {
    return null; // Before school or after night session
  }

  // Corrected morning boundary: 12:40 (760 minutes)
  let targetSlot = '';
  if (currentMinutes < 760) {
    targetSlot = 'am';
  } else if (currentMinutes < 960) {
    targetSlot = 'pm1'; // 12:40 - 16:00
  } else if (currentMinutes < 1060) {
    targetSlot = 'pm2'; // 16:00 - 17:40
  } else {
    targetSlot = 'night'; // 17:40 - 18:30
  }

  return { targetDay, targetSlot };
}

export function isClassActiveAtTime(gradeName, className, timeOrMode, schedules = []) {
  if (gradeName === '緊急應變小組') {
    return true; // Emergency team is always active
  }

  const slot = resolveTimeSlot(timeOrMode);
  if (!slot) return false;

  const columnKey = `${slot.targetDay}_${slot.targetSlot}`;

  // Find matching rows in schedules
  const isSpecialGroup = (gradeName === '課後班' || gradeName === '學習扶助班');

  if (isSpecialGroup) {
    // Exact group and class name matching (.some across rows)
    return schedules.some(row => {
      if (row.groupName !== gradeName) return false;
      if (row.className !== className && row.className !== 'all' && row.className !== '全部') return false;
      return Boolean(row[columnKey]);
    });
  }

  // Normal grades & kindergarten
  const match = schedules.find(row => {
    return row.groupName === gradeName && (
      row.className === 'all' || row.className === '全部' || !row.className
    );
  });

  if (!match) return false;
  return Boolean(match[columnKey]);
}
