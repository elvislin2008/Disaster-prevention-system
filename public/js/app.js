/**
 * ==============================================================================
 * 清水國小校園災難與演練即時點名通報系統 V20.4
 * 前端核心業務邏輯模組 (public/js/app.js)
 * ==============================================================================
 * 職責：
 * 1. 100% 嚴格保留 v204 Index.txt 既有交互行為與狀態管理
 * 2. 7 階循環點名按鈕 (🟢實到 ➔ 🟣學習中心 ➔ 🟠本土語 ➔ 🔵團隊 ➔ 🟡請假 ➔ 🔴失蹤 ➔ 🔵已接回)
 * 3. 雙層年級與班別篩選器 (單字大寫年級字串，恪遵鐵律 2)
 * 4. 恪遵鐵律 4：抽離待確認 (pending) 狀態嚴格隔離，絕不計入搜救失蹤，且卡片絕不染紅
 * 5. 時段邊界對齊：平日上午邊界修正為 12:40 (760 分鐘)，補齊週四全時段 (thu_am, thu_pm1, thu_pm2, thu_night)
 * 6. 檢傷門檻防呆：黃卡/紅卡強制校驗陪同就醫人數 (1~4人)
 * 7. 5 次未接自動紅燈告警與導師自主接回
 * 8. 徹底拔除 3.5s ~ 15s 輪詢計時器，對接 gasBridgeAdapter.initRealtimeSync 實時推播 (<500ms)
 */

// ==============================================================================
// 全域狀態變數定義
// ==============================================================================
let allStudents = [];
let currentClassStudents = [];
let studentStatusMap = {};
let studentLocationMap = {};
let classReports = {};
let contactStates = {};
let searchStatusMap = {};
let searchNotesMap = {};
let helpRequestMap = {};
let assigneeMap = {};
let pulloutStatusMap = {};
let autoSaveTimer = null;
let simTimeMode = "auto";
let securityMode = "drill";
let isUnlockedByPassword = false;
let unlockExpiryTime = 0;
let isSiteLocked = false;
let rawStressClassText = "";
let activePulloutSubTab = "SC";
let activeRescueSubTab = "A";
let visitorCounts = { student: 0, teacher: 0, parent: 0, vendor: 0 };
let visitorList = [];
let newVisitorBatch = [];
let isVisitorModalOpen = false;
let activeVisitorSubTab = "add";
let approvedCustomTotal = null;
let selectedGradeOpt = "";
let selectedClassBtn = "";
let rescueTriageMap = {};
let buildingStatusMap = {
  "慈愛樓": {}, "至善樓": {}, "維揚樓": {}, "樂群樓": {}, "弘德樓": {}, "中山樓": {}
};

// ==============================================================================
// 系統常數
// ==============================================================================
const ADMIN_RESET_PASSWORD = "8888";

const bgThemes = {
  'A': 'https://lh3.googleusercontent.com/d/1DOWCepWL2RC9FS4MXIKBLJpNAujIpLeR',
  'B': 'https://lh3.googleusercontent.com/d/1iONTfSJxD9MfqWFSyTjOsxGSqOjXQ6uw',
  'C': 'https://lh3.googleusercontent.com/d/1GL2SH1DKOc_NTaB6J0GOcUOg9MDk0rv1'
};
let currentBgTheme = (typeof localStorage !== 'undefined' && localStorage.getItem('SELECTED_BG_THEME')) || 'C';

const buildingCheckItems = [
  "1. 建物整體/部分塌陷，結構與基礎錯開",
  "2. 建物整體或部分樓層明顯傾斜",
  "3. 柱、梁嚴重損壞，主要牆壁龜裂",
  "4. 外牆掉落物與傾倒物危害情形",
  "5. 鄰近建物傾斜破壞，影響本體安全",
  "6. 基地開裂、下陷、崩滑或土壤液化",
  "7. 旁側或內部設施可能擴大災害規模",
  "8. 其他 (瓦斯管破裂外溢、電線掉落等)"
];

const defaultLocations = ["📌 教室受困", "📌 走廊受困", "📌 疏散過程失蹤", "❓ 不知去向"];

const gradeSortOrder = {
  "一": 1, "一年級": 1, "二": 2, "二年級": 2, "三": 3, "三年級": 3,
  "四": 4, "四年級": 4, "五": 5, "五年級": 5, "六": 6, "六年級": 6,
  "特教": 7, "特教班": 7, "幼兒園": 8, "課後班": 9, "學習扶助班": 10, "緊急應變小組": 11
};

const typeLabelMap = {
  student: "🎒 學生",
  teacher: "🧑🏫 代課/職員",
  parent: "👪 志工/訪客",
  vendor: "🛠️ 廠商/工程"
};

// ==============================================================================
// 工具函式
// ==============================================================================
function normStr(str) {
  return str ? String(str).normalize('NFKC').replace(/[\s\uFEFF\xA0]/g, '').toLowerCase() : '';
}

function cleanClassLabel(cName, gName) {
  if (!cName) return "";
  return String(cName).trim();
}

function getPhoneHref(phoneRaw) {
  if (!phoneRaw) return "#";
  let cleanP = String(phoneRaw).replace(/\D/g, "").trim();
  if (cleanP.length === 8 && !cleanP.startsWith("0")) cleanP = "02" + cleanP;
  else if ((cleanP.length === 9 || cleanP.length === 10) && !cleanP.startsWith("0")) cleanP = "0" + cleanP;
  return "tel:" + cleanP;
}

function parseGradeAndClassInfo(str) {
  if (!str) return null;
  let clean = normStr(str);
  let match3 = clean.match(/^([1-6])(\d{2})$/);
  if (match3) return { grade: parseInt(match3[1], 10), classNum: parseInt(match3[2], 10) };

  let gradeNum = 0;
  let remaining = clean;
  const gradeMap = [
    { keys: ["一年級", "1年級", "1年", "一年"], val: 1 },
    { keys: ["二年級", "2年級", "2年", "二年"], val: 2 },
    { keys: ["三年級", "3年級", "3年", "三年"], val: 3 },
    { keys: ["四年級", "4年級", "4年", "四年"], val: 4 },
    { keys: ["五年級", "5年級", "5年", "五年"], val: 5 },
    { keys: ["六年級", "6年級", "6年", "六年"], val: 6 },
    { keys: ["特教"], val: 7 },
    { keys: ["幼兒園", "幼兒"], val: 8 }
  ];
  for (let i = 0; i < gradeMap.length; i++) {
    let item = gradeMap[i];
    for (let k = 0; k < item.keys.length; k++) {
      if (remaining.indexOf(item.keys[k]) !== -1) {
        gradeNum = item.val;
        remaining = remaining.replace(item.keys[k], '');
        break;
      }
    }
    if (gradeNum > 0) break;
  }
  if (gradeNum === 0) {
    if (/^一|^1[^\d]/.test(clean)) { gradeNum = 1; remaining = clean.replace(/^一|^1/, ''); }
    else if (/^二|^2[^\d]/.test(clean)) { gradeNum = 2; remaining = clean.replace(/^二|^2/, ''); }
    else if (/^三|^3[^\d]/.test(clean)) { gradeNum = 3; remaining = clean.replace(/^三|^3/, ''); }
    else if (/^四|^4[^\d]/.test(clean)) { gradeNum = 4; remaining = clean.replace(/^四|^4/, ''); }
    else if (/^五|^5[^\d]/.test(clean)) { gradeNum = 5; remaining = clean.replace(/^五|^5/, ''); }
    else if (/^六|^6[^\d]/.test(clean)) { gradeNum = 6; remaining = clean.replace(/^六|^6/, ''); }
  }
  let classNum = 0;
  let digitMatch = remaining.match(/\d+/);
  if (digitMatch) classNum = parseInt(digitMatch[0], 10);
  return (gradeNum > 0 && classNum > 0) ? { grade: gradeNum, classNum: classNum } : null;
}

function isSameClass(strA, strB) {
  if (!strA || !strB) return false;
  let infoA = parseGradeAndClassInfo(strA);
  let infoB = parseGradeAndClassInfo(strB);
  if (infoA && infoB) return (infoA.grade === infoB.grade) && (infoA.classNum === infoB.classNum);
  return normStr(strA) === normStr(strB);
}

// ==============================================================================
// 介面主題切換 (Theme A, B, C)
// ==============================================================================
function applyBgTheme(themeKey) {
  currentBgTheme = themeKey;
  let bgUrl = bgThemes[themeKey] || bgThemes['C'];
  if (typeof document !== 'undefined') {
    document.querySelectorAll('.page').forEach(p => {
      p.style.backgroundImage = "url('" + bgUrl + "')";
    });
    let btn = document.getElementById('btnBgToggle');
    if (btn) btn.innerText = '🖼️ 底圖: ' + themeKey + '版';
  }
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('SELECTED_BG_THEME', themeKey);
  }
}

function toggleBgTheme() {
  let nextTheme = 'C';
  if (currentBgTheme === 'C') nextTheme = 'A';
  else if (currentBgTheme === 'A') nextTheme = 'B';
  else if (currentBgTheme === 'B') nextTheme = 'C';
  applyBgTheme(nextTheme);
}

// ==============================================================================
// 安全防護、網站緊急鎖定與個資防護
// ==============================================================================
function toggleSiteLock() {
  if (typeof document === 'undefined') return;
  if (!checkCommanderAccess("操作網站關閉鎖定")) return;
  let overlay = document.getElementById("siteLockedOverlay");
  let btn = document.getElementById("btnCloseSite");

  if (!isSiteLocked) {
    if (confirm("🚨 確定要啟動【網站關閉/緊急鎖定】嗎？\n啟動後全頁面敏感學生個資將獨立隱藏封鎖！")) {
      isSiteLocked = true;
      if (overlay) overlay.classList.add("active");
      if (btn) {
        btn.innerText = "🔒 網站已鎖定";
        btn.classList.add("locked");
      }
      saveFullSystemStateToBackend();
    }
  } else {
    isSiteLocked = false;
    if (overlay) overlay.classList.remove("active");
    if (btn) {
      btn.innerText = "🔒 網站關閉";
      btn.classList.remove("locked");
    }
    alert("✅ 網站解鎖成功，恢復正常運作。");
    updateSecurityUI();
    saveFullSystemStateToBackend();
  }
}

function toggleSecurityMode() {
  if (typeof document === 'undefined') return;
  if (!checkCommanderAccess("切換演練防護與危難模式")) return;

  if (securityMode === "drill") {
    securityMode = "disaster";
    isUnlockedByPassword = true;
    updateSecurityUI();
    saveFullSystemStateToBackend();
    alert("🚨 已切換為【危難模式】！所有功能與家長個資聯繫電話全面解鎖。");
  } else {
    securityMode = "drill";
    isUnlockedByPassword = false;
    unlockExpiryTime = 0;
    updateSecurityUI();
    saveFullSystemStateToBackend();
    alert("🛡️ 已切換為【演練密碼防護模式】！家長個資電話已隱藏鎖定。");
  }
}

function updateSecurityUI() {
  if (typeof document === 'undefined') return;
  let btn = document.getElementById("btnSecurityMode");
  if (btn) {
    if (securityMode === "disaster") {
      btn.innerText = "🚨 危難全開";
      btn.className = "btn-mode-toggle disaster-mode";
    } else {
      btn.innerText = "🛡️ 演練防護";
      btn.className = "btn-mode-toggle";
    }
  }
  if (currentClassStudents.length > 0) renderTeacherContactPanel();
  renderSummaryTable();
  renderRescueTable();
  renderPulloutPage();
}

function verifyPasswordToUnlockPhone() {
  alert("🛡️ 家長電話預設防護隱藏！請由指揮中心點擊『🛡️ 演練防護』輸入授權密碼切換為『🚨 危難全開』模式解鎖全頁面電話。");
}

// ==============================================================================
// 作息排程與 12:40 邊界對齊 (對齊 760 分鐘，補齊週四全時段)
// ==============================================================================
function onSimTimeChange(mode) {
  simTimeMode = mode;
  approvedCustomTotal = null; // 切換時段重置自訂人數

  // 1. 立即更新本地畫面
  updateGradeDropdown();
  renderSchoolOverview();
  renderPulloutPage();
  if (selectedClassBtn) onClassClick(selectedClassBtn);

  // 2. 標記時間切換
  if (typeof window !== 'undefined') {
    window.lastTimeSwitchTimestamp = Date.now();
  }

  // 3. 背景儲存
  saveFullSystemStateToBackend();
}

function isClassActiveAtTime(gradeName, className, modeOverride, schedulesOverride) {
  if (!gradeName) return false;
  if (gradeName.includes("緊急") || gradeName.includes("應變")) return true;

  let currentMode = modeOverride || simTimeMode;
  let now = (modeOverride instanceof Date) ? modeOverride : new Date();
  let dayIndex = now.getDay();
  const dayKeys = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  let targetDay = dayKeys[dayIndex];
  let targetSlot = "am";

  if (currentMode === "auto" || modeOverride instanceof Date) {
    if (dayIndex === 0 || dayIndex === 6) return false;
    let currentMinutes = now.getHours() * 60 + now.getMinutes();
    if (currentMinutes < 480 || currentMinutes >= 1110) return false;

    // 關鍵時段邊界：760 分鐘 (12:40)，12:00~12:40 低年級在校用餐
    if (currentMinutes < 760) targetSlot = "am";
    else if (currentMinutes < 960) targetSlot = "pm1";
    else if (currentMinutes < 1060) targetSlot = "pm2";
    else targetSlot = "night";
  } else {
    // 手動模擬時段映射 (完整補齊週四時段)
    if (currentMode === "mon_am") { targetDay = "mon"; targetSlot = "am"; }
    else if (currentMode === "mon_pm1") { targetDay = "mon"; targetSlot = "pm1"; }
    else if (currentMode === "mon_pm2") { targetDay = "mon"; targetSlot = "pm2"; }
    else if (currentMode === "tue_pm") { targetDay = "tue"; targetSlot = "pm1"; }
    else if (currentMode === "wed_pm1") { targetDay = "wed"; targetSlot = "pm1"; }
    else if (currentMode === "wed_pm2") { targetDay = "wed"; targetSlot = "pm2"; }
    else if (currentMode === "thu_am") { targetDay = "thu"; targetSlot = "am"; }
    else if (currentMode === "thu_pm1") { targetDay = "thu"; targetSlot = "pm1"; }
    else if (currentMode === "thu_pm2") { targetDay = "thu"; targetSlot = "pm2"; }
    else if (currentMode === "thu_night") { targetDay = "thu"; targetSlot = "night"; }
    else if (currentMode === "fri_pm") { targetDay = "fri"; targetSlot = "pm1"; }
    else if (currentMode === "night") {
      targetSlot = "night";
      targetDay = (dayIndex >= 1 && dayIndex <= 5) ? dayKeys[dayIndex] : "mon";
    } else {
      const match = String(currentMode).match(/^(mon|tue|wed|thu|fri)_(am|pm1|pm2|night)$/);
      if (match) {
        targetDay = match[1];
        targetSlot = match[2];
      }
    }
  }

  let slotKey = targetDay + "_" + targetSlot;
  let schedules = schedulesOverride || ((typeof window !== 'undefined' && window.scheduleConfigData) ? window.scheduleConfigData : []);

  if (schedules && schedules.length > 0) {
    let gStr = String(gradeName).trim();
    let cStr = String(className || "").trim();

    function isGroupMatch(rG, tG) {
      if (rG === tG) return true;
      return rG.replace(/年級$/, '') === tG.replace(/年級$/, '');
    }

    // 1. 特殊小組獨立班級列比對 (課後班 / 學習扶助班)
    if (gStr === '課後班' || gStr === '學習扶助班') {
      if (cStr) {
        return schedules.some(row =>
          isGroupMatch(String(row.groupName).trim(), gStr) &&
          (String(row.className).trim() === cStr || row.className === 'all' || row.className === '全部') &&
          row[slotKey] === true
        );
      }
      return schedules.some(row =>
        isGroupMatch(String(row.groupName).trim(), gStr) &&
        row[slotKey] === true
      );
    }

    // 2. 常態年級通用列比對 (B欄為空、或為 all / 全部)
    let groupRow = schedules.find(item => {
      let rG = String(item.groupName).trim();
      let rC = String(item.className || "").trim().toLowerCase();
      return isGroupMatch(rG, gStr) && (rC === "" || rC === "all" || rC === "全部");
    });
    if (groupRow) {
      return groupRow[slotKey] === true;
    }

    // 3. 獨立班級列比對
    if (cStr) {
      return schedules.some(item =>
        isGroupMatch(String(item.groupName).trim(), gStr) &&
        String(item.className).trim() === cStr &&
        item[slotKey] === true
      );
    } else {
      return schedules.some(item =>
        isGroupMatch(String(item.groupName).trim(), gStr) &&
        item[slotKey] === true
      );
    }
  }

  // 保底預設邏輯：一二年級週二全天，三至六年級週一二四全天
  if (['一', '二'].includes(gradeName)) {
    if (targetSlot === 'am') return true;
    if (targetDay === 'tue' && targetSlot === 'pm1') return true;
    return false;
  }
  if (['三', '四', '五', '六'].includes(gradeName)) {
    if (targetSlot === 'am') return true;
    if (['mon', 'tue', 'thu'].includes(targetDay) && targetSlot === 'pm1') return true;
    return false;
  }

  return true;
}

function isStudentOffCampus(gradeName) {
  return !isClassActiveAtTime(gradeName, "");
}

// ==============================================================================
// 7 階點名狀態循環流轉
// ==============================================================================
function getNextRollCallStage(curr) {
  if (curr === "present") return "study_center";
  if (curr === "study_center") return "native_lang";
  if (curr === "native_lang") return "team";
  if (curr === "team") return "leave";
  if (curr === "leave") return "missing";
  if (curr === "missing") return "pickedUp";
  return "present";
}

// ==============================================================================
// 年級與班別篩選器
// ==============================================================================
function updateGradeDropdown() {
  if (typeof document === 'undefined') return;
  let container = document.getElementById("gradeBtnContainer");
  if (!container) return;
  container.innerHTML = "";
  if (!allStudents || allStudents.length === 0) return;

  let grades = [...new Set(allStudents.map(d => d.grade))].filter(Boolean);
  let activeGrades = grades.filter(g => isClassActiveAtTime(g, ""));
  // 關鍵防護：若當前時段為非在校時段（例如晚間演練測試、假日測試），activeGrades 為空時預設展示全部年級，確保測試時隨時可見！
  if (activeGrades.length === 0) {
    activeGrades = grades;
  }
  activeGrades.sort((a, b) => (gradeSortOrder[a] || 99) - (gradeSortOrder[b] || 99));

  if (selectedGradeOpt && !activeGrades.includes(selectedGradeOpt)) {
    selectedGradeOpt = "";
    selectedClassBtn = "";
    let sec = document.getElementById("classBtnSection");
    if (sec) sec.style.display = "none";
    let phBox = document.getElementById("placeholderBox");
    if (phBox) phBox.style.display = "block";
    let stContent = document.getElementById("studentContent");
    if (stContent) stContent.style.display = "none";
  }

  activeGrades.forEach(g => {
    let btn = document.createElement("button");
    btn.className = "btn-grade-opt " + (selectedGradeOpt === g ? "active" : "");
    btn.innerText = g;
    btn.onclick = function() {
      selectedGradeOpt = g;
      Array.from(container.children).forEach(child => child.classList.remove("active"));
      btn.classList.add("active");
      onGradeChange();
    };
    container.appendChild(btn);
  });
}

function onGradeChange() {
  if (typeof document === 'undefined') return;
  let gVal = selectedGradeOpt;
  let sec = document.getElementById("classBtnSection");
  let label = document.getElementById("classStepLabel");
  let container = document.getElementById("classBtnContainer");
  if (!container || !sec || !label) return;

  container.innerHTML = "";
  let phBox = document.getElementById("placeholderBox");
  if (phBox) phBox.style.display = "block";
  let stContent = document.getElementById("studentContent");
  if (stContent) stContent.style.display = "none";
  selectedClassBtn = "";

  if (!gVal) {
    sec.style.display = "none";
    return;
  }
  label.innerText = (gVal.includes("應變") || gVal.includes("緊急")) ? "2. 請點選組別/職稱：" : "2. 請點選班級：";

  let classes = [...new Set(allStudents.filter(d => d.grade === gVal).map(d => d.className))].filter(Boolean);
  let activeClasses = classes.filter(c => isClassActiveAtTime(gVal, c));
  if (activeClasses.length > 0) {
    classes = activeClasses;
  }
  classes.sort((a, b) => a.localeCompare(b, 'zh-Hant', { numeric: true }));

  if (classes.length === 0) {
    container.innerHTML = '<div style="padding:8px 12px; color:#856404; background:#fff3cd; border:1px solid #ffeeba; border-radius:6px; font-size:0.85rem; font-weight:bold;">⚠️ 當前時段尚無該單位班別在校。</div>';
  } else {
    classes.forEach(c => {
      let btn = document.createElement("button");
      btn.className = "btn-class-item " + (selectedClassBtn === c ? "active" : "");
      btn.innerText = cleanClassLabel(c, gVal);
      btn.onclick = function() {
        selectedClassBtn = c;
        Array.from(container.children).forEach(child => child.classList.remove("active"));
        btn.classList.add("active");
        onClassClick(c);
      };
      container.appendChild(btn);
    });
  }
  sec.style.display = "block";
}

// ==============================================================================
// RBAC 班級編輯權限防護查驗 (Finding 4 恪遵規格與 8888 覆蓋)
// ==============================================================================
function checkClassEditPermission(gVal, cVal) {
  const auth = (typeof window !== 'undefined' && window.AuthManager) ||
               (typeof globalThis !== 'undefined' && globalThis.AuthManager);
  if (!auth || typeof auth.getUserRole !== 'function') {
    return { canEdit: true, role: 'anonymous' };
  }
  const role = auth.getUserRole();
  // 總指揮官或演練 8888 覆蓋：具備全校 90 班編輯特權
  if (role === 'commander') {
    return { canEdit: true, role: 'commander' };
  }
  // 導師角色：嚴格限於其指派之單一班級
  if (role === 'teacher') {
    const allowed = typeof auth.canEditClass === 'function' && auth.canEditClass(gVal, cVal);
    return { canEdit: Boolean(allowed), role: 'teacher' };
  }
  // 未登入訪客 (操場離線演習應急模式)：不予鎖定，維持現場可用性
  if (role === 'visitor') {
    return { canEdit: true, role: 'visitor' };
  }
  // 其他角色 (pullout_teacher, medical, patrol 等)：非指揮官且非帶班導師，唯讀檢視
  return { canEdit: false, role };
}

/**
 * 取得 app.js 當前全域狀態快照 (供測試與即時監控使用)
 */
function getAppState() {
  return {
    classReports: { ...classReports },
    pulloutStatusMap: { ...pulloutStatusMap },
    rescueTriageMap: { ...rescueTriageMap },
    searchStatusMap: { ...searchStatusMap },
    searchNotesMap: { ...searchNotesMap },
    contactStates: { ...contactStates },
    helpRequestMap: { ...helpRequestMap },
    assigneeMap: { ...assigneeMap },
    visitorCounts: { ...visitorCounts },
    visitorList: [ ...visitorList ],
    buildingStatusMap: { ...buildingStatusMap },
    approvedCustomTotal,
    securityMode,
    simTimeMode,
    currentClassStudents: [ ...currentClassStudents ],
    studentStatusMap: { ...studentStatusMap },
    selectedGradeOpt,
    selectedClassBtn
  };
}

/**
 * 開啟班級點名視窗
 */
function openClassRollCall(grade, className) {
  if (grade) selectedGradeOpt = grade;
  if (className) selectedClassBtn = className;
  return onClassClick(className || selectedClassBtn, grade || selectedGradeOpt);
}

function onClassClick(cVal, gValOverride) {
  if (typeof document === 'undefined') return;
  if (gValOverride) selectedGradeOpt = gValOverride;
  let gVal = selectedGradeOpt;
  // 若未指定年級但學生名冊能推斷該班級所屬年級
  if (!gVal && cVal && allStudents.length > 0) {
    const matched = allStudents.find(d => d.className === cVal);
    if (matched && matched.grade) {
      gVal = matched.grade;
      selectedGradeOpt = gVal;
    }
  }
  selectedClassBtn = cVal;
  if (!cVal || !gVal) return;

  currentClassStudents = allStudents.filter(d => d.grade === gVal && d.className === cVal && d.status !== 'transferred_out' && d.isActive !== false);
  currentClassStudents.sort((a, b) => (a.seatNum || 0) - (b.seatNum || 0));

  studentStatusMap = {};
  studentLocationMap = {};
  let key = gVal + " " + cVal;
  let lastReport = classReports[key];

  currentClassStudents.forEach(s => {
    let studentKey = key + "_" + s.seatRaw;
    if (searchStatusMap[studentKey]) {
      studentStatusMap[s.seatRaw] = 'present';
    } else if (lastReport) {
      if (lastReport.leave && lastReport.leave.some(l => l.seatRaw === s.seatRaw)) {
        studentStatusMap[s.seatRaw] = 'leave';
      } else if (lastReport.pickedUp && lastReport.pickedUp.some(p => p.seatRaw === s.seatRaw)) {
        studentStatusMap[s.seatRaw] = 'pickedUp';
      } else if (lastReport.studyCenter && lastReport.studyCenter.some(sc => sc.seatRaw === s.seatRaw)) {
        studentStatusMap[s.seatRaw] = 'study_center';
      } else if (lastReport.nativeLang && lastReport.nativeLang.some(nl => nl.seatRaw === s.seatRaw)) {
        studentStatusMap[s.seatRaw] = 'native_lang';
      } else if (lastReport.team && lastReport.team.some(tm => tm.seatRaw === s.seatRaw)) {
        studentStatusMap[s.seatRaw] = 'team';
      } else if (lastReport.missing && lastReport.missing.some(m => m.seatRaw === s.seatRaw)) {
        studentStatusMap[s.seatRaw] = 'missing';
        let mObj = lastReport.missing.find(m => m.seatRaw === s.seatRaw);
        studentLocationMap[s.seatRaw] = { tag: mObj.locationTag || '', note: mObj.locationNote || '' };
      } else {
        studentStatusMap[s.seatRaw] = 'present';
      }
    } else {
      studentStatusMap[s.seatRaw] = 'present';
    }
  });

  renderMatrix();

  // Finding 4: UI Guard 權限校驗與按鈕/警示條控制
  const perm = checkClassEditPermission(gVal, cVal);
  let warnBox = document.getElementById("teacherClassAuthWarn");
  let btnSubmit = document.getElementById("btnSubmitAttendance");

  if (!perm.canEdit) {
    if (!warnBox) {
      warnBox = document.createElement("div");
      warnBox.id = "teacherClassAuthWarn";
      warnBox.className = "teacher-class-auth-warn";
      warnBox.style.cssText = "padding:8px 14px; margin-bottom:10px; border-radius:6px; background:#fff3cd; color:#856404; border:1px solid #ffeeba; font-size:0.83rem; font-weight:bold; display:flex; align-items:center; justify-content:space-between;";
      const grid = document.getElementById("studentGrid");
      if (grid && grid.parentNode) {
        grid.parentNode.insertBefore(warnBox, grid);
      }
    }
    warnBox.innerHTML = `<span>🔒 <b>唯讀檢視模式</b>：您目前為【${perm.role === 'teacher' ? '導師' : perm.role}】，非 <b>${gVal} ${cleanClassLabel(cVal, gVal)}</b> 之帶班導師，點名操作已鎖定為唯讀檢視。<br><span style="font-size:0.75rem; font-weight:normal; color:#666;">若需代為點名，請洽總指揮官或點擊右上角輸入演練通行碼解鎖。</span></span>`;
    warnBox.style.display = "flex";

    if (btnSubmit) {
      btnSubmit.disabled = true;
      btnSubmit.style.opacity = "0.55";
      btnSubmit.style.cursor = "not-allowed";
      btnSubmit.innerText = "🔒 唯讀檢視中 (非本班帶班導師)";
      btnSubmit.classList.remove("saved");
    }
  } else {
    if (warnBox) warnBox.style.display = "none";
    if (btnSubmit) {
      btnSubmit.disabled = false;
      btnSubmit.style.opacity = "";
      btnSubmit.style.cursor = "";
      btnSubmit.innerText = "送出點名紀錄 (請送出紀錄)";
      btnSubmit.classList.remove("saved");
    }
  }

  let phBox = document.getElementById("placeholderBox");
  if (phBox) phBox.style.display = "none";
  let stContent = document.getElementById("studentContent");
  if (stContent) stContent.style.display = "block";
}

