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
  "特教": 7, "幼兒園": 8, "課後班": 9, "學習扶助班": 10, "緊急應變小組": 11
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
    let pwd = prompt("🔑 請輸入指揮中心授權密碼解除全站鎖定：");
    if (pwd === ADMIN_RESET_PASSWORD || (window.AuthManager && window.AuthManager.getUserRole() === 'commander')) {
      isSiteLocked = false;
      if (overlay) overlay.classList.remove("active");
      if (btn) {
        btn.innerText = "🔒 網站關閉";
        btn.classList.remove("locked");
      }
      alert("✅ 網站解鎖成功，恢復正常運作。");
      updateSecurityUI();
      saveFullSystemStateToBackend();
    } else if (pwd !== null) {
      alert("❌ 密碼錯誤！");
    }
  }
}

function toggleSecurityMode() {
  if (securityMode === "drill") {
    let hasCommanderAuth = (window.AuthManager && window.AuthManager.getUserRole() === 'commander');
    let pwd = hasCommanderAuth ? ADMIN_RESET_PASSWORD : prompt("🔑 請輸入指揮中心授權密碼切換為【危難全開模式】：");
    if (pwd === ADMIN_RESET_PASSWORD || hasCommanderAuth) {
      securityMode = "disaster";
      isUnlockedByPassword = true;
      updateSecurityUI();
      saveFullSystemStateToBackend();
      alert("🚨 已切換為【危難模式】！所有功能與家長個資聯繫電話全面解鎖。");
    } else if (pwd !== null) {
      alert("❌ 密碼錯誤！無法切換模式。");
    }
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
  classes = classes.filter(c => isClassActiveAtTime(gVal, c));
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

  currentClassStudents = allStudents.filter(d => d.grade === gVal && d.className === cVal);
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
    warnBox.innerHTML = `<span>🔒 <b>唯讀檢視模式</b>：您目前為【${perm.role === 'teacher' ? '導師' : perm.role}】，非 <b>${gVal} ${cleanClassLabel(cVal, gVal)}</b> 之帶班導師，點名操作已鎖定為唯讀檢視。<br><span style="font-size:0.75rem; font-weight:normal; color:#666;">若需代為點名，請洽總指揮官或點擊右上角輸入演練通行碼 (8888) 解鎖。</span></span>`;
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

    btn.className = "seat-btn " + statusClass + (!perm.canEdit ? " readonly-seat" : "");
    btn.innerHTML = '<span class="seat-title">' + s.seatRaw + '</span><span class="name">' + s.name + '</span><span class="status-label">' + statusText + '</span>' + noteHtml;
    if (!perm.canEdit) {
      btn.style.cursor = "not-allowed";
      btn.title = "唯讀檢視模式（非本班帶班導師）";
    }

    btn.onclick = function() {
      if (!perm.canEdit) {
        if (typeof alert !== 'undefined') {
          alert(`⚠️ 唯讀檢視模式：您非 ${gVal} ${cVal} 帶班導師，無法修改點名狀態。\n若需代為點名，請使用總指揮官帳號登入或輸入 8888 演練通行碼。`);
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

        let groupedMap = {};
        classes.forEach(cKey => {
          let parts = cKey.split(" ");
          let gName = parts[0];
          let cName = parts[1] || parts[0];
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
// 指揮官全校數據重置
// ==============================================================================
function resetAllDataWithPassword() {
  let pwd = prompt("🔑 請輸入指揮中心授權管理密碼：");
  if (pwd === null) return;
  let isAuthorized = (pwd === ADMIN_RESET_PASSWORD) || (window.AuthManager && window.AuthManager.getUserRole() === 'commander');

  if (isAuthorized) {
    if (confirm("⚠️ 密碼驗證成功！確定要清空並重置全校點名紀錄與建築物檢核狀態嗎？")) {
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
  } else {
    alert("❌ 密碼錯誤！無法執行重置動作。");
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

  // 1. 群組化所有學生資料
  let gradeGroupMap = {};
  allStudents.forEach(s => {
    let gName = s.grade;
    if (!gradeGroupMap[gName]) gradeGroupMap[gName] = new Set();
    gradeGroupMap[gName].add(s.className);
  });

  // 2. 嚴格依據 Config 表篩選「當前時段有班級在校」的年級
  let gradeList = Object.keys(gradeGroupMap).filter(g => isClassActiveAtTime(g, ""));
  if (gradeList.length === 0) {
    container.innerHTML = '<div style="color:#1F4E79; font-weight:bold; font-size:0.85rem; padding:10px; text-align:center; background:#e8f4f8; border-radius:6px;">⚠️ 當前時段全校均非在校時間（無班級在校）。</div>';
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
        let rawCount = allStudents.filter(s => s.grade === gradeName && s.className === cName).length;
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
  let calcVal = parseInt(document.getElementById("calcTotalLabel")?.innerText || "0", 10) || 0;
  approvedCustomTotal = calcVal;
  renderSchoolOverview();
  saveFullSystemStateToBackend();
  alert("✅ 指揮官已採納試算數（在校應出席：" + calcVal + " 人）！");
}

function setCustomTotalAttendance() {
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
// 主分頁切換與指揮官 20 分鐘 Session 授權
// ==============================================================================
function switchPage(pageId, btn) {
  if (typeof document === 'undefined') return;
  let nowTime = Date.now();
  let isSessionValid = isUnlockedByPassword && (nowTime < unlockExpiryTime);

  // 指揮中心權限鑑權：若已透過 Supabase 登入為 commander，直接放行；否則校驗 8888 密碼
  let isCommanderUser = (typeof window !== 'undefined' && window.AuthManager && window.AuthManager.getUserRole() === 'commander');

  if (pageId === 'adminPage' && !isSessionValid && !isCommanderUser) {
    let pwd = prompt("🔑 請輸入指揮中心授權密碼進入：");
    if (pwd === ADMIN_RESET_PASSWORD) {
      isUnlockedByPassword = true;
      unlockExpiryTime = Date.now() + (20 * 60 * 1000);
      alert("✅ 密碼驗證成功！已取得 20 分鐘指揮中心通行授權。");
      updateSecurityUI();
    } else {
      if (pwd !== null) alert("❌ 密碼錯誤！無法進入指揮中心。");
      return;
    }
  }

  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  let targetPage = document.getElementById(pageId);
  if (targetPage) targetPage.classList.add('active');

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

  // 1. 班級點名細粒度增量 ({ type: 'class_reports', reports } 或 batch)
  if (eventType === 'class_reports' || eventType === 'batch') {
    const r = deltaOrFull.reports || deltaOrFull.classReports;
    if (r && typeof r === 'object') {
      classReports = { ...classReports, ...r };
      shouldRenderOverview = true;
      shouldRenderSummary = true;
      shouldRenderRescue = true;
    }
  }

  // 2. 抽離學生細粒度增量 ({ type: 'pullouts', pullouts } 或 batch)
  if (eventType === 'pullouts' || eventType === 'batch') {
    const p = deltaOrFull.pullouts || deltaOrFull.pulloutStatusMap;
    if (p && typeof p === 'object') {
      pulloutStatusMap = { ...pulloutStatusMap, ...p };
      shouldRenderPullout = true;
      shouldRenderOverview = true;
      shouldRenderRescue = true;
      shouldRenderSummary = true;
    }
  }

  // 3. 搜救檢傷細粒度增量 ({ type: 'rescues', rescues } 或 batch)
  if (eventType === 'rescues' || eventType === 'batch') {
    const r = deltaOrFull.rescues || deltaOrFull.rescueTriageMap;
    if (r && typeof r === 'object') {
      rescueTriageMap = { ...rescueTriageMap, ...r };
      const newSearchStatus = { ...searchStatusMap };
      for (const [k, v] of Object.entries(r)) {
        if (v && v.searchDone) newSearchStatus[k] = true;
        if (v && v.note) searchNotesMap[k] = v.note;
      }
      searchStatusMap = newSearchStatus;
      shouldRenderRescue = true;
      shouldRenderSummary = true;
      shouldRenderOverview = true;
      shouldRenderPullout = true;
    }
  }

  // 4. 家長聯繫與求助標記 ({ type: 'contacts', contacts, helpRequests } 或 batch)
  if (eventType === 'contacts' || eventType === 'batch') {
    const c = deltaOrFull.contacts || deltaOrFull.contactStates;
    const h = deltaOrFull.helpRequests || deltaOrFull.helpRequestMap;
    if (c && typeof c === 'object') contactStates = { ...contactStates, ...c };
    if (h && typeof h === 'object') helpRequestMap = { ...helpRequestMap, ...h };
    shouldRenderSummary = true;
    shouldRenderOverview = true;
  }

  // 5. 校外與臨時人員登記 ({ type: 'visitors', visitors } 或 batch)
  if (eventType === 'visitors' || eventType === 'batch') {
    const v = deltaOrFull.visitors || deltaOrFull.visitorList;
    if (v) {
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
  }

  // 6. 建物巡檢細粒度增量 ({ type: 'buildings', buildings } 或 batch)
  if (eventType === 'buildings' || eventType === 'batch') {
    const b = deltaOrFull.buildings || deltaOrFull.buildingStatusMap;
    if (b && typeof b === 'object') {
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
  }

  // 7. 系統全域組態增量 ({ type: 'system_state', state } 或 batch)
  if (eventType === 'system_state' || eventType === 'batch') {
    const s = deltaOrFull.state || deltaOrFull.systemState;
    if (s && typeof s === 'object') {
      if (s.visitorCounts) visitorCounts = { ...s.visitorCounts };
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

// 自動繫結至 window.onload
if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', initApp);
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
  checkClassEditPermission,
  openClassRollCall,
  getAppState,
  loadSavedFullState,
  syncRemoteState,
  saveFullSystemStateToBackend,
  setupData,
  initApp
};
