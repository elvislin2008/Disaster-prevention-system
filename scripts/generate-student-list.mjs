import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SURNAMES = ['林', '陳', '黃', '張', '李', '王', '吳', '劉', '蔡', '楊', '許', '鄭', '謝', '洪', '郭', '邱', '曾', '廖', '賴', '徐', '周', '葉', '蘇', '莊', '江'];
const GIVEN_NAMES = ['宏澤', '雅婷', '家豪', '冠宇', '宇軒', '宗翰', '詩涵', '思婷', '佳穎', '柏翰', '品妤', '子晴', '彥廷', '承翰', '欣妤', '俊傑', '子軒', '佩萱', '欣蓉', '博文', '子翔', '若瑄', '詠晴', '浩宇', '晨睿', '品妍', '宥廷', '恩碩', '予樂', '宥辰'];

function getRandomItem(arr, index) {
  return arr[index % arr.length];
}

function padZero(num) {
  return num < 10 ? `0${num}` : `${num}`;
}

function generatePhone(seed) {
  const p1 = 900 + (seed * 17) % 99;
  const p2 = 100 + (seed * 31) % 899;
  const p3 = 100 + (seed * 53) % 899;
  return `0${p1}-${p2}-${p3}`;
}

const regularGrades = ['一', '二', '三', '四', '五', '六'];
const students = [];
let globalIndex = 1;

// 1. 常態班級: 一至六年級，各 1~15 班，每班 25 人
for (const grade of regularGrades) {
  for (let c = 1; c <= 15; c++) {
    const className = String(c);
    const teacherName = `${getRandomItem(SURNAMES, c * 3 + grade.charCodeAt(0))}老師`;
    const teacherPhone = `0988-${padZero(c * 5)}-${padZero(c * 7 + 10)}`;
    const studentsPerClass = 25;

    for (let s = 1; s <= studentsPerClass; s++) {
      const seatNum = s;
      const seatRaw = `${padZero(s)}號`;
      const name = `${getRandomItem(SURNAMES, globalIndex)}${getRandomItem(GIVEN_NAMES, globalIndex + s)}`;
      const parent = `${name}家長`;
      const phone = generatePhone(globalIndex);
      const classKey = `${grade} ${className}`;
      const studentId = `${grade}_${className}_${seatRaw}`;

      students.push({
        id: studentId,
        grade,
        className,
        seatNum,
        seatRaw,
        name,
        parent,
        phone,
        teacher: teacherName,
        teacherPhone,
        classKey,
        isActive: true
      });
      globalIndex++;
    }
  }
}

// 2. 幼兒園: 親親班 20 人
const kindergartenClass = '親親';
for (let s = 1; s <= 20; s++) {
  const seatNum = s;
  const seatRaw = `${padZero(s)}號`;
  const name = `${getRandomItem(SURNAMES, globalIndex)}${getRandomItem(GIVEN_NAMES, globalIndex + s)}`;
  students.push({
    id: `幼兒園_${kindergartenClass}_${seatRaw}`,
    grade: '幼兒園',
    className: kindergartenClass,
    seatNum,
    seatRaw,
    name,
    parent: `${name}家長`,
    phone: generatePhone(globalIndex),
    teacher: '林幼師',
    teacherPhone: '0988-111-222',
    classKey: `幼兒園 ${kindergartenClass}`,
    isActive: true
  });
  globalIndex++;
}

// 3. 課後班各班
const afterSchoolClasses = [
  '一甲A', '一乙A', '二甲A', '二乙A', '三甲', '中乙',
  '四甲', '四乙', '五甲', '高乙', '六甲', '六乙',
  '一乙B', '二乙B', '星光一', '星光二'
];

for (const cName of afterSchoolClasses) {
  for (let s = 1; s <= 12; s++) {
    const seatNum = s;
    const seatRaw = `${padZero(s)}號`;
    const name = `${getRandomItem(SURNAMES, globalIndex)}${getRandomItem(GIVEN_NAMES, globalIndex + s)}`;
    students.push({
      id: `課後班_${cName}_${seatRaw}`,
      grade: '課後班',
      className: cName,
      seatNum,
      seatRaw,
      name,
      parent: `${name}家長`,
      phone: generatePhone(globalIndex),
      teacher: `${cName}課後師`,
      teacherPhone: '0977-222-333',
      classKey: `課後班 ${cName}`,
      isActive: true
    });
    globalIndex++;
  }
}

// 4. 學習扶助班
const assistClasses = ['學2甲', '學2乙'];
for (const aName of assistClasses) {
  for (let s = 1; s <= 10; s++) {
    const seatNum = s;
    const seatRaw = `${padZero(s)}號`;
    const name = `${getRandomItem(SURNAMES, globalIndex)}${getRandomItem(GIVEN_NAMES, globalIndex + s)}`;
    students.push({
      id: `學習扶助班_${aName}_${seatRaw}`,
      grade: '學習扶助班',
      className: aName,
      seatNum,
      seatRaw,
      name,
      parent: `${name}家長`,
      phone: generatePhone(globalIndex),
      teacher: `${aName}輔導師`,
      teacherPhone: '0966-333-444',
      classKey: `學習扶助班 ${aName}`,
      isActive: true
    });
    globalIndex++;
  }
}

// 5. 緊急應變小組
const emergencyTeam = [
  { className: '指揮官', name: '李校長', phone: '0911-000-001', role: '總指揮官' },
  { className: '通報組', name: '張主任', phone: '0911-000-002', role: '通報組長' },
  { className: '避難引導組', name: '王主任', phone: '0911-000-003', role: '避難引導組長' },
  { className: '安全防護組', name: '陳組長', phone: '0911-000-004', role: '安全防護組長' },
  { className: '緊急救護組', name: '黃校護', phone: '0911-000-005', role: '救護站負責人' }
];

for (let i = 0; i < emergencyTeam.length; i++) {
  const member = emergencyTeam[i];
  const seatNum = i + 1;
  const seatRaw = `${padZero(seatNum)}號`;
  students.push({
    id: `緊急應變小組_${member.className}_${seatRaw}`,
    grade: '緊急應變小組',
    className: member.className,
    seatNum,
    seatRaw,
    name: member.name,
    parent: '清水國小應變中心',
    phone: member.phone,
    teacher: member.name,
    teacherPhone: member.phone,
    classKey: `緊急應變小組 ${member.className}`,
    isActive: true
  });
  globalIndex++;
}

const outDir = path.join(__dirname, 'data');
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

const outFile = path.join(outDir, 'StudentList.json');
fs.writeFileSync(outFile, JSON.stringify(students, null, 2), 'utf8');

console.log(`✅ 已產出 StudentList.json，共 ${students.length} 筆學生與教職員名冊資料。`);