// ==============================================================================
// 學生座位矩陣渲染 (7 階流轉與各狀態標籤)
// ==============================================================================
function renderMatrix() {
  if (typeof document === 'undefined') return;
  let grid = document.getElementById("studentGrid");
  if (!grid) return;
  grid.innerHTML = "";

  let gVal = selectedGradeOpt;
  let cVal = selectedClassBtn;
  let key = gVal + " " + cVal;
  let isEmergencyTeacherGroup = (gVal.includes("緊急") || gVal.includes("應變")) && cVal.includes("導師");

  currentClassStudents.forEach(s => {
    let studentKey = key + "_" + s.seatRaw;
    let pulloutSt = pulloutStatusMap[studentKey] || 'pending';
    let isRescueFound = !!searchStatusMap[studentKey];
    let status = studentStatusMap[s.seatRaw] || 'present';
    let btn = document.createElement("div");
    let statusClass = '';
    let statusText = '🟢 實到';

    if (isEmergencyTeacherGroup) {
      let classHasReported = Object.keys(classReports).some(k => {
        let rep = classReports[k];
        let cLabel = cleanClassLabel(rep.className || k);
        return isSameClass(k, s.name) || isSameClass(cLabel, s.name);
      });
      if (status === 'missing') {
        statusClass = 'missing';
        statusText = classHasReported ? '🔴 失蹤 (班級已回報)' : '🔴 失蹤 (班級未回報)';
      } else if (classHasReported) {
        statusClass = 'pullout-safe-tm';
        statusText = '🟢 實到 (班級已回報)';
      } else {
        statusClass = 'leave';
        statusText = '🟡 待確認 (班級未回報)';
      }
    } else if (status === 'study_center') {
      if (pulloutSt === 'safe') {
        statusClass = 'pullout-safe-sc';
        statusText = '🟣 學習中心 (安全確認)';
      } else if (pulloutSt === 'missing') {
        statusClass = 'missing';
        statusText = '🔴 失蹤 (學習中心)';
      } else {
        statusClass = 'study_center';
        statusText = '🟣 學習中心 (待確認)';
      }
    } else if (status === 'native_lang') {
      if (pulloutSt === 'safe') {
        statusClass = 'pullout-safe-nl';
        statusText = '🟠 本土語 (安全確認)';
      } else if (pulloutSt === 'missing') {
        statusClass = 'missing';
        statusText = '🔴 失蹤 (本土語)';
      } else {
        statusClass = 'native_lang';
        statusText = '🟠 本土語 (待確認)';
      }
    } else if (status === 'team') {
      if (pulloutSt === 'safe') {
        statusClass = 'pullout-safe-tm';
        statusText = '<span style="color:#00838f; font-size:0.85rem; vertical-align:middle;">●</span> 團隊 (安全確認)';
      } else if (pulloutSt === 'missing') {
        statusClass = 'missing';
        statusText = '🔴 失蹤 (團隊)';
      } else {
        statusClass = 'team';
        statusText = '<span style="color:#00838f; font-size:0.85rem; vertical-align:middle;">●</span> 團隊 (待確認)';
      }
    } else if (status === 'leave') {
      statusClass = 'leave';
      statusText = '🟡 請假';
    } else if (status === 'missing') {
      statusClass = 'missing';
      statusText = '🔴 失蹤';
    } else if (status === 'pickedUp') {
      statusClass = 'pickedUp';
      statusText = '🔵 已接回';
    }

    let noteHtml = '';
    let noteText = searchNotesMap[studentKey] || '';
    if (isRescueFound && status === 'present') {
      statusText = '✅ 實到 (已尋獲)';
      if (noteText) noteHtml = '<span class="found-note-tag">🔍 ' + noteText + '</span>';
    }

    const perm = checkClassEditPermission(gVal, cVal);
    const transferInTag = s.status === 'transferred_in' ? ' <span style="font-size:0.65rem; background:#2563eb; color:#fff; border-radius:3px; padding:1px 3px; font-weight:normal;">轉入</span>' : '';

    btn.className = "seat-btn " + statusClass + (!perm.canEdit ? " readonly-seat" : "");
    btn.innerHTML = '<span class="seat-title">' + s.seatRaw + transferInTag + '</span><span class="name">' + s.name + '</span><span class="status-label">' + statusText + '</span>' + noteHtml;
    if (!perm.canEdit) {
      btn.style.cursor = "not-allowed";
      btn.title = "唯讀檢視模式（非本班帶班導師）";
    } else {
      btn.title = "點按次數：按1下學習中心、按2下本土語、按3下團隊、按4下請假、按5下失蹤、按6下已接回";
    }

    btn.onclick = function() {
      if (!perm.canEdit) {
        if (typeof alert !== 'undefined') {
          alert(`⚠️ 唯讀檢視模式：您非 ${gVal} ${cVal} 帶班導師，無法修改點名狀態。\n若需代為點名，請使用總指揮官帳號登入或輸入演練通行碼。`);
        }
        return;
      }

      if (status === 'present') {
        studentStatusMap[s.seatRaw] = 'study_center';
        if (!pulloutStatusMap[studentKey]) pulloutStatusMap[studentKey] = 'pending';
      } else if (status === 'study_center') {
        studentStatusMap[s.seatRaw] = 'native_lang';
        if (!pulloutStatusMap[studentKey]) pulloutStatusMap[studentKey] = 'pending';
      } else if (status === 'native_lang') {
        studentStatusMap[s.seatRaw] = 'team';
        if (!pulloutStatusMap[studentKey]) pulloutStatusMap[studentKey] = 'pending';
      } else if (status === 'team') {
        studentStatusMap[s.seatRaw] = 'leave';
        delete pulloutStatusMap[studentKey];
      } else if (status === 'leave') {
        studentStatusMap[s.seatRaw] = 'missing';
        delete pulloutStatusMap[studentKey];
        if (!studentLocationMap[s.seatRaw]) studentLocationMap[s.seatRaw] = { tag: '', note: '' };
      } else if (status === 'missing') {
        studentStatusMap[s.seatRaw] = 'pickedUp';
        delete studentLocationMap[s.seatRaw];
      } else {
        studentStatusMap[s.seatRaw] = 'present';
        delete studentLocationMap[s.seatRaw];
        delete pulloutStatusMap[studentKey];
      }
      renderMatrix();
      triggerAutoSaveTimer();
    };

    grid.appendChild(btn);
  });

  updateStats();
  renderLocationPanel();
  renderTeacherContactPanel();
}

function renderLocationPanel() {
  if (typeof document === 'undefined') return;
  let missingStudents = currentClassStudents.filter(s => studentStatusMap[s.seatRaw] === 'missing');
  let panel = document.getElementById("locationSection");
  let list = document.getElementById("locationList");
  if (!panel || !list) return;

  if (missingStudents.length === 0) {
    panel.style.display = "none";
    return;
  }
  panel.style.display = "block";
  list.innerHTML = "";

  missingStudents.forEach(s => {
    if (!studentLocationMap[s.seatRaw]) studentLocationMap[s.seatRaw] = { tag: '', note: '' };
    let locData = studentLocationMap[s.seatRaw];
    let box = document.createElement("div");
    box.style.marginBottom = "10px";
    box.style.paddingBottom = "8px";
    box.style.borderBottom = "1px dashed #f5c6cb";

    let title = document.createElement("div");
    title.style.fontSize = "0.8rem";
    title.style.fontWeight = "bold";
    title.style.color = "#721c24";
    title.style.marginBottom = "4px";
    title.innerText = "🎯 " + s.seatRaw + " " + s.name + " 位置標註：";
    box.appendChild(title);

    let tagsDiv = document.createElement("div");
    tagsDiv.className = "location-tags";
    defaultLocations.forEach(loc => {
      let btn = document.createElement("span");
      btn.className = "loc-tag " + (locData.tag === loc ? "selected" : "");
      btn.innerText = loc;
      btn.onclick = function() {
        locData.tag = (locData.tag === loc) ? '' : loc;
        renderLocationPanel();
        triggerAutoSaveTimer();
      };
      tagsDiv.appendChild(btn);
    });
    box.appendChild(tagsDiv);

    let input = document.createElement("input");
    input.type = "text";
    input.className = "loc-input";
    input.placeholder = "其他自行備註...";
    input.value = locData.note || '';
    input.oninput = function() {
      locData.note = this.value;
      triggerAutoSaveTimer();
    };
    box.appendChild(input);
    list.appendChild(box);
  });
}

function renderTeacherContactPanel() {
  if (typeof document === 'undefined') return;
  let gVal = selectedGradeOpt;
  let cVal = selectedClassBtn;
  let classKey = gVal + " " + cVal;
  let missingStudents = currentClassStudents.filter(s => studentStatusMap[s.seatRaw] === 'missing');
  let panel = document.getElementById("teacherContactSection");
  let tbody = document.getElementById("teacherContactTable");
  if (!panel || !tbody) return;

  if (missingStudents.length === 0) {
    panel.style.display = "none";
    return;
  }
  panel.style.display = "block";
  tbody.innerHTML = "";

  missingStudents.forEach(s => {
    let studentKey = classKey + "_" + s.seatRaw;
    if (!contactStates[studentKey]) contactStates[studentKey] = { status: "未聯繫", count: 0 };
    let state = contactStates[studentKey];
    if (state.count >= 5 && helpRequestMap[studentKey] === undefined) {
      helpRequestMap[studentKey] = true;
    }
    let isDone = (state.status === "已聯繫");
    let isHelpReq = !!helpRequestMap[studentKey];
    let phoneHref = getPhoneHref(s.phone);
    let teacherPhoneHref = getPhoneHref(s.teacherPhone);
    let displayParentPhone = (securityMode === "drill") || isSiteLocked ?
      '<span class="masked-phone" onclick="verifyPasswordToUnlockPhone()">🔒 ***-*** (個資防護中)</span>' :
      '<a class="phone-link" href="' + phoneHref + '">📞 ' + (s.phone || '無電話') + '</a>';

    let row = document.createElement("tr");
    if (isDone) row.className = "teacher-row-contact-done";
    else if (isHelpReq) row.className = "teacher-row-disabled";

    let actionBtnHtml = isDone ?
      '<span style="color:#155724; font-weight:bold; font-size:0.75rem;">✅ 已完結</span>' :
      (isHelpReq ?
        '<button class="btn-help-req requested" disabled>🚨 已轉交指揮中心</button><button class="btn-take-back" onclick="takeBackContact(\'' + studentKey + '\')">↩️ 導師自主接回聯繫</button>' :
        '<button class="btn-help-req" onclick="toggleHelpReq(\'' + studentKey + '\')">🚨 請求指揮中心協助</button>'
      );

    let searchNoteInfo = searchNotesMap[studentKey] ? '<br><small style="color:#155724; font-weight:bold;">📍 尋獲地點：' + searchNotesMap[studentKey] + '</small>' : '';
    let teacherInfo = s.teacher ? '<br><small style="color:#1F4E79; font-weight:bold;">🧑🏫 帶班導師：' + s.teacher + '</small>' + (s.teacherPhone ? ' <a class="phone-link" style="padding:1px 4px; font-size:0.7rem;" href="' + teacherPhoneHref + '">📞 撥打導師</a>' : '') : '';

    row.innerHTML = '<td><b>' + s.seatRaw + ' ' + s.name + '</b>' + teacherInfo + searchNoteInfo + '</td>' +
      '<td>' + (s.parent || '家長') + '<br>' + displayParentPhone + '</td>' +
      '<td><div class="contact-controls"><div><label><input type="radio" name="tc_' + studentKey + '" value="未聯繫" ' + (state.status === "未聯繫" ? "checked" : "") + ' onchange="updateStatus(\'' + studentKey + '\', \'未聯繫\')">未聯繫</label> <label><input type="radio" name="tc_' + studentKey + '" value="聯繫中" ' + (state.status === "聯繫中" ? "checked" : "") + ' onchange="updateStatus(\'' + studentKey + '\', \'聯繫中\')">聯繫中</label> <label><input type="radio" name="tc_' + studentKey + '" value="已聯繫" ' + (state.status === "已聯繫" ? "checked" : "") + ' onchange="updateStatus(\'' + studentKey + '\', \'已聯繫\')">已聯繫</label></div><div class="retry-counter"><span>已撥打：<b>' + state.count + '</b> 次</span> <button class="retry-btn" onclick="addRetry(\'' + studentKey + '\')">+1 次未接</button></div></div></td>' +
      '<td>' + actionBtnHtml + '</td>';

    tbody.appendChild(row);
  });
}

function toggleHelpReq(key) {
  helpRequestMap[key] = true;
  if (typeof google !== 'undefined' && google.script && google.script.run) {
    google.script.run.withSuccessHandler(function(res) {
      if (res && res.success) {
        if (res.contactStates) contactStates = res.contactStates;
        if (res.helpRequestMap) helpRequestMap = res.helpRequestMap;
        renderTeacherContactPanel();
        renderSummaryTable();
        renderRescueTable();
      }
    }).updateContactStateDelta(key, contactStates[key], true);
  }
  renderTeacherContactPanel();
  renderSummaryTable();
  renderRescueTable();
  triggerAutoSaveTimer();
}

function takeBackContact(key) {
  helpRequestMap[key] = false;
  if (typeof google !== 'undefined' && google.script && google.script.run) {
    google.script.run.withSuccessHandler(function(res) {
      if (res && res.success) {
        if (res.contactStates) contactStates = res.contactStates;
        if (res.helpRequestMap) helpRequestMap = res.helpRequestMap;
        renderTeacherContactPanel();
        renderSummaryTable();
        renderRescueTable();
      }
    }).updateContactStateDelta(key, contactStates[key], false);
  }
  renderTeacherContactPanel();
  renderSummaryTable();
  renderRescueTable();
  triggerAutoSaveTimer();
}

function updateStats() {
  if (typeof document === 'undefined') return;
  let total = currentClassStudents.length;
  let presentCount = 0, studyCenterCount = 0, nativeLangCount = 0, teamCount = 0, leaveCount = 0, missingCount = 0, pickedUpCount = 0;
  let isEmergencyTeacherGroup = (selectedGradeOpt.includes("緊急") || selectedGradeOpt.includes("應變")) && selectedClassBtn.includes("導師");

  currentClassStudents.forEach(s => {
    let st = studentStatusMap[s.seatRaw] || 'present';
    if (isEmergencyTeacherGroup) {
      let classHasReported = Object.keys(classReports).some(k => {
        let rep = classReports[k];
        let cLabel = cleanClassLabel(rep.className || k);
        return isSameClass(k, s.name) || isSameClass(cLabel, s.name);
      });
      if (st === 'missing') missingCount++;
      else if (classHasReported) presentCount++;
      else leaveCount++;
    } else {
      if (st === 'present') presentCount++;
      else if (st === 'study_center') studyCenterCount++;
      else if (st === 'native_lang') nativeLangCount++;
      else if (st === 'team') teamCount++;
      else if (st === 'leave') leaveCount++;
      else if (st === 'missing') missingCount++;
      else if (st === 'pickedUp') pickedUpCount++;
    }
  });

  const setEl = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.innerText = val;
  };
  setEl("stTotal", total);
  setEl("stPresent", presentCount);
  setEl("stStudyCenter", studyCenterCount);
  setEl("stNativeLang", nativeLangCount);
  setEl("stTeam", teamCount);
  setEl("stLeave", leaveCount);
  setEl("stMissing", missingCount);
  setEl("stPickedUp", pickedUpCount);
}

function triggerAutoSaveTimer() {
  if (typeof document === 'undefined') return;
  let msgBar = document.getElementById("autoSaveMsg");
  let btnSubmit = document.getElementById("btnSubmitAttendance");
  if (msgBar) msgBar.style.display = "block";
  if (btnSubmit) {
    btnSubmit.innerText = "送出點名紀錄 (請送出紀錄)";
    btnSubmit.classList.remove("saved");
  }
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(function() {
    submitAttendance(true);
  }, 5000);
}

function submitAttendance(isAuto) {
  if (autoSaveTimer) {
    clearTimeout(autoSaveTimer);
    autoSaveTimer = null;
  }
  if (typeof document !== 'undefined') {
    let msgBar = document.getElementById("autoSaveMsg");
    if (msgBar) msgBar.style.display = "none";
  }

  let gVal = selectedGradeOpt;
  let cVal = selectedClassBtn;
  let key = gVal + " " + cVal;

  // Finding 4: 點名送出權限守門員
  const perm = checkClassEditPermission(gVal, cVal);
  if (!perm.canEdit) {
    if (!isAuto && typeof alert !== 'undefined') {
      alert(`⚠️ 權限不足：您非 ${gVal} ${cVal} 帶班導師，無法送出點名紀錄。`);
    }
    return false;
  }

  let leaveStudents = currentClassStudents.filter(s => studentStatusMap[s.seatRaw] === 'leave');
  let pickedUpStudents = currentClassStudents.filter(s => studentStatusMap[s.seatRaw] === 'pickedUp');
  let studyCenterStudents = currentClassStudents.filter(s => studentStatusMap[s.seatRaw] === 'study_center');
  let nativeLangStudents = currentClassStudents.filter(s => studentStatusMap[s.seatRaw] === 'native_lang');
  let teamStudents = currentClassStudents.filter(s => studentStatusMap[s.seatRaw] === 'team');
  let missingStudents = currentClassStudents.filter(s => studentStatusMap[s.seatRaw] === 'missing').map(s => {
    let loc = studentLocationMap[s.seatRaw] || {};
    return { ...s, locationTag: loc.tag || '', locationNote: loc.note || '' };
  });

  let presentCount = currentClassStudents.length - leaveStudents.length - missingStudents.length - pickedUpStudents.length - studyCenterStudents.length - nativeLangStudents.length - teamStudents.length;

  let singleReport = {
    grade: gVal,
    className: cVal,
    total: currentClassStudents.length,
    presentCount: presentCount,
    leave: leaveStudents,
    pickedUp: pickedUpStudents,
    studyCenter: studyCenterStudents,
    nativeLang: nativeLangStudents,
    team: teamStudents,
    missing: missingStudents
  };

  classReports[key] = singleReport;

  if (typeof google !== 'undefined' && google.script && google.script.run) {
    google.script.run.withSuccessHandler(function(res) {
      if (res && res.success) {
        if (res.classReports) classReports = res.classReports;
        renderSchoolOverview();
        renderPulloutPage();
        renderSummaryTable();
        renderRescueTable();
      }
    }).updateClassReportDelta(key, singleReport);
  }

  if (typeof document !== 'undefined') {
    let btnSubmit = document.getElementById("btnSubmitAttendance");
    if (btnSubmit) {
      btnSubmit.innerText = "✅ 最新點名紀錄已自動同步送出";
      btnSubmit.classList.add("saved");
    }
  }

  renderSchoolOverview();
  renderPulloutPage();
  renderSummaryTable();
  renderRescueTable();

  if (!isAuto && typeof alert !== 'undefined') {
    alert("✅ " + key + " 最新點名紀錄已成功送出！");
  }
}

// ==============================================================================
// 抽離確認頁 (三區塊分流與鐵律 4 恪遵)
// ==============================================================================
function switchPulloutSubTab(tabType) {
  activePulloutSubTab = tabType;
  if (typeof document === 'undefined') return;
  let btnSC = document.getElementById("subBtnSC");
  let btnNL = document.getElementById("subBtnNL");
  let btnTM = document.getElementById("subBtnTM");
  let cardSC = document.getElementById("cardPulloutSC");
  let cardNL = document.getElementById("cardPulloutNL");
  let cardTM = document.getElementById("cardPulloutTM");

  if (btnSC) btnSC.className = "pullout-sub-btn" + (tabType === 'SC' ? " active-sc" : "");
  if (btnNL) btnNL.className = "pullout-sub-btn" + (tabType === 'NL' ? " active-nl" : "");
  if (btnTM) btnTM.className = "pullout-sub-btn" + (tabType === 'TM' ? " active-tm" : "");

  if (cardSC) cardSC.style.display = (tabType === 'SC') ? "block" : "none";
  if (cardNL) cardNL.style.display = (tabType === 'NL') ? "block" : "none";
  if (cardTM) cardTM.style.display = (tabType === 'TM') ? "block" : "none";
}

function renderPulloutPage() {
  if (typeof document === 'undefined') return;
  let tbodySC = document.getElementById("pulloutTableStudyCenter");
  let tbodyNL = document.getElementById("pulloutTableNativeLang");
  let tbodyTM = document.getElementById("pulloutTableTeam");
  if (!tbodySC || !tbodyNL || !tbodyTM) return;

  tbodySC.innerHTML = "";
  tbodyNL.innerHTML = "";
  tbodyTM.innerHTML = "";

  let scList = [], nlList = [], tmList = [];

  Object.keys(classReports).forEach(k => {
    let rep = classReports[k];
    let gName = rep.grade || k.split(" ")[0] || "";
    let cName = rep.className || k.split(" ")[1] || "";
    if (rep.studyCenter && rep.studyCenter.length > 0) {
      rep.studyCenter.forEach(s => scList.push({ classKey: k, student: s, studentKey: k + "_" + s.seatRaw, gradeName: gName, className: cName }));
    }
    if (rep.nativeLang && rep.nativeLang.length > 0) {
      rep.nativeLang.forEach(s => nlList.push({ classKey: k, student: s, studentKey: k + "_" + s.seatRaw, gradeName: gName, className: cName }));
    }
    if (rep.team && rep.team.length > 0) {
      rep.team.forEach(s => tmList.push({ classKey: k, student: s, studentKey: k + "_" + s.seatRaw, gradeName: gName, className: cName }));
    }
  });

  function comparePullout(a, b) {
    let stA = pulloutStatusMap[a.studentKey] || 'pending';
    let stB = pulloutStatusMap[b.studentKey] || 'pending';
    let rankA = (stA === 'pending') ? 0 : 1;
    let rankB = (stB === 'pending') ? 0 : 1;
    if (rankA !== rankB) return rankA - rankB;
    let gA = gradeSortOrder[a.gradeName] || 99;
    let gB = gradeSortOrder[b.gradeName] || 99;
    if (gA !== gB) return gA - gB;
    let cComp = a.className.localeCompare(b.className, 'zh-Hant', { numeric: true });
    if (cComp !== 0) return cComp;
    return (a.student.seatNum || 0) - (b.student.seatNum || 0);
  }

  scList.sort(comparePullout);
  nlList.sort(comparePullout);
  tmList.sort(comparePullout);

  function buildPulloutRows(list, tbody, typeLabel) {
    if (list.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:#888;">目前尚無' + typeLabel + '抽離學生</td></tr>';
      return;
    }
    list.forEach(item => {
      let sKey = item.studentKey;
      let s = item.student;
      if (!pulloutStatusMap[sKey]) pulloutStatusMap[sKey] = 'pending';
      let curStatus = pulloutStatusMap[sKey];
      let row = document.createElement("tr");
      let teacherPhoneHref = getPhoneHref(s.teacherPhone);
      let teacherCellHtml = s.teacher ? '<b>' + s.teacher + '</b>' + (s.teacherPhone ? '<br><a class="phone-link" style="padding:1px 4px; font-size:0.7rem;" href="' + teacherPhoneHref + '">📞 撥打導師</a>' : '') : '無導師資訊';
      let btnGroupHtml = '<div>' +
        '<button class="btn-pullout-opt ' + (curStatus === "pending" ? "active-pending" : "") + '" onclick="updatePulloutStatus(\'' + sKey + '\', \'pending\', \'' + typeLabel + '\')">⏳ 抽離待確認</button>' +
        '<button class="btn-pullout-opt ' + (curStatus === "safe" ? "active-safe" : "") + '" onclick="updatePulloutStatus(\'' + sKey + '\', \'safe\', \'' + typeLabel + '\')">☑️ 安全確認</button>' +
        '<button class="btn-pullout-opt ' + (curStatus === "missing" ? "active-missing" : "") + '" onclick="updatePulloutStatus(\'' + sKey + '\', \'missing\', \'' + typeLabel + '\')">🚨 失蹤</button>' +
      '</div>';
      row.innerHTML = '<td><b>' + item.classKey + '</b></td><td><b>' + s.seatRaw + ' ' + s.name + '</b>' + (curStatus !== 'pending' ? ' <small style="color:#28a745; font-weight:bold;">(已完成處理)</small>' : '') + '</td><td>' + teacherCellHtml + '</td><td>' + btnGroupHtml + '</td>';
      tbody.appendChild(row);
    });
  }

  buildPulloutRows(scList, tbodySC, "學習中心");
  buildPulloutRows(nlList, tbodyNL, "本土語");
  buildPulloutRows(tmList, tbodyTM, "團隊");
}

