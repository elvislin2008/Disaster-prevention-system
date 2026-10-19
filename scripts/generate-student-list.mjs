import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as XLSX from 'xlsx';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SURNAMES = [
  '林', '陳', '黃', '張', '李', '王', '吳', '劉', '蔡', '楊',
  '許', '鄭', '謝', '洪', '郭', '邱', '曾', '廖', '賴', '徐',
  '周', '葉', '蘇', '莊', '江', '何', '蕭', '羅', '高', '潘'
];

const GIVEN_NAMES = [
  '宏澤', '雅婷', '家豪', '冠宇', '宇軒', '宗翰', '詩涵', '思婷',
  '佳穎', '柏翰', '品妤', '子晴', '彥廷', '承翰', '欣妤', '俊傑',
  '子軒', '佩萱', '欣蓉', '博文', '子翔', '若瑄', '詠晴', '浩宇',
  '晨睿', '品妍', '宥廷', '恩碩', '予樂', '宥辰', '承恩', '羽彤',
  '安琪', '凱文', '芷晴', '冠廷', '亮宇', '依晨', '語婕', '皓哲'
];

function getRandomItem(arr, index) {
  return arr[Math.abs(index) % arr.length];
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

/**
 * 115學年度全校學生疏散避難情形調查表(上午版本)
 * 精確班級與人數規格配置表 (合計 2,144 人)
 */
const CLASS_SPECS = [
  // 1. 一年級 (11 班, 共 256 人)
  { grade: '一', className: '101', count: 23 },
  { grade: '一', className: '102', count: 23 },
  { grade: '一', className: '103', count: 23 },
  { grade: '一', className: '104', count: 23 },
  { grade: '一', className: '105', count: 22 },
  { grade: '一', className: '106', count: 24 },
  { grade: '一', className: '107', count: 24 },
  { grade: '一', className: '108', count: 24 },
  { grade: '一', className: '109', count: 24 },
  { grade: '一', className: '110', count: 23 },
  { grade: '一', className: '111', count: 23 },

  // 2. 二年級 (10 班, 共 266 人)
  { grade: '二', className: '201', count: 26 },
  { grade: '二', className: '202', count: 28 },
  { grade: '二', className: '203', count: 27 },
  { grade: '二', className: '204', count: 27 },
  { grade: '二', className: '205', count: 25 },
  { grade: '二', className: '206', count: 25 },
  { grade: '二', className: '207', count: 27 },
  { grade: '二', className: '208', count: 28 },
  { grade: '二', className: '209', count: 26 },
  { grade: '二', className: '210', count: 27 },

  // 3. 三年級 (12 班, 共 307 人)
  { grade: '三', className: '301', count: 25 },
  { grade: '三', className: '302', count: 27 },
  { grade: '三', className: '303', count: 25 },
  { grade: '三', className: '304', count: 26 },
  { grade: '三', className: '305', count: 25 },
  { grade: '三', className: '306', count: 25 },
  { grade: '三', className: '307', count: 25 },
  { grade: '三', className: '308', count: 26 },
  { grade: '三', className: '309', count: 25 },
  { grade: '三', className: '310', count: 26 },
  { grade: '三', className: '311', count: 27 },
  { grade: '三', className: '312', count: 25 },

  // 4. 四年級 (13 班, 共 315 人)
  { grade: '四', className: '401', count: 26 },
  { grade: '四', className: '402', count: 25 },
  { grade: '四', className: '403', count: 24 },
  { grade: '四', className: '404', count: 25 },
  { grade: '四', className: '405', count: 24 },
  { grade: '四', className: '406', count: 24 },
  { grade: '四', className: '407', count: 23 },
  { grade: '四', className: '408', count: 24 },
  { grade: '四', className: '409', count: 23 },
  { grade: '四', className: '410', count: 25 },
  { grade: '四', className: '411', count: 25 },
  { grade: '四', className: '412', count: 23 },
  { grade: '四', className: '413', count: 24 },

  // 5. 五年級 (14 班, 共 316 人)
  { grade: '五', className: '501', count: 22 },
  { grade: '五', className: '502', count: 24 },
  { grade: '五', className: '503', count: 22 },
  { grade: '五', className: '504', count: 23 },
  { grade: '五', className: '505', count: 22 },
  { grade: '五', className: '506', count: 22 },
  { grade: '五', className: '507', count: 24 },
  { grade: '五', className: '508', count: 23 },
  { grade: '五', className: '509', count: 24 },
  { grade: '五', className: '510', count: 22 },
  { grade: '五', className: '511', count: 22 },
  { grade: '五', className: '512', count: 22 },
  { grade: '五', className: '513', count: 21 },
  { grade: '五', className: '514', count: 23 },

  // 6. 六年級 (15 班, 共 342 人)
  { grade: '六', className: '601', count: 22 },
  { grade: '六', className: '602', count: 24 },
  { grade: '六', className: '603', count: 24 },
  { grade: '六', className: '604', count: 22 },
  { grade: '六', className: '605', count: 25 },
  { grade: '六', className: '606', count: 23 },
  { grade: '六', className: '607', count: 21 },
  { grade: '六', className: '608', count: 22 },
  { grade: '六', className: '609', count: 23 },
  { grade: '六', className: '610', count: 24 },
  { grade: '六', className: '611', count: 22 },
  { grade: '六', className: '612', count: 22 },
  { grade: '六', className: '613', count: 23 },
  { grade: '六', className: '614', count: 23 },
  { grade: '六', className: '615', count: 22 },

  // 7. 特教班 (3 班, 共 24 人)
  { grade: '特教班', className: '特甲', count: 8 },
  { grade: '特教班', className: '特乙', count: 8 },
  { grade: '特教班', className: '特丙', count: 8 },

  // 8. 幼兒園 (7 班, 共 130 人)
  { grade: '幼兒園', className: '親親班', count: 19 },
  { grade: '幼兒園', className: '甜心班', count: 18 },
  { grade: '幼兒園', className: '寶貝班', count: 19 },
  { grade: '幼兒園', className: '西瓜班', count: 17 },
  { grade: '幼兒園', className: '綿羊班', count: 21 },
  { grade: '幼兒園', className: '白兔班', count: 19 },
  { grade: '幼兒園', className: '蘋果班', count: 17 },

  // 9. 緊急應變小組 / 教職員工 (5 組, 共 188 人)
  { grade: '緊急應變小組', className: '指揮官', count: 1, isStaff: true, leaderTitle: '總指揮官', leaderName: '李校長' },
  { grade: '緊急應變小組', className: '通報組', count: 35, isStaff: true, leaderTitle: '通報組長', leaderName: '張主任' },
  { grade: '緊急應變小組', className: '避難引導組', count: 55, isStaff: true, leaderTitle: '避難引導組長', leaderName: '王主任' },
  { grade: '緊急應變小組', className: '安全防護組', count: 50, isStaff: true, leaderTitle: '安全防護組長', leaderName: '陳組長' },
  { grade: '緊急應變小組', className: '緊急救護組', count: 47, isStaff: true, leaderTitle: '救護站負責人', leaderName: '黃校護' }
];

const students = [];
let globalIndex = 1;

for (let cIdx = 0; cIdx < CLASS_SPECS.length; cIdx++) {
  const spec = CLASS_SPECS[cIdx];
  const isEmergency = spec.grade === '緊急應變小組';
  const isKindergarten = spec.grade === '幼兒園';
  const isSpecial = spec.grade === '特教班';

  // 帶班導師或組長
  let defaultTeacher = `${getRandomItem(SURNAMES, cIdx * 3)}老師`;
  let defaultTeacherPhone = `0988-${padZero((cIdx * 5) % 100)}-${padZero((cIdx * 7 + 10) % 100)}`;
  if (isEmergency) {
    defaultTeacher = spec.leaderName || `${spec.className}組長`;
    defaultTeacherPhone = `0911-000-${padZero(cIdx + 1)}`;
  } else if (isKindergarten) {
    defaultTeacher = `${getRandomItem(SURNAMES, cIdx * 3 + 2)}幼師`;
    defaultTeacherPhone = `0977-111-${padZero((cIdx * 9) % 100)}`;
  } else if (isSpecial) {
    defaultTeacher = `${getRandomItem(SURNAMES, cIdx * 3 + 5)}特師`;
    defaultTeacherPhone = `0966-222-${padZero((cIdx * 11) % 100)}`;
  }

  for (let s = 1; s <= spec.count; s++) {
    const seatNum = s;
    const seatRaw = `${padZero(s)}號`;
    let name;
    let parent;
    let phone;
    let teacher = defaultTeacher;
    let teacherPhone = defaultTeacherPhone;

    if (isEmergency) {
      if (s === 1 && spec.leaderName) {
        name = spec.leaderName;
      } else {
        name = `${getRandomItem(SURNAMES, globalIndex)}${getRandomItem(GIVEN_NAMES, globalIndex + s)}`;
      }
      parent = '清水國小應變中心';
      phone = `0911-${padZero(cIdx * 10 + Math.floor(s / 10))}-${padZero(s % 100)}`;
      teacher = name;
      teacherPhone = phone;
    } else {
      name = `${getRandomItem(SURNAMES, globalIndex)}${getRandomItem(GIVEN_NAMES, globalIndex + s)}`;
      parent = `${name}家長`;
      phone = generatePhone(globalIndex);
    }

    const classKey = `${spec.grade} ${spec.className}`;
    const studentId = `${spec.grade}_${spec.className}_${seatRaw}`;

    students.push({
      id: studentId,
      grade: spec.grade,
      className: spec.className,
      seatNum,
      seatRaw,
      name,
      parent,
      phone,
      teacher,
      teacherPhone,
      classKey,
      status: 'active',
      isActive: true
    });

    globalIndex++;
  }
}

// 輸出目標目錄
const outDir = path.join(__dirname, 'data');
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

// 1. 輸出 JSON (scripts/data/StudentList.json)
const jsonOutFile = path.join(outDir, 'StudentList.json');
fs.writeFileSync(jsonOutFile, JSON.stringify(students, null, 2), 'utf8');

// 2. 輸出 CSV (scripts/data/StudentList.csv)
const csvHeader = '群組類別,班別名稱,座號,姓名,家長姓名,家長電話,帶班導師,導師電話,在籍狀態\n';
const csvRows = students.map(s => {
  return `"${s.grade}","${s.className}","${s.seatRaw}","${s.name}","${s.parent}","${s.phone}","${s.teacher}","${s.teacherPhone}","在籍"`;
}).join('\n');
const csvOutFile = path.join(outDir, 'StudentList.csv');
fs.writeFileSync(csvOutFile, '\uFEFF' + csvHeader + csvRows, 'utf8');

// 3. 輸出範本檔到 public/templates/
const templateDir = path.join(__dirname, '..', 'public', 'templates');
if (!fs.existsSync(templateDir)) {
  fs.mkdirSync(templateDir, { recursive: true });
}

// A. 範本 CSV
const templateCsvPath = path.join(templateDir, '清水國小全校師生名冊_匯入範本.csv');
fs.writeFileSync(templateCsvPath, '\uFEFF' + csvHeader + csvRows, 'utf8');

// B. 範本 XLSX (使用 xlsx 套件產出標準 Excel 活頁簿)
const xlsxData = [
  ['群組類別', '班別名稱', '座號', '姓名', '家長姓名', '家長電話', '帶班導師', '導師電話', '在籍狀態']
];
students.forEach(s => {
  xlsxData.push([
    s.grade,
    s.className,
    s.seatRaw,
    s.name,
    s.parent,
    s.phone,
    s.teacher,
    s.teacherPhone,
    '在籍'
  ]);
});
const wb = XLSX.utils.book_new();
const ws = XLSX.utils.aoa_to_sheet(xlsxData);
ws['!cols'] = [
  { wch: 12 }, { wch: 10 }, { wch: 8 }, { wch: 12 },
  { wch: 14 }, { wch: 15 }, { wch: 14 }, { wch: 15 }, { wch: 10 }
];
XLSX.utils.book_append_sheet(wb, ws, '全校名冊');
const templateXlsxPath = path.join(templateDir, '清水國小全校師生名冊_匯入範本.xlsx');
XLSX.writeFile(wb, templateXlsxPath);

// 統計資訊驗算與印出
const gradeCounts = {};
students.forEach(s => {
  gradeCounts[s.grade] = (gradeCounts[s.grade] || 0) + 1;
});

console.log('='.repeat(70));
console.log('🏫 115學年度全校學生疏散避難情形名冊產出報告');
console.log('='.repeat(70));
console.log(`總班級 / 組別數：${CLASS_SPECS.length} 班`);
console.log(`全校名冊總人數：${students.length} 人 (預期目標：2,144 人)`);
console.log('-'.repeat(70));
for (const [grade, count] of Object.entries(gradeCounts)) {
  console.log(`- ${grade.padEnd(8, ' ')}: ${String(count).padStart(4, ' ')} 人`);
}
console.log('='.repeat(70));
console.log(`✅ 已寫入：${jsonOutFile}`);
console.log(`✅ 已寫入：${csvOutFile}`);
console.log(`✅ 已寫入：${templateCsvPath}`);
console.log(`✅ 已寫入：${templateXlsxPath}`);
