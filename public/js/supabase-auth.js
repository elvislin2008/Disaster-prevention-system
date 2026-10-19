/**
 * ==============================================================================
 * 清水國小校園災難與演練即時點名通報系統 V20.4
 * Supabase Auth & Role-Based Access Control (RBAC) 模組 (public/js/supabase-auth.js)
 * ==============================================================================
 * 職責：
 * 1. 整合 Supabase Auth (@supabase/supabase-js) 負責教職員與指揮官帳號鑑權與會話管理
 * 2. 實作 Role-Based Access Control (RBAC): commander, teacher, pullout_teacher, medical, patrol, visitor_manager
 * 3. 操場極限斷網離線保護：LocalStorage 快取有效會話與身分，離線點名權限零失效
 * 4. 演練應變快選通行碼：支援 8888 快速解鎖指揮官模式 (20 分鐘臨時過期窗口)
 * 5. 無侵入式 UI 整合：導覽列右上角緊湊狀態標籤 (#authNavBadge) 與登入彈窗
 */

const STORAGE_KEYS = {
  SESSION: 'APP_AUTH_SESSION',
  DRILL_EXPIRY: 'APP_AUTH_DRILL_EXPIRY',
  REGISTERED_USERS: 'APP_AUTH_REGISTERED_USERS',
  PASSCODES_CONFIG: 'APP_AUTH_PASSCODES_CONFIG'
};

// 系統標準角色清單 (RBAC)
const VALID_ROLES = [
  'commander',        // 總指揮官 / 系統管理員
  'teacher',          // 班級導師
  'pullout_teacher',  // 抽離專責教師 (學習中心 / 本土語 / 學校團隊)
  'medical',          // 緊急救護組員
  'rescue_officer',   // 搜救與救護官 (同義相容)
  'patrol',           // 建物巡檢組員
  'inspector',        // 建物巡檢組長 (同義相容)
  'visitor_manager',  // 訪客登記組員
  'visitor'           // 訪客 (預設無編輯權限)
];

const ROLE_DISPLAY_NAMES = {
  commander: '總指揮官',
  teacher: '班級導師',
  pullout_teacher: '抽離教師',
  medical: '緊急救護',
  rescue_officer: '緊急救護',
  patrol: '建物巡檢',
  inspector: '建物巡檢',
  visitor_manager: '訪客登記',
  visitor: '訪客'
};

// 預設各組災難通報數字碼 (可由總指揮官隨時自訂修改並即時同步)
export const DEFAULT_PASSCODES_CONFIG = {
  medical: '1199',          // 救護隊
  inspector: '7777',        // 巡檢隊
  pullout_teacher: '3333',  // 抽離組
  visitor_manager: '5555',  // 訪客組
  commander_drill: '8888'   // 演練臨時總指揮官通行碼
};

// 災難快速通報數字碼動態映射表
export const ROLE_PASSCODES = {};

/**
 * 依最新設定重建動態通行碼映射表
 */
export function rebuildRolePasscodes(cfg = {}) {
  const merged = Object.assign({}, DEFAULT_PASSCODES_CONFIG, cfg);
  for (const k of Object.keys(ROLE_PASSCODES)) {
    delete ROLE_PASSCODES[k];
  }

  // 1. 緊急救護隊
  const medCode = String(merged.medical || '1199').trim();
  ROLE_PASSCODES[medCode] = { role: 'medical', name: '緊急救護官 (護理師)' };
  ROLE_PASSCODES['119'] = { role: 'medical', name: '緊急救護官 (護理師)' };

  // 2. 建物巡檢組
  const insCode = String(merged.inspector || '7777').trim();
  ROLE_PASSCODES[insCode] = { role: 'inspector', name: '建物巡檢組 (總務處)' };
  ROLE_PASSCODES['2222'] = { role: 'inspector', name: '建物巡檢組 (總務處)' };

  // 3. 抽離確認組
  const pulCode = String(merged.pullout_teacher || '3333').trim();
  ROLE_PASSCODES[pulCode] = { role: 'pullout_teacher', name: '抽離專責教師 (特教組)' };

  // 4. 訪客管理組
  const visCode = String(merged.visitor_manager || '5555').trim();
  ROLE_PASSCODES[visCode] = { role: 'visitor_manager', name: '訪客登記組 (守衛室)' };
  ROLE_PASSCODES['4444'] = { role: 'visitor_manager', name: '訪客登記組 (守衛室)' };

  // 5. 演練備用通行碼
  const drillCode = String(merged.commander_drill || '8888').trim();
  ROLE_PASSCODES[drillCode] = { role: 'commander', name: '演練總指揮官 (' + drillCode + ')' };
  ROLE_PASSCODES['8888'] = { role: 'commander', name: '演練總指揮官 (8888)' };

  return ROLE_PASSCODES;
}

// 模組載入時預先以預設值建立
rebuildRolePasscodes();


// 離線演練或本機開發保底預設帳號庫
const SEED_ACCOUNTS = new Map([
  ['poyilin59@gmail.com', {
    password: 'admin123',
    user: {
      id: 'usr_poyi_001',
      email: 'poyilin59@gmail.com',
      user_metadata: { role: 'commander', name: '總指揮官' }
    }
  }],
  ['commander@qs.edu.tw', {
    password: 'cmd123456',
    user: {
      id: 'usr_cmd_001',
      email: 'commander@qs.edu.tw',
      user_metadata: { role: 'commander', name: '總指揮官' }
    }
  }],
  ['teacher1_1@qs.edu.tw', {
    password: 'tea123456',
    user: {
      id: 'usr_tea_101',
      email: 'teacher1_1@qs.edu.tw',
      user_metadata: {
        role: 'teacher',
        assignedGrade: '一',
        assignedClass: '1',
        name: '一年一班導師'
      }
    }
  }],
  ['pullout@qs.edu.tw', {
    password: 'pul123456',
    user: {
      id: 'usr_pul_001',
      email: 'pullout@qs.edu.tw',
      user_metadata: { role: 'pullout_teacher', name: '抽離專責教師' }
    }
  }],
  ['medical@qs.edu.tw', {
    password: 'med123456',
    user: {
      id: 'usr_med_001',
      email: 'medical@qs.edu.tw',
      user_metadata: { role: 'medical', name: '緊急救護官' }
    }
  }],
  ['inspector@qs.edu.tw', {
    password: 'ins123456',
    user: {
      id: 'usr_ins_001',
      email: 'inspector@qs.edu.tw',
      user_metadata: { role: 'inspector', name: '建物巡檢組長' }
    }
  }],
  ['visitor@qs.edu.tw', {
    password: 'vis123456',
    user: {
      id: 'usr_vis_001',
      email: 'visitor@qs.edu.tw',
      user_metadata: { role: 'visitor_manager', name: '訪客登記組員' }
    }
  }]
]);

/**
 * SupabaseAuth 類別封裝
 */