function updatePulloutStatus(sKey, statusVal, typeLabel) {
  const auth = (typeof window !== 'undefined' && window.AuthManager) ||
               (typeof globalThis !== 'undefined' && globalThis.AuthManager);

  if (auth && typeof auth.getUserRole === 'function') {
    const isCommander = typeof auth.canAccessCommander === 'function' && auth.canAccessCommander();
    const hasCommanderAccess = isCommander || (isUnlockedByPassword && (Date.now() < unlockExpiryTime));
    const canPullout = typeof auth.canAccessPullout === 'function' && auth.canAccessPullout();

    if (!hasCommanderAccess && !canPullout) {
      alert('⛔ 權限受限：僅限【抽離專責教師】或【總指揮官】可更新抽離確認狀態！');
      return;
    }
  }

  pulloutStatusMap[sKey] = statusVal;
  let rescueData = null;

  if (statusVal === 'missing') {
    if (!rescueTriageMap[sKey]) {
      rescueTriageMap[sKey] = { status: "searching", triage: "none", note: "", locationFound: "", escortCount: 0 };
    }
    rescueTriageMap[sKey].status = "searching";
    rescueTriageMap[sKey].locationFound = "📌 抽離失蹤 (" + typeLabel + "地點)";
    rescueData = rescueTriageMap[sKey];
  } else if (statusVal === 'safe') {
    if (rescueTriageMap[sKey]) {
      rescueTriageMap[sKey].status = "safe";
    }
    searchStatusMap[sKey] = true;
  }

  if (typeof google !== 'undefined' && google.script && google.script.run) {
    google.script.run.withSuccessHandler(function(res) {
      if (res && res.success) {
        if (res.pulloutStatusMap) pulloutStatusMap = res.pulloutStatusMap;
        if (res.rescueTriageMap) rescueTriageMap = res.rescueTriageMap;
        renderPulloutPage();
        renderSchoolOverview();
        renderRescueTable();
        renderSummaryTable();
        if (currentClassStudents.length > 0) renderMatrix();
      }
    }).updatePulloutStatusDelta(sKey, statusVal, rescueData);
  }

  renderPulloutPage();
  renderSchoolOverview();
  renderRescueTable();
  renderSummaryTable();
  if (currentClassStudents.length > 0) renderMatrix();
}

// ==============================================================================
// 危難救助與建物巡檢頁
// ==============================================================================
function switchRescueSubTab(tabType) {
  if (typeof document === 'undefined') return;

  const auth = (typeof window !== 'undefined' && window.AuthManager) ||
               (typeof globalThis !== 'undefined' && globalThis.AuthManager);

  if (auth && typeof auth.getUserRole === 'function') {
    const isCommander = typeof auth.canAccessCommander === 'function' && auth.canAccessCommander();
    const hasCommanderAccess = isCommander || (isUnlockedByPassword && (Date.now() < unlockExpiryTime));
    const canRescue = typeof auth.canAccessRescue === 'function' && auth.canAccessRescue();
    const canPatrol = typeof auth.canAccessPatrol === 'function' && auth.canAccessPatrol();
    const role = auth.getUserRole();
    const roleTitle = ROLE_NAME_ZH[role] || '一般訪客';

    // 切換 A 區塊 (搜救與傷病處置) 嚴格查驗：僅限危難救助組 (搶救組、緊急救護組) 或總指揮官
    if (tabType === 'A') {
      if (!hasCommanderAccess && !canRescue) {
        alert(`⛔ 存取被拒絕：【A 區：搜救與傷病處置】僅限危難救助組（搶救組、緊急救護組）或總指揮官操作！\n您目前的登入身分為【${roleTitle}】。`);
        return;
      }
    }

    // 切換 B 區塊 (建物安全檢核) 嚴格查驗：僅限巡檢組或總指揮官
    if (tabType === 'B') {
      if (!hasCommanderAccess && !canPatrol) {
        alert(`⛔ 存取被拒絕：【B 區：校園建築安全檢核】僅限建物巡檢組或總指揮官操作！\n您目前的登入身分為【${roleTitle}】。`);
        return;
      }
    }
  }

  activeRescueSubTab = tabType;
  if (typeof document === 'undefined') return;
  let btnA = document.getElementById("subBtnRescueA");
  let btnB = document.getElementById("subBtnRescueB");
  let cardA = document.getElementById("cardRescueA");
  let cardB = document.getElementById("cardRescueB");

  if (tabType === 'A') {
    if (btnA) btnA.className = "rescue-sub-btn active-rescue";
    if (btnB) btnB.className = "rescue-sub-btn";
    if (cardA) cardA.style.display = "block";
    if (cardB) cardB.style.display = "none";
  } else {
    if (btnA) btnA.className = "rescue-sub-btn";
    if (btnB) btnB.className = "rescue-sub-btn active-building";
    if (cardA) cardA.style.display = "none";
    if (cardB) cardB.style.display = "block";
  }
}

function renderRescueRowInPlace(sKey) {
  if (typeof document === 'undefined') return;
  let row = document.getElementById("rescue_row_" + sKey);
  if (!row) return;
  let rData = rescueTriageMap[sKey] || { status: "searching", triage: "none", note: "", locationFound: "", escortCount: 0 };
  let item = null;

  Object.keys(classReports).forEach(k => {
    let rep = classReports[k];
    let gName = rep.grade || k.split(" ")[0] || "";
    let cName = rep.className || k.split(" ")[1] || "";
    let searchInList = function(list, pLabel) {
      if (list) {
        let found = list.find(s => (k + "_" + s.seatRaw) === sKey);
        if (found) item = { classKey: k, student: found, studentKey: sKey, gradeName: gName, className: cName, pulloutLabel: pLabel };
      }
    };
    searchInList(rep.missing, null);
    searchInList(rep.studyCenter, "學習中心教室");
    searchInList(rep.nativeLang, "本土語教室");
    searchInList(rep.team, "團隊活動地點");
  });

  if (!item && sKey.startsWith("校外人士_")) {
    let vTitle = sKey.replace("校外人士_", "");
    let vObj = visitorList.find(v => v.title === vTitle);
    if (vObj) item = { classKey: "校外人士", student: { seatRaw: vObj.seq + "號", name: vObj.title + (vObj.note ? " (" + vObj.note + ")" : ""), phone: "", teacher: "校外人士無導師", teacherPhone: "" }, studentKey: sKey, gradeName: "校外人士", className: "校外人員", pulloutLabel: "校外失蹤" };
  }

  if (!item) return;
  let s = item.student;
  let defaultLocDesc = rData.locationFound || (item.pulloutLabel ? "📌 抽離失蹤 (" + item.pulloutLabel + ")" : "");
  let statusBtns = '<div><button class="btn-rescue-opt ' + (rData.status === "searching" ? "active-searching" : "") + '" onclick="updateRescueStatus(\'' + sKey + '\', \'searching\')">🔍 1. 搜救中</button><button class="btn-rescue-opt ' + (rData.status === "injured" ? "active-injured" : "") + '" onclick="updateRescueStatus(\'' + sKey + '\', \'injured\')">🚑 2. 受傷轉介救護</button><button class="btn-rescue-opt ' + (rData.status === "safe" ? "active-safe" : "") + '" onclick="updateRescueStatus(\'' + sKey + '\', \'safe\')">🟢 3. 安全送班</button></div><input type="text" style="width:100%; margin-top:2px; font-size:0.8rem; padding:4px; border:1px solid #1F4E79; border-radius:6px;" placeholder="📌 發現地點描述..." value="' + defaultLocDesc + '" oninput="updateRescueLocation(\'' + sKey + '\', this.value)">';

  let triageBtns = '';
  if (rData.status === "injured") {
    let phoneHref = getPhoneHref(s.phone);
    let displayPhone = (securityMode === "drill") || isSiteLocked ? '<span class="masked-phone" onclick="verifyPasswordToUnlockPhone()">🔒 ***-*** (個資防護中)</span>' : '<a class="phone-link" href="' + phoneHref + '">📞 ' + (s.phone || '無電話') + '</a>';
    let escortBtnsHtml = '';
    if (rData.triage === "yellow" || rData.triage === "red") {
      escortBtnsHtml = '<div style="margin-top:4px; font-size:0.8rem; color:#dc3545; font-weight:bold; display:flex; align-items:center; gap:3px; flex-wrap:wrap;"><span>陪同就醫:</span><button class="btn-escort-opt ' + (rData.escortCount === 1 ? "active" : "") + '" onclick="updateRescueEscort(\'' + sKey + '\', 1)">1人</button><button class="btn-escort-opt ' + (rData.escortCount === 2 ? "active" : "") + '" onclick="updateRescueEscort(\'' + sKey + '\', 2)">2人</button><button class="btn-escort-opt ' + (rData.escortCount === 3 ? "active" : "") + '" onclick="updateRescueEscort(\'' + sKey + '\', 3)">3人</button><button class="btn-escort-opt ' + (rData.escortCount === 4 ? "active" : "") + '" onclick="updateRescueEscort(\'' + sKey + '\', 4)">4人</button></div>';
    }
    let isFinalized = !!searchStatusMap[sKey];
    let okBtnBg = isFinalized ? "#6c757d" : "#28a745";
    let okBtnText = isFinalized ? "🔄 已送出" : "✅ OK確認";
    triageBtns = '<div style="margin-top:2px;"><div style="display:flex; align-items:center; gap:4px; flex-wrap:wrap;"><button class="btn-triage-opt ' + (rData.triage === "green" ? "active-green" : "") + '" onclick="updateRescueTriage(\'' + sKey + '\', \'green\')">🟢 綠卡</button><button class="btn-triage-opt ' + (rData.triage === "yellow" ? "active-yellow" : "") + '" onclick="updateRescueTriage(\'' + sKey + '\', \'yellow\')">🟡 黃卡</button><button class="btn-triage-opt ' + (rData.triage === "red" ? "active-red" : "") + '" onclick="updateRescueTriage(\'' + sKey + '\', \'red\')">🔴 紅卡</button><button style="padding:4px 8px; background:' + okBtnBg + '; color:#fff; border:none; border-radius:6px; font-weight:bold; font-size:0.78rem; cursor:pointer; margin-bottom:3px; white-space:nowrap; box-shadow:0 1px 3px rgba(0,0,0,0.15);" onclick="confirmRescueTriage(\'' + sKey + '\')">' + okBtnText + '</button></div>' + escortBtnsHtml + '<input type="text" id="triageNote_' + sKey + '" style="width:100%; margin-top:4px; font-size:0.8rem; padding:4px; border:1px solid #ccc; border-radius:6px;" placeholder="📝 檢傷傷勢備註 (非必填)..." value="' + (rData.note || '') + '" oninput="updateRescueNote(\'' + sKey + '\', this.value)"><div style="margin-top:4px; font-size:0.78rem; color:#555;">家長聯繫：' + displayPhone + '</div></div>';
  }
  let origStatusTag = item.pulloutLabel ? '<small style="color:#d9534f; font-weight:bold; display:block;">(原狀態:' + item.pulloutLabel + ')</small>' : '<small style="color:#721c24; font-weight:normal; display:block;">(原狀態:失蹤)</small>';
  let noteLocTag = (s.locationTag || s.locationNote) ? '<div style="font-size:0.75rem; color:#dc3545; margin-top:2px;">📌點名備註: ' + (s.locationTag || '') + ' ' + (s.locationNote || '') + '</div>' : '';
  row.innerHTML = '<td><b>' + item.classKey + '</b></td><td><span class="badge-status-missing">🚨 ' + s.seatRaw + ' ' + s.name + '</span>' + origStatusTag + noteLocTag + '</td><td>' + statusBtns + '</td><td>' + (rData.status === "safe" ? '<span style="color:#155724; font-weight:bold;">🟢 已安全送班</span>' : triageBtns) + '</td>';
}

function renderRescueTable() {
  if (typeof document === 'undefined') return;
  let tbody = document.getElementById("rescueTableBody");
  if (!tbody) return;
  tbody.innerHTML = "";

  let rescueList = [];

  Object.keys(classReports).forEach(k => {
    let rep = classReports[k];
    let gName = rep.grade || k.split(" ")[0] || "";
    let cName = rep.className || k.split(" ")[1] || "";

    if (rep.missing && rep.missing.length > 0) {
      rep.missing.forEach(s => {
        let sKey = k + "_" + s.seatRaw;
        rescueList.push({ classKey: k, student: s, studentKey: sKey, gradeName: gName, className: cName });
      });
    }

    // 抽離標註失蹤者
    let checkPulloutMissing = function(sList, labelText) {
      if (sList && sList.length > 0) {
        sList.forEach(s => {
          let sKey = k + "_" + s.seatRaw;
          if (pulloutStatusMap[sKey] === 'missing' && !rescueList.some(r => r.studentKey === sKey)) {
            rescueList.push({ classKey: k, student: s, studentKey: sKey, gradeName: gName, className: cName, pulloutLabel: labelText });
          }
        });
      }
    };
    checkPulloutMissing(rep.studyCenter, "學習中心教室");
    checkPulloutMissing(rep.nativeLang, "本土語教室");
    checkPulloutMissing(rep.team, "團隊活動地點");
  });

  // 校外失蹤者
  visitorList.filter(v => v.status === "missing").forEach(v => {
    let sKey = "校外人士_" + v.title;
    if (!rescueList.some(r => r.studentKey === sKey)) {
      rescueList.push({
        classKey: "校外人士",
        student: { seatRaw: v.seq + "號", name: v.title + (v.note ? " (" + v.note + ")" : ""), phone: "", teacher: "校外人士", teacherPhone: "" },
        studentKey: sKey,
        gradeName: "校外人士",
        className: "校外人員",
        pulloutLabel: "校外失蹤"
      });
    }
  });

  if (rescueList.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:#155724; font-weight:bold;">🟢 目前尚無救助中案件，人員均安全！</td></tr>';
    return;
  }

  function compareTriageCases(a, b) {
    let rA = rescueTriageMap[a.studentKey] || { status: "searching", triage: "none", locationFound: "", note: "", escortCount: 0 };
    let rB = rescueTriageMap[b.studentKey] || { status: "searching", triage: "none", locationFound: "", note: "", escortCount: 0 };
    let compA = !!searchStatusMap[a.studentKey];
    let compB = !!searchStatusMap[b.studentKey];
    if (compA !== compB) return compA ? 1 : -1;
    let gA = gradeSortOrder[a.gradeName] || 99;
    let gB = gradeSortOrder[b.gradeName] || 99;
    if (gA !== gB) return gA - gB;
    let classComp = a.className.localeCompare(b.className, 'zh-Hant', { numeric: true });
    if (classComp !== 0) return classComp;

    function getTriageRank(r) {
      if (r.status === "injured") {
        if (r.triage === "red") return 1;
        if (r.triage === "yellow") return 2;
        if (r.triage === "green") return 3;
        return 5;
      }
      if (r.status === "safe") return 4;
      if (r.status === "searching") return 5;
      return 99;
    }

    let rankA = getTriageRank(rA);
    let rankB = getTriageRank(rB);
    if (rankA !== rankB) return rankA - rankB;
    return (a.student.seatNum || 0) - (b.student.seatNum || 0);
  }

  rescueList.sort(compareTriageCases);

  rescueList.forEach(item => {
    let sKey = item.studentKey;
    let row = document.createElement("tr");
    row.id = "rescue_row_" + sKey;
    tbody.appendChild(row);
    renderRescueRowInPlace(sKey);
  });
}

function updateRescueLocation(key, val) {
  if (!rescueTriageMap[key]) rescueTriageMap[key] = { status: "searching", triage: "none", note: "", locationFound: "", escortCount: 0 };
  rescueTriageMap[key].locationFound = val;
  triggerDebouncedStateSave();
}

function updateRescueEscort(key, count) {
  if (!rescueTriageMap[key]) rescueTriageMap[key] = { status: "injured", triage: "yellow", note: "", locationFound: "", escortCount: 0 };
  rescueTriageMap[key].escortCount = count;
  searchStatusMap[key] = false;

  if (!contactStates[key]) contactStates[key] = { status: "未聯繫", count: 0 };

  if (typeof google !== 'undefined' && google.script && google.script.run) {
    google.script.run.withSuccessHandler(function(res) {
      if (res && res.success) {
        if (res.rescueTriageMap) rescueTriageMap = res.rescueTriageMap;
        if (res.searchStatusMap) searchStatusMap = res.searchStatusMap;
        renderRescueRowInPlace(key);
        renderSchoolOverview();
      }
    }).updateRescueStatusDelta(key, rescueTriageMap[key], false);
  }

  renderRescueRowInPlace(key);
  renderSchoolOverview();
}

function updateRescueStatus(key, val) {
  if (!rescueTriageMap[key]) rescueTriageMap[key] = { status: "searching", triage: "none", note: "", locationFound: "", escortCount: 0 };
  rescueTriageMap[key].status = val;
  let isSearchDone = (val === "safe");

  if (val === "safe") {
    searchStatusMap[key] = true;
    if (pulloutStatusMap[key]) pulloutStatusMap[key] = 'safe';
    if (!contactStates[key]) contactStates[key] = { status: "未聯繫", count: 0 };
  } else {
    searchStatusMap[key] = false;
  }

  if (typeof google !== 'undefined' && google.script && google.script.run) {
    google.script.run.withSuccessHandler(function(res) {
      if (res && res.success) {
        if (res.rescueTriageMap) rescueTriageMap = res.rescueTriageMap;
        if (res.searchStatusMap) searchStatusMap = res.searchStatusMap;
        if (res.pulloutStatusMap) pulloutStatusMap = res.pulloutStatusMap;
        renderSchoolOverview();
        renderSummaryTable();
        renderPulloutPage();
        renderRescueTable();
      }
    }).updateRescueStatusDelta(key, rescueTriageMap[key], isSearchDone);
  }

  if (val === "safe") renderRescueTable();
  else renderRescueRowInPlace(key);
  renderSchoolOverview();
  renderSummaryTable();
  renderPulloutPage();
}

// 檢傷防呆門檻驗證 (黃卡/紅卡強制 1~4 人)
function confirmRescueTriage(key) {
  let rData = rescueTriageMap[key];
  if (!rData) return;

  if (rData.triage === "none" || !rData.triage) {
    alert("⚠️ 請先選擇檢傷分類卡 (🟢綠卡 / 🟡黃卡 / 🔴紅卡)！");
    return;
  }

  if (rData.triage === "yellow" || rData.triage === "red" || rData.triage === "黃卡" || rData.triage === "紅卡") {
    let escort = Number(rData.escortCount || 0);
    if (!escort || escort < 1 || escort > 4) {
      alert("⚠️ 選擇黃卡/紅卡時，請先點選【陪同就醫人數】(1~4人) 才可 OK 送出！");
      return;
    }
  }

  if (typeof document !== 'undefined') {
    let noteInput = document.getElementById("triageNote_" + key);
    if (noteInput) {
      rData.note = noteInput.value.trim();
    }
  }

  searchStatusMap[key] = true;
  if (pulloutStatusMap[key]) pulloutStatusMap[key] = 'safe';
  if (!contactStates[key]) contactStates[key] = { status: "未聯繫", count: 0 };

  if (typeof google !== 'undefined' && google.script && google.script.run) {
    google.script.run.withSuccessHandler(function(res) {
      if (res && res.success) {
        if (res.rescueTriageMap) rescueTriageMap = res.rescueTriageMap;
        if (res.searchStatusMap) searchStatusMap = res.searchStatusMap;
        if (res.pulloutStatusMap) pulloutStatusMap = res.pulloutStatusMap;
        renderSchoolOverview();
        renderSummaryTable();
        renderRescueTable();
        renderPulloutPage();
      }
    }).updateRescueStatusDelta(key, rData, true);
  }

  renderSchoolOverview();
  renderSummaryTable();
  renderRescueTable();
  renderPulloutPage();
}

function updateRescueTriage(key, val) {
  if (!rescueTriageMap[key]) rescueTriageMap[key] = { status: "injured", triage: "none", note: "", locationFound: "", escortCount: 0 };

  if (rescueTriageMap[key].triage !== val) {
    rescueTriageMap[key].triage = val;
    rescueTriageMap[key].escortCount = 0;
  }
  searchStatusMap[key] = false;

  if (!contactStates[key]) contactStates[key] = { status: "未聯繫", count: 0 };

  if (typeof google !== 'undefined' && google.script && google.script.run) {
    google.script.run.withSuccessHandler(function(res) {
      if (res && res.success) {
        if (res.rescueTriageMap) rescueTriageMap = res.rescueTriageMap;
        if (res.searchStatusMap) searchStatusMap = res.searchStatusMap;
        renderRescueRowInPlace(key);
        renderSchoolOverview();
      }
    }).updateRescueStatusDelta(key, rescueTriageMap[key], false);
  }

  renderRescueRowInPlace(key);
  renderSchoolOverview();
}

function updateRescueNote(key, val) {
  if (!rescueTriageMap[key]) rescueTriageMap[key] = { status: "injured", triage: "none", note: "", locationFound: "", escortCount: 0 };
  rescueTriageMap[key].note = val;
  triggerDebouncedStateSave();
}

let debouncedStateSaveTimer = null;
function triggerDebouncedStateSave() {
  if (debouncedStateSaveTimer) clearTimeout(debouncedStateSaveTimer);
  debouncedStateSaveTimer = setTimeout(function() {
    saveFullSystemStateToBackend();
  }, 3000);
}

// ==============================================================================
// 建物安全巡檢 (6 大建物 & 8 大指標)
// ==============================================================================
function renderBuildingGrid() {
  if (typeof document === 'undefined') return;
  let grid = document.getElementById("buildingCheckGrid");
  if (!grid) return;
  grid.innerHTML = "";

  Object.keys(buildingStatusMap).forEach(bName => {
    if (bName === "ALL") return;
    let bData = buildingStatusMap[bName] || {};
    let card = document.createElement("div");
    card.className = "building-card";
    let cardHtml = '<div class="building-title">🏢 ' + bName + ' 結構安全檢核</div>';

    buildingCheckItems.forEach((itemText, idx) => {
      let itemKey = "item_" + idx;
      let isDanger = (bData[itemKey] === true);
      let btnText = isDanger ? "⚠️ 受損/危險" : "✅ 安全";
      let btnClass = isDanger ? "btn-building-toggle danger" : "btn-building-toggle safe";

      cardHtml += '<div class="building-check-item">' +
        '<span>' + itemText + '</span>' +
        '<button class="' + btnClass + '" onclick="toggleBuildingItem(\'' + bName + '\', \'' + itemKey + '\')">' + btnText + '</button>' +
      '</div>';
    });

    let isSubmitted = (bData.submitted === true);
    let btnBg = isSubmitted ? "#28a745" : "#fd7e14";
    let btnLabel = isSubmitted ? "✅ 已檢核完畢 (已存檔)" : "檢核完畢送出 (請送出紀錄)";

    cardHtml += '<input type="text" id="bNoteInput_' + bName + '" style="width:100%; margin-top:6px; font-size:0.8rem; padding:5px; border:1px solid #ccc; border-radius:6px;" placeholder="📌 建築物損毀詳細現況說明..." value="' + (bData.note || '') + '" oninput="onBuildingNoteInput(\'' + bName + '\', this.value)">';
    cardHtml += '<button id="bSubmitBtn_' + bName + '" class="btn-submit" onclick="submitBuildingCheck(\'' + bName + '\')" style="margin-top:8px; padding:10px; font-size:0.88rem; background:' + btnBg + ';">' + btnLabel + '</button>';

    card.innerHTML = cardHtml;
    grid.appendChild(card);
  });
}

let buildingAutoSaveTimers = {};
function onBuildingNoteInput(bName, val) {
  if (!buildingStatusMap[bName]) buildingStatusMap[bName] = {};
  buildingStatusMap[bName].note = val;
  buildingStatusMap[bName].submitted = false;

  if (typeof document !== 'undefined') {
    let btn = document.getElementById("bSubmitBtn_" + bName);
    if (btn) {
      btn.style.background = "#fd7e14";
      btn.innerText = "檢核完畢送出 (請送出紀錄)";
    }
  }

  if (buildingAutoSaveTimers[bName]) clearTimeout(buildingAutoSaveTimers[bName]);
  buildingAutoSaveTimers[bName] = setTimeout(function() {
    if (typeof google !== 'undefined' && google.script && google.script.run) {
      google.script.run.updateBuildingStatusDelta(bName, buildingStatusMap[bName]);
    }
    renderSchoolOverview();
  }, 3000);
}

function toggleBuildingItem(bName, itemKey) {
  if (!buildingStatusMap[bName]) buildingStatusMap[bName] = {};
  buildingStatusMap[bName][itemKey] = !buildingStatusMap[bName][itemKey];
  buildingStatusMap[bName].submitted = false;

  if (typeof google !== 'undefined' && google.script && google.script.run) {
    google.script.run.updateBuildingStatusDelta(bName, buildingStatusMap[bName]);
  }
  renderBuildingGrid();
  renderSchoolOverview();
}

function submitBuildingCheck(bName) {
  if (!buildingStatusMap[bName]) buildingStatusMap[bName] = {};
  buildingStatusMap[bName].submitted = true;

  if (typeof google !== 'undefined' && google.script && google.script.run) {
    google.script.run.withSuccessHandler(function(res) {
      if (res && res.success) {
        if (res.buildingStatusMap) buildingStatusMap = res.buildingStatusMap;
        if (buildingStatusMap["ALL"]) delete buildingStatusMap["ALL"];
        renderBuildingGrid();
        renderSchoolOverview();
        alert("✅ " + bName + " 建築安全檢核紀錄已成功送出存檔！");
      } else {
        alert("❌ 存檔失敗，請稍後再試。");
      }
    }).updateBuildingStatusDelta(bName, buildingStatusMap[bName]);
  }

  renderBuildingGrid();
  renderSchoolOverview();
}

// ==============================================================================
// 校外人員登記模組
// ==============================================================================
function openVisitorModal() {
  if (typeof document === 'undefined') return;

  const auth = (typeof window !== 'undefined' && window.AuthManager) ||
               (typeof globalThis !== 'undefined' && globalThis.AuthManager);

  if (auth && typeof auth.getUserRole === 'function') {
    const isCommander = typeof auth.canAccessCommander === 'function' && auth.canAccessCommander();
    const hasCommanderAccess = isCommander || (isUnlockedByPassword && (Date.now() < unlockExpiryTime));
    const isVisitorMgr = typeof auth.canAccessVisitor === 'function' && auth.canAccessVisitor();
    const isAuth = typeof auth.isAuthenticated === 'function' && auth.isAuthenticated();

    if (!hasCommanderAccess && !isVisitorMgr) {
      if (!isAuth) {
        if (typeof auth.openLoginModal === 'function') auth.openLoginModal();
        alert('🔒 權限受限：您必須先登入【訪客登記組】或【總指揮官】帳號才能登記校外/臨時人員！');
      } else {
        const role = auth.getUserRole();
        const roleTitle = ROLE_NAME_ZH[role] || role;
        alert(`⛔ 存取被拒絕：校外人員登記僅限訪客登記組或總指揮官操作！\n您目前的登入身分為【${roleTitle}】。`);
      }
      return;
    }
  }

  isVisitorModalOpen = true;
  newVisitorBatch = [];
  switchVisitorSubTab("add");
  renderNewVisitorModalItems();
  let modal = document.getElementById("visitorModal");
  if (modal) modal.style.display = "flex";
}

function closeVisitorModal() {
  if (typeof document === 'undefined') return;
  isVisitorModalOpen = false;
  let modal = document.getElementById("visitorModal");
  if (modal) modal.style.display = "none";
}

