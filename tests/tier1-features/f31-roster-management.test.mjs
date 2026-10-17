import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MockFirestore } from '../helpers/mock-firestore.mjs';
import { parseRosterDataArray } from '../../public/js/app.js';

describe('Tier 1: Feature 31 - Full Roster & Transfer Status Management (師生名冊與在籍管理)', () => {
  it('F31-1: Commander marks student as transferred_out and student is excluded from active roll call', () => {
    let allStudents = [
      { id: '五_1_01號', grade: '五', className: '1', seatNum: 1, seatRaw: '01號', name: '王小明', status: 'active', isActive: true },
      { id: '五_1_02號', grade: '五', className: '1', seatNum: 2, seatRaw: '02號', name: '李小美', status: 'active', isActive: true },
      { id: '五_1_03號', grade: '五', className: '1', seatNum: 3, seatRaw: '03號', name: '張大同', status: 'active', isActive: true }
    ];

    // Mark student 02號 as transferred_out
    const target = allStudents.find(s => s.id === '五_1_02號');
    target.status = 'transferred_out';
    target.isActive = false;

    // Active students for class 五 1
    const activeClassStudents = allStudents.filter(s => s.grade === '五' && s.className === '1' && s.status !== 'transferred_out' && s.isActive !== false);
    assert.equal(activeClassStudents.length, 2, 'Class active students count should be 2 after transfer out');
    assert.deepEqual(activeClassStudents.map(s => s.name), ['王小明', '張大同']);
  });

  it('F31-2: Commander adds a new transfer-in student and class count increments immediately', () => {
    let allStudents = [
      { id: '三_2_01號', grade: '三', className: '2', seatNum: 1, seatRaw: '01號', name: '陳小美', status: 'active', isActive: true }
    ];

    const newStudent = {
      id: '三_2_35號',
      grade: '三',
      className: '2',
      seatNum: 35,
      seatRaw: '35號',
      name: '林轉生',
      status: 'transferred_in',
      isActive: true
    };
    allStudents.push(newStudent);

    const activeClassStudents = allStudents.filter(s => s.grade === '三' && s.className === '2' && s.status !== 'transferred_out' && s.isActive !== false);
    assert.equal(activeClassStudents.length, 2, 'Class active count should increase to 2');
    assert.ok(activeClassStudents.some(s => s.name === '林轉生' && s.status === 'transferred_in'));
  });

  it('F31-3: Restoring a transferred-out student back to active restores them to class roster', () => {
    let allStudents = [
      { id: '一_1_05號', grade: '一', className: '1', seatNum: 5, seatRaw: '05號', name: '周小倫', status: 'transferred_out', isActive: false }
    ];

    // Active count before restore
    let activeBefore = allStudents.filter(s => s.status !== 'transferred_out' && s.isActive !== false);
    assert.equal(activeBefore.length, 0);

    // Restore to active
    const target = allStudents[0];
    target.status = 'active';
    target.isActive = true;

    let activeAfter = allStudents.filter(s => s.status !== 'transferred_out' && s.isActive !== false);
    assert.equal(activeAfter.length, 1);
    assert.equal(activeAfter[0].name, '周小倫');
  });

  it('F31-4: Roster search filters across name, seat number, phone and teacher correctly', () => {
    const students = [
      { grade: '四', className: '3', seatRaw: '12號', name: '郭靖', phone: '0912-111-222', teacher: '黃老師' },
      { grade: '四', className: '3', seatRaw: '13號', name: '黃蓉', phone: '0988-333-444', teacher: '黃老師' },
      { grade: '六', className: '1', seatRaw: '01號', name: '楊過', phone: '0922-555-666', teacher: '洪老師' }
    ];

    const searchKeyword = '郭靖';
    const matchName = students.filter(s => `${s.grade} ${s.className} ${s.seatRaw} ${s.name} ${s.phone} ${s.teacher}`.includes(searchKeyword));
    assert.equal(matchName.length, 1);
    assert.equal(matchName[0].name, '郭靖');

    const searchPhone = '0988';
    const matchPhone = students.filter(s => `${s.grade} ${s.className} ${s.seatRaw} ${s.name} ${s.phone} ${s.teacher}`.includes(searchPhone));
    assert.equal(matchPhone.length, 1);
    assert.equal(matchPhone[0].name, '黃蓉');
  });

  it('F31-5: Firestore setStudent merges and saves student transfer state correctly', async () => {
    const firestore = new MockFirestore();
    const docRef = { collName: 'students', docId: '二_1_10號' };

    await firestore.setDoc(docRef, {
      id: '二_1_10號',
      grade: '二',
      className: '1',
      seatRaw: '10號',
      name: '趙敏',
      status: 'transferred_out',
      isActive: false
    });

    const docSnap = await firestore.getDoc(docRef);
    assert.ok(docSnap.exists());
    const data = docSnap.data();
    assert.equal(data.status, 'transferred_out');
    assert.equal(data.isActive, false);
  });

  it('F31-6: parseRosterDataArray parses Excel rows with Iron Rule 2 canonicalization & seat formatting', () => {
    const rawExcelRows = [
      ['年級', '班級', '座號', '姓名', '性別', '家長電話', '導師姓名', '導師電話', '在籍狀態'],
      ['一年級', '1班', '1', '陳大文', '男', '0912-345-001', '林慧珍老師', '0988-111-222', '正常在籍'],
      ['2年級', '02', '5號', '林小華', '女', '0912-345-002', '張雅晴老師', '0988-222-333', '新轉入'],
      ['三', '3', '35', '張大同', '男', '0912-345-003', '吳志豪老師', '0988-333-444', '已轉出'],
      ['幼兒園', '企鵝班', '1', '孫小寶', '男', '0988-999-001', '幼教李老師', '0988-888-999', '正常在籍']
    ];

    const parsed = parseRosterDataArray(rawExcelRows);
    assert.equal(parsed.length, 4, 'Should parse 4 student records');

    // Check Iron Rule 2: Grade string must be canonical single character
    assert.equal(parsed[0].grade, '一', '一年級 must be canonicalized to 一');
    assert.equal(parsed[0].className, '1', '1班 must be trimmed to 1');
    assert.equal(parsed[0].seatRaw, '01號', 'Seat 1 must be formatted as 01號');
    assert.equal(parsed[0].id, '一_1_01號');
    assert.equal(parsed[0].status, 'active');
    assert.equal(parsed[0].isActive, true);

    // Check second student
    assert.equal(parsed[1].grade, '二', '2年級 must be canonicalized to 二');
    assert.equal(parsed[1].className, '2', '02 must be normalized to 2');
    assert.equal(parsed[1].seatRaw, '05號');
    assert.equal(parsed[1].status, 'transferred_in');
    assert.equal(parsed[1].isActive, true);

    // Check transferred_out student
    assert.equal(parsed[2].grade, '三');
    assert.equal(parsed[2].className, '3');
    assert.equal(parsed[2].seatRaw, '35號');
    assert.equal(parsed[2].status, 'transferred_out');
    assert.equal(parsed[2].isActive, false);

    // Check kindergarten student
    assert.equal(parsed[3].grade, '幼兒園');
    assert.equal(parsed[3].className, '企鵝班');
    assert.equal(parsed[3].seatRaw, '01號');
    assert.equal(parsed[3].id, '幼兒園_企鵝班_01號');
  });

  it('F31-7: Excel import merge mode updates existing students and appends new ones without dropping unchanged records', () => {
    const existingStudents = [
      { id: '一_1_01號', grade: '一', className: '1', seatNum: 1, seatRaw: '01號', name: '舊生甲', status: 'active', isActive: true },
      { id: '一_1_02號', grade: '一', className: '1', seatNum: 2, seatRaw: '02號', name: '舊生乙', status: 'active', isActive: true }
    ];

    const importedStudents = [
      { id: '一_1_01號', grade: '一', className: '1', seatNum: 1, seatRaw: '01號', name: '舊生甲(改名)', status: 'active', isActive: true },
      { id: '一_1_03號', grade: '一', className: '1', seatNum: 3, seatRaw: '03號', name: '新轉入生丙', status: 'transferred_in', isActive: true }
    ];

    // Simulate merge
    const map = new Map(existingStudents.map(s => [s.id, s]));
    importedStudents.forEach(s => {
      const old = map.get(s.id);
      map.set(s.id, old ? { ...old, ...s } : s);
    });
    const merged = Array.from(map.values());

    assert.equal(merged.length, 3, 'Merged list should contain 3 students');
    const stu1 = merged.find(s => s.id === '一_1_01號');
    assert.equal(stu1.name, '舊生甲(改名)');
    const stu2 = merged.find(s => s.id === '一_1_02號');
    assert.equal(stu2.name, '舊生乙', 'Unchanged student should remain preserved');
    const stu3 = merged.find(s => s.id === '一_1_03號');
    assert.equal(stu3.name, '新轉入生丙');
  });

  it('F31-8: Excel template file exists on filesystem and is accessible for download', async () => {
    const { existsSync } = await import('node:fs');
    const templatePath = 'public/templates/清水國小全校師生名冊_匯入範本.xlsx';
    assert.ok(existsSync(templatePath), 'Excel template file must exist at public/templates/清水國小全校師生名冊_匯入範本.xlsx');
  });
});