export class SupabaseAuth {
  constructor(options = {}) {
    this.options = options;
    this.client = null;
    this.currentSession = null;
    this.authListeners = new Set();
    this.drillUnlockExpiry = 0;
    this.failedPasscodeAttempts = 0;
    this.lastFailedAttemptTime = 0;
    this._isModalOpen = false;
    this._initialized = false;

    // 立即載入本機快取之 Session 與演練授權 (避免首頁載入時 UI 閃爍)
    this._restoreSessionFromStorage();
    this._restoreDrillExpiryFromStorage();

    // 載入自訂密碼設定並建立各組通行碼映射表
    try {
      const initialConfig = this.getPasscodesConfig();
      rebuildRolePasscodes(initialConfig);
    } catch (e) {}

    // 在瀏覽器環境下監聽網路在線/離線事件
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('online', () => this._handleNetworkStatusChange(true));
      window.addEventListener('offline', () => this._handleNetworkStatusChange(false));
    }
  }

  // ==========================================================================
  // 1. 初始化與 Supabase Client 配置
  // ==========================================================================

  async init() {
    if (this._initialized) return this;
    this._initialized = true;

    // 啟動各組災難通報碼雲端即時同步
    this._initPasscodesSync();

    const appConfig = (typeof window !== 'undefined' && window.__APP_CONFIG__) ||
                      (typeof globalThis !== 'undefined' && globalThis.__APP_CONFIG__) ||
                      null;

    const supabaseConfig = (appConfig && typeof appConfig.getSupabaseConfig === 'function')
      ? appConfig.getSupabaseConfig()
      : { url: '', anonKey: '' };

    // 嘗試解析 createClient (優先順序: window.supabase -> globalThis.supabase -> dynamic import)
    let createClientFn = null;
    if (typeof window !== 'undefined' && window.supabase && typeof window.supabase.createClient === 'function') {
      createClientFn = window.supabase.createClient;
    } else if (typeof globalThis !== 'undefined' && globalThis.supabase && typeof globalThis.supabase.createClient === 'function') {
      createClientFn = globalThis.supabase.createClient;
    } else {
      try {
        const mod = await import('@supabase/supabase-js');
        if (mod && typeof mod.createClient === 'function') {
          createClientFn = mod.createClient;
        }
      } catch (e) {
        // 在純前端未配置 import map 或無 node_modules 時優雅降級
      }
    }

    const hasValidConfig = supabaseConfig.url &&
                          supabaseConfig.anonKey &&
                          !supabaseConfig.url.includes('example-project') &&
                          !supabaseConfig.anonKey.includes('exampleAnonKey');

    if (createClientFn && hasValidConfig) {
      try {
        this.client = createClientFn(supabaseConfig.url, supabaseConfig.anonKey, {
          auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: false
          }
        });

        // 監聽 Supabase 雲端驗證狀態變更
        if (this.client.auth && typeof this.client.auth.onAuthStateChange === 'function') {
          this.client.auth.onAuthStateChange(async (event, session) => {
            if (session) {
              this.currentSession = this._normalizeSession(session);
              this._saveSessionToStorage(this.currentSession);
            } else if (event === 'SIGNED_OUT') {
              this.currentSession = null;
              this._clearSessionStorage();
            }
            this._notifyAuthState(event, this.currentSession);
            this.renderAuthBadge();
          });
        }

        // 非同步校驗遠端 Session
        const { data } = await this.client.auth.getSession();
        if (data && data.session) {
          this.currentSession = this._normalizeSession(data.session);
          this._saveSessionToStorage(this.currentSession);
        }
      } catch (err) {
        console.warn('[SupabaseAuth] 遠端 Supabase Client 初始化失敗，降級為離線持久化快取模式：', err);
      }
    }

    this.renderAuthBadge();
    return this;
  }

  getClient() {
    return this.client;
  }

  // ==========================================================================
  // 2. 帳號身分鑑權 API (Login, Logout, Session)
  // ==========================================================================

  /**
   * 確保 Firebase App 已初始化並取得 Firebase Auth 實例
   */
  _ensureFirebaseAuth() {
    if (typeof window === 'undefined' || !window.firebase) return null;
    try {
      if (!window.firebase.apps || window.firebase.apps.length === 0) {
        const appConfig = window.__APP_CONFIG__ || globalThis.__APP_CONFIG__;
        const fbConfig = (appConfig && typeof appConfig.getFirebaseConfig === 'function')
          ? appConfig.getFirebaseConfig()
          : (appConfig && appConfig.firebase) || null;
        if (fbConfig && fbConfig.apiKey && typeof window.firebase.initializeApp === 'function') {
          window.firebase.initializeApp(fbConfig);
        }
      }
      if (typeof window.firebase.auth === 'function') {
        return window.firebase.auth();
      }
    } catch (e) {
      console.warn('[SupabaseAuth] 取得 Firebase Auth 實例失敗：', e);
    }
    return null;
  }

  /**
   * 電子郵件與密碼登入
   */
  async login(email, password) {
    if (!email || !password || typeof email !== 'string' || typeof password !== 'string') {
      return {
        data: { user: null, session: null },
        error: new Error('Email and password required')
      };
    }

    const trimmedEmail = email.trim().toLowerCase();
    // 格式檢核 (符合 B06-2)
    if (!trimmedEmail.includes('@') || !trimmedEmail.includes('.')) {
      return {
        data: { user: null, session: null },
        error: new Error('Invalid email format')
      };
    }

    // 0. 優先使用 Firebase Authentication (Google 官方高防護伺服器鑑權)
    const fbAuth = this._ensureFirebaseAuth();
    if (fbAuth) {
      try {
        const userCredential = await fbAuth.signInWithEmailAndPassword(trimmedEmail, password);
        if (userCredential && userCredential.user) {
          const fbUser = userCredential.user;
          const isCommander = (trimmedEmail === 'poyilin59@gmail.com' || trimmedEmail.startsWith('commander') || trimmedEmail.includes('admin'));
          let role = isCommander ? 'commander' : 'teacher';
          let displayName = fbUser.displayName || (isCommander ? '總指揮官' : '教職員');
          if (displayName && (displayName.includes('poyilin59') || (isCommander && displayName.includes('@')))) {
            displayName = '總指揮官';
          }
          let assignedGrade = '';
          let assignedClass = '';

          // 嘗試自 Firestore users 集合讀取自訂角色與指派班級
          try {
            const fs = (typeof window !== 'undefined' && window.firestoreService) ||
                       (typeof globalThis !== 'undefined' && globalThis.firestoreService);
            if (fs && typeof fs.getDoc === 'function' && typeof fs.doc === 'function') {
              const snap = await fs.getDoc(fs.doc('users', trimmedEmail));
              if (snap && (typeof snap.exists === 'function' ? snap.exists() : snap.exists)) {
                const uData = typeof snap.data === 'function' ? snap.data() : snap.data;
                if (uData) {
                  if (uData.role) role = uData.role;
                  if (uData.name) displayName = uData.name;
                  if (uData.assignedGrade) assignedGrade = uData.assignedGrade;
                  if (uData.assignedClass) assignedClass = uData.assignedClass;
                }
              } else {
                // 自動建立初始記錄供後台管理檢視
                fs.setDoc(fs.doc('users', trimmedEmail), {
                  email: trimmedEmail,
                  name: displayName,
                  role: role,
                  assignedGrade,
                  assignedClass,
                  createdAt: Date.now()
                }).catch(() => {});
              }
            }
          } catch (fsErr) {
            console.warn('[SupabaseAuth] 讀取使用者自訂權限略過：', fsErr);
          }

          const session = {
            access_token: await fbUser.getIdToken().catch(() => `fb_${fbUser.uid}_${Date.now()}`),
            expires_at: Math.floor(Date.now() / 1000) + 3600,
            user: {
              id: fbUser.uid,
              email: fbUser.email,
              user_metadata: {
                name: displayName,
                role: role,
                assignedGrade,
                assignedClass
              }
            }
          };
          this.currentSession = session;
          this._saveSessionToStorage(session);
          this._notifyAuthState('SIGNED_IN', session);
          this.renderAuthBadge();
          return {
            data: { user: session.user, session },
            error: null
          };
        }
      } catch (fbErr) {
        const errCode = fbErr.code || '';
        const errMsg = fbErr.message || '';
        console.warn('[Firebase Auth] 登入失敗：', errCode, errMsg);

        if (errCode === 'auth/wrong-password' || 
            errCode === 'auth/invalid-credential' || 
            errCode === 'auth/invalid-login-credentials' ||
            errMsg.includes('INVALID_LOGIN_CREDENTIALS') ||
            errMsg.includes('INVALID_PASSWORD')) {
          return {
            data: { user: null, session: null },
            error: new Error('密碼錯誤或帳號不存在！請確認密碼是否正確，或是否已在 Firebase 控制台新增此使用者。')
          };
        }
        if (errCode === 'auth/user-not-found' || errMsg.includes('EMAIL_NOT_FOUND')) {
          return {
            data: { user: null, session: null },
            error: new Error('Firebase 中查無此帳號！請先至 Firebase 控制台「Authentication」->「使用者」新增此信箱。')
          };
        }
        if (errCode === 'auth/operation-not-allowed' || errCode === 'auth/configuration-not-found' || errMsg.includes('CONFIGURATION_NOT_FOUND')) {
          return {
            data: { user: null, session: null },
            error: new Error('Firebase 尚未啟用「電子郵件/密碼」登入！請至 Firebase 控制台「Authentication」->「登入方式」啟用。')
          };
        }
        if (errCode === 'auth/too-many-requests' || errMsg.includes('TOO_MANY_ATTEMPTS')) {
          return {
            data: { user: null, session: null },
            error: new Error('登入失敗次數過多，已被安全機制暫時鎖定，請稍後再試。')
          };
        }

        // 若在線且 Firebase Auth 回報明確錯誤，直接回傳友善錯誤
        if (typeof navigator === 'undefined' || navigator.onLine) {
          return {
            data: { user: null, session: null },
            error: new Error('Firebase 驗證失敗：' + (errMsg || errCode))
          };
        }
      }
    }

    // 1. 若 Supabase Client 已連線且網路在線，呼叫 Supabase 驗證
    if (this.client && this.client.auth && (typeof navigator === 'undefined' || navigator.onLine)) {
      try {
        const res = await this.client.auth.signInWithPassword({
          email: trimmedEmail,
          password
        });
        if (res.data && res.data.session) {
          this.currentSession = this._normalizeSession(res.data.session);
          this._saveSessionToStorage(this.currentSession);
          this._notifyAuthState('SIGNED_IN', this.currentSession);
          this.renderAuthBadge();
          return {
            data: { user: this.currentSession.user, session: this.currentSession },
            error: null
          };
        }
        if (res.error) {
          return {
            data: { user: null, session: null },
            error: res.error
          };
        }
      } catch (e) {
        // 網路錯誤或伺服器超時，轉入離線/保底帳號檢核
      }
    }

    // 2. 離線操場演練或未配置 Supabase 連線金鑰時的保底機制
    const seed = SEED_ACCOUNTS.get(trimmedEmail);
    if (seed && seed.password === password) {
      const session = {
        access_token: `jwt_${seed.user.id}_${Date.now()}`,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        user: {
          id: seed.user.id,
          email: seed.user.email,
          user_metadata: { ...seed.user.user_metadata }
        }
      };
      this.currentSession = session;
      this._saveSessionToStorage(session);
      this._notifyAuthState('SIGNED_IN', session);
      this.renderAuthBadge();
      return {
        data: { user: session.user, session },
        error: null
      };
    }

    // 2.5 檢查自訂註冊帳號庫 (LocalStorage)
    const registered = this._getRegisteredUsers();
    const regUser = registered[trimmedEmail];
    if (regUser && regUser.password === password) {
      const session = {
        access_token: `jwt_${regUser.id}_${Date.now()}`,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        user: {
          id: regUser.id,
          email: regUser.email,
          user_metadata: { ...regUser.user_metadata }
        }
      };
      this.currentSession = session;
      this._saveSessionToStorage(session);
      this._notifyAuthState('SIGNED_IN', session);
      this.renderAuthBadge();
      return {
        data: { user: session.user, session },
        error: null
      };
    }

    // 3. 檢查本機離線快取是否吻合 (斷網在操場登入上次使用者)
    if (this.currentSession &&
        this.currentSession.user &&
        this.currentSession.user.email === trimmedEmail) {
      return {
        data: { user: this.currentSession.user, session: this.currentSession },
        error: null
      };
    }

    return {
      data: { user: null, session: null },
      error: new Error('Invalid login credentials')
    };
  }

  /**
   * 註冊新帳號並自動登入 (支援操場 LocalStorage 快取與雲端 Firestore 同步)
   */
  async register(email, password, name = '總指揮官', role = 'commander', extra = {}) {
    if (!email || !password || typeof email !== 'string' || typeof password !== 'string') {
      return {
        data: { user: null, session: null },
        error: new Error('請輸入電子信箱與密碼')
      };
    }

    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail.includes('@') || !trimmedEmail.includes('.')) {
      return {
        data: { user: null, session: null },
        error: new Error('電子信箱格式無效')
      };
    }

    if (password.length < 6) {
      return {
        data: { user: null, session: null },
        error: new Error('密碼長度至少需 6 個字元')
      };
    }

    const registered = this._getRegisteredUsers();
    const newUser = {
      id: `usr_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      email: trimmedEmail,
      password: password,
      user_metadata: {
        name: (name && name.trim()) || (role === 'commander' ? '總指揮官' : '教職員'),
        role: role || 'commander',
        ...extra
      },
      createdAt: Date.now()
    };

    registered[trimmedEmail] = newUser;
    this._saveRegisteredUsers(registered);

    // 異步寫入 Firestore
    try {
      const fs = (typeof window !== 'undefined' && window.firestoreService) ||
                 (typeof globalThis !== 'undefined' && globalThis.firestoreService);
      if (fs && typeof fs.setDoc === 'function' && typeof fs.doc === 'function') {
        fs.setDoc(fs.doc('users', trimmedEmail), {
          email: trimmedEmail,
          password: password,
          name: newUser.user_metadata.name,
          role: newUser.user_metadata.role,
          createdAt: newUser.createdAt
        }).catch(() => {});
      }
    } catch (e) {}

    return this.login(trimmedEmail, password);
  }

  isAuthenticated() {
    return Boolean(this.currentSession && this.currentSession.user && this.currentSession.user.email);
  }

  async sendPasswordResetEmail(email) {
    if (!email) return { error: new Error('請輸入電子信箱') };
    const trimmed = String(email).trim().toLowerCase();
    const fbAuth = this._ensureFirebaseAuth();
    if (fbAuth) {
      try {
        await fbAuth.sendPasswordResetEmail(trimmed);
        return { success: true, error: null };
      } catch (e) {
        return { success: false, error: e };
      }
    }
    return { success: false, error: new Error('尚未連線至 Firebase Auth 服務') };
  }

  _getRegisteredUsers() {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const raw = window.localStorage.getItem(STORAGE_KEYS.REGISTERED_USERS);
        if (raw) return JSON.parse(raw);
      }
    } catch (e) {}
    return this._memRegisteredUsers || {};
  }

  _saveRegisteredUsers(obj) {
    this._memRegisteredUsers = Object.assign({}, obj);
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(STORAGE_KEYS.REGISTERED_USERS, JSON.stringify(obj));
      }
    } catch (e) {}
  }

  /**
   * 登出並清理會話快取
   */
  async logout() {
    if (this.client && this.client.auth) {
      try {
        await this.client.auth.signOut();
      } catch (e) {
        // 忽略離線登出錯誤
      }
    }

    this.currentSession = null;
    this.drillUnlockExpiry = 0;
    this._clearSessionStorage();
    this._clearDrillStorage();
    this._notifyAuthState('SIGNED_OUT', null);
    this.renderAuthBadge();
    return { error: null };
  }

  /**
   * 取得當前會話 (包含 JWT 與過期時間)
   */
  async getSession() {
    // 檢查 JWT 是否過期
    if (this.currentSession && this.currentSession.expires_at) {
      const nowSec = Math.floor(Date.now() / 1000);
      if (this.currentSession.expires_at < nowSec) {
        // 若處於離線狀態，不主動清除教職員登入身分，僅標記過期但允許操場點名
        if (typeof navigator !== 'undefined' && navigator.onLine) {
          this.currentSession = null;
          this._clearSessionStorage();
        }
      }
    }
    return {
      data: { session: this.currentSession },
      error: null
    };
  }

  /**
   * 取得當前使用者物件
   */
  getCurrentUser() {
    // 若演練指揮官已解鎖但無實際帳號登入，回傳臨時指揮官使用者
    if (this.isDrillUnlocked() && (!this.currentSession || !this.currentSession.user)) {
      return {
        id: 'drill_commander_evaluator',
        email: 'drill@commander.local',
        user_metadata: {
          role: 'commander',
          name: '演練總指揮官 (8888)'
        }
      };
    }
    return this.currentSession ? this.currentSession.user : null;
  }

  /**
   * 相容 Supabase 原生 API：signInWithPassword / signOut / getUser
   */
  async signInWithPassword({ email, password }) {
    return this.login(email, password);
  }

  async signOut() {
    return this.logout();
  }

  async getUser() {
    return {
      data: { user: this.getCurrentUser() },
      error: null
    };
  }

  /**
   * 註冊會話狀態異動監聽器
   */
  onAuthStateChange(callback) {
    if (typeof callback === 'function') {
      this.authListeners.add(callback);
    }
    return {
      data: {
        subscription: {
          unsubscribe: () => {
            this.authListeners.delete(callback);
          }
        }
      }
    };
  }

  _notifyAuthState(event, session) {
    for (const listener of this.authListeners) {
      try {
        listener(event, session);
      } catch (e) {
        console.error('[SupabaseAuth] Listener error:', e);
      }
    }
  }

  // ==========================================================================
  // 3. Role-Based Access Control (RBAC) 權限查驗
  // ==========================================================================

  /**
   * 取得當前使用者角色
   */
  getUserRole() {
    // 演練通行碼 8888 覆蓋權限：若在 20 分鐘窗口內直接視為 commander
    if (this.isDrillUnlocked()) {
      return 'commander';
    }

    if (!this.currentSession || !this.currentSession.user) {
      return 'visitor';
    }

    const meta = this.currentSession.user.user_metadata || {};
    const appMeta = this.currentSession.user.app_metadata || {};
    const rawRole = meta.role || appMeta.role;

    if (!rawRole || !VALID_ROLES.includes(rawRole)) {
      return 'visitor';
    }

    return rawRole;
  }

  /**
   * 取得所屬指派班級字串 (例如 "一 1")
   */
  getAssignedClass() {
    const user = this.getCurrentUser();
    if (!user || !user.user_metadata) return null;
    const meta = user.user_metadata;
    if (meta.assignedClass && meta.assignedClass.includes(' ')) {
      return meta.assignedClass;
    }
    if (meta.assignedGrade && meta.assignedClass) {
      return `${meta.assignedGrade} ${meta.assignedClass}`;
    }
    return meta.assignedClass || null;
  }

  /**
   * 班級編輯權限防護 (恪遵鐵律 2 年級單字比對)
   */
  canEditClass(grade, className) {
    const role = this.getUserRole();
    if (role === 'commander') return true;
    if (role !== 'teacher') return false;

    const user = this.getCurrentUser();
    if (!user || !user.user_metadata) return false;

    const meta = user.user_metadata;
    const cleanGrade = String(grade || '').trim();
    const cleanClassName = String(className || '').trim();

    // 比對一：格式為 "一 1"
    if (meta.assignedClass === `${cleanGrade} ${cleanClassName}`) {
      return true;
    }

    // 比對二：分欄 assignedGrade="一" 與 assignedClass="1"
    if (meta.assignedGrade && meta.assignedClass) {
      return String(meta.assignedGrade).trim() === cleanGrade &&
             String(meta.assignedClass).trim() === cleanClassName;
    }

    return false;
  }

  /**
   * 是否具備總指揮官權限 (核定口頭報告、壓測、重置、全站鎖定)
   */
  canAccessCommander() {
    if (this.getUserRole() === 'commander') return true;
    const user = this.getCurrentUser();
    if (user && user.email) {
      const email = String(user.email).trim().toLowerCase();
      if (email === 'poyilin59@gmail.com' || email.startsWith('commander') || email.includes('admin')) {
        return true;
      }
    }
    if (typeof window !== 'undefined' && window.isUnlockedByPassword) {
      return true;
    }
    return false;
  }

  /**
   * 是否具備抽離確認權限 (學習中心 / 本土語 / 團隊)
   */
  canAccessPullout() {
    const role = this.getUserRole();
    return role === 'commander' || role === 'pullout_teacher';
  }

  /**
   * 是否具備危難搜救與檢傷分類權限
   */
  canAccessRescue() {
    const role = this.getUserRole();
    return role === 'commander' || role === 'medical' || role === 'rescue_officer';
  }

  /**
   * 是否具備建物巡檢權限
   */
  canAccessPatrol() {
    const role = this.getUserRole();
    return role === 'commander' || role === 'patrol' || role === 'inspector';
  }

  /**
   * 是否具備訪客登記權限
   */
  canAccessVisitor() {
    const role = this.getUserRole();
    return role === 'commander' || role === 'visitor_manager';
  }

  /**
   * 是否可解鎖個資遮蔽電話 (指揮官或災難全開模式)
   */
  canUnlockMaskedPhones(securityMode) {
    return this.canAccessCommander() || securityMode === 'disaster';
  }

  /**
   * 個資電話遮蔽處理 (符合 B07-4)
   */
  getMaskedPhone(rawPhone, securityMode) {
    if (this.canUnlockMaskedPhones(securityMode)) {
      return rawPhone;
    }
    return '🔒 ***-*** (個資防護中)';
  }

  // ==========================================================================
  // 4. 演練應變快選通行碼 (Passcode 8888 臨時指揮官)
  // ==========================================================================

  /**
   * 校驗演練通行碼 (8888)
   */
  verifyDrillPasscode(passcode) {
    const now = Date.now();
    // 暴力破解頻率防護 (5 次錯誤阻擋 30 秒 - 符合 B09-3)
    if (this.failedPasscodeAttempts >= 5) {
      if (now - this.lastFailedAttemptTime < 30 * 1000) {
        throw new Error('Too many passcode attempts. Please wait 30 seconds.');
      } else {
        // 超過 30 秒自動解凍計數器
        this.failedPasscodeAttempts = 0;
      }
    }

    const cleanCode = String(passcode || '').trim();
    const cfg = this.getPasscodesConfig();
    const drillPin = String(cfg.commander_drill || '8888').trim();

    if (cleanCode === drillPin || cleanCode === '8888') {
      this.failedPasscodeAttempts = 0;
      this.drillUnlockExpiry = now + 20 * 60 * 1000; // 20 分鐘
      this._saveDrillExpiryToStorage(this.drillUnlockExpiry);
      this._notifyAuthState('DRILL_UNLOCKED', this.currentSession);
      this.renderAuthBadge();
      return true;
    }

    this.failedPasscodeAttempts++;
    this.lastFailedAttemptTime = now;
    return false;
  }

  /**
   * 取得當前各組災難通報數字碼設定 (優先快取，無則取預設)
   */
  getPasscodesConfig() {
    let cfg = Object.assign({}, DEFAULT_PASSCODES_CONFIG);
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const raw = window.localStorage.getItem(STORAGE_KEYS.PASSCODES_CONFIG);
        if (raw) {
          const parsed = JSON.parse(raw);
          cfg = Object.assign(cfg, parsed);
        }
      }
    } catch (e) {}
    if (this._memPasscodesConfig) {
      cfg = Object.assign(cfg, this._memPasscodesConfig);
    }
    return cfg;
  }

  /**
   * 總指揮官變更各組通報密碼並即時同步全校 (Firestore + LocalStorage)
   */
  async updatePasscodesConfig(newConfig) {
    if (!this.canAccessCommander()) {
      throw new Error('權限受限：僅限總指揮官可以更改各組密碼！');
    }
    if (!newConfig || typeof newConfig !== 'object') {
      throw new Error('密碼設定格式錯誤');
    }

    const currentCfg = this.getPasscodesConfig();
    const sanitized = {
      medical: String(newConfig.medical || currentCfg.medical || DEFAULT_PASSCODES_CONFIG.medical).trim(),
      inspector: String(newConfig.inspector || currentCfg.inspector || DEFAULT_PASSCODES_CONFIG.inspector).trim(),
      pullout_teacher: String(newConfig.pullout_teacher || currentCfg.pullout_teacher || DEFAULT_PASSCODES_CONFIG.pullout_teacher).trim(),
      visitor_manager: String(newConfig.visitor_manager || currentCfg.visitor_manager || DEFAULT_PASSCODES_CONFIG.visitor_manager).trim(),
      commander_drill: String(newConfig.commander_drill || currentCfg.commander_drill || DEFAULT_PASSCODES_CONFIG.commander_drill).trim(),
      updatedAt: Date.now(),
      updatedBy: (this.currentSession && this.currentSession.user && this.currentSession.user.email) || 'commander'
    };

    // 驗證每組密碼長度介於 3 至 8 碼之間
    for (const [k, v] of Object.entries(sanitized)) {
      if (k === 'updatedAt' || k === 'updatedBy') continue;
      if (!v || v.length < 3 || v.length > 8) {
        throw new Error('各組密碼長度必須介於 3 至 8 碼之間！');
      }
    }

    this._memPasscodesConfig = sanitized;
    rebuildRolePasscodes(sanitized);

    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(STORAGE_KEYS.PASSCODES_CONFIG, JSON.stringify(sanitized));
      }
    } catch (e) {}

    // 1. 寫入 Firestore SDK
    try {
      const fs = (typeof window !== 'undefined' && window.firestoreService) ||
                 (typeof globalThis !== 'undefined' && globalThis.firestoreService);
      if (fs && typeof fs.setDoc === 'function' && typeof fs.doc === 'function') {
        await fs.setDoc(fs.doc('config', 'passcodes'), sanitized, { merge: true });
      }
    } catch (e) {}

    // 2. 寫入 Firestore REST API 雙保險
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
            medical: { stringValue: sanitized.medical },
            inspector: { stringValue: sanitized.inspector },
            pullout_teacher: { stringValue: sanitized.pullout_teacher },
            visitor_manager: { stringValue: sanitized.visitor_manager },
            commander_drill: { stringValue: sanitized.commander_drill },
            updatedAt: { integerValue: String(sanitized.updatedAt) }
          }
        })
      });
    } catch (e) {}

    return { success: true, config: sanitized };
  }

  /**
   * 初始化各組密碼的 Firestore 即時監聽與 REST 同步
   */
  _initPasscodesSync() {
    try {
      const fs = (typeof window !== 'undefined' && window.firestoreService) ||
                 (typeof globalThis !== 'undefined' && globalThis.firestoreService);
      if (fs && typeof fs.onSnapshot === 'function' && typeof fs.doc === 'function') {
        fs.onSnapshot(fs.doc('config', 'passcodes'), (snap) => {
          if (snap && (typeof snap.exists === 'function' ? snap.exists() : snap.exists)) {
            const data = typeof snap.data === 'function' ? snap.data() : snap.data;
            if (data) {
              this._memPasscodesConfig = Object.assign({}, data);
              rebuildRolePasscodes(this._memPasscodesConfig);
              if (typeof window !== 'undefined' && window.localStorage) {
                window.localStorage.setItem(STORAGE_KEYS.PASSCODES_CONFIG, JSON.stringify(this._memPasscodesConfig));
              }
            }
          }
        }, () => {});
      }
    } catch (e) {}

    try {
      const appConfig = (typeof window !== 'undefined' && window.__APP_CONFIG__) || null;
      const fbConfig = (appConfig && typeof appConfig.getFirebaseConfig === 'function') ? appConfig.getFirebaseConfig() : null;
      const projectId = (fbConfig && fbConfig.projectId) || 'disaster-prevention-syst-7169e';
      const apiKey = (fbConfig && fbConfig.apiKey) || 'AIzaSyBsLYXXrxxHIrgCvhgcS09xi9DGOUInfOc';

      fetch(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/config/passcodes?key=${apiKey}`)
        .then(res => res.ok ? res.json() : null)
        .then(data => {
          if (data && data.fields) {
            const f = data.fields;
            const loaded = {
              medical: (f.medical && f.medical.stringValue) || DEFAULT_PASSCODES_CONFIG.medical,
              inspector: (f.inspector && f.inspector.stringValue) || DEFAULT_PASSCODES_CONFIG.inspector,
              pullout_teacher: (f.pullout_teacher && f.pullout_teacher.stringValue) || DEFAULT_PASSCODES_CONFIG.pullout_teacher,
              visitor_manager: (f.visitor_manager && f.visitor_manager.stringValue) || DEFAULT_PASSCODES_CONFIG.visitor_manager,
              commander_drill: (f.commander_drill && f.commander_drill.stringValue) || DEFAULT_PASSCODES_CONFIG.commander_drill
            };
            this._memPasscodesConfig = loaded;
            rebuildRolePasscodes(loaded);
            if (typeof window !== 'undefined' && window.localStorage) {
              window.localStorage.setItem(STORAGE_KEYS.PASSCODES_CONFIG, JSON.stringify(loaded));
            }
          }
        })
        .catch(() => {});
    } catch (e) {}
  }

  /**
   * 以數字通報碼快速登入 (支援各應變組別與演練通行碼)
   */
  loginWithPasscode(passcode) {
    try {
      const cleanCode = String(passcode || '').trim();
      const now = Date.now();

      // 暴力破解頻率防護 (5 次錯誤阻擋 30 秒 - 符合 B09-3)
      if (this.failedPasscodeAttempts >= 5) {
        if (now - this.lastFailedAttemptTime < 30 * 1000) {
          throw new Error('嘗試次數過多，請等待 30 秒後再試。');
        } else {
          this.failedPasscodeAttempts = 0;
        }
      }

      // 1. 特殊演練通行碼 (自訂或 8888)
      const cfg = this.getPasscodesConfig();
      const drillPin = String(cfg.commander_drill || '8888').trim();
      if (cleanCode === drillPin || cleanCode === '8888') {
        const ok = this.verifyDrillPasscode(cleanCode);
        if (ok) {
          return {
            success: true,
            role: 'commander',
            name: '演練總指揮官 (' + cleanCode + ')',
            expiry: this.drillUnlockExpiry
          };
        }
        return { success: false, error: '通行碼錯誤' };
      }

      // 2. 各應變組別數字通報碼 (動態查表)
      const match = ROLE_PASSCODES[cleanCode];
      if (match) {
        this.failedPasscodeAttempts = 0;
        const session = {
          user: {
            id: `usr_pin_${match.role}`,
            email: `${match.role}@quick-login.local`,
            user_metadata: {
              role: match.role,
              name: match.name,
              loginType: 'pin_passcode'
            }
          },
          expires_at: Math.floor((now + 6 * 60 * 60 * 1000) / 1000) // 6 小時有效
        };
        this.currentSession = session;
        this._saveSessionToStorage(session);
        this._notifyAuthState('SIGNED_IN', session);
        this.renderAuthBadge();
        return {
          success: true,
          role: match.role,
          name: match.name
        };
      }

      this.failedPasscodeAttempts++;
      this.lastFailedAttemptTime = now;
      return {
        success: false,
        error: '通報碼錯誤，請確認組別數字代碼！'
      };
    } catch (err) {
      return {
        success: false,
        error: err.message
      };
    }
  }

  /**
   * 檢查演練指揮官模式是否在有效期內 (含時鐘校驗 B09-4)
   */
  isDrillUnlocked() {
    if (!this.drillUnlockExpiry) return false;
    const now = Date.now();
    const maxExpiryDuration = 20 * 60 * 1000;

    // 檢查是否已超時過期
    if (now >= this.drillUnlockExpiry) {
      this.drillUnlockExpiry = 0;
      this._clearDrillStorage();
      return false;
    }

    // 時鐘回撥異常保護 (Clock drift adjustment backwards)
    if (this.drillUnlockExpiry - now > maxExpiryDuration + 60000) {
      this.drillUnlockExpiry = 0;
      this._clearDrillStorage();
      return false;
    }

    return true;
  }

  /**
   * 鎖定並解除演練指揮官身分
   */
  lockDrill() {
    this.drillUnlockExpiry = 0;
    this._clearDrillStorage();
    this._notifyAuthState('DRILL_LOCKED', this.currentSession);
    this.renderAuthBadge();
  }

  // ==========================================================================
  // 5. 離線會話快取 (LocalStorage Session Preservation)
  // ==========================================================================

  _saveSessionToStorage(session) {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(STORAGE_KEYS.SESSION, JSON.stringify(session));
      }
    } catch (e) {
      // 忽略 LocalStorage 容量或存取權限受限例外
    }
  }

  _restoreSessionFromStorage() {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const raw = window.localStorage.getItem(STORAGE_KEYS.SESSION);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && parsed.user) {
            this.currentSession = parsed;
          }
        }
      }
    } catch (e) {
      // 忽略解析錯誤
    }
  }

  _clearSessionStorage() {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.removeItem(STORAGE_KEYS.SESSION);
      }
    } catch (e) {
      // 忽略
    }
  }

  _saveDrillExpiryToStorage(timestamp) {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(STORAGE_KEYS.DRILL_EXPIRY, String(timestamp));
      }
    } catch (e) {
      // 忽略
    }
  }

  _restoreDrillExpiryFromStorage() {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const raw = window.localStorage.getItem(STORAGE_KEYS.DRILL_EXPIRY);
        if (raw) {
          const exp = Number(raw);
          if (!isNaN(exp) && exp > Date.now()) {
            this.drillUnlockExpiry = exp;
          } else {
            this._clearDrillStorage();
          }
        }
      }
    } catch (e) {
      // 忽略
    }
  }

  _clearDrillStorage() {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.removeItem(STORAGE_KEYS.DRILL_EXPIRY);
      }
    } catch (e) {
      // 忽略
    }
  }

  _normalizeSession(session) {
    if (!session) return null;
    return {
      access_token: session.access_token || `jwt_${Date.now()}`,
      expires_at: session.expires_at || (Math.floor(Date.now() / 1000) + 3600),
      user: {
        id: session.user?.id || `usr_${Date.now()}`,
        email: session.user?.email || '',
        user_metadata: { ...(session.user?.user_metadata || {}) },
        app_metadata: { ...(session.user?.app_metadata || {}) }
      }
    };
  }

  _handleNetworkStatusChange(isOnline) {
    this.renderAuthBadge();
    if (!isOnline) {
      console.info('[SupabaseAuth] 偵測到斷網，已啟動操場離線會話維持機制。');
    }
  }

  // ==========================================================================
  // 6. 無侵入式 UI 整合 Helper (#authNavBadge 與登入視窗)
  // ==========================================================================

  _escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  _truncateName(name, max = 15) {
    if (!name) return '';
    return name.length > max ? name.substring(0, max) + '...' : name;
  }

  /**
   * 渲染導覽列緊湊狀態標籤
   */
  renderAuthBadge(targetContainer) {
    const container = targetContainer || (typeof document !== 'undefined' ? document.getElementById('authNavBadge') : null);
    if (!container) return '';

    const isOnline = typeof navigator === 'undefined' ? true : navigator.onLine;
    const isDrill = this.isDrillUnlocked();
    const role = this.getUserRole();
    const user = this.getCurrentUser();
    const roleText = ROLE_DISPLAY_NAMES[role] || role;
    const offlineSuffix = isOnline ? '' : ' (離線快取)';

    let html = '';

    if (role === 'visitor') {
      html = `
        <div class="auth-card" style="display:flex;align-items:center;height:38px;max-height:45px;gap:6px;font-size:0.8rem;background:rgba(255,255,255,0.92);padding:4px 8px;border-radius:6px;border:1px solid #c0d4e5;">
          <span style="color:#555;font-weight:bold;">未登入 (訪客)${offlineSuffix}</span>
          <button id="authLoginBtn" type="button" style="padding:4px 8px;background:#1F4E79;color:#fff;border:none;border-radius:4px;font-size:0.75rem;font-weight:bold;cursor:pointer;">登入</button>
          <button id="authDrillQuickBtn" type="button" style="padding:4px 8px;background:#fd7e14;color:#fff;border:none;border-radius:4px;font-size:0.75rem;font-weight:bold;cursor:pointer;">演練通行</button>
        </div>
      `;
    } else {
      let rawName = (user && user.user_metadata && user.user_metadata.name) || (user && user.email) || roleText;
      if (rawName && (rawName.includes('poyilin59') || (role === 'commander' && rawName.includes('@')))) {
        rawName = '總指揮官';
      }
      const displayName = this._escapeHtml(this._truncateName(rawName, 15));
      const badgeColor = isDrill ? '#dc3545' : (role === 'commander' ? '#6f42c1' : '#28a745');

      html = `
        <div class="auth-card" style="display:flex;align-items:center;height:38px;max-height:45px;gap:6px;font-size:0.8rem;background:rgba(255,255,255,0.92);padding:4px 8px;border-radius:6px;border:1px solid #c0d4e5;">
          <span class="badge" style="background:${badgeColor};color:#fff;padding:2px 6px;border-radius:4px;font-size:0.72rem;font-weight:bold;">${roleText}</span>
          <span class="name" style="font-weight:bold;color:#1F4E79;max-width:110px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${displayName}</span>
          <span style="font-size:0.7rem;color:#dc3545;">${offlineSuffix}</span>
          ${isDrill ? '<button id="authLockDrillBtn" type="button" style="padding:4px 8px;background:#dc3545;color:#fff;border:none;border-radius:4px;font-size:0.75rem;font-weight:bold;cursor:pointer;">退出演練</button>' : '<button id="authLogoutBtn" type="button" style="padding:4px 8px;background:#6c757d;color:#fff;border:none;border-radius:4px;font-size:0.75rem;font-weight:bold;cursor:pointer;">登出</button>'}
        </div>
      `;
    }

    container.innerHTML = html;

    // 綁定事件監聽
    const loginBtn = container.querySelector('#authLoginBtn');
    if (loginBtn) loginBtn.onclick = () => this.openLoginModal();

    const drillQuickBtn = container.querySelector('#authDrillQuickBtn');
    if (drillQuickBtn) {
      drillQuickBtn.onclick = () => {
        this.verifyDrillPasscode('8888');
      };
    }

    const logoutBtn = container.querySelector('#authLogoutBtn');
    if (logoutBtn) logoutBtn.onclick = () => this.logout();

    const lockDrillBtn = container.querySelector('#authLockDrillBtn');
    if (lockDrillBtn) lockDrillBtn.onclick = () => this.lockDrill();

    return html;
  }

  /**
   * 開啟登入彈跳視窗 (含防止重複連擊鎖 B08-3)
   * @param {string} targetTabOrRole 預設分頁或目標角色 ('passcode' | 'commander' | 'medical' | 'inspector' | 'pullout_teacher' | 'visitor_manager')
   */
  openLoginModal(targetTabOrRole = 'passcode') {
    if (typeof document === 'undefined') return;
    if (this._isModalOpen) return; // guard against double click

    this._isModalOpen = true;

    let modalOverlay = document.getElementById('authModalOverlay');
    if (!modalOverlay) {
      modalOverlay = document.createElement('div');
      modalOverlay.id = 'authModalOverlay';
      modalOverlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);backdrop-filter:blur(4px);z-index:10000;display:flex;align-items:center;justify-content:center;padding:12px;';
      document.body.appendChild(modalOverlay);
    }

    const isCommanderActive = targetTabOrRole === 'commander' || targetTabOrRole === 'adminPage';
    const passcodesCfg = this.getPasscodesConfig();

    modalOverlay.innerHTML = `
      <div class="custom-modal-card" style="background:#fff;border-radius:12px;width:100%;max-width:420px;box-shadow:0 10px 30px rgba(0,0,0,0.3);overflow:hidden;border:1px solid #1F4E79;">
        <!-- 頂部標題列 -->
        <div class="modal-header" style="background:#1F4E79;color:#fff;padding:12px 16px;display:flex;justify-content:space-between;align-items:center;font-weight:bold;">
          <span>🔐 校園防災緊急登入通報</span>
          <button id="authModalCloseBtn" type="button" style="background:transparent;border:none;color:#fff;font-size:1.3rem;cursor:pointer;line-height:1;">&times;</button>
        </div>

        <!-- 雙分頁標籤：災難快速數字碼 (預設) vs 總指揮官帳號密碼 -->
        <div style="display:flex;border-bottom:2px solid #e2e8f0;background:#f8fafc;">
          <button id="authTabPasscodeBtn" type="button" style="flex:1;padding:10px 6px;border:none;background:${!isCommanderActive ? '#fff' : '#f1f5f9'};color:${!isCommanderActive ? '#0284c7' : '#64748b'};font-weight:bold;font-size:0.83rem;border-bottom:${!isCommanderActive ? '3px solid #0284c7' : 'none'};cursor:pointer;">
            ⚡ 各組數字登入 (災難專用)
          </button>
          <button id="authTabCommanderBtn" type="button" style="flex:1;padding:10px 6px;border:none;background:${isCommanderActive ? '#fff' : '#f1f5f9'};color:${isCommanderActive ? '#6f42c1' : '#64748b'};font-weight:bold;font-size:0.83rem;border-bottom:${isCommanderActive ? '3px solid #6f42c1' : 'none'};cursor:pointer;">
            👑 總指揮官登入 (帳號密碼)
          </button>
        </div>

        <div class="modal-body" style="padding:16px;">
          <!-- ========================================== -->
          <!-- 分頁 1：各組別數字快速通報碼登入 (預設) -->
          <!-- ========================================== -->
          <div id="authPasscodeTabContent" style="display:${!isCommanderActive ? 'block' : 'none'};">
            <div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:6px;padding:10px 12px;font-size:0.8rem;color:#0369a1;margin-bottom:14px;line-height:1.5;">
              🚨 <b>各應變組別通報登入：</b><br>
              • 災難來臨時無需輸入長帳號，請直接輸入總指揮官核發給您組別之<b>數字通報密碼</b>。<br>
              • 適用組別：🚑 救護隊、🏢 巡檢隊、🔄 抽離組、📝 訪客組。
            </div>

            <!-- 數字顯示與輸入框 (完全空白、密碼遮罩、不預填、防瀏覽器密碼代入) -->
            <div style="margin-bottom:12px;">
              <input id="authInputPasscode" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="8" placeholder="請輸入組別通報密碼" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" name="pin_field" value="" style="width:100%;padding:10px;border:2px solid #0284c7;border-radius:8px;font-size:1.4rem;text-align:center;letter-spacing:6px;font-weight:bold;box-sizing:border-box;-webkit-text-security:disc;text-security:disc;" />
            </div>

            <!-- 觸控螢幕虛擬數字鍵盤 (0~9, 清空, ⌫) -->
            <div id="authNumKeypad" style="display:grid;grid-template-columns:repeat(3, 1fr);gap:6px;margin-bottom:12px;">
              <button type="button" class="auth-pad-key" data-val="1" style="padding:10px;font-size:1.15rem;font-weight:bold;background:#f1f5f9;border:1px solid #cbd5e1;border-radius:6px;cursor:pointer;">1</button>
              <button type="button" class="auth-pad-key" data-val="2" style="padding:10px;font-size:1.15rem;font-weight:bold;background:#f1f5f9;border:1px solid #cbd5e1;border-radius:6px;cursor:pointer;">2</button>
              <button type="button" class="auth-pad-key" data-val="3" style="padding:10px;font-size:1.15rem;font-weight:bold;background:#f1f5f9;border:1px solid #cbd5e1;border-radius:6px;cursor:pointer;">3</button>
              <button type="button" class="auth-pad-key" data-val="4" style="padding:10px;font-size:1.15rem;font-weight:bold;background:#f1f5f9;border:1px solid #cbd5e1;border-radius:6px;cursor:pointer;">4</button>
              <button type="button" class="auth-pad-key" data-val="5" style="padding:10px;font-size:1.15rem;font-weight:bold;background:#f1f5f9;border:1px solid #cbd5e1;border-radius:6px;cursor:pointer;">5</button>
              <button type="button" class="auth-pad-key" data-val="6" style="padding:10px;font-size:1.15rem;font-weight:bold;background:#f1f5f9;border:1px solid #cbd5e1;border-radius:6px;cursor:pointer;">6</button>
              <button type="button" class="auth-pad-key" data-val="7" style="padding:10px;font-size:1.15rem;font-weight:bold;background:#f1f5f9;border:1px solid #cbd5e1;border-radius:6px;cursor:pointer;">7</button>
              <button type="button" class="auth-pad-key" data-val="8" style="padding:10px;font-size:1.15rem;font-weight:bold;background:#f1f5f9;border:1px solid #cbd5e1;border-radius:6px;cursor:pointer;">8</button>
              <button type="button" class="auth-pad-key" data-val="9" style="padding:10px;font-size:1.15rem;font-weight:bold;background:#f1f5f9;border:1px solid #cbd5e1;border-radius:6px;cursor:pointer;">9</button>
              <button type="button" class="auth-pad-key" data-val="clear" style="padding:10px;font-size:0.85rem;font-weight:bold;background:#fee2e2;color:#b91c1c;border:1px solid #fca5a5;border-radius:6px;cursor:pointer;">清空</button>
              <button type="button" class="auth-pad-key" data-val="0" style="padding:10px;font-size:1.15rem;font-weight:bold;background:#f1f5f9;border:1px solid #cbd5e1;border-radius:6px;cursor:pointer;">0</button>
              <button type="button" class="auth-pad-key" data-val="back" style="padding:10px;font-size:1.15rem;font-weight:bold;background:#f1f5f9;border:1px solid #cbd5e1;border-radius:6px;cursor:pointer;">⌫</button>
            </div>

            <div id="authPasscodeError" style="color:#dc3545;font-size:0.8rem;display:none;margin-bottom:8px;font-weight:bold;text-align:center;"></div>
            <button id="authSubmitPasscodeBtn" type="button" style="width:100%;padding:11px;background:#0284c7;color:#fff;border:none;border-radius:6px;font-weight:bold;font-size:0.95rem;cursor:pointer;">⚡ 驗證數字並登入看板</button>
          </div>

          <!-- ========================================== -->
          <!-- 分頁 2：總指揮官詳細帳號密碼登入 (最高權限) -->
          <!-- ========================================== -->
          <div id="authCommanderTabContent" style="display:${isCommanderActive ? 'block' : 'none'};">
            <div style="background:#faf5ff;border:1px solid #e9d5ff;border-radius:6px;padding:8px 10px;font-size:0.78rem;color:#6b21a8;margin-bottom:12px;line-height:1.4;">
              🔒 <b>總指揮官帳號安全防護：</b><br>
              • 總指揮官掌握全校個資電話、全局戰情、學籍名冊與權限指派。<br>
              • 依資安規範，<b>必須使用完整電子郵件與詳細密碼驗證登入</b>。
            </div>

            <form id="authEmailForm" autocomplete="off" onsubmit="return false;" style="display:flex;flex-direction:column;gap:10px;">
              <!-- 阻絕瀏覽器自動帶入舊帳密之虛擬無效輸入項 -->
              <input type="text" style="display:none !important;" aria-hidden="true" tabindex="-1" autocomplete="off" />
              <input type="password" style="display:none !important;" aria-hidden="true" tabindex="-1" autocomplete="off" />
              <div>
                <label style="display:block;font-size:0.8rem;color:#555;margin-bottom:3px;font-weight:bold;">指揮官電子信箱 (Email)</label>
                <input id="authInputEmail" type="text" value="" placeholder="請輸入指揮官電子信箱 (例如: commander@qs.edu.tw)" autocomplete="new-password" autocapitalize="off" autocorrect="off" spellcheck="false" name="cmd_login_acc" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px;font-size:0.88rem;box-sizing:border-box;" required />
              </div>
              <div>
                <label style="display:block;font-size:0.8rem;color:#555;margin-bottom:3px;font-weight:bold;">詳細密碼</label>
                <input id="authInputPassword" type="password" value="" placeholder="請輸入指揮官密碼" autocomplete="new-password" name="cmd_login_secret" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px;font-size:0.88rem;box-sizing:border-box;" required />
              </div>
              <div id="authLoginError" style="color:#dc3545;font-size:0.8rem;display:none;line-height:1.4;font-weight:bold;"></div>
              <button id="authSubmitEmailBtn" type="submit" style="padding:10px;background:#6f42c1;color:#fff;border:none;border-radius:6px;font-weight:bold;cursor:pointer;margin-top:4px;">🔓 驗證密碼並登入指揮中心</button>
              <div style="text-align:right;margin-top:2px;">
                <a href="javascript:void(0)" id="authForgotPwdLink" style="font-size:0.75rem;color:#007bff;text-decoration:none;">忘記密碼？發送重設信至信箱</a>
              </div>
            </form>
          </div>
        </div>

        <div class="modal-footer" style="padding:8px 16px;background:#f8f9fa;border-top:1px solid #eee;display:flex;justify-content:space-between;align-items:center;">
          <span style="font-size:0.72rem;color:#666;">清水國小校園災難與演練即時通報系統</span>
          <button id="authModalCancelBtn" type="button" style="padding:6px 12px;background:#6c757d;color:#fff;border:none;border-radius:4px;font-size:0.8rem;cursor:pointer;">關閉</button>
        </div>
      </div>
    `;

    modalOverlay.style.display = 'flex';

    // 綁定彈窗控制項
    const closeBtn = modalOverlay.querySelector('#authModalCloseBtn');
    const cancelBtn = modalOverlay.querySelector('#authModalCancelBtn');
    const tabPasscodeBtn = modalOverlay.querySelector('#authTabPasscodeBtn');
    const tabCommanderBtn = modalOverlay.querySelector('#authTabCommanderBtn');
    const passcodeContent = modalOverlay.querySelector('#authPasscodeTabContent');
    const commanderContent = modalOverlay.querySelector('#authCommanderTabContent');
    const inputPasscode = modalOverlay.querySelector('#authInputPasscode');
    const inputEmail = modalOverlay.querySelector('#authInputEmail');
    const inputPassword = modalOverlay.querySelector('#authInputPassword');
    const submitPasscodeBtn = modalOverlay.querySelector('#authSubmitPasscodeBtn');
    const errPasscodeBox = modalOverlay.querySelector('#authPasscodeError');
    const formEmail = modalOverlay.querySelector('#authEmailForm');
    const forgotPwdLink = modalOverlay.querySelector('#authForgotPwdLink');

    // 關鍵強制清理函式：清空所有欄位，嚴防瀏覽器密碼庫自動帶入
    const clearAllAuthFields = () => {
      if (inputPasscode) inputPasscode.value = '';
      if (inputEmail) inputEmail.value = '';
      if (inputPassword) inputPassword.value = '';
    };

    // 立即清空，並在 DOM 渲染後連續排程清空，徹底攔截瀏覽器延遲 autofill
    clearAllAuthFields();
    setTimeout(clearAllAuthFields, 40);
    setTimeout(clearAllAuthFields, 120);
    setTimeout(clearAllAuthFields, 300);

    const handleClose = () => {
      clearAllAuthFields();
      this.closeLoginModal();
    };
    if (closeBtn) closeBtn.onclick = handleClose;
    if (cancelBtn) cancelBtn.onclick = handleClose;

    // 分頁切換監聽
    if (tabPasscodeBtn && tabCommanderBtn) {
      tabPasscodeBtn.onclick = () => {
        passcodeContent.style.display = 'block';
        commanderContent.style.display = 'none';
        tabPasscodeBtn.style.background = '#fff';
        tabPasscodeBtn.style.color = '#0284c7';
        tabPasscodeBtn.style.borderBottom = '3px solid #0284c7';
        tabCommanderBtn.style.background = '#f1f5f9';
        tabCommanderBtn.style.color = '#64748b';
        tabCommanderBtn.style.borderBottom = 'none';
        clearAllAuthFields();
        if (inputPasscode) inputPasscode.focus();
      };

      tabCommanderBtn.onclick = () => {
        commanderContent.style.display = 'block';
        passcodeContent.style.display = 'none';
        tabCommanderBtn.style.background = '#fff';
        tabCommanderBtn.style.color = '#6f42c1';
        tabCommanderBtn.style.borderBottom = '3px solid #6f42c1';
        tabPasscodeBtn.style.background = '#f1f5f9';
        tabPasscodeBtn.style.color = '#64748b';
        tabPasscodeBtn.style.borderBottom = 'none';
        clearAllAuthFields();
        if (inputEmail) inputEmail.focus();
      };
    }

    // 虛擬數字鍵盤監聽
    const padKeys = modalOverlay.querySelectorAll('.auth-pad-key');
    padKeys.forEach(btn => {
      btn.onclick = () => {
        if (!inputPasscode) return;
        const val = btn.getAttribute('data-val');
        if (val === 'clear') {
          inputPasscode.value = '';
        } else if (val === 'back') {
          inputPasscode.value = inputPasscode.value.slice(0, -1);
        } else if (inputPasscode.value.length < 8) {
          inputPasscode.value += val;
        }
      };
    });

    // 數字通報碼提交監聽
    if (submitPasscodeBtn) {
      submitPasscodeBtn.onclick = (e) => {
        e.preventDefault();
        const code = inputPasscode ? inputPasscode.value.trim() : '';
        if (!code) {
          if (errPasscodeBox) {
            errPasscodeBox.textContent = '請輸入 4 位數字通報碼！';
            errPasscodeBox.style.display = 'block';
          }
          return;
        }

        const res = this.loginWithPasscode(code);
        if (res.success) {
          clearAllAuthFields();
          this.closeLoginModal();
          const targetRole = res.role || 'commander';
          const roleName = ROLE_DISPLAY_NAMES[targetRole] || res.name || targetRole;
          alert('⚡ 歡迎快速通報登入！身分：【' + roleName + '】');
          if (typeof window !== 'undefined' && typeof window.navigateByRole === 'function') {
            window.navigateByRole(targetRole);
          }
        } else {
          if (errPasscodeBox) {
            errPasscodeBox.textContent = res.error || '通報碼錯誤！';
            errPasscodeBox.style.display = 'block';
          }
        }
      };
    }

    if (inputPasscode) {
      inputPasscode.onkeydown = (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (submitPasscodeBtn) submitPasscodeBtn.click();
        }
      };
    }

    // 忘記密碼連結
    if (forgotPwdLink) {
      forgotPwdLink.onclick = async () => {
        const email = modalOverlay.querySelector('#authInputEmail')?.value;
        if (!email) {
          alert('請先輸入電子信箱！');
          return;
        }
        const res = await this.sendPasswordResetEmail(email);
        if (res.error) {
          alert('發送重設信失敗：' + (res.error.message || res.error));
        } else {
          alert('✅ 密碼重設信已寄出！請至信箱 ' + email + ' 收信並點擊連結重新設定密碼。');
        }
      };
    }

    // 總指揮官表單提交
    if (formEmail) {
      formEmail.onsubmit = async (e) => {
        e.preventDefault();
        const email = modalOverlay.querySelector('#authInputEmail')?.value;
        const password = modalOverlay.querySelector('#authInputPassword')?.value;
        const errBox = modalOverlay.querySelector('#authLoginError');

        const res = await this.login(email, password);
        if (res.error) {
          if (errBox) {
            errBox.textContent = '登入失敗：' + res.error.message;
            errBox.style.display = 'block';
          }
        } else {
          clearAllAuthFields();
          this.closeLoginModal();
          const role = this.getUserRole();
          const roleName = ROLE_DISPLAY_NAMES[role] || (res.data?.user?.user_metadata?.name || '總指揮官');
          alert('👑 歡迎總指揮官登入！身分：' + roleName);
          if (typeof window !== 'undefined' && typeof window.navigateByRole === 'function') {
            window.navigateByRole(role);
          }
        }
      };
    }
  }

  /**
   * 關閉登入彈窗
   */
  closeLoginModal() {
    if (typeof document !== 'undefined') {
      const overlay = document.getElementById('authModalOverlay');
      if (overlay) {
        overlay.style.display = 'none';
        const pInput = overlay.querySelector('#authInputPasscode');
        const eInput = overlay.querySelector('#authInputEmail');
        const pwdInput = overlay.querySelector('#authInputPassword');
        if (pInput) pInput.value = '';
        if (eInput) eInput.value = '';
        if (pwdInput) pwdInput.value = '';
      }
    }
    this._isModalOpen = false;
  }
}

// 建立單例
export const AuthManager = new SupabaseAuth();

// 掛載至全域
if (typeof window !== 'undefined') {
  window.SupabaseAuth = SupabaseAuth;
  window.AuthManager = AuthManager;
  window.auth = AuthManager;
  window.supabaseAuth = AuthManager;
}
if (typeof globalThis !== 'undefined') {
  globalThis.SupabaseAuth = SupabaseAuth;
  globalThis.AuthManager = AuthManager;
  globalThis.auth = AuthManager;
  globalThis.supabaseAuth = AuthManager;
}

export default AuthManager;