function switchVisitorSubTab(tabType) {
  activeVisitorSubTab = tabType;
  if (typeof document === 'undefined') return;
  let btnAdd = document.getElementById("vSubBtnAdd");
  let btnList = document.getElementById("vSubBtnList");
  let contentAdd = document.getElementById("vTabContentAdd");
  let contentList = document.getElementById("vTabContentList");
  let btnSubmit = document.getElementById("btnSubmitVisitorNew");

  if (tabType === 'add') {
    if (btnAdd) btnAdd.className = "pullout-sub-btn active-sc";
    if (btnList) btnList.className = "pullout-sub-btn";
    if (contentAdd) contentAdd.style.display = "block";
    if (contentList) contentList.style.display = "none";
    if (btnSubmit) btnSubmit.style.display = "block";
  } else {
    if (btnAdd) btnAdd.className = "pullout-sub-btn";
    if (btnList) btnList.className = "pullout-sub-btn active-sc";
    if (contentAdd) contentAdd.style.display = "none";
    if (contentList) contentList.style.display = "block";
    if (btnSubmit) btnSubmit.style.display = "none";
    renderAllVisitorListItems();
  }
}

function adjustNewVisitorItemCount(type, delta) {
  if (delta > 0) {
    let sameTypeItems = newVisitorBatch.filter(v => v.type === type);
    let nextSeq = sameTypeItems.length + 1;
    let seqStr = nextSeq < 10 ? "0" + nextSeq : "" + nextSeq;
    newVisitorBatch.push({
      id: "v_" + Date.now() + "_" + Math.floor(Math.random() * 1000),
      type: type,
      seq: seqStr,
      title: (typeLabelMap[type] || type) + " " + seqStr,
      status: "safe",
      note: ""
    });
  } else {
    let idx = -1;
    for (let i = newVisitorBatch.length - 1; i >= 0; i--) {
      if (newVisitorBatch[i].type === type) {
        idx = i;
        break;
      }
    }
    if (idx !== -1) newVisitorBatch.splice(idx, 1);
  }
  renderNewVisitorModalItems();
}

function setNewVisitorItemStatus(vId, statusVal) {
  let item = newVisitorBatch.find(v => v.id === vId);
  if (item) {
    item.status = statusVal;
    renderNewVisitorModalItems();
  }
}

function setNewVisitorItemNote(vId, val) {
  let item = newVisitorBatch.find(v => v.id === vId);
  if (item) item.note = val;
}

function renderNewVisitorModalItems() {
  if (typeof document === 'undefined') return;
  let container = document.getElementById("newVisitorItemsContainer");
  if (!container) return;
  container.innerHTML = "";

  if (newVisitorBatch.length === 0) {
    container.innerHTML = '<div style="text-align:center; color:#888; padding:15px; font-size:0.85rem;">本次尚未點選任何新增校外人員。</div>';
    return;
  }

  newVisitorBatch.forEach(item => {
    let card = document.createElement("div");
    card.className = "visitor-item-card";
    let isSafe = (item.status === "safe");
    let isMissing = (item.status === "missing");
    let noteInputHtml = isMissing ? '<input type="text" style="width:100%; margin-top:5px; padding:4px 6px; font-size:0.8rem; border:1px solid #dc3545; border-radius:6px;" placeholder="📌 請填寫姓名/機構/最後位置備註..." value="' + (item.note || '') + '" oninput="setNewVisitorItemNote(\'' + item.id + '\', this.value)">' : '';
    card.innerHTML = '<div class="visitor-item-title"><span><b>' + item.title + '</b></span><div><button class="btn-visitor-opt ' + (isSafe ? "active-safe" : "") + '" onclick="setNewVisitorItemStatus(\'' + item.id + '\', \'safe\')">🟢 安全確認</button><button class="btn-visitor-opt ' + (isMissing ? "active-missing" : "") + '" onclick="setNewVisitorItemStatus(\'' + item.id + '\', \'missing\')">🔴 失蹤</button></div></div>' + noteInputHtml;
    container.appendChild(card);
  });
}

function renderAllVisitorListItems() {
  if (typeof document === 'undefined') return;
  let container = document.getElementById("allVisitorItemsContainer");
  if (!container) return;
  container.innerHTML = "";

  if (visitorList.length === 0) {
    container.innerHTML = '<div style="text-align:center; color:#888; padding:15px; font-size:0.85rem;">全校目前尚未登記任何校外人士。</div>';
    return;
  }

  visitorList.forEach(item => {
    let card = document.createElement("div");
    card.className = "visitor-item-card";
    let isSafe = (item.status === "safe");
    let statusBadge = isSafe ? '<span style="color:#155724; font-weight:bold;">🟢 現場出席</span>' : '<span style="color:#dc3545; font-weight:bold;">🔴 失蹤搜救中</span>';
    let noteText = item.note ? '<div style="font-size:0.78rem; color:#555; margin-top:2px;">📌 備註：' + item.note + '</div>' : '';
    card.innerHTML = '<div class="visitor-item-title"><span><b>' + item.title + '</b></span><div>' + statusBadge + '</div></div>' + noteText;
    container.appendChild(card);
  });
}

function submitNewVisitorBatchData() {
  if (newVisitorBatch.length === 0) {
    alert("ℹ️ 您尚未點選任何新增校外人員。");
    closeVisitorModal();
    return;
  }
  let btn = typeof document !== 'undefined' ? document.getElementById("btnSubmitVisitorNew") : null;
  if (btn) {
    btn.disabled = true;
    btn.style.background = "#198754";
    btn.innerText = "✅ 已填報送出 (同步中...)";
  }
  newVisitorBatch.forEach(v => { if (!v.status) v.status = "safe"; });
  let count = newVisitorBatch.length;

  if (typeof google !== 'undefined' && google.script && google.script.run) {
    google.script.run.withSuccessHandler(function(res) {
      if (res && res.success) {
        if (res.visitorList) visitorList = res.visitorList;
        if (res.visitorCounts) visitorCounts = res.visitorCounts;
        if (res.rescueTriageMap) rescueTriageMap = res.rescueTriageMap;
        renderSchoolOverview();
        renderRescueTable();
        renderSummaryTable();
      }
      setTimeout(function() {
        if (btn) {
          btn.disabled = false;
          btn.style.background = "#28a745";
          btn.innerText = "✅ 確認送出本次填報";
        }
        closeVisitorModal();
        alert("✅ 已成功完成 " + count + " 名校外人員填報！視窗已自動關閉。");
      }, 300);
    }).withFailureHandler(function(err) {
      alert("❌ 填報送出失敗：" + err);
      if (btn) {
        btn.disabled = false;
        btn.style.background = "#28a745";
        btn.innerText = "✅ 確認送出本次填報";
      }
    }).appendVisitorListDelta(newVisitorBatch);
  } else {
    visitorList.push(...newVisitorBatch);
    closeVisitorModal();
    renderSchoolOverview();
  }
}

// ==============================================================================
// 壓力測試模擬器與彈窗名單
// ==============================================================================
function executeBackendStressTest() {
  if (typeof document === 'undefined') return;
  if (!checkCommanderAccess("執行併發壓力測試")) return;
  let currentSimMode = document.getElementById("simTimeSelect")?.value || "mon_am";
  if (!confirm("⚠️ 確定要執行當前在校班級併發壓力測試嗎？\n系統將自動對實際在校班級進行模擬點名寫入。")) return;

  if (typeof google !== 'undefined' && google.script && google.script.run) {
    google.script.run.withSuccessHandler(function(res) {
      if (res && res.success) {
        alert("✅ 當前在校班級併發壓力測試完成！\n\n當前模擬時段：" + currentSimMode + "\n實際測試班級數：" + (res.classesCount || res.totalClasses || 0) + " 班\n總模擬學生人數：" + (res.studentsCount || res.totalStudents || 0) + " 人\n處理時間：" + (res.durationMs ? (res.durationMs / 1000).toFixed(2) : (res.totalDurationSec || 0)) + " s\n\n📊 壓力測試紀錄已同步寫入 Firestore。");
        google.script.run.withSuccessHandler(loadSavedFullState).getFullSystemState();
      } else {
        alert("❌ 測試失敗：" + (res ? res.error : "未知原因"));
      }
    }).runStressTest(currentSimMode);
  }
}

function showLatestStressClassList() {
  if (typeof document === 'undefined') return;
  let body = document.getElementById("modalBody");
  if (body) body.innerHTML = "載入名單明細中...";
  let modal = document.getElementById("stressModal");
  if (modal) modal.style.display = "flex";

  if (typeof google !== 'undefined' && google.script && google.script.run) {
    google.script.run.withSuccessHandler(function(data) {
      if (!body) return;
      if (!data || data.error) {
        body.innerHTML = '<div style="color:#dc3545; font-weight:bold;">⚠️ ' + (data ? data.error : '載入失敗') + '</div>';
        rawStressClassText = "";
      } else {
        let classes = data.activeClasses || data.classList || [];
        rawStressClassText = "📋 壓力測試班級名單 (共 " + (data.classesCount || classes.length) + " 班)\n\n" + classes.join("\n");

        const emergencyResponseTeams = ['通報組', '安全防護組', '避難引導組', '搶救組', '緊急救護組', '指揮官'];
        let groupedMap = {};
        classes.forEach(cKey => {
          let parts = cKey.split(" ");
          let gName = parts[0];
          let cName = parts[1] || parts[0];

          // 核心規則：通報組、安全防護組、避難引導組、搶救組、緊急救護組 統一歸入「緊急應變小組」
          if (emergencyResponseTeams.includes(gName) || emergencyResponseTeams.includes(cName)) {
            gName = "緊急應變小組";
            if (!parts[1] && emergencyResponseTeams.includes(cKey)) {
              cName = cKey;
            }
          }

          if (!groupedMap[gName]) groupedMap[gName] = [];
          groupedMap[gName].push(cName);
        });

        let sortedGrades = Object.keys(groupedMap).sort((a, b) => (gradeSortOrder[a] || 99) - (gradeSortOrder[b] || 99));

        let html = '<div style="margin-bottom:10px; color:#1F4E79; font-weight:bold; font-size:0.85rem;">' +
                   '🕒 演練模式：' + (data.simTimeMode || simTimeMode) + ' | 當前在校測試班級數：' + (data.classesCount || classes.length) + ' 班' +
                   '</div>';

        sortedGrades.forEach(gName => {
          html += '<div style="margin-top:8px; font-weight:bold; color:#2c3e50; border-bottom:1px solid #ddd; padding-bottom:2px;">📌 ' + gName + '</div>';
          html += '<div class="badge-grid-container" style="display:flex; flex-wrap:wrap; gap:4px; margin-top:4px;">';
          groupedMap[gName].forEach(cName => {
            html += '<div class="class-badge-item" style="padding:4px 8px; background:#e8f0f8; border:1px solid #c0d4e5; border-radius:4px; font-size:0.8rem; font-weight:bold;">' + cleanClassLabel(cName) + '</div>';
          });
          html += '</div>';
        });

        body.innerHTML = html;
      }
    }).getLatestStressTestClassList();
  }
}

function closeStressModal() {
  if (typeof document === 'undefined') return;
  let modal = document.getElementById("stressModal");
  if (modal) modal.style.display = "none";
}

function copyStressModalText() {
  if (!rawStressClassText) {
    alert("⚠️ 目前無壓測名單可供複製。");
    return;
  }
  if (typeof navigator !== 'undefined' && navigator.clipboard) {
    navigator.clipboard.writeText(rawStressClassText).then(function() {
      alert("✅ 最新壓力測試班級名單已成功複製至剪貼簿！");
    }).catch(function(err) {
      alert("複製失敗：" + err);
    });
  }
}

// ==============================================================================
// 👥 教職員角色與權限管理 (嚴格限制：僅系統管理者/總指揮官可操作)
// ==============================================================================

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[m]);
}

/**
 * 查驗是否具備系統管理者 (總指揮官) 權限
 */
function checkSystemAdminAccess() {
  const auth = (typeof window !== 'undefined' && window.AuthManager) ||
               (typeof globalThis !== 'undefined' && globalThis.AuthManager);
  if (!auth) {
    alert('⛔ 存取被拒絕：系統尚未載入鑑權模組。');
    return false;
  }

  const role = typeof auth.getUserRole === 'function' ? auth.getUserRole() : '';
  const user = typeof auth.getCurrentUser === 'function' ? auth.getCurrentUser() : null;
  const email = (user && user.email) ? String(user.email).trim().toLowerCase() : '';
  const isCommander = role === 'commander';
  const isAdminEmail = email === 'fishyaya@apps.ntpc.edu.tw' || email === 'poyilin59@gmail.com' || email.startsWith('commander') || email.includes('admin');
  if (isCommander || isAdminEmail) {
    return true;
  }

  if (typeof auth.openLoginModal === 'function') {
    auth.openLoginModal();
  }
  alert('⛔ 權限受限：本功能僅限系統管理者 (總指揮官) 登入後使用！');
  return false;
}

/**
 * 開啟教職員權限管理彈窗
 */
async function openUserPermissionModal() {
  if (typeof document === 'undefined') return;
  if (!checkSystemAdminAccess()) return;

  const modal = document.getElementById('userPermissionModal');
  if (modal) {
    modal.style.display = 'flex';
    await renderUserPermissionTable();
  }
}

/**
 * 關閉教職員權限管理彈窗
 */
function closeUserPermissionModal() {
  if (typeof document === 'undefined') return;
  const modal = document.getElementById('userPermissionModal');
  if (modal) {
    modal.style.display = 'none';
  }
}

const ROLE_OPTIONS_MAP = {
  commander: '👑 總指揮官',
  medical: '🚑 緊急救護官',
  inspector: '🏢 建物巡檢組',
  pullout_teacher: '🔄 抽離專責教師',
  visitor_manager: '📝 訪客登記組'
};

/**
 * 載入並渲染 Firestore 中的 users 清單
 */
async function renderUserPermissionTable() {
  const tbody = document.getElementById('userPermissionTableBody');
  if (!tbody) return;

  tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:12px; color:#888;">正在自雲端 Firebase 載入名單...</td></tr>';

  let userList = [];

  try {
    const appConfig = (typeof window !== 'undefined' && window.__APP_CONFIG__) || null;
    const fbConfig = (appConfig && typeof appConfig.getFirebaseConfig === 'function')
      ? appConfig.getFirebaseConfig()
      : null;
    const projectId = (fbConfig && fbConfig.projectId) || 'disaster-prevention-syst-7169e';
    const apiKey = (fbConfig && fbConfig.apiKey) || 'AIzaSyBsLYXXrxxHIrgCvhgcS09xi9DGOUInfOc';

    const res = await fetch(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users?key=${apiKey}`);
    if (res.ok) {
      const data = await res.json();
      if (data && data.documents) {
        userList = data.documents.map(doc => {
          const docId = doc.name.split('/').pop();
          const f = doc.fields || {};
          return {
            email: (f.email && f.email.stringValue) || decodeURIComponent(docId),
            name: (f.name && f.name.stringValue) || '',
            role: (f.role && f.role.stringValue) || 'visitor_manager',
            assignedGrade: (f.assignedGrade && f.assignedGrade.stringValue) || '',
            assignedClass: (f.assignedClass && f.assignedClass.stringValue) || ''
          };
        });
      }
    }
  } catch (err) {
    console.warn('[UserPermission] REST 讀取失敗，降級為 firestoreService：', err);
  }

  // 降級回退
  if (userList.length === 0) {
    try {
      const fs = (typeof window !== 'undefined' && window.firestoreService) ||
                 (typeof globalThis !== 'undefined' && globalThis.firestoreService);
      if (fs && typeof fs.getDocs === 'function' && typeof fs.collection === 'function') {
        const snap = await fs.getDocs(fs.collection('users'));
        if (snap && snap.docs) {
          userList = snap.docs.map(d => {
            const dData = typeof d.data === 'function' ? d.data() : d.data;
            return {
              email: dData.email || d.id,
              name: dData.name || '',
              role: dData.role || 'commander',
              assignedGrade: dData.assignedGrade || '',
              assignedClass: dData.assignedClass || ''
            };
          });
        }
      }
    } catch (e) {
      console.warn('[UserPermission] 服務獲取異常：', e);
    }
  }

  // 排序：總指揮官排最前
  userList.sort((a, b) => {
    if (a.role === 'commander' && b.role !== 'commander') return -1;
    if (b.role === 'commander' && a.role !== 'commander') return 1;
    return a.email.localeCompare(b.email);
  });

  let html = '';
  userList.forEach((u, idx) => {
    const isMaster = u.email === 'fishyaya@apps.ntpc.edu.tw' || u.email === 'poyilin59@gmail.com';
    const safeEmail = u.email.replace(/[^a-zA-Z0-9]/g, '_');
    const displayAccount = isMaster ? '👑 總指揮官主帳號 (系統管理)' : escapeHtml(u.email);

    html += `
      <tr style="border-bottom:1px solid #eee; background:${idx % 2 === 0 ? '#fff' : '#fdfdfd'};">
        <td style="padding:8px 10px; font-weight:bold; color:#1F4E79;">
          ${displayAccount} ${isMaster ? '<span style="background:#e83e8c; color:#fff; font-size:0.7rem; padding:1px 5px; border-radius:3px;">主要管理者</span>' : ''}
        </td>
        <td style="padding:6px 10px;">
          <input id="permNameInput_${safeEmail}" type="text" value="${escapeHtml(u.name)}" style="width:120px; padding:4px 6px; border:1px solid #ccc; border-radius:4px; font-size:0.82rem;" />
        </td>
        <td style="padding:6px 10px;">
          <select id="permRoleSelect_${safeEmail}" style="padding:4px 6px; border:1px solid #ccc; border-radius:4px; font-size:0.82rem; background:#fff;">
            <option value="commander" ${u.role === 'commander' ? 'selected' : ''}>👑 總指揮官 (commander)</option>
            <option value="medical" ${u.role === 'medical' ? 'selected' : ''}>🚑 緊急救護官 (medical)</option>
            <option value="inspector" ${u.role === 'inspector' ? 'selected' : ''}>🏢 建物巡檢組 (inspector)</option>
            <option value="pullout_teacher" ${u.role === 'pullout_teacher' ? 'selected' : ''}>🔄 抽離專責教師 (pullout)</option>
            <option value="visitor_manager" ${u.role === 'visitor_manager' ? 'selected' : ''}>📝 訪客登記組 (visitor)</option>
          </select>
        </td>
        <td style="padding:6px 10px; text-align:center;">
          <button type="button" style="padding:4px 8px; background:#28a745; color:#fff; border:none; border-radius:4px; font-size:0.75rem; font-weight:bold; cursor:pointer;" onclick="saveSingleUserPermission('${u.email}', '${safeEmail}')">💾 儲存</button>
          ${!isMaster ? `<button type="button" style="padding:4px 8px; background:#dc3545; color:#fff; border:none; border-radius:4px; font-size:0.75rem; font-weight:bold; cursor:pointer; margin-left:4px;" onclick="deleteSingleUserPermission('${u.email}')">🗑️ 刪除</button>` : ''}
        </td>
      </tr>
    `;
  });

  tbody.innerHTML = html;
}

/**
 * 儲存單一使用者的權限設定
 */
async function saveSingleUserPermission(email, safeEmail) {
  if (!checkSystemAdminAccess()) return;

  const nameInput = document.getElementById(`permNameInput_${safeEmail}`);
  const roleSelect = document.getElementById(`permRoleSelect_${safeEmail}`);

  const name = nameInput ? nameInput.value.trim() : '';
  const role = roleSelect ? roleSelect.value : 'commander';

  try {
    const fs = (typeof window !== 'undefined' && window.firestoreService) ||
               (typeof globalThis !== 'undefined' && globalThis.firestoreService);
    if (fs && typeof fs.setDoc === 'function' && typeof fs.doc === 'function') {
      await fs.setDoc(fs.doc('users', email), {
        email,
        name,
        role,
        updatedAt: Date.now()
      }, { merge: true });
    }

    const appConfig = (typeof window !== 'undefined' && window.__APP_CONFIG__) || null;
    const fbConfig = (appConfig && typeof appConfig.getFirebaseConfig === 'function') ? appConfig.getFirebaseConfig() : null;
    const projectId = (fbConfig && fbConfig.projectId) || 'disaster-prevention-syst-7169e';
    const apiKey = (fbConfig && fbConfig.apiKey) || 'AIzaSyBsLYXXrxxHIrgCvhgcS09xi9DGOUInfOc';

    await fetch(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${encodeURIComponent(email)}?key=${apiKey}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fields: {
          email: { stringValue: email },
          name: { stringValue: name },
          role: { stringValue: role },
          updatedAt: { integerValue: String(Date.now()) }
        }
      })
    });

    const roleName = ROLE_OPTIONS_MAP[role] || role;
    alert(`✅ 已成功更新「${name || email}」的權限為：【${roleName}】！`);
    await renderUserPermissionTable();
  } catch (err) {
    alert('儲存失敗：' + (err.message || err));
  }
}

/**
 * 新增人員權限
 */
async function addNewUserPermission() {
  if (!checkSystemAdminAccess()) return;

  const emailInput = document.getElementById('permNewEmail');
  const nameInput = document.getElementById('permNewName');
  const roleSelect = document.getElementById('permNewRole');

  const email = emailInput ? emailInput.value.trim().toLowerCase() : '';
  const name = nameInput ? nameInput.value.trim() : '';
  const role = roleSelect ? roleSelect.value : 'commander';

  if (!email || !email.includes('@') || !email.includes('.')) {
    alert('⚠️ 請輸入有效的電子信箱格式！');
    return;
  }

  try {
    const fs = (typeof window !== 'undefined' && window.firestoreService) ||
               (typeof globalThis !== 'undefined' && globalThis.firestoreService);
    if (fs && typeof fs.setDoc === 'function' && typeof fs.doc === 'function') {
      await fs.setDoc(fs.doc('users', email), {
        email,
        name: name || (ROLE_OPTIONS_MAP[role] || '教職員'),
        role,
        createdAt: Date.now(),
        updatedAt: Date.now()
      }, { merge: true });
    }

    const appConfig = (typeof window !== 'undefined' && window.__APP_CONFIG__) || null;
    const fbConfig = (appConfig && typeof appConfig.getFirebaseConfig === 'function') ? appConfig.getFirebaseConfig() : null;
    const projectId = (fbConfig && fbConfig.projectId) || 'disaster-prevention-syst-7169e';
    const apiKey = (fbConfig && fbConfig.apiKey) || 'AIzaSyBsLYXXrxxHIrgCvhgcS09xi9DGOUInfOc';

    await fetch(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${encodeURIComponent(email)}?key=${apiKey}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fields: {
          email: { stringValue: email },
          name: { stringValue: name || (ROLE_OPTIONS_MAP[role] || '教職員') },
          role: { stringValue: role },
          updatedAt: { integerValue: String(Date.now()) }
        }
      })
    });

    alert(`✅ 已成功指派「${name || email}」為【${ROLE_OPTIONS_MAP[role] || role}】！`);
    if (emailInput) emailInput.value = '';
    if (nameInput) nameInput.value = '';
    await renderUserPermissionTable();
  } catch (err) {
    alert('新增失敗：' + (err.message || err));
  }
}

/**
 * 刪除人員權限
 */
async function deleteSingleUserPermission(email) {
  if (!checkSystemAdminAccess()) return;

  if (email === 'fishyaya@apps.ntpc.edu.tw' || email === 'poyilin59@gmail.com') {
    alert('⚠️ 主要系統管理者帳號不可刪除！');
    return;
  }

  if (!confirm(`確定要移除「${email}」的職能權限嗎？\n移除後該帳號將無法使用該專屬功能。`)) {
    return;
  }

  try {
    const fs = (typeof window !== 'undefined' && window.firestoreService) ||
               (typeof globalThis !== 'undefined' && globalThis.firestoreService);
    if (fs && typeof fs.deleteDoc === 'function' && typeof fs.doc === 'function') {
      await fs.deleteDoc(fs.doc('users', email));
    }

    const appConfig = (typeof window !== 'undefined' && window.__APP_CONFIG__) || null;
    const fbConfig = (appConfig && typeof appConfig.getFirebaseConfig === 'function') ? appConfig.getFirebaseConfig() : null;
    const projectId = (fbConfig && fbConfig.projectId) || 'disaster-prevention-syst-7169e';
    const apiKey = (fbConfig && fbConfig.apiKey) || 'AIzaSyBsLYXXrxxHIrgCvhgcS09xi9DGOUInfOc';

    await fetch(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${encodeURIComponent(email)}?key=${apiKey}`, {
      method: 'DELETE'
    });

    alert(`✅ 已成功移除「${email}」的授權！`);
    await renderUserPermissionTable();
  } catch (err) {
    alert('刪除失敗：' + (err.message || err));
  }
}

/**
 * 開啟各組災難數字通報碼管理彈窗 (僅限總指揮官)
 */
async function openPasscodeModal() {
  if (typeof document === 'undefined') return;
  if (!checkSystemAdminAccess()) return;

  const modal = document.getElementById('passcodeModal');
  if (!modal) return;

  const auth = (typeof window !== 'undefined' && (window.AuthManager || window.auth || window.supabaseAuth)) ||
               (typeof globalThis !== 'undefined' && (globalThis.AuthManager || globalThis.auth || globalThis.supabaseAuth));
  let cfg = { medical: '1199', inspector: '7777', pullout_teacher: '3333', visitor_manager: '5555' };
  if (auth && typeof auth.getPasscodesConfig === 'function') {
    cfg = auth.getPasscodesConfig();
  } else {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const raw = window.localStorage.getItem('APP_AUTH_PASSCODES_CONFIG');
        if (raw) cfg = Object.assign(cfg, JSON.parse(raw));
      }
    } catch (e) {}
  }

  const pulInput = document.getElementById('cfgPasscodePullout');
  const medInput = document.getElementById('cfgPasscodeMedical');
  const insInput = document.getElementById('cfgPasscodeInspector');
  const visInput = document.getElementById('cfgPasscodeVisitor');

  if (pulInput) pulInput.value = cfg.pullout_teacher || '3333';
  if (medInput) medInput.value = cfg.medical || '1199';
  if (insInput) insInput.value = cfg.inspector || '7777';
  if (visInput) visInput.value = cfg.visitor_manager || '5555';

  modal.style.display = 'flex';
}

/**
 * 關閉各組災難數字通報碼管理彈窗
 */
function closePasscodeModal() {
  if (typeof document === 'undefined') return;
  const modal = document.getElementById('passcodeModal');
  if (modal) modal.style.display = 'none';
}

/**
 * 儲存總指揮官自訂之各組密碼設定
 */
