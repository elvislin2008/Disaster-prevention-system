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
  REGISTERED_USERS: 'APP_AUTH_REGISTERED_USERS'
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
    return this.getUserRole() === 'commander';
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

    if (cleanCode === '8888') {
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
   * 以通行碼登入
   */
  loginWithPasscode(passcode) {
    try {
      const ok = this.verifyDrillPasscode(passcode);
      if (ok) {
        return {
          success: true,
          role: 'commander',
          expiry: this.drillUnlockExpiry
        };
      }
      return {
        success: false,
        error: '通行碼錯誤'
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
          <button id="authDrillQuickBtn" type="button" style="padding:4px 8px;background:#fd7e14;color:#fff;border:none;border-radius:4px;font-size:0.75rem;font-weight:bold;cursor:pointer;">8888演練</button>
        </div>
      `;
    } else {
      const rawName = (user && user.user_metadata && user.user_metadata.name) || (user && user.email) || roleText;
      const displayName = this._escapeHtml(this._truncateName(rawName, 15));
      const badgeColor = isDrill ? '#dc3545' : (role === 'commander' ? '#6f42c1' : '#28a745');

      html = `
        <div class="auth-card" style="display:flex;align-items:center;height:38px;max-height:45px;gap:6px;font-size:0.8rem;background:rgba(255,255,255,0.92);padding:4px 8px;border-radius:6px;border:1px solid #c0d4e5;">
          <span class="badge" style="background:${badgeColor};color:#fff;padding:2px 6px;border-radius:4px;font-size:0.72rem;font-weight:bold;">${roleText}</span>
          <span class="name" style="font-weight:bold;color:#1F4E79;max-width:110px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${displayName}</span>
          <span style="font-size:0.7rem;color:#dc3545;">${offlineSuffix}</span>
          ${isDrill ? '<button id="authLockDrillBtn" type="button" style="padding:4px 8px;background:#dc3545;color:#fff;border:none;border-radius:4px;font-size:0.75rem;font-weight:bold;cursor:pointer;">退出8888</button>' : '<button id="authLogoutBtn" type="button" style="padding:4px 8px;background:#6c757d;color:#fff;border:none;border-radius:4px;font-size:0.75rem;font-weight:bold;cursor:pointer;">登出</button>'}
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
   */
  openLoginModal() {
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

    modalOverlay.innerHTML = `
      <div class="custom-modal-card" style="background:#fff;border-radius:12px;width:100%;max-width:380px;box-shadow:0 10px 25px rgba(0,0,0,0.3);overflow:hidden;border:1px solid #1F4E79;">
        <div class="modal-header" style="background:#1F4E79;color:#fff;padding:12px 16px;display:flex;justify-content:space-between;align-items:center;font-weight:bold;">
          <span>🔐 教職員身分鑑權登入 (Supabase Auth)</span>
          <button id="authModalCloseBtn" type="button" style="background:transparent;border:none;color:#fff;font-size:1.2rem;cursor:pointer;">&times;</button>
        </div>
        <div class="modal-body" style="padding:16px;">
          <!-- 快捷提示列 -->
          <div style="background:#e8f4f8;border:1px solid #bee5eb;border-radius:6px;padding:8px 10px;font-size:0.8rem;color:#0c5460;margin-bottom:12px;line-height:1.4;">
            🔒 <b>指揮中心權限管制專區：</b><br>
            • 請輸入指揮官或教職員帳號密碼以解鎖指揮中心功能。<br>
            • 若尚未設定密碼，請點選<b>【註冊新帳號】</b>立即自訂密碼啟用！
          </div>

          <div style="display:flex;gap:6px;margin-bottom:12px;border-bottom:1px solid #eee;padding-bottom:8px;">
            <button id="authTabEmailBtn" type="button" style="flex:1;padding:7px;border:none;background:#1F4E79;color:#fff;border-radius:4px;font-weight:bold;cursor:pointer;font-size:0.85rem;">🔑 帳號登入</button>
            <button id="authTabRegisterBtn" type="button" style="flex:1;padding:7px;border:1px solid #1F4E79;background:#fff;color:#1F4E79;border-radius:4px;font-weight:bold;cursor:pointer;font-size:0.85rem;">📝 註冊新帳號</button>
            <button id="authTabPasscodeBtn" type="button" style="padding:7px 10px;border:1px solid #6c757d;background:#fff;color:#6c757d;border-radius:4px;font-weight:bold;cursor:pointer;font-size:0.75rem;">8888演練</button>
          </div>

          <!-- 1. 登入表單 (Login Form) -->
          <form id="authEmailForm" style="display:flex;flex-direction:column;gap:10px;">
            <div style="display:flex;gap:6px;margin-bottom:2px;">
              <button id="quickFillCmdBtn" type="button" style="flex:1;padding:5px;background:#e9ecef;border:1px solid #ced4da;border-radius:4px;font-size:0.75rem;cursor:pointer;font-weight:bold;color:#495057;">👉 填入指揮官 (poyilin59)</button>
              <button id="quickFillTeaBtn" type="button" style="flex:1;padding:5px;background:#e9ecef;border:1px solid #ced4da;border-radius:4px;font-size:0.75rem;cursor:pointer;font-weight:bold;color:#495057;">👉 填入一年一班導師</button>
            </div>
            <div>
              <label style="display:block;font-size:0.8rem;color:#555;margin-bottom:3px;font-weight:bold;">電子信箱 (Email)</label>
              <input id="authInputEmail" type="email" value="poyilin59@gmail.com" placeholder="例如: poyilin59@gmail.com" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px;font-size:0.88rem;" required />
            </div>
            <div>
              <label style="display:block;font-size:0.8rem;color:#555;margin-bottom:3px;font-weight:bold;">密碼</label>
              <input id="authInputPassword" type="password" placeholder="請輸入密碼" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px;font-size:0.88rem;" required />
              <div style="font-size:0.75rem;color:#6c757d;margin-top:3px;">
                💡 預設指揮官密碼為 <b>admin123</b>（或點上方【註冊新帳號】自訂密碼）
              </div>
            </div>
            <div id="authLoginError" style="color:#dc3545;font-size:0.8rem;display:none;"></div>
            <button id="authSubmitEmailBtn" type="submit" style="padding:10px;background:#28a745;color:#fff;border:none;border-radius:6px;font-weight:bold;cursor:pointer;margin-top:4px;">🔓 登入指揮中心</button>
          </form>

          <!-- 2. 註冊新帳號表單 (Register Form) -->
          <form id="authRegisterForm" style="display:none;flex-direction:column;gap:10px;">
            <div>
              <label style="display:block;font-size:0.8rem;color:#555;margin-bottom:3px;font-weight:bold;">電子信箱 (Email)</label>
              <input id="authRegEmail" type="email" value="poyilin59@gmail.com" placeholder="例如: poyilin59@gmail.com" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px;font-size:0.88rem;" required />
            </div>
            <div>
              <label style="display:block;font-size:0.8rem;color:#555;margin-bottom:3px;font-weight:bold;">自訂密碼 (至少 6 碼)</label>
              <input id="authRegPassword" type="password" placeholder="請設定您的登入密碼" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px;font-size:0.88rem;" required />
            </div>
            <div>
              <label style="display:block;font-size:0.8rem;color:#555;margin-bottom:3px;font-weight:bold;">使用者姓名 / 稱謂</label>
              <input id="authRegName" type="text" value="總指揮官" placeholder="例如: 總指揮官 或 林老師" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px;font-size:0.88rem;" required />
            </div>
            <div>
              <label style="display:block;font-size:0.8rem;color:#555;margin-bottom:3px;font-weight:bold;">系統身分權限</label>
              <select id="authRegRole" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px;font-size:0.88rem;background:#fff;">
                <option value="commander" selected>總指揮官 (具備全校指揮中心最高特權)</option>
                <option value="teacher">班級導師 (負責班級點名)</option>
                <option value="medical">緊急救護組員</option>
                <option value="patrol">建物巡檢組員</option>
              </select>
            </div>
            <div id="authRegError" style="color:#dc3545;font-size:0.8rem;display:none;"></div>
            <button id="authSubmitRegBtn" type="submit" style="padding:10px;background:#007bff;color:#fff;border:none;border-radius:6px;font-weight:bold;cursor:pointer;margin-top:4px;">✨ 立即建立帳號並登入</button>
          </form>

          <!-- 3. 演練應變碼表單 (Passcode Form) -->
          <form id="authPasscodeForm" style="display:none;flex-direction:column;gap:10px;">
            <div>
              <label style="display:block;font-size:0.8rem;color:#555;margin-bottom:3px;font-weight:bold;">演練應變通行碼 (預設 8888)</label>
              <input id="authInputPasscode" type="password" maxlength="6" value="8888" placeholder="8888" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px;font-size:1.1rem;text-align:center;letter-spacing:4px;" required />
            </div>
            <div id="authPasscodeError" style="color:#dc3545;font-size:0.8rem;display:none;"></div>
            <button id="authSubmitPasscodeBtn" type="submit" style="padding:10px;background:#fd7e14;color:#fff;border:none;border-radius:6px;font-weight:bold;cursor:pointer;margin-top:6px;">一鍵解鎖演練指揮官模式 (20分鐘)</button>
          </form>
        </div>
        <div class="modal-footer" style="padding:8px 16px;background:#f8f9fa;border-top:1px solid #eee;display:flex;justify-content:space-between;align-items:center;">
          <span style="font-size:0.72rem;color:#666;">支援操場斷網離線快取</span>
          <button id="authModalCancelBtn" type="button" style="padding:6px 12px;background:#6c757d;color:#fff;border:none;border-radius:4px;font-size:0.8rem;cursor:pointer;">關閉</button>
        </div>
      </div>
    `;

    modalOverlay.style.display = 'flex';

    // 綁定彈窗控制項
    const closeBtn = modalOverlay.querySelector('#authModalCloseBtn');
    const cancelBtn = modalOverlay.querySelector('#authModalCancelBtn');
    const tabEmail = modalOverlay.querySelector('#authTabEmailBtn');
    const tabRegister = modalOverlay.querySelector('#authTabRegisterBtn');
    const tabPasscode = modalOverlay.querySelector('#authTabPasscodeBtn');
    const formEmail = modalOverlay.querySelector('#authEmailForm');
    const formRegister = modalOverlay.querySelector('#authRegisterForm');
    const formPasscode = modalOverlay.querySelector('#authPasscodeForm');

    const handleClose = () => this.closeLoginModal();
    if (closeBtn) closeBtn.onclick = handleClose;
    if (cancelBtn) cancelBtn.onclick = handleClose;

    const activateTab = (activeTab, activeForm) => {
      [tabEmail, tabRegister, tabPasscode].forEach(t => {
        if (!t) return;
        t.style.background = '#fff';
        t.style.color = '#1F4E79';
        t.style.border = '1px solid #1F4E79';
      });
      [formEmail, formRegister, formPasscode].forEach(f => {
        if (f) f.style.display = 'none';
      });
      if (activeTab) {
        activeTab.style.background = '#1F4E79';
        activeTab.style.color = '#fff';
        activeTab.style.border = 'none';
      }
      if (activeForm) activeForm.style.display = 'flex';
    };

    if (tabEmail && formEmail) tabEmail.onclick = () => activateTab(tabEmail, formEmail);
    if (tabRegister && formRegister) tabRegister.onclick = () => activateTab(tabRegister, formRegister);
    if (tabPasscode && formPasscode) tabPasscode.onclick = () => activateTab(tabPasscode, formPasscode);

    const fillCmd = modalOverlay.querySelector('#quickFillCmdBtn');
    if (fillCmd) {
      fillCmd.onclick = () => {
        const emailEl = modalOverlay.querySelector('#authInputEmail');
        const passEl = modalOverlay.querySelector('#authInputPassword');
        if (emailEl) emailEl.value = 'poyilin59@gmail.com';
        if (passEl) passEl.value = 'admin123';
      };
    }

    const fillTea = modalOverlay.querySelector('#quickFillTeaBtn');
    if (fillTea) {
      fillTea.onclick = () => {
        const emailEl = modalOverlay.querySelector('#authInputEmail');
        const passEl = modalOverlay.querySelector('#authInputPassword');
        if (emailEl) emailEl.value = 'teacher1_1@qs.edu.tw';
        if (passEl) passEl.value = 'tea123456';
      };
    }

    if (formEmail) {
      formEmail.onsubmit = async (e) => {
        e.preventDefault();
        const email = modalOverlay.querySelector('#authInputEmail').value;
        const password = modalOverlay.querySelector('#authInputPassword').value;
        const errBox = modalOverlay.querySelector('#authLoginError');

        const res = await this.login(email, password);
        if (res.error) {
          errBox.innerHTML = '登入失敗：查無此帳號或密碼錯誤。<br>👉 若您尚未建立密碼，請點上方<b>【註冊新帳號】</b>自訂密碼！';
          errBox.style.display = 'block';
        } else {
          this.closeLoginModal();
          alert('✅ 歡迎登入指揮中心！身分：' + (res.data?.user?.user_metadata?.name || '指揮官'));
        }
      };
    }

    if (formRegister) {
      formRegister.onsubmit = async (e) => {
        e.preventDefault();
        const email = modalOverlay.querySelector('#authRegEmail').value;
        const password = modalOverlay.querySelector('#authRegPassword').value;
        const name = modalOverlay.querySelector('#authRegName').value;
        const role = modalOverlay.querySelector('#authRegRole').value;
        const errBox = modalOverlay.querySelector('#authRegError');

        const res = await this.register(email, password, name, role);
        if (res.error) {
          errBox.textContent = '註冊失敗：' + res.error.message;
          errBox.style.display = 'block';
        } else {
          this.closeLoginModal();
          alert('🎉 恭喜！帳號註冊成功並已自動登入！\n\n身分：' + name + ' (' + (ROLE_DISPLAY_NAMES[role] || role) + ')');
        }
      };
    }

    if (formPasscode) {
      formPasscode.onsubmit = (e) => {
        e.preventDefault();
        const code = modalOverlay.querySelector('#authInputPasscode').value;
        const errBox = modalOverlay.querySelector('#authPasscodeError');
        const res = this.loginWithPasscode(code);
        if (res.success) {
          this.closeLoginModal();
        } else {
          errBox.textContent = '解鎖失敗：' + res.error;
          errBox.style.display = 'block';
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
      if (overlay) overlay.style.display = 'none';
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
}
if (typeof globalThis !== 'undefined') {
  globalThis.SupabaseAuth = SupabaseAuth;
  globalThis.AuthManager = AuthManager;
}

export default AuthManager;
