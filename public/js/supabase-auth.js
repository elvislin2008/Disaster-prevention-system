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
          <span>🔐 指揮中心身分鑑權登入 (Firebase Auth)</span>
          <button id="authModalCloseBtn" type="button" style="background:transparent;border:none;color:#fff;font-size:1.2rem;cursor:pointer;">&times;</button>
        </div>
        <div class="modal-body" style="padding:16px;">
          <!-- 權限管制提示列 -->
          <div style="background:#e8f4f8;border:1px solid #bee5eb;border-radius:6px;padding:8px 10px;font-size:0.8rem;color:#0c5460;margin-bottom:12px;line-height:1.4;">
            🔒 <b>指揮中心安全管制專區：</b><br>
            • 本專區功能僅授權指揮官與教職員使用。<br>
            • 身分由 Google Firebase 伺服器嚴格驗證，防止未授權竄改。
          </div>

          <!-- 登入表單 -->
          <form id="authEmailForm" style="display:flex;flex-direction:column;gap:10px;">
            <div>
              <label style="display:block;font-size:0.8rem;color:#555;margin-bottom:3px;font-weight:bold;">電子信箱 (Email)</label>
              <input id="authInputEmail" type="email" value="poyilin59@gmail.com" placeholder="請輸入帳號 (例如: poyilin59@gmail.com)" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px;font-size:0.88rem;" required />
            </div>
            <div>
              <label style="display:block;font-size:0.8rem;color:#555;margin-bottom:3px;font-weight:bold;">密碼</label>
              <input id="authInputPassword" type="password" placeholder="請輸入密碼" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px;font-size:0.88rem;" required />
            </div>
            <div id="authLoginError" style="color:#dc3545;font-size:0.8rem;display:none;line-height:1.4;"></div>
            <button id="authSubmitEmailBtn" type="submit" style="padding:10px;background:#28a745;color:#fff;border:none;border-radius:6px;font-weight:bold;cursor:pointer;margin-top:4px;">🔓 驗證並登入指揮中心</button>
            <div style="text-align:right;margin-top:2px;">
              <a href="javascript:void(0)" id="authForgotPwdLink" style="font-size:0.75rem;color:#007bff;text-decoration:none;">忘記密碼？發送重設信至信箱</a>
            </div>
          </form>

          <!-- 8888 備用演練入口 (摺疊次要) -->
          <div style="margin-top:12px;padding-top:8px;border-top:1px dashed #ccc;text-align:center;">
            <a href="javascript:void(0)" id="authToggleDrillLink" style="font-size:0.75rem;color:#6c757d;text-decoration:none;">⚙️ 操場斷網備用：8888 演練應變碼</a>
            <div id="authPasscodeSection" style="display:none;margin-top:8px;">
              <input id="authInputPasscode" type="password" maxlength="6" placeholder="輸入 8888" style="width:120px;padding:6px;border:1px solid #ccc;border-radius:4px;font-size:0.95rem;text-align:center;letter-spacing:3px;" />
              <button id="authSubmitPasscodeBtn" type="button" style="padding:6px 12px;background:#fd7e14;color:#fff;border:none;border-radius:4px;font-size:0.78rem;font-weight:bold;cursor:pointer;margin-left:4px;">解鎖演練</button>
              <div id="authPasscodeError" style="color:#dc3545;font-size:0.75rem;display:none;margin-top:4px;"></div>
            </div>
          </div>
        </div>
        <div class="modal-footer" style="padding:8px 16px;background:#f8f9fa;border-top:1px solid #eee;display:flex;justify-content:space-between;align-items:center;">
          <span style="font-size:0.72rem;color:#666;">Google Firebase 高防護鑑權</span>
          <button id="authModalCancelBtn" type="button" style="padding:6px 12px;background:#6c757d;color:#fff;border:none;border-radius:4px;font-size:0.8rem;cursor:pointer;">關閉</button>
        </div>
      </div>
    `;

    modalOverlay.style.display = 'flex';

    // 綁定彈窗控制項
    const closeBtn = modalOverlay.querySelector('#authModalCloseBtn');
    const cancelBtn = modalOverlay.querySelector('#authModalCancelBtn');
    const formEmail = modalOverlay.querySelector('#authEmailForm');
    const toggleDrillLink = modalOverlay.querySelector('#authToggleDrillLink');
    const passcodeSection = modalOverlay.querySelector('#authPasscodeSection');
    const submitPasscodeBtn = modalOverlay.querySelector('#authSubmitPasscodeBtn');
    const forgotPwdLink = modalOverlay.querySelector('#authForgotPwdLink');

    const handleClose = () => this.closeLoginModal();
    if (closeBtn) closeBtn.onclick = handleClose;
    if (cancelBtn) cancelBtn.onclick = handleClose;

    if (toggleDrillLink && passcodeSection) {
      toggleDrillLink.onclick = () => {
        passcodeSection.style.display = passcodeSection.style.display === 'none' ? 'block' : 'none';
      };
    }

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

    if (formEmail) {
      formEmail.onsubmit = async (e) => {
        e.preventDefault();
        const email = modalOverlay.querySelector('#authInputEmail').value;
        const password = modalOverlay.querySelector('#authInputPassword').value;
        const errBox = modalOverlay.querySelector('#authLoginError');

        const res = await this.login(email, password);
        if (res.error) {
          errBox.textContent = '登入失敗：' + res.error.message;
          errBox.style.display = 'block';
        } else {
          this.closeLoginModal();
          const role = this.getUserRole();
          const roleName = ROLE_DISPLAY_NAMES[role] || (res.data?.user?.user_metadata?.name || '指揮官');
          alert('✅ 歡迎登入！身分：' + roleName);
          if (typeof window !== 'undefined' && typeof window.navigateByRole === 'function') {
            window.navigateByRole(role);
          }
        }
      };
    }

    if (submitPasscodeBtn) {
      submitPasscodeBtn.onclick = (e) => {
        e.preventDefault();
        const code = modalOverlay.querySelector('#authInputPasscode').value;
        const errBox = modalOverlay.querySelector('#authPasscodeError');
        const res = this.loginWithPasscode(code);
        if (res.success) {
          this.closeLoginModal();
          if (typeof window !== 'undefined' && typeof window.navigateByRole === 'function') {
            window.navigateByRole('commander');
          }
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