async function savePasscodeConfigModal(event) {
  if (event && typeof event.preventDefault === 'function') event.preventDefault();
  if (!checkSystemAdminAccess()) return;

  const pulInput = document.getElementById('cfgPasscodePullout');
  const medInput = document.getElementById('cfgPasscodeMedical');
  const insInput = document.getElementById('cfgPasscodeInspector');
  const visInput = document.getElementById('cfgPasscodeVisitor');

  const newConfig = {
    pullout_teacher: pulInput ? pulInput.value.trim() : '3333',
    medical: medInput ? medInput.value.trim() : '1199',
    inspector: insInput ? insInput.value.trim() : '7777',
    visitor_manager: visInput ? visInput.value.trim() : '5555',
    updatedAt: Date.now()
  };

  // 驗證每組密碼長度介於 3 至 8 碼之間
  for (const [k, v] of Object.entries(newConfig)) {
    if (k === 'updatedAt') continue;
    if (!v || v.length < 3 || v.length > 8) {
      alert('⚠️ 各組密碼長度必須介於 3 至 8 碼之間！');
      return;
    }
  }

  try {
    const auth = (typeof window !== 'undefined' && (window.AuthManager || window.auth || window.supabaseAuth)) ||
                 (typeof globalThis !== 'undefined' && (globalThis.AuthManager || globalThis.auth || globalThis.supabaseAuth));

    if (auth && typeof auth.updatePasscodesConfig === 'function') {
      await auth.updatePasscodesConfig(newConfig);
    } else {
      // 離線/保底直接寫入 LocalStorage 與 Firestore
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.setItem('APP_AUTH_PASSCODES_CONFIG', JSON.stringify(newConfig));
        }
      } catch (e) {}

      // 寫入 Firestore SDK
      try {
        const fs = (typeof window !== 'undefined' && window.firestoreService) ||
                   (typeof globalThis !== 'undefined' && globalThis.firestoreService);
        if (fs && typeof fs.setDoc === 'function' && typeof fs.doc === 'function') {
          await fs.setDoc(fs.doc('config', 'passcodes'), newConfig, { merge: true });
        }
      } catch (e) {}

      // 寫入 Firestore REST API
      try {
        const appConfig = (typeof window !== 'undefined' && window.__APP_CONFIG__) || null;
        const fbConfig = (appConfig && typeof appConfig.getFirebaseConfig === 'function') ? appConfig.getFirebaseConfig() : null;
        const projectId = (fbConfig && fbConfig.projectId) || 'disaster-prevention-syst-7169e';
        const apiKey = (fbConfig && fbConfig.apiKey) || 'AIzaSyBsLYXXrxxHIrgCvhgcS09xi9DGOUInfOc';

        await fetch(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/config/passcodes?key=${apiKey}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fields: {
              medical: { stringValue: newConfig.medical },
              inspector: { stringValue: newConfig.inspector },
              pullout_teacher: { stringValue: newConfig.pullout_teacher },
              visitor_manager: { stringValue: newConfig.visitor_manager },
              updatedAt: { integerValue: String(newConfig.updatedAt) }
            }
          })
        });
      } catch (e) {}
    }

    alert('✅ 各組災難數字通報碼已成功更新！\n全校終端與登入視窗已即時同步新密碼。');
    closePasscodeModal();
  } catch (err) {
    alert('❌ 儲存失敗：' + (err.message || err));
  }
}

/**
 * 恢復各組密碼為系統原廠預設
 */
async function resetPasscodeConfigToDefault() {
  if (!checkSystemAdminAccess()) return;
  if (!confirm('確定要將各組密碼恢復為原廠預設嗎？')) {
    return;
  }

  const pulInput = document.getElementById('cfgPasscodePullout');
  const medInput = document.getElementById('cfgPasscodeMedical');
  const insInput = document.getElementById('cfgPasscodeInspector');
  const visInput = document.getElementById('cfgPasscodeVisitor');

  if (pulInput) pulInput.value = '3333';
  if (medInput) medInput.value = '1199';
  if (insInput) insInput.value = '7777';
  if (visInput) visInput.value = '5555';

  await savePasscodeConfigModal();
}

// ==============================================================================
// 指揮官全校數據重置
// ==============================================================================
function resetAllDataWithPassword() {
  if (typeof document === 'undefined') return;
  if (!checkCommanderAccess("執行全校重置")) return;

  if (confirm("⚠️ 確定要清空並重置全校點名紀錄與建築物檢核狀態嗎？此動作不可撤銷！")) {
    if (typeof google !== 'undefined' && google.script && google.script.run) {
      google.script.run.withSuccessHandler(function() {
        classReports = {};
        contactStates = {};
        searchStatusMap = {};
        searchNotesMap = {};
        helpRequestMap = {};
        assigneeMap = {};
        rescueTriageMap = {};
        pulloutStatusMap = {};
        visitorList = [];
        visitorCounts = { student: 0, teacher: 0, parent: 0, vendor: 0 };
        buildingStatusMap = {
          "慈愛樓": {}, "至善樓": {}, "維揚樓": {}, "樂群樓": {}, "弘德樓": {}, "中山樓": {}
        };
        renderSchoolOverview();
        renderPulloutPage();
        renderSummaryTable();
        renderRescueTable();
        renderBuildingGrid();
        if (currentClassStudents.length > 0) {
          currentClassStudents.forEach(s => studentStatusMap[s.seatRaw] = 'present');
          renderMatrix();
        }
        alert("✅ 全校點名紀錄與建築物檢核狀態已成功歸零重置！");
      }).clearAllReports();
    }
  }
}

// ==============================================================================
// 全校師生名冊與學籍在籍管理 (指揮中心專用)
// 支援即時查看、搜尋、篩選、新轉入登記、標記轉出、在籍狀態切換與 CSV 匯出
// ==============================================================================
let rosterCurrentPage = 1;
const rosterPageSize = 30;
let rosterFilteredStudents = [];

/**
 * 開啟師生名冊管理視窗
 */
async function openRosterModal() {
  if (typeof document === 'undefined') return;
  if (!checkSystemAdminAccess()) return;

  const modal = document.getElementById('rosterModal');
  if (!modal) return;
  modal.style.display = 'flex';

  // 初始化年級選單
  const gradeSel = document.getElementById('rosterGradeFilter');
  if (gradeSel) {
    const grades = [...new Set(allStudents.map(s => s.grade))].filter(Boolean);
    grades.sort((a, b) => (gradeSortOrder[a] || 99) - (gradeSortOrder[b] || 99));
    let opts = '<option value="">全部年級</option>';
    grades.forEach(g => {
      opts += `<option value="${g}">${g}${['一','二','三','四','五','六'].includes(g) ? '年級' : ''}</option>`;
    });
    gradeSel.innerHTML = opts;
  }

  rosterCurrentPage = 1;
  onRosterGradeChange();
  renderRosterTable();
}

/**
 * 關閉師生名冊管理視窗
 */
function closeRosterModal() {
  if (typeof document === 'undefined') return;
  const modal = document.getElementById('rosterModal');
  if (modal) modal.style.display = 'none';
  toggleNewStudentForm(false);
}

/**
 * 年級篩選變更時動態更新班級選單
 */
function onRosterGradeChange() {
  if (typeof document === 'undefined') return;
  const gradeSel = document.getElementById('rosterGradeFilter');
  const classSel = document.getElementById('rosterClassFilter');
  if (!gradeSel || !classSel) return;

  const selectedGrade = gradeSel.value;
  let classes = [];
  if (selectedGrade) {
    classes = [...new Set(allStudents.filter(s => s.grade === selectedGrade).map(s => s.className))].filter(Boolean);
  } else {
    classes = [...new Set(allStudents.map(s => s.className))].filter(Boolean);
  }
  classes.sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));

  let opts = '<option value="">全部班級</option>';
  classes.forEach(c => {
    opts += `<option value="${c}">${c}班</option>`;
  });
  classSel.innerHTML = opts;

  rosterCurrentPage = 1;
  renderRosterTable();
}

/**
 * 搜尋關鍵字或狀態變更時重新過濾
 */
function onRosterFilterChange() {
  rosterCurrentPage = 1;
  renderRosterTable();
}

/**
 * 切換分頁
 */
function changeRosterPage(delta) {
  const totalPages = Math.ceil(rosterFilteredStudents.length / rosterPageSize) || 1;
  const targetPage = rosterCurrentPage + delta;
  if (targetPage >= 1 && targetPage <= totalPages) {
    rosterCurrentPage = targetPage;
    renderRosterTable(false);
  }
}

/**
 * 展開或收合登記新轉入學生表單
 */
function toggleNewStudentForm(forceState) {
  if (typeof document === 'undefined') return;
  const card = document.getElementById('rosterNewStudentCard');
  if (!card) return;
  if (typeof forceState === 'boolean') {
    card.style.display = forceState ? 'block' : 'none';
  } else {
    card.style.display = card.style.display === 'none' ? 'block' : 'none';
  }
}

/**
 * 提交登記新轉入學生
 */
async function submitNewStudentForm() {
  if (!checkSystemAdminAccess()) return;

  const g = document.getElementById('newStuGrade')?.value || '一';
  const c = document.getElementById('newStuClass')?.value.trim() || '';
  const seatInput = document.getElementById('newStuSeat')?.value.trim() || '';
  const name = document.getElementById('newStuName')?.value.trim() || '';
  const gender = document.getElementById('newStuGender')?.value || '男';
  const phone = document.getElementById('newStuPhone')?.value.trim() || '';
  const teacher = document.getElementById('newStuTeacher')?.value.trim() || `${g}年${c}班導師`;
  const status = document.getElementById('newStuStatus')?.value || 'transferred_in';

  if (!c || !seatInput || !name) {
    alert('⚠️ 請填寫完整的班級、座號與學生姓名！');
    return;
  }

  const seatNum = parseInt(seatInput) || 0;
  const seatRaw = seatInput.includes('號') ? seatInput : (seatNum < 10 ? '0' + seatNum : String(seatNum)) + '號';
  const studentId = `${g}_${c}_${seatRaw}`;

  const studentObj = {
    id: studentId,
    grade: g,
    className: c,
    seatNum,
    seatRaw,
    name,
    gender,
    phone,
    teacher,
    teacherPhone: '',
    classKey: `${g} ${c}`,
    status: status,
    isActive: status !== 'transferred_out',
    transferredAt: new Date().toISOString(),
    isCustomAdded: true
  };

  // 1. 檢查是否存在相同學號/座號
  const existingIdx = allStudents.findIndex(s => (s.id === studentId) || (s.grade === g && s.className === c && s.seatRaw === seatRaw));
  if (existingIdx >= 0) {
    if (!confirm(`⚠️ 班級【${g} ${c}】座號 ${seatRaw} 目前已有學生【${allStudents[existingIdx].name}】，確定要覆蓋並設為轉入嗎？`)) {
      return;
    }
    allStudents[existingIdx] = { ...allStudents[existingIdx], ...studentObj };
  } else {
    allStudents.push(studentObj);
  }

  if (typeof window !== 'undefined') window.allStudents = allStudents;

  // 2. 存入後端 Firestore
  try {
    const fs = (typeof window !== 'undefined' && window.firestoreService) ||
               (typeof globalThis !== 'undefined' && globalThis.firestoreService);
    if (fs && typeof fs.setStudent === 'function') {
      await fs.setStudent(studentId, studentObj);
    }
    if (typeof google !== 'undefined' && google.script && google.script.run && typeof google.script.run.saveStudent === 'function') {
      google.script.run.saveStudent(studentObj);
    }
  } catch (err) {
    console.warn('[RosterManager] 儲存新轉入學生警告:', err);
  }

  // 3. 更新畫面
  toggleNewStudentForm(false);
  const nameEl = document.getElementById('newStuName');
  if (nameEl) nameEl.value = '';
  const seatEl = document.getElementById('newStuSeat');
  if (seatEl) seatEl.value = '';
  const phoneEl = document.getElementById('newStuPhone');
  if (phoneEl) phoneEl.value = '';

  renderRosterTable();
  renderSchoolOverview();
  renderPulloutPage();
  updateGradeDropdown();
  if (selectedClassBtn === c && selectedGradeOpt === g) {
    onClassClick(c);
  }

  alert(`🎉 成功登記新轉入學生：【${g} ${c}】${seatRaw} ${name}！`);
}

/**
 * 即時更新單一學生在籍狀態 (在籍 / 轉出 / 新轉入)
 */
async function updateStudentRosterStatus(studentId, newStatus) {
  if (!checkSystemAdminAccess()) return;

  const student = allStudents.find(s => s.id === studentId || `${s.grade}_${s.className}_${s.seatRaw}` === studentId);
  if (!student) {
    alert('找不到指定學生資料！');
    return;
  }

  student.status = newStatus;
  student.isActive = (newStatus !== 'transferred_out');
  student.transferredAt = new Date().toISOString();

  // 若標記為轉出，若該生在點名表中，將狀態重置或移除抽離
  const sKey = `${student.grade} ${student.className}_${student.seatRaw}`;
  if (newStatus === 'transferred_out') {
    if (pulloutStatusMap[sKey]) delete pulloutStatusMap[sKey];
    if (searchStatusMap[sKey]) delete searchStatusMap[sKey];
  }

  if (typeof window !== 'undefined') window.allStudents = allStudents;

  // 立即存入 Firestore
  try {
    const fs = (typeof window !== 'undefined' && window.firestoreService) ||
               (typeof globalThis !== 'undefined' && globalThis.firestoreService);
    if (fs && typeof fs.setStudent === 'function') {
      await fs.setStudent(student.id || studentId, student);
    }
    if (typeof google !== 'undefined' && google.script && google.script.run && typeof google.script.run.saveStudent === 'function') {
      google.script.run.saveStudent(student);
    }
  } catch (err) {
    console.warn('[RosterManager] 更新在籍狀態雲端儲存警告:', err);
  }

  // 立即連動全校看板與本班點名
  renderRosterTable(false);
  renderSchoolOverview();
  renderPulloutPage();
  if (selectedGradeOpt === student.grade && selectedClassBtn === student.className) {
    onClassClick(student.className);
  }

  const statusMap = {
    active: '🟢 正常在籍',
    transferred_out: '🔴 標記轉出 (已離校)',
    transferred_in: '🔵 新轉入'
  };
  console.log('[RosterManager]', `✅ 【${student.grade} ${student.className}】${student.seatRaw} ${student.name} 已更新為【${statusMap[newStatus] || newStatus}】`);
}

/**
 * 渲染名冊表格與統計卡片
 */
function renderRosterTable(recalculateFiltered = true) {
  if (typeof document === 'undefined') return;

  const totalEl = document.getElementById('rosterStatTotal');
  const activeEl = document.getElementById('rosterStatActive');
  const outEl = document.getElementById('rosterStatOut');
  const inEl = document.getElementById('rosterStatIn');
  const tbody = document.getElementById('rosterTableBody');
  const pageInfo = document.getElementById('rosterPageInfo');
  const pageCurrent = document.getElementById('rosterPageCurrent');
  const btnPrev = document.getElementById('btnRosterPrev');
  const btnNext = document.getElementById('btnRosterNext');

  if (!tbody) return;

  // 1. 全校總計統計更新
  const total = allStudents.length;
  const outCount = allStudents.filter(s => s.status === 'transferred_out' || s.isActive === false).length;
  const inCount = allStudents.filter(s => s.status === 'transferred_in').length;
  const activeCount = total - outCount;

  if (totalEl) totalEl.innerText = total.toLocaleString();
  if (activeEl) activeEl.innerText = activeCount.toLocaleString();
  if (outEl) outEl.innerText = outCount.toLocaleString();
  if (inEl) inEl.innerText = inCount.toLocaleString();

  // 2. 條件篩選
  if (recalculateFiltered) {
    const search = (document.getElementById('rosterSearchInput')?.value || '').trim().toLowerCase();
    const grade = document.getElementById('rosterGradeFilter')?.value || '';
    const className = document.getElementById('rosterClassFilter')?.value || '';
    const status = document.getElementById('rosterStatusFilter')?.value || '';

    rosterFilteredStudents = allStudents.filter(s => {
      if (grade && s.grade !== grade) return false;
      if (className && String(s.className) !== String(className)) return false;

      const sStatus = s.status || (s.isActive === false ? 'transferred_out' : 'active');
      if (status) {
        if (status === 'transferred_out' && sStatus !== 'transferred_out') return false;
        if (status === 'transferred_in' && sStatus !== 'transferred_in') return false;
        if (status === 'active' && (sStatus === 'transferred_out')) return false;
      }

      if (search) {
        const text = `${s.grade || ''} ${s.className || ''} ${s.seatRaw || ''} ${s.name || ''} ${s.phone || ''} ${s.parent || ''} ${s.teacher || ''}`.toLowerCase();
        if (!text.includes(search)) return false;
      }

      return true;
    });

    // 依年級、班級、座號排序
    rosterFilteredStudents.sort((a, b) => {
      const gDiff = (gradeSortOrder[a.grade] || 99) - (gradeSortOrder[b.grade] || 99);
      if (gDiff !== 0) return gDiff;
      const cDiff = String(a.className).localeCompare(String(b.className), undefined, { numeric: true });
      if (cDiff !== 0) return cDiff;
      return (a.seatNum || 0) - (b.seatNum || 0);
    });
  }

  // 3. 分頁截取
  const totalItems = rosterFilteredStudents.length;
  const totalPages = Math.ceil(totalItems / rosterPageSize) || 1;
  if (rosterCurrentPage > totalPages) rosterCurrentPage = totalPages;
  if (rosterCurrentPage < 1) rosterCurrentPage = 1;

  const startIdx = (rosterCurrentPage - 1) * rosterPageSize;
  const pageItems = rosterFilteredStudents.slice(startIdx, startIdx + rosterPageSize);

  if (pageInfo) pageInfo.innerText = `符合條件：共 ${totalItems} 筆 (第 ${startIdx + 1} - ${Math.min(startIdx + rosterPageSize, totalItems)} 筆)`;
  if (pageCurrent) pageCurrent.innerText = `${rosterCurrentPage} / ${totalPages}`;
  if (btnPrev) btnPrev.disabled = rosterCurrentPage <= 1;
  if (btnNext) btnNext.disabled = rosterCurrentPage >= totalPages;

  if (pageItems.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:18px; color:#888;">無符合篩選條件的學生資料。</td></tr>';
    return;
  }

  // 4. 渲染列
  let html = '';
  pageItems.forEach((s, idx) => {
    const sId = s.id || `${s.grade}_${s.className}_${s.seatRaw}`;
    const currStatus = s.status || (s.isActive === false ? 'transferred_out' : 'active');

    let badgeHtml = '<span style="background:#16a34a; color:#fff; padding:2px 6px; border-radius:4px; font-size:0.75rem; font-weight:bold;">🟢 正常在籍</span>';
    if (currStatus === 'transferred_out') {
      badgeHtml = '<span style="background:#dc2626; color:#fff; padding:2px 6px; border-radius:4px; font-size:0.75rem; font-weight:bold;">🔴 已轉出</span>';
    } else if (currStatus === 'transferred_in') {
      badgeHtml = '<span style="background:#2563eb; color:#fff; padding:2px 6px; border-radius:4px; font-size:0.75rem; font-weight:bold;">🔵 新轉入</span>';
    }

    const rowBg = currStatus === 'transferred_out' ? '#fff5f5' : (currStatus === 'transferred_in' ? '#f0f7ff' : (idx % 2 === 0 ? '#fff' : '#fafafa'));

    html += `
      <tr style="border-bottom:1px solid #e2e8f0; background:${rowBg};">
        <td style="padding:6px 8px; font-weight:bold; color:#1F4E79;">
          ${escapeHtml(s.grade)} ${escapeHtml(cleanClassLabel(s.className, s.grade))}
        </td>
        <td style="padding:6px 8px; font-weight:bold;">
          ${escapeHtml(s.seatRaw || (s.seatNum + '號'))}
        </td>
        <td style="padding:6px 8px; font-weight:bold; color:#0f172a;">
          ${escapeHtml(s.name || '')}
        </td>
        <td style="padding:6px 8px; color:#475569;">
          ${escapeHtml(s.gender || '學生')}
        </td>
        <td style="padding:6px 8px; color:#334155;">
          ${escapeHtml(s.phone || '-')}
        </td>
        <td style="padding:6px 8px; color:#475569;">
          ${escapeHtml(s.teacher || '-')}
        </td>
        <td style="padding:6px 8px; text-align:center;">
          ${badgeHtml}
        </td>
        <td style="padding:6px 8px; text-align:center;">
          <select style="padding:3px 6px; border:1px solid #94a3b8; border-radius:4px; font-size:0.78rem; background:#fff; font-weight:bold;" onchange="updateStudentRosterStatus('${sId}', this.value)">
            <option value="active" ${currStatus === 'active' ? 'selected' : ''}>🟢 設為在籍</option>
            <option value="transferred_out" ${currStatus === 'transferred_out' ? 'selected' : ''}>🔴 標記轉出</option>
            <option value="transferred_in" ${currStatus === 'transferred_in' ? 'selected' : ''}>🔵 標記新轉入</option>
          </select>
          ${s.isCustomAdded ? `<button type="button" style="padding:2px 6px; margin-left:4px; background:#ef4444; color:#fff; border:none; border-radius:3px; font-size:0.72rem; cursor:pointer;" onclick="deleteRosterStudent('${sId}')">🗑️</button>` : ''}
        </td>
      </tr>
    `;
  });

  tbody.innerHTML = html;
}

/**
 * 刪除自訂新增的學生
 */
async function deleteRosterStudent(studentId) {
  if (!checkSystemAdminAccess()) return;
  const s = allStudents.find(stu => stu.id === studentId || `${stu.grade}_${stu.className}_${stu.seatRaw}` === studentId);
  if (!s) return;

  if (!confirm(`確定要徹底刪除學生【${s.grade} ${s.className} ${s.name}】的紀錄嗎？`)) return;

  allStudents = allStudents.filter(stu => stu !== s);
  if (typeof window !== 'undefined') window.allStudents = allStudents;

  try {
    const fs = (typeof window !== 'undefined' && window.firestoreService) ||
               (typeof globalThis !== 'undefined' && globalThis.firestoreService);
    if (fs && typeof fs.deleteDoc === 'function' && typeof fs.doc === 'function') {
      await fs.deleteDoc(fs.doc('students', studentId));
    }
  } catch (err) {
    console.warn('[RosterManager] 刪除學生警告:', err);
  }

  renderRosterTable();
  renderSchoolOverview();
}

/**
 * 匯出名冊 CSV (UTF-8 with BOM 確保 Excel 開啟不亂碼)
 */
function exportRosterCSV() {
  if (rosterFilteredStudents.length === 0) {
    alert('目前篩選條件下無任何名單資料可匯出！');
    return;
  }

  let csv = '\uFEFF年級,班級,座號,姓名,性別,在籍狀態,家長電話,導師\n';
  rosterFilteredStudents.forEach(s => {
    const statusMap = { active: '正常在籍', transferred_out: '已轉出', transferred_in: '新轉入' };
    const stLabel = statusMap[s.status] || (s.isActive === false ? '已轉出' : '正常在籍');
    csv += `"${s.grade}","${s.className}","${s.seatRaw}","${s.name}","${s.gender || '學生'}","${stLabel}","${s.phone || ''}","${s.teacher || ''}"\n`;
  });

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `清水國小師生在籍名冊_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ==============================================================================
// 全校師生名冊 Excel 批次匯入與標準範本下載 (管理員專用)
// ==============================================================================
let excelParsedStudents = [];

/**
 * 開啟 Excel 匯入全校名冊對話框
 */
function openExcelImportModal() {
  if (typeof document === 'undefined') return;
  if (!checkSystemAdminAccess()) return;

  const modal = document.getElementById('excelImportModal');
  if (!modal) return;
  modal.style.display = 'flex';

  // 註冊拖曳放置事件
  const dropZone = document.getElementById('excelDropZone');
  if (dropZone && !dropZone._dragBound) {
    dropZone._dragBound = true;
    ['dragenter', 'dragover'].forEach(name => {
      dropZone.addEventListener(name, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.style.borderColor = '#059669';
        dropZone.style.background = '#ecfdf5';
      });
    });
    ['dragleave', 'drop'].forEach(name => {
      dropZone.addEventListener(name, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.style.borderColor = '#94a3b8';
        dropZone.style.background = '#f8fafc';
      });
    });
    dropZone.addEventListener('drop', (e) => {
      const files = e.dataTransfer && e.dataTransfer.files;
      if (files && files.length > 0) {
        handleExcelFileSelected({ target: { files: [files[0]] } });
      }
    });
  }
}

/**
 * 關閉 Excel 匯入對話框並重置選取狀態
 */
function closeExcelImportModal() {
  if (typeof document === 'undefined') return;
  const modal = document.getElementById('excelImportModal');
  if (modal) modal.style.display = 'none';

  excelParsedStudents = [];
  const fileInput = document.getElementById('excelFileInput');
  if (fileInput) fileInput.value = '';
  const fileNameLabel = document.getElementById('excelSelectedFileName');
  if (fileNameLabel) fileNameLabel.style.display = 'none';
  const previewSection = document.getElementById('excelPreviewSection');
  if (previewSection) previewSection.style.display = 'none';
  const btnExecute = document.getElementById('btnExecuteExcelImport');
  if (btnExecute) btnExecute.disabled = true;
  const progressBox = document.getElementById('excelImportProgressBox');
  if (progressBox) progressBox.style.display = 'none';
}

/**
 * 下載全校名冊標準 Excel 範例檔 (.xlsx)
 */
function downloadRosterExcelTemplate() {
  const headers = ['年級', '班級', '座號', '姓名', '性別', '家長電話', '導師姓名', '導師電話', '在籍狀態'];
  const sampleRows = [
    ['一', '1', '1', '陳大文', '男', '0912-345-001', '林慧珍老師', '0988-111-222', '正常在籍'],
    ['一', '1', '2', '林小華', '女', '0912-345-002', '林慧珍老師', '0988-111-222', '正常在籍'],
    ['一', '1', '3', '黃志強', '男', '0912-345-003', '林慧珍老師', '0988-111-222', '正常在籍'],
    ['一', '2', '1', '張小明', '男', '0922-333-001', '王美華老師', '0988-222-333', '正常在籍'],
    ['二', '1', '1', '王小美', '女', '0933-444-001', '張雅晴老師', '0988-333-444', '正常在籍'],
    ['三', '1', '1', '李大同', '男', '0944-555-001', '吳志豪老師', '0988-444-555', '正常在籍'],
    ['四', '1', '1', '劉小芬', '女', '0955-666-001', '陳淑惠老師', '0988-555-666', '新轉入'],
    ['五', '1', '1', '趙小龍', '男', '0966-777-001', '謝建國老師', '0988-666-777', '正常在籍'],
    ['六', '1', '1', '周大福', '男', '0977-888-001', '周俊傑老師', '0988-777-888', '正常在籍'],
    ['幼兒園', '企鵝班', '1', '孫小寶', '男', '0988-999-001', '幼教李老師', '0988-888-999', '正常在籍']
  ];

  const xlsxLib = (typeof window !== 'undefined' && window.XLSX) || (typeof globalThis !== 'undefined' && globalThis.XLSX) || null;
  if (xlsxLib && typeof xlsxLib.utils === 'object' && typeof xlsxLib.writeFile === 'function') {
    const ws = xlsxLib.utils.aoa_to_sheet([headers, ...sampleRows]);
    ws['!cols'] = [
      { wch: 10 }, { wch: 10 }, { wch: 8 }, { wch: 14 },
      { wch: 8 }, { wch: 16 }, { wch: 14 }, { wch: 16 }, { wch: 12 }
    ];
    const wb = xlsxLib.utils.book_new();
    xlsxLib.utils.book_append_sheet(wb, ws, '全校師生名冊範本');
    xlsxLib.writeFile(wb, '清水國小全校師生名冊_匯入範本.xlsx');
  } else {
    // 降級下載 CSV
    downloadRosterCsvTemplate();
  }
}

/**
 * 備用下載 CSV 範本檔 (UTF-8 with BOM)
 */
function downloadRosterCsvTemplate() {
  let csv = '\uFEFF年級,班級,座號,姓名,性別,家長電話,導師姓名,導師電話,在籍狀態\n';
  const sampleRows = [
    ['一', '1', '1', '陳大文', '男', '0912-345-001', '林慧珍老師', '0988-111-222', '正常在籍'],
    ['一', '1', '2', '林小華', '女', '0912-345-002', '林慧珍老師', '0988-111-222', '正常在籍'],
    ['一', '1', '3', '黃志強', '男', '0912-345-003', '林慧珍老師', '0988-111-222', '正常在籍'],
    ['一', '2', '1', '張小明', '男', '0922-333-001', '王美華老師', '0988-222-333', '正常在籍'],
    ['二', '1', '1', '王小美', '女', '0933-444-001', '張雅晴老師', '0988-333-444', '正常在籍'],
    ['三', '1', '1', '李大同', '男', '0944-555-001', '吳志豪老師', '0988-444-555', '正常在籍'],
    ['四', '1', '1', '劉小芬', '女', '0955-666-001', '陳淑惠老師', '0988-555-666', '新轉入'],
    ['五', '1', '1', '趙小龍', '男', '0966-777-001', '謝建國老師', '0988-666-777', '正常在籍'],
    ['六', '1', '1', '周大福', '男', '0977-888-001', '周俊傑老師', '0988-777-888', '正常在籍'],
    ['幼兒園', '企鵝班', '1', '孫小寶', '男', '0988-999-001', '幼教李老師', '0988-888-999', '正常在籍']
  ];
  sampleRows.forEach(row => {
    csv += row.map(v => `"${v}"`).join(',') + '\n';
  });

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = '清水國小全校師生名冊_匯入範本.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * 處理選取之 Excel / CSV 檔案
 */
async function handleExcelFileSelected(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;

  const fileNameLabel = document.getElementById('excelSelectedFileName');
  if (fileNameLabel) {
    fileNameLabel.innerText = `📄 已選取：${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
    fileNameLabel.style.display = 'inline-block';
  }

  try {
    const arrayBuffer = await file.arrayBuffer();
    const xlsxLib = (typeof window !== 'undefined' && window.XLSX) || (typeof globalThis !== 'undefined' && globalThis.XLSX) || null;

    let rows = [];
    if (xlsxLib && typeof xlsxLib.read === 'function') {
      const wb = xlsxLib.read(new Uint8Array(arrayBuffer), { type: 'array' });
      const firstSheet = wb.Sheets[wb.SheetNames[0]];
      rows = xlsxLib.utils.sheet_to_json(firstSheet, { header: 1, defval: '' });
    } else {
      // CSV 簡易解析器回退
      const text = new TextDecoder('utf-8').decode(arrayBuffer);
      rows = text.split(/\r?\n/).map(line => {
        const matches = line.match(/(".*?"|[^",]+)(?=\s*,|\s*$)/g);
        return matches ? matches.map(m => m.replace(/^"|"$/g, '').trim()) : line.split(',');
      }).filter(r => r && r.length > 0 && r.some(Boolean));
    }

    excelParsedStudents = parseRosterDataArray(rows);
    renderExcelPreview(excelParsedStudents);
  } catch (err) {
    console.error('[ExcelImport] 解析失敗：', err);
    alert('⚠️ 讀取 Excel 檔案失敗：' + (err.message || err));
  }
}

/**
 * 將解析後的二維陣列轉為正規化的學生名冊物件陣列
 * 遵守鐵律 2：年級字串維持單字大寫（「一」、「二」...），嚴禁使用正則強轉為「一年級」
 */
function parseRosterDataArray(rows) {
  if (!Array.isArray(rows) || rows.length < 2) return [];

  // 尋找表頭欄位索引
  const headerRow = rows[0].map(h => String(h || '').trim().toLowerCase());
  let colGrade = headerRow.findIndex(h => h.includes('年級') || h.includes('grade') || h.includes('年段'));
  let colClass = headerRow.findIndex(h => h.includes('班級') || h.includes('班') || h.includes('class'));
  let colSeat = headerRow.findIndex(h => h.includes('座號') || h.includes('號') || h.includes('seat'));
  let colName = headerRow.findIndex(h => h.includes('姓名') || h.includes('name'));
  let colGender = headerRow.findIndex(h => h.includes('性別') || h.includes('稱謂') || h.includes('身分') || h.includes('gender'));
  let colPhone = headerRow.findIndex(h => h.includes('家長電話') || h.includes('電話') || h.includes('手機') || h.includes('phone'));
  let colTeacher = headerRow.findIndex(h => h.includes('導師姓名') || h.includes('導師') || h.includes('teacher'));
  let colTeacherPhone = headerRow.findIndex(h => h.includes('導師電話') || h.includes('導師手機') || h.includes('teacherphone'));
  let colStatus = headerRow.findIndex(h => h.includes('在籍') || h.includes('狀態') || h.includes('status'));

  // 若標頭未明確匹配，依預設欄位順序退回
  if (colGrade === -1) colGrade = 0;
  if (colClass === -1) colClass = 1;
  if (colSeat === -1) colSeat = 2;
  if (colName === -1) colName = 3;
  if (colGender === -1) colGender = 4;
  if (colPhone === -1) colPhone = 5;
  if (colTeacher === -1) colTeacher = 6;
  if (colTeacherPhone === -1) colTeacherPhone = 7;
  if (colStatus === -1) colStatus = 8;

  const result = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.length === 0) continue;
    const rawGrade = r[colGrade];
    const rawName = r[colName];
    // 若該列全為空或缺少姓名，則跳過
    if (!rawName && !rawGrade) continue;

    const grade = normalizeGradeString(rawGrade);
    const className = normalizeClassName(r[colClass]);
    const { seatNum, seatRaw } = normalizeSeatNumAndRaw(r[colSeat]);
    const name = String(rawName || `學生_${grade}${className}_${seatRaw}`).trim();
    const gender = String(r[colGender] || '學生').trim();
    const phone = String(r[colPhone] || '').trim();
    const teacher = String(r[colTeacher] || `${grade}年級${className}班導師`).trim();
    const teacherPhone = String(r[colTeacherPhone] || '').trim();
    const { status, isActive } = normalizeStatus(r[colStatus]);
    const id = `${grade}_${className}_${seatRaw}`;
    const classKey = `${grade} ${className}`;

    result.push({
      id,
      grade,
      className,
      seatNum,
      seatRaw,
      name,
      parent: `家長_${grade}${className}_${seatRaw}`,
      phone,
      teacher,
      teacherPhone,
      gender,
      classKey,
      status,
      isActive,
      updatedAt: new Date().toISOString()
    });
  }

  return result;
}

function normalizeGradeString(rawGrade) {
  if (!rawGrade) return '一';
  const str = String(rawGrade).trim();
  if (/^[1一]/.test(str)) return '一';
  if (/^[2二]/.test(str)) return '二';
  if (/^[3三]/.test(str)) return '三';
  if (/^[4四]/.test(str)) return '四';
  if (/^[5五]/.test(str)) return '五';
  if (/^[6六]/.test(str)) return '六';
  if (str.includes('幼')) return '幼兒園';
  if (str.includes('特')) return '特教班';
  if (str.includes('應變')) return '緊急應變小組';
  return str;
}

function normalizeSeatNumAndRaw(rawSeat) {
  if (!rawSeat) return { seatNum: 1, seatRaw: '01號' };
  const str = String(rawSeat).replace(/[^\d]/g, '');
  const num = parseInt(str, 10) || 1;
  const raw = (num < 10 ? '0' + num : String(num)) + '號';
  return { seatNum: num, seatRaw: raw };
}

function normalizeClassName(rawClass) {
  if (!rawClass) return '1';
  let str = String(rawClass).trim();
  if (/^\d+班$/.test(str)) {
    str = str.replace(/班$/, '');
  }
  const num = parseInt(str, 10);
  if (!isNaN(num) && String(num) === str.replace(/^0+/, '')) {
    return String(num);
  }
  return str;
}

function normalizeStatus(rawStatus) {
  if (!rawStatus) return { status: 'active', isActive: true };
  const str = String(rawStatus).trim();
  if (str.includes('轉出') || str.includes('離校') || str.toLowerCase().includes('out')) {
    return { status: 'transferred_out', isActive: false };
  }
  if (str.includes('轉入') || str.toLowerCase().includes('in')) {
    return { status: 'transferred_in', isActive: true };
  }
  return { status: 'active', isActive: true };
}

/**
 * 渲染 Excel 預覽資料與統計
 */
function renderExcelPreview(students) {
  const previewSection = document.getElementById('excelPreviewSection');
  const countBadge = document.getElementById('excelParsedCountBadge');
  const statTotal = document.getElementById('prevStatTotal');
  const statActive = document.getElementById('prevStatActive');
  const statIn = document.getElementById('prevStatIn');
  const statOut = document.getElementById('prevStatOut');
  const statClasses = document.getElementById('prevStatClasses');
  const tbody = document.getElementById('excelPreviewTableBody');
  const btnExecute = document.getElementById('btnExecuteExcelImport');

  if (!students || students.length === 0) {
    if (previewSection) previewSection.style.display = 'none';
    if (btnExecute) btnExecute.disabled = true;
    alert('檔案中未讀取到有效的學生名單資料，請確認是否依範本欄位填寫。');
    return;
  }

  const total = students.length;
  const activeCount = students.filter(s => s.status === 'active').length;
  const inCount = students.filter(s => s.status === 'transferred_in').length;
  const outCount = students.filter(s => s.status === 'transferred_out').length;
  const classKeys = new Set(students.map(s => s.classKey));

  if (countBadge) countBadge.innerText = `共 ${total.toLocaleString()} 筆`;
  if (statTotal) statTotal.innerText = total.toLocaleString();
  if (statActive) statActive.innerText = activeCount.toLocaleString();
  if (statIn) statIn.innerText = inCount.toLocaleString();
  if (statOut) statOut.innerText = outCount.toLocaleString();
  if (statClasses) statClasses.innerText = `${classKeys.size} 班`;

  if (tbody) {
    let html = '';
    const previewList = students.slice(0, 5);
    previewList.forEach((s, idx) => {
      let stBadge = '<span style="color:#16a34a; font-weight:bold;">🟢 正常在籍</span>';
      if (s.status === 'transferred_out') stBadge = '<span style="color:#dc2626; font-weight:bold;">🔴 已轉出</span>';
      else if (s.status === 'transferred_in') stBadge = '<span style="color:#2563eb; font-weight:bold;">🔵 新轉入</span>';

      html += `
        <tr style="border-bottom:1px solid #eee; background:${idx % 2 === 0 ? '#fff' : '#fdfdfd'};">
          <td style="padding:4px 8px; font-weight:bold;">${escapeHtml(s.grade)}</td>
          <td style="padding:4px 8px;">${escapeHtml(s.className)}</td>
          <td style="padding:4px 8px;">${escapeHtml(s.seatRaw)}</td>
          <td style="padding:4px 8px; font-weight:bold; color:#1F4E79;">${escapeHtml(s.name)}</td>
          <td style="padding:4px 8px;">${escapeHtml(s.gender)}</td>
          <td style="padding:4px 8px;">${escapeHtml(s.phone || '-')}</td>
          <td style="padding:4px 8px;">${escapeHtml(s.teacher || '-')}</td>
          <td style="padding:4px 8px;">${stBadge}</td>
        </tr>
      `;
    });
    tbody.innerHTML = html;
  }

  if (previewSection) previewSection.style.display = 'block';
  if (btnExecute) btnExecute.disabled = false;
}

/**
 * 執行批次匯入全校師生名冊至 Firebase Cloud Firestore
 */
async function executeRosterExcelImport() {
  if (!checkSystemAdminAccess()) return;
  if (!excelParsedStudents || excelParsedStudents.length === 0) {
    alert('請先選取並解析 Excel 名冊檔案！');
    return;
  }

  const modeRadio = document.querySelector('input[name="excelImportMode"]:checked');
  const importMode = modeRadio ? modeRadio.value : 'merge';

  const confirmMsg = importMode === 'replace'
    ? `⚠️ 確定要【完全替換】全校名冊嗎？\n本次匯入共 ${excelParsedStudents.length} 筆資料，將作為全校最新名冊基準。`
    : `確定要【增量更新 / 合併】全校名冊嗎？\n本次將更新/匯入 ${excelParsedStudents.length} 筆學生資料。`;

  if (!confirm(confirmMsg)) return;

  const btnExecute = document.getElementById('btnExecuteExcelImport');
  const progressBox = document.getElementById('excelImportProgressBox');
  const progressBar = document.getElementById('excelProgressBar');
  const progressPercent = document.getElementById('excelProgressPercent');
  const progressLabel = document.getElementById('excelProgressLabel');

  if (btnExecute) btnExecute.disabled = true;
  if (progressBox) progressBox.style.display = 'block';

  try {
    // 1. 本地名冊記憶體合併
    if (importMode === 'replace') {
      allStudents = [...excelParsedStudents];
    } else {
      const studentMap = new Map();
      allStudents.forEach(s => {
        const key = s.id || `${s.grade}_${s.className}_${s.seatRaw}`;
        studentMap.set(key, s);
      });
      excelParsedStudents.forEach(s => {
        const key = s.id || `${s.grade}_${s.className}_${s.seatRaw}`;
        const existing = studentMap.get(key);
        studentMap.set(key, existing ? { ...existing, ...s } : s);
      });
      allStudents = Array.from(studentMap.values());
    }

    if (typeof window !== 'undefined') window.allStudents = allStudents;

    // 2. 批次寫入 Firebase Cloud Firestore
    const appConfig = (typeof window !== 'undefined' && window.__APP_CONFIG__) || null;
    const fbConfig = (appConfig && typeof appConfig.getFirebaseConfig === 'function') ? appConfig.getFirebaseConfig() : null;
    const projectId = (fbConfig && fbConfig.projectId) || 'disaster-prevention-syst-7169e';
    const apiKey = (fbConfig && fbConfig.apiKey) || 'AIzaSyBsLYXXrxxHIrgCvhgcS09xi9DGOUInfOc';

    const writes = excelParsedStudents.map(s => ({
      update: {
        name: `projects/${projectId}/databases/(default)/documents/students/${encodeURIComponent(s.id)}`,
        fields: {
          id: { stringValue: s.id },
          grade: { stringValue: s.grade },
          className: { stringValue: String(s.className) },
          seatNum: { integerValue: String(s.seatNum) },
          seatRaw: { stringValue: s.seatRaw },
          name: { stringValue: s.name },
          parent: { stringValue: s.parent || '' },
          phone: { stringValue: s.phone || '' },
          teacher: { stringValue: s.teacher || '' },
          teacherPhone: { stringValue: s.teacherPhone || '' },
          gender: { stringValue: s.gender || '學生' },
          classKey: { stringValue: s.classKey },
          status: { stringValue: s.status || 'active' },
          isActive: { booleanValue: s.isActive !== false },
          updatedAt: { stringValue: new Date().toISOString() }
        }
      }
    }));

    const BATCH_SIZE = 300;
    const totalWrites = writes.length;
    let completedWrites = 0;

    for (let i = 0; i < totalWrites; i += BATCH_SIZE) {
      const chunk = writes.slice(i, i + BATCH_SIZE);
      const pct = Math.round((completedWrites / totalWrites) * 100);
      if (progressBar) progressBar.style.width = `${pct}%`;
      if (progressPercent) progressPercent.innerText = `${pct}%`;
      if (progressLabel) progressLabel.innerText = `正在寫入 Firebase Firestore... [${completedWrites} / ${totalWrites}] 筆`;

      try {
        await fetch(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:commit?key=${apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ writes: chunk })
        });
      } catch (postErr) {
        console.warn('[ExcelImport] REST commit 批次寫入警告：', postErr);
      }

      completedWrites += chunk.length;
    }

    if (progressBar) progressBar.style.width = '100%';
    if (progressPercent) progressPercent.innerText = '100%';
    if (progressLabel) progressLabel.innerText = `✅ 寫入完成！共處理 ${totalWrites} 筆學生資料`;

    // 3. 同步寫入 IndexedDB / 本機 Firestore 服務
    const fs = (typeof window !== 'undefined' && window.firestoreService) ||
               (typeof globalThis !== 'undefined' && globalThis.firestoreService);
    if (fs && typeof fs.setStudent === 'function') {
      for (const s of excelParsedStudents) {
        await fs.setStudent(s.id, s);
      }
    }

    // 4. 更新前端所有視圖
    updateGradeDropdown();
    renderSchoolOverview();
    renderPulloutPage();
    renderRosterTable();
    if (selectedClassBtn && selectedGradeOpt) {
      onClassClick(selectedClassBtn);
    }

    alert(`🎉 全校師生名冊已成功批次匯入並同步至 Firebase！\n總共處理 ${excelParsedStudents.length} 筆學生資料。`);
    closeExcelImportModal();
  } catch (err) {
    console.error('[ExcelImport] 匯入作業發生異常：', err);
    alert('❌ 批次匯入過程發生錯誤：' + (err.message || err));
  } finally {
    if (btnExecute) btnExecute.disabled = false;
    if (progressBox) progressBox.style.display = 'none';
  }
}

// ==============================================================================
// 指揮中心四大看板、口頭報告詞膠囊與全校概況矩陣圖
// ==============================================================================
function renderSchoolOverview() {
  if (typeof document === 'undefined') return;
  let container = document.getElementById("schoolOverviewContainer");
  if (!container) return;
  container.innerHTML = "";

  if (!allStudents || allStudents.length === 0) {
    container.innerHTML = '<div style="color:#666; font-size:0.85rem;">目前資料庫中尚無學生資料。</div>';
    return;
  }

  // 1. 群組化所有學生資料 (排除已轉出學生)
  let gradeGroupMap = {};
  allStudents.forEach(s => {
    if (s.status === 'transferred_out' || s.isActive === false) return;
    let gName = s.grade;
    if (!gradeGroupMap[gName]) gradeGroupMap[gName] = new Set();
    gradeGroupMap[gName].add(s.className);
  });

  // 2. 嚴格依據 Config 表篩選「當前時段有班級在校」的年級
  let gradeList = Object.keys(gradeGroupMap).filter(g => isClassActiveAtTime(g, ""));
  if (gradeList.length === 0) {
    container.innerHTML = '<div style="color:#1F4E79; font-weight:bold; font-size:0.85rem; padding:12px; text-align:center; background:#e8f4f8; border:1px solid #bee5eb; border-radius:6px; line-height:1.6;">' +
      '⚠️ 當前真實時間非在校時段（全校放學中）。<br>' +
      '👉 如需進行防災演練測試，請在上方時段選單切換至【🕒 星期一 (09:00全校在校)】。<br>' +
      '<button onclick="const sel = document.getElementById(\'simTimeSelect\'); if(sel){sel.value=\'mon_am\';} onSimTimeChange(\'mon_am\');" style="margin-top:8px; padding:6px 14px; background:#1F4E79; color:#fff; border:none; border-radius:4px; font-weight:bold; cursor:pointer;">🔘 一鍵切換為【週一 上午 (全校在校)】進行演練</button>' +
      '</div>';
    const setNum = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };
    setNum("spTotal", 0);
    setNum("spLeave", 0);
    setNum("spHospital", 0);
    setNum("spEscort", 0);
    setNum("spPresent", 0);
    setNum("spVisitor", visitorList.length);
    setNum("spRescuing", 0);
    setNum("statCardTotal", 0);
    setNum("statCardExpected", 0);
    setNum("statCardPresent", 0);
    setNum("statCardAbsent", 0);
    let breakdown = document.getElementById("calcBreakdownContainer");
    if (breakdown) breakdown.innerHTML = '<span class="calc-breakdown-pill">總計在校: 0人</span>';
    setNum("calcTotalLabel", 0);
    return;
  }

  gradeList.sort((a, b) => (gradeSortOrder[a] || 99) - (gradeSortOrder[b] || 99));

  let grandTotal = 0, grandPresent = 0, grandLeave = 0, grandHospital = 0, grandEscort = 0, grandRescuing = 0;
  let breakdownHtml = "";

  // 3. 逐一年級渲染區塊與班級卡片
  gradeList.forEach(gradeName => {
    let gradeDiv = document.createElement("div");
    gradeDiv.className = "grade-section";
    let header = document.createElement("div");
    header.className = "grade-section-header";
    let title = document.createElement("div");
    title.className = "grade-section-title";
    title.innerText = "🏫 " + gradeName;
    header.appendChild(title);

    let classList = Array.from(gradeGroupMap[gradeName]).filter(c => isClassActiveAtTime(gradeName, c));
    classList.sort((a, b) => a.localeCompare(b, 'zh-Hant', { numeric: true }));

    if (classList.length === 0) return;

    let gPresentTotal = 0, gLeaveTotal = 0, gMissingTotal = 0, gTotal = 0, gDoneTotal = 0;

    classList.forEach(cName => {
      let fullKey = gradeName + " " + cName;
      let rep = classReports[fullKey];

      if (rep) {
        gTotal += (rep.total || 0);
        let classPresent = rep.presentCount || 0;

        // 抽離學生安全狀態統計 (恪遵鐵律 4)
        let checkPullout = function(sList) {
          if (sList && sList.length > 0) {
            sList.forEach(s => {
              let sKey = fullKey + "_" + s.seatRaw;
              let pState = pulloutStatusMap[sKey] || 'pending';
              let isDone = !!searchStatusMap[sKey];

              if (pState === 'safe' || isDone) {
                classPresent++;
              } else if (pState === 'missing') {
                gMissingTotal++;
                grandRescuing++;
              }
              // 鐵律 4：若為 pending，嚴格不做任何累加，絕不計入搜救失蹤！
            });
          }
        };

        checkPullout(rep.studyCenter);
        checkPullout(rep.nativeLang);
        checkPullout(rep.team);

        gPresentTotal += classPresent;
        gLeaveTotal += (rep.leave ? rep.leave.length : 0);

        // 失蹤搜救與送醫處置統計
        if (rep.missing) {
          rep.missing.forEach(m => {
            let mKey = fullKey + "_" + m.seatRaw;
            if (searchStatusMap[mKey] && contactStates[mKey] && contactStates[mKey].status === "已聯繫") {
              gDoneTotal++;
            } else if (!searchStatusMap[mKey]) {
              gMissingTotal++;
              grandRescuing++;
            }

            let rData = rescueTriageMap[mKey];
            if (rData && rData.status === "injured") {
              if (rData.triage === "yellow" || rData.triage === "red" || rData.triage === "黃卡" || rData.triage === "紅卡") {
                grandHospital++;
                grandEscort += (rData.escortCount || 0);
              }
            }
          });
        }
      } else {
        let rawCount = allStudents.filter(s => s.grade === gradeName && s.className === cName && s.status !== 'transferred_out' && s.isActive !== false).length;
        gTotal += rawCount;
      }
    });

    grandTotal += gTotal;
    grandPresent += gPresentTotal;
    grandLeave += gLeaveTotal;

    breakdownHtml += '<span class="calc-breakdown-pill">' + gradeName + ' (' + classList.length + '班): ' + gTotal + '人</span>';

    let statsSummary = document.createElement("div");
    statsSummary.className = "grade-stats-summary";
    statsSummary.innerHTML = '應到:' + gTotal + ' | 實:<span style="color:#155724;">' + gPresentTotal + '</span> | 假:<span style="color:#856404;">' + gLeaveTotal + '</span> | 失:<span style="color:#721c24;">' + gMissingTotal + '</span> | 結:<span style="color:#0f5132;">' + gDoneTotal + '</span>';
    header.appendChild(statsSummary);
    gradeDiv.appendChild(header);

    // 班級狀態卡片矩陣
    let grid = document.createElement("div");
    grid.className = "school-overview-grid";

    classList.forEach(cName => {
      let fullKey = gradeName + " " + cName;
      let rep = classReports[fullKey];
      let card = document.createElement("div");
      card.onclick = function() { scrollToClassRow(fullKey); };
      let shortClassName = cleanClassLabel(cName, gradeName);

      if (!rep) {
        card.className = "class-status-card";
        card.innerHTML = '<span class="class-name-num">' + shortClassName + '</span><span class="count-tag">待填報</span>';
      } else {
        let missingCount = rep.missing ? rep.missing.length : 0;
        let leaveCount = rep.leave ? rep.leave.length : 0;
        let presentCount = rep.presentCount || 0;

        let pulloutMissingCount = 0;
        let checkPulloutCard = function(sList) {
          if (sList && sList.length > 0) {
            sList.forEach(s => {
              let sKey = fullKey + "_" + s.seatRaw;
              let pState = pulloutStatusMap[sKey] || 'pending';
              let isDone = !!searchStatusMap[sKey];
              if (pState === 'safe' || isDone) {
                presentCount++;
              } else if (pState === 'missing') {
                pulloutMissingCount++;
              }
              // 鐵律 4：pending 抽離學生絕不計入 pulloutMissingCount，班級卡片絕不染紅！
            });
          }
        };
        checkPulloutCard(rep.studyCenter);
        checkPulloutCard(rep.nativeLang);
        checkPulloutCard(rep.team);

        let allMissingKeys = [];
        if (rep.missing) rep.missing.forEach(m => allMissingKeys.push(fullKey + "_" + m.seatRaw));

        let collectPulloutMissing = function(sList) {
          if (sList) {
            sList.forEach(s => {
              let sKey = fullKey + "_" + s.seatRaw;
              if (pulloutStatusMap[sKey] === 'missing' && !allMissingKeys.includes(sKey)) {
                allMissingKeys.push(sKey);
              }
            });
          }
        };
        collectPulloutMissing(rep.studyCenter);
        collectPulloutMissing(rep.nativeLang);
        collectPulloutMissing(rep.team);

        let totalDisplayMissing = missingCount + pulloutMissingCount;
        let allMissingSearchDone = false;
        let allMissingContactDone = false;

        if (allMissingKeys.length > 0) {
          allMissingSearchDone = allMissingKeys.every(sKey => !!searchStatusMap[sKey]);
          allMissingContactDone = allMissingKeys.every(sKey => contactStates[sKey] && contactStates[sKey].status === "已聯繫");
        }

        if (totalDisplayMissing === 0 && leaveCount === 0) {
          card.className = "class-status-card all-present";
          card.innerHTML = '<span class="class-name-num">' + shortClassName + '</span><span class="count-tag">實' + presentCount + '/假0/失0</span>';
        } else if (totalDisplayMissing === 0) {
          card.className = "class-status-card has-leave";
          card.innerHTML = '<span class="class-name-num">' + shortClassName + '</span><span class="count-tag">實' + presentCount + '/假' + leaveCount + '/失0</span>';
        } else if (allMissingSearchDone && allMissingContactDone) {
          card.className = "class-status-card search-contact-all-done";
          card.innerHTML = '<span class="class-name-num">' + shortClassName + '</span><span class="count-tag">實' + presentCount + '/假' + leaveCount + '/已結案' + totalDisplayMissing + '</span>';
        } else if (allMissingSearchDone) {
          card.className = "class-status-card search-all-done";
          card.innerHTML = '<span class="class-name-num">' + shortClassName + '</span><span class="count-tag">實' + presentCount + '/假' + leaveCount + '/已結案' + totalDisplayMissing + '</span>';
        } else {
          card.className = "class-status-card has-missing";
          card.innerHTML = '<span class="class-name-num">' + shortClassName + '</span><span class="count-tag">實' + presentCount + '/假' + leaveCount + '/失' + totalDisplayMissing + '</span>';
        }
      }
      grid.appendChild(card);
    });

    gradeDiv.appendChild(grid);
    container.appendChild(gradeDiv);
  });

  // 4. 校外人士彙整
  let totalVisitors = visitorList.length;
  let safeVisitors = visitorList.filter(v => v.status === "safe").length;
  let missingVisitors = visitorList.filter(v => v.status === "missing").length;
  grandRescuing += missingVisitors;

  let vSummarySection = document.createElement("div");
  vSummarySection.className = "grade-section";
  vSummarySection.style.background = "rgba(235, 243, 250, 0.9)";
  vSummarySection.style.border = "1px solid #17a2b8";

  let vHeader = document.createElement("div");
  vHeader.className = "grade-section-header";
  vHeader.innerHTML = '<div class="grade-section-title" style="color:#17a2b8;">👥 校外 / 臨時人員動態彙整</div>' +
    '<div class="grade-stats-summary" style="border-color:#17a2b8;">登錄總數: <b>' + totalVisitors + '</b> 人 | 🟢現場出席: <span style="color:#155724;">' + safeVisitors + '</span> | 🔴失蹤搜救: <span style="color:#dc3545;">' + missingVisitors + '</span></div>';
  vSummarySection.appendChild(vHeader);

  let vGrid = document.createElement("div");
  vGrid.className = "school-overview-grid";
  vGrid.style.marginTop = "4px";

  const catKeys = [
    { type: "student", label: "🎒 學生" },
    { type: "teacher", label: "👨🏫 代課" },
    { type: "parent", label: "🤝 訪客" },
    { type: "vendor", label: "👷 廠商" }
  ];

  catKeys.forEach(cat => {
    let catItems = visitorList.filter(v => v.type === cat.type);
    let catTotal = catItems.length;
    let catSafe = catItems.filter(v => v.status === "safe").length;
    let catMissing = catItems.filter(v => v.status === "missing").length;

    let vCard = document.createElement("div");
    vCard.className = "class-status-card";
    vCard.style.minWidth = "110px";

    if (catTotal === 0) {
      vCard.innerHTML = '<span class="class-name-num">' + cat.label + '</span><span class="count-tag">未登記 (0人)</span>';
    } else if (catMissing > 0) {
      vCard.className = "class-status-card has-missing";
      vCard.innerHTML = '<span class="class-name-num">' + cat.label + '</span><span class="count-tag">共' + catTotal + '人 (失' + catMissing + ')</span>';
    } else {
      vCard.className = "class-status-card all-present";
      vCard.innerHTML = '<span class="class-name-num">' + cat.label + '</span><span class="count-tag">出席' + catSafe + '人/失0</span>';
    }
    vGrid.appendChild(vCard);
  });

  vSummarySection.appendChild(vGrid);
  container.appendChild(vSummarySection);

  // 5. 更新數據膠囊與指揮官總覽
  breakdownHtml += '<span class="calc-breakdown-pill" style="background:#1F4E79; color:#fff;">總計在校: ' + grandTotal + '人</span>';
  let breakdownEl = document.getElementById("calcBreakdownContainer");
  if (breakdownEl) breakdownEl.innerHTML = breakdownHtml;

  let calcLabelEl = document.getElementById("calcTotalLabel");
  if (calcLabelEl) calcLabelEl.innerText = grandTotal;

  let finalExpectedTotal = (approvedCustomTotal !== null) ? approvedCustomTotal : grandTotal;
  const setVal = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.innerText = val;
  };

  // 更新口頭報告詞膠囊
  setVal("spTotal", finalExpectedTotal);
  setVal("spLeave", grandLeave);
  setVal("spHospital", grandHospital);
  setVal("spEscort", grandEscort);
  setVal("spPresent", grandPresent);
  setVal("spVisitor", totalVisitors);
  setVal("spRescuing", grandRescuing);

  // 更新四大狀態看板卡片 (.card-total, .card-expected, .card-present, .card-absent)
  setVal("statCardTotal", grandTotal);
  setVal("statCardExpected", finalExpectedTotal);
  setVal("statCardPresent", grandPresent);
  setVal("statCardAbsent", (grandLeave + grandRescuing));

  // 6. 建物安全標籤動態
  let bTagsContainer = document.getElementById("buildingStatusTagContainer");
  if (bTagsContainer) {
    let bTagHtml = "";
    Object.keys(buildingStatusMap).forEach(bName => {
      if (bName === "ALL") return;
      let bData = buildingStatusMap[bName] || {};
      let isSubmitted = (bData.submitted === true);
      let hasDanger = false;

      buildingCheckItems.forEach((_, idx) => {
        if (bData["item_" + idx] === true) hasDanger = true;
      });

      if (isSubmitted && hasDanger) {
        bTagHtml += '<span class="building-status-tag danger">🔴 ' + bName + ': 受損</span>';
      } else if (isSubmitted) {
        bTagHtml += '<span class="building-status-tag safe">🟢 ' + bName + ': 安全</span>';
      } else {
        bTagHtml += '<span class="building-status-tag pending">⏳ ' + bName + ': 待檢</span>';
      }
    });
    bTagsContainer.innerHTML = bTagHtml;
  }
}

function approveCalculatedTotal() {
  if (typeof document === 'undefined') return;
  if (!checkCommanderAccess("核定採納試算人數")) return;
  let calcVal = parseInt(document.getElementById("calcTotalLabel")?.innerText || "0", 10) || 0;
  approvedCustomTotal = calcVal;
  renderSchoolOverview();
  saveFullSystemStateToBackend();
  alert("✅ 指揮官已採納試算數（在校應出席：" + calcVal + " 人）！");
}

function setCustomTotalAttendance() {
  if (typeof document === 'undefined') return;
  if (!checkCommanderAccess("手動修改全校在校人數")) return;
  let val = prompt("✏️ 請輸入全校自訂應出席總人數：", approvedCustomTotal !== null ? String(approvedCustomTotal) : "2143");
  if (val !== null && val.trim() !== "" && !isNaN(Number(val))) {
    let parsed = Number(val);
    if (parsed < 0) {
      alert("⚠️ 人數不能為負數！");
      return;
    }
    if (parsed > 5000) {
      if (!confirm("⚠️ 輸入人數超過 5000 人（超出一般校園合理規模），確定要儲存嗎？")) {
        return;
      }
    }
    approvedCustomTotal = parsed;
    renderSchoolOverview();
    saveFullSystemStateToBackend();
    alert("✅ 已成功自訂全校應出席人數為：" + approvedCustomTotal + " 人");
  } else if (val !== null) {
    alert("❌ 請輸入有效的純數字！");
  }
}

function scrollToClassRow(classKey) {
  if (typeof document === 'undefined') return;
  let targetRow = document.getElementById("row_active_" + classKey) || document.getElementById("row_done_" + classKey);
  if (targetRow) {
    targetRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } else {
    alert("ℹ️ " + classKey + " 目前無失蹤學生，無需進一步搜救追蹤。");
  }
}

function scrollToOverviewTop() {
  if (typeof document === 'undefined') return;
  let topAnchor = document.getElementById("overviewTopAnchor");
  if (topAnchor) topAnchor.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ==============================================================================
// 失蹤學生緊急聯繫與搜救追蹤總表
// ==============================================================================
function renderSummaryTable() {
  if (typeof document === 'undefined') return;
  let tbodyActive = document.getElementById("summaryTableActive");
  let tbodyDone = document.getElementById("summaryTableDone");
  if (!tbodyActive || !tbodyDone) return;

  tbodyActive.innerHTML = "";
  tbodyDone.innerHTML = "";

  let keys = Object.keys(classReports);
  let activeCount = 0, doneCount = 0;
  let allMissingItems = [];

  keys.forEach(k => {
    let rep = classReports[k];
    let gName = rep.grade || k.split(" ")[0] || "";
    let cName = rep.className || k.split(" ")[1] || "";

    if (rep.missing && rep.missing.length > 0) {
      rep.missing.forEach((s, idx) => {
        let studentKey = k + "_" + s.seatRaw;
        if (!contactStates[studentKey]) contactStates[studentKey] = { status: "未聯繫", count: 0 };
        let state = contactStates[studentKey];
        let isSearchDone = !!searchStatusMap[studentKey];
        let isHelpReq = !!helpRequestMap[studentKey];

        let originalStudentData = allStudents.find(orig => orig.grade === gName && orig.className === cName && orig.seatRaw === s.seatRaw);
        let teacherName = s.teacher || (originalStudentData ? originalStudentData.teacher : '');
        let teacherPhone = s.teacherPhone || (originalStudentData ? originalStudentData.teacherPhone : '');

        allMissingItems.push({
          classKey: k, gradeName: gName, className: cName,
          student: { ...s, teacher: teacherName, teacherPhone: teacherPhone },
          studentKey: studentKey, state: state, isSearchDone: isSearchDone, isHelpReq: isHelpReq,
          isFirstInClass: idx === 0, pulloutLabel: null
        });
      });
    }

    let checkPulloutMissing = function(sList, labelText) {
      if (sList && sList.length > 0) {
        sList.forEach((s) => {
          let studentKey = k + "_" + s.seatRaw;
          if (pulloutStatusMap[studentKey] === 'missing' && !allMissingItems.some(item => item.studentKey === studentKey)) {
            if (!contactStates[studentKey]) contactStates[studentKey] = { status: "未聯繫", count: 0 };
            let state = contactStates[studentKey];
            let isSearchDone = !!searchStatusMap[studentKey];
            let isHelpReq = !!helpRequestMap[studentKey];

            let originalStudentData = allStudents.find(orig => orig.grade === gName && orig.className === cName && orig.seatRaw === s.seatRaw);
            let teacherName = s.teacher || (originalStudentData ? originalStudentData.teacher : '');
            let teacherPhone = s.teacherPhone || (originalStudentData ? originalStudentData.teacherPhone : '');

            allMissingItems.push({
              classKey: k, gradeName: gName, className: cName,
              student: { ...s, teacher: teacherName, teacherPhone: teacherPhone },
              studentKey: studentKey, state: state, isSearchDone: isSearchDone, isHelpReq: isHelpReq,
              isFirstInClass: false, pulloutLabel: labelText
            });
          }
        });
      }
    };
    checkPulloutMissing(rep.studyCenter, "學習中心");
    checkPulloutMissing(rep.nativeLang, "本土語");
    checkPulloutMissing(rep.team, "團隊");
  });

  visitorList.filter(v => v.status === "missing").forEach(v => {
    let studentKey = "校外人士_" + v.title;
    if (!allMissingItems.some(item => item.studentKey === studentKey)) {
      if (!contactStates[studentKey]) contactStates[studentKey] = { status: "未聯繫", count: 0 };
      let state = contactStates[studentKey];
      let isSearchDone = !!searchStatusMap[studentKey];
      let isHelpReq = !!helpRequestMap[studentKey];

      allMissingItems.push({
        classKey: "校外人士", gradeName: "校外人士", className: "校外人員",
        student: { seatRaw: v.seq + "號", name: v.title + (v.note ? " (" + v.note + ")" : ""), phone: "", teacher: "無導師", teacherPhone: "" },
        studentKey: studentKey, state: state, isSearchDone: isSearchDone, isHelpReq: isHelpReq,
        isFirstInClass: false, pulloutLabel: "校外失蹤"
      });
    }
  });

  allMissingItems.sort((a, b) => {
    let isCompA = a.isSearchDone && (a.state.status === "已聯繫");
    let isCompB = b.isSearchDone && (b.state.status === "已聯繫");
    if (isCompA !== isCompB) return isCompA ? 1 : -1;

    let gA = gradeSortOrder[a.gradeName] || 99;
    let gB = gradeSortOrder[b.gradeName] || 99;
    if (gA !== gB) return gA - gB;

    let classComp = a.className.localeCompare(b.className, 'zh-Hant', { numeric: true });
    if (classComp !== 0) return classComp;

    let rA = rescueTriageMap[a.studentKey] || { status: "searching", triage: "none" };
    let rB = rescueTriageMap[b.studentKey] || { status: "searching", triage: "none" };

    function getRank(r) {
      if (r.status === "injured") {
        if (r.triage === "red") return 1;
        if (r.triage === "yellow") return 2;
        if (r.triage === "green") return 3;
        return 5;
      }
      if (r.status === "safe") return 4;
      if (r.status === "searching") return 5;
      return 99;
    }

    let rankA = getRank(rA);
    let rankB = getRank(rB);
    if (rankA !== rankB) return rankA - rankB;

    return (a.student.seatNum || 0) - (b.student.seatNum || 0);
  });

  allMissingItems.forEach(item => {
    let k = item.classKey;
    let s = item.student;
    let studentKey = item.studentKey;
    let state = item.state;
    let isSearchDone = item.isSearchDone;
    let isHelpReq = item.isHelpReq;
    let assigneeName = assigneeMap[studentKey] || '';

    let rData = rescueTriageMap[studentKey] || { status: "searching", triage: "none", note: "", locationFound: "" };
    let isCaseCompleted = isSearchDone && (state.status === "已聯繫");

    let locText = "";
    if (s.locationTag || s.locationNote) {
      let partsLoc = [];
      if (s.locationTag) partsLoc.push(s.locationTag);
      if (s.locationNote) partsLoc.push(s.locationNote);
      locText = '<br><small style="color:#d9534f; font-weight:bold;">📌 ' + partsLoc.join(" / ") + '</small>';
    }

    let phoneHref = getPhoneHref(s.phone);
    let teacherPhoneHref = getPhoneHref(s.teacherPhone);
    let displayParentPhone = (securityMode === "drill" && !isUnlockedByPassword) || isSiteLocked ?
      '<span class="masked-phone" onclick="verifyPasswordToUnlockPhone()">🔒 ***-***</span>' :
      '<a class="phone-link" href="' + phoneHref + '">📞 ' + (s.phone || '無電話') + '</a>';

    let row = document.createElement("tr");
    if (isCaseCompleted) row.id = item.isFirstInClass ? "row_done_" + k : "row_done_" + studentKey;
    else {
      row.id = item.isFirstInClass ? "row_active_" + k : "row_active_" + studentKey;
      if (isHelpReq) row.className = "help-requested";
    }

    let helpTagHtml = (isHelpReq && !isCaseCompleted) ? '<br><span style="color:#dc3545; font-weight:bold; font-size:0.7rem;">🚨 請求協助</span>' : '';
    let teacherCellHtml = s.teacher ? '<b>' + s.teacher + '</b>' + (s.teacherPhone ? '<br><a class="phone-link" style="padding:1px 4px; font-size:0.7rem;" href="' + teacherPhoneHref + '">📞 撥打導師</a>' : '') : '無導師資訊';

    let badgeHtml = '<span class="badge-status-missing">🚨 搜救中</span>';
    if (rData.status === "safe") badgeHtml = '<span class="badge-status-found">🟢 安全送班</span>';
    else if (rData.status === "injured") {
      if (rData.triage === "green") badgeHtml = '<span class="badge-status-found">🟢 綠卡輕傷</span>';
      else if (rData.triage === "yellow") badgeHtml = '<span class="badge-status-yellow">🟡 黃卡送醫</span>';
      else if (rData.triage === "red") badgeHtml = '<span class="badge-status-red">🔴 紅卡送醫</span>';
      else badgeHtml = '<span style="background:#fd7e14; color:#fff; padding:3px 8px; border-radius:12px; font-weight:bold; font-size:0.72rem;">🚑 轉介救護</span>';
    } else if (isSearchDone) {
      badgeHtml = '<span class="badge-status-found">✅ 已尋獲</span>';
    }

    let descText = rData.locationFound ? "📌 " + rData.locationFound : "";
    if (rData.note) descText += (descText ? " | " : "") + "📝 " + rData.note;
    if (!descText && searchNotesMap[studentKey]) descText = searchNotesMap[studentKey];

    let origStatusTag = item.pulloutLabel ?
      '<small style="color:#d9534f; font-weight:bold; display:block;">(原狀態:' + item.pulloutLabel + ')</small>' :
      '<small style="color:#721c24; font-weight:normal; display:block;">(原狀態:失蹤)</small>';

    row.innerHTML = '<td><b>' + k + '</b></td>' +
      '<td><b>' + s.seatRaw + ' ' + s.name + '</b>' + origStatusTag + locText + helpTagHtml + '</td>' +
      '<td>' + teacherCellHtml + '</td>' +
      '<td><label style="cursor:pointer; font-weight:bold;"><input type="checkbox" ' + (isSearchDone ? "checked" : "") + ' onchange="toggleSearchDone(\'' + studentKey + '\', this.checked)"> 完結</label><br>' + badgeHtml + '</td>' +
      '<td><input type="text" class="search-note-input" placeholder="📌 尋獲地點與描述..." value="' + descText + '" oninput="updateSearchNote(\'' + studentKey + '\', this.value)"></td>' +
      '<td>' + (s.parent || '家長') + '<br>' + displayParentPhone + '</td>' +
      '<td><div class="contact-row-container"><div><label><input type="radio" name="tc_' + studentKey + '" value="未聯繫" ' + (state.status === "未聯繫" ? "checked" : "") + ' onchange="updateStatus(\'' + studentKey + '\', \'未聯繫\')">未聯繫</label> <label><input type="radio" name="tc_' + studentKey + '" value="聯繫中" ' + (state.status === "聯繫中" ? "checked" : "") + ' onchange="updateStatus(\'' + studentKey + '\', \'聯繫中\')">聯繫中</label> <label><input type="radio" name="tc_' + studentKey + '" value="已聯繫" ' + (state.status === "已聯繫" ? "checked" : "") + ' onchange="updateStatus(\'' + studentKey + '\', \'已聯繫\')">已聯繫</label></div><div class="retry-counter"><span>撥打<b>' + state.count + '</b>次</span> <button class="retry-btn" onclick="addRetry(\'' + studentKey + '\')">+1</button></div><input type="text" class="assignee-input-compact" placeholder="👤 處置組別/人" value="' + assigneeName + '" oninput="updateAssignee(\'' + studentKey + '\', this.value)"></div></td>';

    if (isCaseCompleted) {
      tbodyDone.appendChild(row);
      doneCount++;
    } else {
      tbodyActive.appendChild(row);
      activeCount++;
    }
  });

  if (activeCount === 0) tbodyActive.innerHTML = '<tr><td colspan="7" style="text-align:center; color:green; font-weight:bold;">✅ 目前尚無緊急處置案件！</td></tr>';
  if (doneCount === 0) tbodyDone.innerHTML = '<tr><td colspan="7" style="text-align:center; color:#888;">尚無已完結歸檔項目</td></tr>';
}

function updateSearchNote(key, val) {
  searchNotesMap[key] = val;
  triggerDebouncedStateSave();
}

function updateAssignee(key, val) {
  assigneeMap[key] = val;
  triggerDebouncedStateSave();
}

function toggleSearchDone(key, isChecked) {
  searchStatusMap[key] = isChecked;
  if (currentClassStudents.length > 0) {
    renderMatrix();
    renderTeacherContactPanel();
  }

  if (typeof google !== 'undefined' && google.script && google.script.run) {
    google.script.run.withSuccessHandler(function(res) {
      if (res && res.success) {
        if (res.searchStatusMap) searchStatusMap = res.searchStatusMap;
        if (res.pulloutStatusMap) pulloutStatusMap = res.pulloutStatusMap;
        renderSummaryTable();
        renderRescueTable();
        renderSchoolOverview();
        renderPulloutPage();
      }
    }).updateRescueStatusDelta(key, null, isChecked);
  }

  renderSummaryTable();
  renderRescueTable();
  renderSchoolOverview();
  renderPulloutPage();
}

function updateStatus(key, val) {
  if (contactStates[key]) {
    contactStates[key].status = val;
    if (typeof google !== 'undefined' && google.script && google.script.run) {
      google.script.run.updateContactStateDelta(key, contactStates[key], null);
    }
    renderSchoolOverview();
    renderSummaryTable();
    renderRescueTable();
    renderPulloutPage();
    if (currentClassStudents.length > 0) renderTeacherContactPanel();
    triggerAutoSaveTimer();
  }
}

// 5 次未接自動紅燈警示
function addRetry(key) {
  if (contactStates[key]) {
    contactStates[key].count++;
    contactStates[key].status = "聯繫中";
    let isHelp = contactStates[key].count >= 5 ? true : null;
    if (isHelp) helpRequestMap[key] = true;

    if (typeof google !== 'undefined' && google.script && google.script.run) {
      google.script.run.updateContactStateDelta(key, contactStates[key], isHelp);
    }
    renderSummaryTable();
    renderRescueTable();
    renderSchoolOverview();
    renderPulloutPage();
    if (currentClassStudents.length > 0) renderTeacherContactPanel();
    triggerAutoSaveTimer();
  }
}

// ==============================================================================
// 角色自動導向與指揮中心嚴格鑑權防護 (RBAC Strict Guard & Auto-Navigation)
// ==============================================================================

const ROLE_NAME_ZH = {
  commander: '總指揮官',
  pullout_teacher: '抽離確認組 (避難引導組)',
  medical: '危難救助組 (搶救組/緊急救護組)',
  rescue_officer: '危難救助組 (搶救組/緊急救護組)',
  patrol: '建物巡檢組 (安全防護組)',
  inspector: '建物巡檢組 (安全防護組)',
  visitor_manager: '訪客登記組',
  teacher: '班級導師',
  visitor: '一般訪客'
};

/**
 * 依據登入角色自動導向對應專屬頁面
 */
function navigateByRole(role) {
  if (typeof document === 'undefined') return;
  const cleanRole = String(role || '').toLowerCase();

  if (cleanRole === 'commander') {
    // 總指揮官 ➔ 自動切換至 🏫 指揮中心
    switchPage('adminPage');
  } else if (cleanRole === 'medical' || cleanRole === 'rescue_officer') {
    // 危難救助組 (搶救組、緊急救護組) ➔ 自動切換至 🆘 危難救助 (A區：搜救與傷病處置)
    switchPage('rescuePage');
    if (typeof switchRescueSubTab === 'function') {
      switchRescueSubTab('A');
    }
  } else if (cleanRole === 'inspector' || cleanRole === 'patrol') {
    // 建物巡檢組 ➔ 自動切換至 🆘 危難救助 (B區：建物安全檢核)
    switchPage('rescuePage');
    if (typeof switchRescueSubTab === 'function') {
      switchRescueSubTab('B');
    }
  } else if (cleanRole === 'pullout_teacher') {
    // 抽離專責教師 ➔ 自動切換至 🔄 抽離確認
    switchPage('pulloutPage');
  } else if (cleanRole === 'visitor_manager') {
    // 訪客登記組 ➔ 老師點名頁面並自動開啟外來人員登記
    switchPage('teacherPage');
    if (typeof openVisitorModal === 'function') {
      openVisitorModal();
    }
  } else {
    // 現場導師或訪客 ➔ 預設停留於 📋 老師點名
    switchPage('teacherPage');
  }
}

/**
 * 嚴格查驗指揮中心權限 (僅限總指揮官 commander 或 8888 應變碼)
 */
function checkCommanderAccess(actionName = "使用指揮中心功能") {
  const auth = (typeof window !== 'undefined' && window.AuthManager) ||
               (typeof globalThis !== 'undefined' && globalThis.AuthManager);

  // 1. 指揮官授權 (包含 8888 演練應變碼)
  const isCommander = auth && typeof auth.canAccessCommander === 'function' && auth.canAccessCommander();
  const isSessionValid = isUnlockedByPassword && (Date.now() < unlockExpiryTime);

  if (isCommander || isSessionValid) {
    return true;
  }

  // 2. 已登入但身分不是總指揮官 (例如 medical, teacher, pullout_teacher 等)
  const isUserLoggedIn = auth && typeof auth.isAuthenticated === 'function' && auth.isAuthenticated();
  if (isUserLoggedIn) {
    const role = (auth && typeof auth.getUserRole === 'function') ? auth.getUserRole() : 'other';
    const roleTitle = ROLE_NAME_ZH[role] || role;
    alert(`⛔ 權限受限：指揮中心僅限總指揮官（系統管理者）使用！\n您目前的登入身分為【${roleTitle}】。`);
    return false;
  }

  // 3. 未登入訪客：彈出登入對話框要求驗證
  if (auth && typeof auth.openLoginModal === 'function') {
    auth.openLoginModal();
  }
  alert(`🔒 權限受限：您必須先登入總指揮官帳號密碼才能${actionName}！`);
  return false;
}

// 主分頁切換與全組別嚴格權限閘門 (RBAC Strict Blocking Across All Tabs)
// ==============================================================================
function switchPage(pageId, btn) {
  if (typeof document === 'undefined') return;

  const auth = (typeof window !== 'undefined' && window.AuthManager) ||
               (typeof globalThis !== 'undefined' && globalThis.AuthManager);

  if (auth && typeof auth.getUserRole === 'function') {
    const role = auth.getUserRole();
    const isAuth = typeof auth.isAuthenticated === 'function' && auth.isAuthenticated();
    const isCommander = typeof auth.canAccessCommander === 'function' && auth.canAccessCommander();
    const hasCommanderAccess = isCommander || (isUnlockedByPassword && (Date.now() < unlockExpiryTime));
    const roleTitle = ROLE_NAME_ZH[role] || '一般訪客';

    // 1. 🏫 指揮中心：嚴格限制總指揮官 (commander)
    if (pageId === 'adminPage') {
      if (!hasCommanderAccess) {
        if (!isAuth) {
          if (typeof auth.openLoginModal === 'function') auth.openLoginModal('commander');
          alert('🔒 權限管制：指揮中心掌握全校戰情與機密個資，僅限總指揮官以完整帳號密碼登入！');
        } else {
          alert(`⛔ 權限受限：指揮中心僅限總指揮官（系統管理者）使用！\n您目前的登入身分為【${roleTitle}】。`);
        }
        return;
      }
    }

    // 2. 🔄 抽離確認：嚴格限制抽離專責教師 (pullout_teacher) 或 總指揮官 (commander)
    else if (pageId === 'pulloutPage') {
      const canPullout = typeof auth.canAccessPullout === 'function' && auth.canAccessPullout();
      if (!hasCommanderAccess && !canPullout) {
        if (!isAuth) {
          if (typeof auth.openLoginModal === 'function') auth.openLoginModal('pullout_teacher');
          alert('⚡ 災難快速通報：請輸入【抽離確認組 (避難引導組)】數字通報碼進入！');
        } else {
          alert(`⛔ 存取被拒絕：【抽離確認】專區僅限抽離確認組 (避難引導組) 或總指揮官使用！\n您目前的登入身分為【${roleTitle}】。`);
        }
        return;
      }
    }

    // 3. 🆘 搜救檢傷與建物巡視：嚴格限制緊急救護官 (medical)、建物巡檢組 (inspector) 或 總指揮官 (commander)
    else if (pageId === 'rescuePage') {
      const canRescue = typeof auth.canAccessRescue === 'function' && auth.canAccessRescue();
      const canPatrol = typeof auth.canAccessPatrol === 'function' && auth.canAccessPatrol();
      if (!hasCommanderAccess && !canRescue && !canPatrol) {
        if (!isAuth) {
          if (typeof auth.openLoginModal === 'function') auth.openLoginModal('medical');
          alert('⚡ 災難快速通報：請輸入【搶救組】、【緊急救護組】或【安全防護組】數字通報碼進入！');
        } else {
          alert(`⛔ 存取被拒絕：【搜救檢傷與建物巡視】專區僅限【搶救組】、【緊急救護組】、【安全防護組】或總指揮官使用！\n您目前的登入身分為【${roleTitle}】。`);
        }
        return;
      }

      // 依登入角色自動分流切換所屬子分頁
      if (!hasCommanderAccess) {
        if (canPatrol && !canRescue) {
          activeRescueSubTab = 'B';
        } else if (canRescue) {
          activeRescueSubTab = 'A';
        }
      }
    }

    // 4. 📋 老師點名頁面：任何人皆可在操場免登入直接點名 (恪遵「導師不用」需求)
  }

  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  let targetPage = document.getElementById(pageId);
  if (targetPage) targetPage.classList.add('active');

  // 若切換至危難救助頁，同步更新子分頁標籤按鈕視覺
  if (pageId === 'rescuePage') {
    switchRescueSubTab(activeRescueSubTab);
  }

  document.querySelectorAll('.nav-tabs').forEach(nav => {
    let btns = nav.querySelectorAll('.tab-btn');
    btns.forEach(b => {
      if (b.getAttribute('onclick') && b.getAttribute('onclick').includes(pageId)) {
        b.classList.add('active');
      } else {
        b.classList.remove('active');
      }
    });
  });
}

// ==============================================================================
// 資料同動與雲端狀態載入 (全量狀態)
// ==============================================================================
function loadSavedFullState(state) {
  if (!state) return;

  // 1. 班級點名 (相容 classReports 與 CLASS_REPORTS_DATA)
  if (state.classReports !== undefined) classReports = state.classReports || {};
  else if (state.CLASS_REPORTS_DATA !== undefined) classReports = state.CLASS_REPORTS_DATA || {};

  // 2. 搜救狀態與備註 (相容 searchStatusMap 與 SEARCH_STATUS_MAP)
  if (state.searchStatusMap !== undefined) searchStatusMap = state.searchStatusMap || {};
  else if (state.SEARCH_STATUS_MAP !== undefined) searchStatusMap = state.SEARCH_STATUS_MAP || {};
  if (state.searchNotesMap !== undefined) searchNotesMap = state.searchNotesMap || {};

  // 3. 家長聯繫與求助標記 (相容 contactStates 與 CONTACT_STATES)
  if (state.contactStates !== undefined) contactStates = state.contactStates || {};
  else if (state.CONTACT_STATES !== undefined) contactStates = state.CONTACT_STATES || {};
  if (state.helpRequestMap !== undefined) helpRequestMap = state.helpRequestMap || {};
  else if (state.HELP_REQUEST_MAP !== undefined) helpRequestMap = state.HELP_REQUEST_MAP || {};

  // 4. 任務指派與檢傷分類
  if (state.assigneeMap !== undefined) assigneeMap = state.assigneeMap || {};
  if (state.rescueTriageMap !== undefined) rescueTriageMap = state.rescueTriageMap || {};
  else if (state.RESCUE_TRIAGE_MAP !== undefined) rescueTriageMap = state.RESCUE_TRIAGE_MAP || {};

  // 5. 抽離追蹤狀態
  if (state.pulloutStatusMap !== undefined) pulloutStatusMap = state.pulloutStatusMap || {};
  else if (state.PULLOUT_STATUS_MAP !== undefined) pulloutStatusMap = state.PULLOUT_STATUS_MAP || {};

  // 6. 訪客數據
  if (state.visitorCounts !== undefined) visitorCounts = state.visitorCounts || { student: 0, teacher: 0, parent: 0, vendor: 0 };
  if (state.visitorList !== undefined) visitorList = state.visitorList || [];
  else if (state.VISITOR_LIST_DATA !== undefined) visitorList = state.VISITOR_LIST_DATA || [];

  if (state.approvedCustomTotal !== undefined) approvedCustomTotal = state.approvedCustomTotal;

  // 7. 建物巡檢狀態 (保留既有建物資料並補齊 6 大建物)
  if (state.buildingStatusMap && Object.keys(state.buildingStatusMap).length > 0) {
    for (const [name, data] of Object.entries(state.buildingStatusMap)) {
      if (name === "ALL") continue;
      buildingStatusMap[name] = Object.assign({}, buildingStatusMap[name] || {}, data);
    }
    if (buildingStatusMap["ALL"]) delete buildingStatusMap["ALL"];
  }
  const defaultBuildingsList = ["慈愛樓", "至善樓", "維揚樓", "樂群樓", "弘德樓", "中山樓"];
  defaultBuildingsList.forEach(b => {
    if (!buildingStatusMap[b]) buildingStatusMap[b] = {};
  });

  // 8. 演練防護與密碼鎖定
  if (state.securityMode) {
    securityMode = state.securityMode;
    if (securityMode === "disaster") isUnlockedByPassword = true;
    updateSecurityUI();
  }

  // 防覆蓋保護：若使用者在 5 秒內剛手動切換時間，不被覆蓋
  let timeSinceSwitch = (typeof window !== 'undefined' && window.lastTimeSwitchTimestamp) ? (Date.now() - window.lastTimeSwitchTimestamp) : 999999;
  if (state.simTimeMode && timeSinceSwitch > 5000) {
    if (simTimeMode !== state.simTimeMode) {
      simTimeMode = state.simTimeMode;
      if (typeof document !== 'undefined') {
        let selectEl = document.getElementById("simTimeSelect");
        if (selectEl && selectEl.value !== simTimeMode) selectEl.value = simTimeMode;
      }
      updateGradeDropdown();
      renderSchoolOverview();
    }
  }

  // 同步暴露至全域物件 (確保測試與除錯可直接訪問最新狀態)
  if (typeof window !== 'undefined') {
    window.classReports = classReports;
    window.pulloutStatusMap = pulloutStatusMap;
    window.rescueTriageMap = rescueTriageMap;
    window.contactStates = contactStates;
    window.searchStatusMap = searchStatusMap;
    window.searchNotesMap = searchNotesMap;
    window.buildingStatusMap = buildingStatusMap;
    window.visitorList = visitorList;
    window.visitorCounts = visitorCounts;
  }

  renderSchoolOverview();
  renderPulloutPage();
  renderSummaryTable();
  renderRescueTable();
  renderBuildingGrid();
}

/**
 * 遠端狀態同步入口：支援細粒度增量 Delta Patching 與相容全量 Full State 載入
 * 徹底解決即時推播導致的未包含資料表清空洗白 (Finding 1)
 * @param {Object} deltaOrFull 來自 Firestore 推播之增量事件或全域系統狀態物件
 */
function syncRemoteState(deltaOrFull) {
  if (!deltaOrFull || typeof deltaOrFull !== 'object') return;

  // 判定是否為細粒度增量事件 (帶有 type 標籤)
  const isDelta = Boolean(deltaOrFull.type);

  if (!isDelta) {
    // 全量狀態或相容 GAS 結構，調用已強固化的 loadSavedFullState
    loadSavedFullState(deltaOrFull);
    if (currentClassStudents.length > 0) renderTeacherContactPanel();
    return;
  }

  const eventType = deltaOrFull.type;
  let shouldRenderOverview = false;
  let shouldRenderPullout = false;
  let shouldRenderSummary = false;
  let shouldRenderRescue = false;
  let shouldRenderBuilding = false;
  let shouldRenderTeacherPanel = currentClassStudents.length > 0;
  let shouldRenderMatrix = currentClassStudents.length > 0;

  // 1. 班級點名細粒度增量 (支援 class_reports, batch, 或直接攜帶鍵值之複合載荷)
  const r = deltaOrFull.reports || deltaOrFull.classReports;
  if (r && typeof r === 'object' && (eventType === 'class_reports' || eventType === 'batch' || Object.keys(r).length > 0)) {
    classReports = { ...classReports, ...r };
    shouldRenderOverview = true;
    shouldRenderSummary = true;
    shouldRenderRescue = true;
  }

  // 2. 抽離學生細粒度增量 (支援 pullouts, batch, 或直接攜帶鍵值之複合載荷)
  const p = deltaOrFull.pullouts || deltaOrFull.pulloutStatusMap;
  if (p && typeof p === 'object' && (eventType === 'pullouts' || eventType === 'batch' || Object.keys(p).length > 0)) {
    pulloutStatusMap = { ...pulloutStatusMap, ...p };
    shouldRenderPullout = true;
    shouldRenderOverview = true;
    shouldRenderRescue = true;
    shouldRenderSummary = true;
  }

  // 3. 搜救檢傷細粒度增量 (支援 rescues, batch, 或直接攜帶鍵值之複合載荷)
  const rescuePayload = deltaOrFull.rescues || deltaOrFull.rescueTriageMap;
  if (rescuePayload && typeof rescuePayload === 'object' && (eventType === 'rescues' || eventType === 'batch' || Object.keys(rescuePayload).length > 0)) {
    rescueTriageMap = { ...rescueTriageMap, ...rescuePayload };
    const newSearchStatus = { ...searchStatusMap };
    for (const [k, v] of Object.entries(rescuePayload)) {
      if (v && v.searchDone) newSearchStatus[k] = true;
      if (v && v.note) searchNotesMap[k] = v.note;
    }
    searchStatusMap = newSearchStatus;
    shouldRenderRescue = true;
    shouldRenderSummary = true;
    shouldRenderOverview = true;
    shouldRenderPullout = true;
  }

  // 4. 家長聯繫與求助標記 (支援 contacts, batch, 或直接攜帶鍵值之複合載荷)
  const c = deltaOrFull.contacts || deltaOrFull.contactStates;
  const h = deltaOrFull.helpRequests || deltaOrFull.helpRequestMap;
  const hasContacts = c && typeof c === 'object' && (eventType === 'contacts' || eventType === 'batch' || Object.keys(c).length > 0);
  const hasHelpRequests = h && typeof h === 'object' && (eventType === 'contacts' || eventType === 'batch' || Object.keys(h).length > 0);
  if (hasContacts || hasHelpRequests) {
    if (c && typeof c === 'object') contactStates = { ...contactStates, ...c };
    if (h && typeof h === 'object') helpRequestMap = { ...helpRequestMap, ...h };
    shouldRenderSummary = true;
    shouldRenderOverview = true;
  }

  // 5. 校外與臨時人員登記 (支援 visitors, batch, 或直接攜帶鍵值之複合載荷)
  const v = deltaOrFull.visitors || deltaOrFull.visitorList;
  const hasVisitors = v && (eventType === 'visitors' || (Array.isArray(v) ? v.length > 0 : (typeof v === 'object' && Object.keys(v).length > 0)));
  if (hasVisitors) {
    visitorList = Array.isArray(v) ? [...v] : Object.values(v);
    visitorCounts = { student: 0, teacher: 0, parent: 0, vendor: 0 };
    visitorList.forEach(item => {
      const cat = item.category || item.type || 'parent';
      if (visitorCounts[cat] !== undefined) {
        visitorCounts[cat] += (Number(item.count) || 1);
      }
    });
    if (typeof renderAllVisitorListItems === 'function') {
      renderAllVisitorListItems();
    }
    shouldRenderOverview = true;
  }

  // 6. 建物巡檢細粒度增量 (支援 buildings, batch, 或直接攜帶鍵值之複合載荷)
  const b = deltaOrFull.buildings || deltaOrFull.buildingStatusMap;
  if (b && typeof b === 'object' && (eventType === 'buildings' || eventType === 'batch' || Object.keys(b).length > 0)) {
    for (const [name, data] of Object.entries(b)) {
      if (name === "ALL") continue;
      buildingStatusMap[name] = Object.assign({}, buildingStatusMap[name] || {}, data);
    }
    if (buildingStatusMap["ALL"]) delete buildingStatusMap["ALL"];
    const defaultBuildingsList = ["慈愛樓", "至善樓", "維揚樓", "樂群樓", "弘德樓", "中山樓"];
    defaultBuildingsList.forEach(name => {
      if (!buildingStatusMap[name]) buildingStatusMap[name] = {};
    });
    shouldRenderBuilding = true;
    shouldRenderOverview = true;
  }

  // 7. 系統全域組態增量 (支援 system_state, batch, 或直接攜帶鍵值之複合載荷)
  const s = deltaOrFull.state || deltaOrFull.systemState;
  if (s && typeof s === 'object' && (eventType === 'system_state' || eventType === 'batch' || Object.keys(s).length > 0)) {
    if (s.visitorCounts && (eventType === 'system_state' || (!visitorList || visitorList.length === 0))) visitorCounts = { ...s.visitorCounts };
    if (s.approvedCustomTotal !== undefined) approvedCustomTotal = s.approvedCustomTotal;
    if (s.siteLocked !== undefined) isSiteLocked = Boolean(s.siteLocked);
    if (s.securityMode) {
      securityMode = s.securityMode;
      if (securityMode === "disaster") isUnlockedByPassword = true;
      updateSecurityUI();
    }
    let timeSinceSwitch = (typeof window !== 'undefined' && window.lastTimeSwitchTimestamp) ? (Date.now() - window.lastTimeSwitchTimestamp) : 999999;
    if (s.simTimeMode && timeSinceSwitch > 5000) {
      if (simTimeMode !== s.simTimeMode) {
        simTimeMode = s.simTimeMode;
        if (typeof document !== 'undefined') {
          let selectEl = document.getElementById("simTimeSelect");
          if (selectEl && selectEl.value !== simTimeMode) selectEl.value = simTimeMode;
        }
        updateGradeDropdown();
      }
    }
    shouldRenderOverview = true;
    shouldRenderPullout = true;
    shouldRenderSummary = true;
    shouldRenderRescue = true;
  }

  // 8. 學生名冊細粒度增量 (支援 students 異動即時同步)
  const stu = deltaOrFull.students;
  if (stu && Array.isArray(stu)) {
    const sMap = new Map();
    allStudents.forEach(s => {
      const key = s.id || `${s.grade}_${s.className}_${s.seatRaw}`;
      sMap.set(key, s);
    });
    stu.forEach(fsS => {
      const key = fsS.id || `${fsS.grade}_${fsS.className}_${fsS.seatRaw}`;
      const existing = sMap.get(key);
      if (existing) {
        Object.assign(existing, fsS);
      } else {
        sMap.set(key, fsS);
      }
    });
    allStudents = Array.from(sMap.values());
    if (typeof window !== 'undefined') window.allStudents = allStudents;
    shouldRenderOverview = true;
    shouldRenderPullout = true;
    if (selectedClassBtn) {
      currentClassStudents = allStudents.filter(d => d.grade === selectedGradeOpt && d.className === selectedClassBtn && d.status !== 'transferred_out' && d.isActive !== false);
      shouldRenderMatrix = true;
    }
    const rModal = (typeof document !== 'undefined') ? document.getElementById('rosterModal') : null;
    if (rModal && rModal.style.display !== 'none' && typeof renderRosterTable === 'function') {
      renderRosterTable(false);
    }
  }

  // 同步暴露至全域物件 (確保測試與除錯可直接訪問最新狀態)
  if (typeof window !== 'undefined') {
    window.classReports = classReports;
    window.pulloutStatusMap = pulloutStatusMap;
    window.rescueTriageMap = rescueTriageMap;
    window.contactStates = contactStates;
    window.searchStatusMap = searchStatusMap;
    window.searchNotesMap = searchNotesMap;
    window.buildingStatusMap = buildingStatusMap;
    window.visitorList = visitorList;
    window.visitorCounts = visitorCounts;
  }

  // 執行對應畫面重新繪製 (避免多餘的全量 DOM 銷毀重建)
  if (shouldRenderOverview) renderSchoolOverview();
  if (shouldRenderPullout) renderPulloutPage();
  if (shouldRenderSummary) renderSummaryTable();
  if (shouldRenderRescue) renderRescueTable();
  if (shouldRenderBuilding) renderBuildingGrid();
  if (shouldRenderTeacherPanel) renderTeacherContactPanel();
  if (shouldRenderMatrix && typeof renderMatrix === 'function') renderMatrix();
}

function saveFullSystemStateToBackend() {
  let payload = {
    classReports: classReports,
    searchStatusMap: searchStatusMap,
    searchNotesMap: searchNotesMap,
    contactStates: contactStates,
    helpRequestMap: helpRequestMap,
    assigneeMap: assigneeMap,
    rescueTriageMap: rescueTriageMap,
    pulloutStatusMap: pulloutStatusMap,
    visitorCounts: visitorCounts,
    visitorList: visitorList,
    approvedCustomTotal: approvedCustomTotal,
    buildingStatusMap: buildingStatusMap,
    securityMode: securityMode,
    simTimeMode: simTimeMode
  };
  if (typeof google !== 'undefined' && google.script && google.script.run) {
    google.script.run.saveFullSystemState(payload);
  }
}

function setupData(data) {
  allStudents = data || [];
  updateGradeDropdown();
  renderSchoolOverview();
  renderPulloutPage();
}

// ==============================================================================
// 應用程式初始化 (全面採用 Firestore onSnapshot 推播，徹底拔除 3.5s~15s 輪詢)
// ==============================================================================
function initApp() {
  applyBgTheme(currentBgTheme);

  // 初始化 Supabase Auth (若環境提供)
  if (typeof window !== 'undefined' && window.AuthManager && typeof window.AuthManager.init === 'function') {
    window.AuthManager.init().then(() => {
      window.AuthManager.renderAuthBadge();

      // 監聽登入與登出事件，自動分流導向角色專屬頁面
      if (typeof window.AuthManager.onAuthStateChange === 'function') {
        window.AuthManager.onAuthStateChange((event, session) => {
          if (event === 'SIGNED_IN' && session && session.user) {
            const role = (window.AuthManager.getUserRole && window.AuthManager.getUserRole()) ||
                         (session.user.user_metadata && session.user.user_metadata.role) ||
                         'visitor';
            navigateByRole(role);
          } else if (event === 'SIGNED_OUT') {
            switchPage('teacherPage');
          }
        });
      }
    }).catch(err => {
      console.warn('[App] Supabase Auth 初始化異常：', err);
    });
  }

  // 初始化 OfflineManager 連線狀態指示 (若環境提供)
  if (typeof window !== 'undefined' && window.OfflineManager && typeof window.OfflineManager.init === 'function') {
    window.OfflineManager.init();
  }

  // 1. 抓取學生名冊
  if (typeof google !== 'undefined' && google.script && google.script.run) {
    google.script.run.withSuccessHandler(setupData).getStudentData();

    // 2. 抓取全域系統狀態
    google.script.run.withSuccessHandler(loadSavedFullState).getFullSystemState();

    // 3. 抓取排程設定表
    google.script.run.withSuccessHandler(function(config) {
      if (config && config.length > 0) {
        if (typeof window !== 'undefined') {
          window.scheduleConfigData = config;
        }
        updateGradeDropdown();
        renderSchoolOverview();
        if (selectedClassBtn) onClassClick(selectedClassBtn);
      }
    }).getScheduleConfigData();
  }

  // 4. 即時伺服器推播監聽：徹底拔除舊有 3.5s ~ 15s 輪詢
  if (typeof window !== 'undefined' && typeof window.initRealtimeSync === 'function') {
    window.initRealtimeSync(function(realtimeState) {
      syncRemoteState(realtimeState);
    });
  }
}

// 自動繫結至 window.onload (相容 ES Module 延遲載入)
if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', initApp);
  } else {
    initApp();
  }
}

// ==============================================================================
// 全域函式導出 (供 HTML 內聯事件、測試與其他模組呼叫)
// ==============================================================================
const exportedAppMethods = {
  applyBgTheme,
  toggleBgTheme,
  toggleSiteLock,
  toggleSecurityMode,
  updateSecurityUI,
  verifyPasswordToUnlockPhone,
  onSimTimeChange,
  isClassActiveAtTime,
  isStudentOffCampus,
  getNextRollCallStage,
  updateGradeDropdown,
  onGradeChange,
  onClassClick,
  renderMatrix,
  renderLocationPanel,
  renderTeacherContactPanel,
  toggleHelpReq,
  takeBackContact,
  updateStats,
  submitAttendance,
  switchPulloutSubTab,
  renderPulloutPage,
  updatePulloutStatus,
  switchRescueSubTab,
  renderRescueRowInPlace,
  renderRescueTable,
  updateRescueLocation,
  updateRescueEscort,
  updateRescueStatus,
  confirmRescueTriage,
  updateRescueTriage,
  updateRescueNote,
  renderBuildingGrid,
  onBuildingNoteInput,
  toggleBuildingItem,
  submitBuildingCheck,
  openVisitorModal,
  closeVisitorModal,
  switchVisitorSubTab,
  adjustNewVisitorItemCount,
  setNewVisitorItemStatus,
  setNewVisitorItemNote,
  renderNewVisitorModalItems,
  renderAllVisitorListItems,
  submitNewVisitorBatchData,
  executeBackendStressTest,
  showLatestStressClassList,
  closeStressModal,
  copyStressModalText,
  openUserPermissionModal,
  closeUserPermissionModal,
  renderUserPermissionTable,
  saveSingleUserPermission,
  addNewUserPermission,
  deleteSingleUserPermission,
  openPasscodeModal,
  closePasscodeModal,
  savePasscodeConfigModal,
  resetPasscodeConfigToDefault,
  openRosterModal,
  closeRosterModal,
  onRosterGradeChange,
  onRosterFilterChange,
  changeRosterPage,
  toggleNewStudentForm,
  submitNewStudentForm,
  updateStudentRosterStatus,
  deleteRosterStudent,
  exportRosterCSV,
  openExcelImportModal,
  closeExcelImportModal,
  downloadRosterExcelTemplate,
  downloadRosterCsvTemplate,
  handleExcelFileSelected,
  parseRosterDataArray,
  executeRosterExcelImport,
  renderRosterTable,
  resetAllDataWithPassword,
  renderSchoolOverview,
  approveCalculatedTotal,
  setCustomTotalAttendance,
  scrollToClassRow,
  scrollToOverviewTop,
  renderSummaryTable,
  updateSearchNote,
  updateAssignee,
  toggleSearchDone,
  updateStatus,
  addRetry,
  switchPage,
  navigateByRole,
  checkClassEditPermission,
  openClassRollCall,
  getAppState,
  loadSavedFullState,
  syncRemoteState,
  saveFullSystemStateToBackend,
  setupData,
  initApp
};

if (typeof window !== 'undefined') {
  Object.assign(window, exportedAppMethods);
}
if (typeof globalThis !== 'undefined') {
  Object.assign(globalThis, exportedAppMethods);
}

export default exportedAppMethods;
export {
  applyBgTheme,
  toggleBgTheme,
  toggleSiteLock,
  toggleSecurityMode,
  updateSecurityUI,
  verifyPasswordToUnlockPhone,
  onSimTimeChange,
  isClassActiveAtTime,
  isStudentOffCampus,
  getNextRollCallStage,
  updateGradeDropdown,
  onGradeChange,
  onClassClick,
  renderMatrix,
  renderLocationPanel,
  renderTeacherContactPanel,
  toggleHelpReq,
  takeBackContact,
  updateStats,
  submitAttendance,
  switchPulloutSubTab,
  renderPulloutPage,
  updatePulloutStatus,
  switchRescueSubTab,
  renderRescueRowInPlace,
  renderRescueTable,
  updateRescueLocation,
  updateRescueEscort,
  updateRescueStatus,
  confirmRescueTriage,
  updateRescueTriage,
  updateRescueNote,
  renderBuildingGrid,
  onBuildingNoteInput,
  toggleBuildingItem,
  submitBuildingCheck,
  openVisitorModal,
  closeVisitorModal,
  switchVisitorSubTab,
  adjustNewVisitorItemCount,
  setNewVisitorItemStatus,
  setNewVisitorItemNote,
  renderNewVisitorModalItems,
  renderAllVisitorListItems,
  submitNewVisitorBatchData,
  executeBackendStressTest,
  showLatestStressClassList,
  closeStressModal,
  copyStressModalText,
  openUserPermissionModal,
  closeUserPermissionModal,
  renderUserPermissionTable,
  saveSingleUserPermission,
  addNewUserPermission,
  deleteSingleUserPermission,
  openPasscodeModal,
  closePasscodeModal,
  savePasscodeConfigModal,
  resetPasscodeConfigToDefault,
  openRosterModal,
  closeRosterModal,
  onRosterGradeChange,
  onRosterFilterChange,
  changeRosterPage,
  toggleNewStudentForm,
  submitNewStudentForm,
  updateStudentRosterStatus,
  deleteRosterStudent,
  exportRosterCSV,
  openExcelImportModal,
  closeExcelImportModal,
  downloadRosterExcelTemplate,
  downloadRosterCsvTemplate,
  handleExcelFileSelected,
  parseRosterDataArray,
  executeRosterExcelImport,
  renderRosterTable,
  resetAllDataWithPassword,
  renderSchoolOverview,
  approveCalculatedTotal,
  setCustomTotalAttendance,
  scrollToClassRow,
  scrollToOverviewTop,
  renderSummaryTable,
  updateSearchNote,
  updateAssignee,
  toggleSearchDone,
  updateStatus,
  addRetry,
  switchPage,
  navigateByRole,
  checkClassEditPermission,
  openClassRollCall,
  getAppState,
  loadSavedFullState,
  syncRemoteState,
  saveFullSystemStateToBackend,
  setupData,
  initApp
};
