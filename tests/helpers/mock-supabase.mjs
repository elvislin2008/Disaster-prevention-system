/**
 * In-memory Mock Supabase Auth and RBAC System.
 */
import { VALID_ROLES } from './contracts.mjs';

export class MockSupabaseAuth {
  constructor() {
    this.users = new Map(); // email -> user data
    this.currentSession = null;
    this.authListeners = new Set();
    this.drillUnlockExpiry = 0;

    // Seed default accounts
    this._registerUser('commander@qs.edu.tw', 'cmd123456', {
      role: 'commander',
      name: '總指揮官'
    });
    this._registerUser('teacher1_1@qs.edu.tw', 'tea123456', {
      role: 'teacher',
      assignedClass: '一 1',
      name: '一年一班導師'
    });
    this._registerUser('pullout@qs.edu.tw', 'pul123456', {
      role: 'pullout_teacher',
      name: '抽離專責教師'
    });
    this._registerUser('medical@qs.edu.tw', 'med123456', {
      role: 'medical',
      name: '緊急救護官'
    });
    this._registerUser('inspector@qs.edu.tw', 'ins123456', {
      role: 'inspector',
      name: '建物巡檢組長'
    });
    this._registerUser('visitor@qs.edu.tw', 'vis123456', {
      role: 'visitor_manager',
      name: '訪客登記組員'
    });
  }

  _registerUser(email, password, metadata) {
    this.users.set(email.toLowerCase(), {
      id: `usr_${Math.random().toString(36).substring(2, 9)}`,
      email: email.toLowerCase(),
      password,
      user_metadata: metadata
    });
  }

  async signInWithPassword({ email, password }) {
    if (!email || !password) {
      return { data: { user: null, session: null }, error: new Error('Email and password required') };
    }
    const user = this.users.get(email.toLowerCase());
    if (!user || user.password !== password) {
      return { data: { user: null, session: null }, error: new Error('Invalid login credentials') };
    }

    const token = `jwt_${user.id}_${Date.now()}`;
    const session = {
      access_token: token,
      user: {
        id: user.id,
        email: user.email,
        user_metadata: { ...user.user_metadata }
      },
      expires_at: Math.floor(Date.now() / 1000) + 3600
    };

    this.currentSession = session;
    this._notifyAuthState('SIGNED_IN', session);
    return { data: { user: session.user, session }, error: null };
  }

  async signOut() {
    this.currentSession = null;
    this.drillUnlockExpiry = 0;
    this._notifyAuthState('SIGNED_OUT', null);
    return { error: null };
  }

  async getSession() {
    return { data: { session: this.currentSession }, error: null };
  }

  async getUser() {
    return { data: { user: this.currentSession ? this.currentSession.user : null }, error: null };
  }

  onAuthStateChange(callback) {
    this.authListeners.add(callback);
    return {
      data: {
        subscription: {
          unsubscribe: () => this.authListeners.delete(callback)
        }
      }
    };
  }

  _notifyAuthState(event, session) {
    for (const listener of this.authListeners) {
      try { listener(event, session); } catch (e) { /* ignore */ }
    }
  }

  // RBAC Helpers
  getUserRole() {
    if (this.isDrillUnlocked()) {
      return 'commander';
    }
    if (!this.currentSession || !this.currentSession.user) return 'visitor';
    const email = String(this.currentSession.user.email || '').trim().toLowerCase();
    if (email.endsWith('@gmail.com') || email === 'fishyaya@apps.ntpc.edu.tw' || email === 'lucyhuang@apps.ntpc.edu.tw' || email === 'fiven@apps.ntpc.edu.tw') {
      return 'commander';
    }
    return this.currentSession.user.user_metadata?.role || 'visitor';
  }

  canEditClass(grade, className) {
    const role = this.getUserRole();
    if (role === 'commander') return true;
    if (role !== 'teacher') return false;

    const assigned = this.currentSession.user.user_metadata?.assignedClass;
    if (!assigned) return false;
    return assigned === `${grade} ${className}`;
  }

  canAccessCommander() {
    return this.getUserRole() === 'commander';
  }

  canAccessPullout() {
    const role = this.getUserRole();
    return role === 'commander' || role === 'pullout_teacher';
  }

  canAccessRescue() {
    const role = this.getUserRole();
    return role === 'commander' || role === 'medical' || role === 'rescue_officer';
  }

  canAccessPatrol() {
    const role = this.getUserRole();
    return role === 'commander' || role === 'patrol' || role === 'inspector';
  }

  canAccessVisitor() {
    const role = this.getUserRole();
    return role === 'commander' || role === 'visitor_manager';
  }

  getPasscodesConfig() {
    return Object.assign({
      medical: '1199',
      inspector: '7777',
      pullout_teacher: '3333',
      visitor_manager: '5555',
      commander_drill: '8888'
    }, this._passcodesConfig || {});
  }

  async updatePasscodesConfig(newConfig) {
    if (!this.canAccessCommander()) {
      throw new Error('權限受限：僅限總指揮官可以更改各組密碼！');
    }
    const current = this.getPasscodesConfig();
    const sanitized = {
      medical: String(newConfig.medical || current.medical || '1199').trim(),
      inspector: String(newConfig.inspector || current.inspector || '7777').trim(),
      pullout_teacher: String(newConfig.pullout_teacher || current.pullout_teacher || '3333').trim(),
      visitor_manager: String(newConfig.visitor_manager || current.visitor_manager || '5555').trim(),
      commander_drill: String(newConfig.commander_drill || current.commander_drill || '8888').trim(),
      updatedAt: Date.now()
    };
    for (const [k, v] of Object.entries(sanitized)) {
      if (k === 'updatedAt') continue;
      if (!v || v.length < 3 || v.length > 8) {
        throw new Error('各組密碼長度必須介於 3 至 8 碼之間！');
      }
    }
    this._passcodesConfig = sanitized;
    return { success: true, config: sanitized };
  }

  getActiveRolePasscodes() {
    const cfg = this.getPasscodesConfig();
    const map = {};
    // 預設與別名註冊
    map['119'] = { role: 'medical', name: '搜救檢傷組' };
    map['1199'] = { role: 'medical', name: '搜救檢傷組' };
    map['2222'] = { role: 'medical', name: '搜救檢傷組' };
    map['7777'] = { role: 'inspector', name: '建物巡檢組' };
    map['3333'] = { role: 'pullout_teacher', name: '抽離專責教師' };
    map['1111'] = { role: 'pullout_teacher', name: '抽離專責教師' };
    map['5555'] = { role: 'visitor_manager', name: '訪客登記組' };
    map['4444'] = { role: 'visitor_manager', name: '訪客登記組' };

    // 動態最新設定覆蓋（自訂最高優先權）
    if (cfg.pullout_teacher) map[String(cfg.pullout_teacher).trim()] = { role: 'pullout_teacher', name: '抽離確認組 (避難引導組)' };
    if (cfg.medical) map[String(cfg.medical).trim()] = { role: 'medical', name: '搜救檢傷組 (搶救組/緊急救護組)' };
    if (cfg.inspector) map[String(cfg.inspector).trim()] = { role: 'inspector', name: '建物巡檢組 (安全防護組)' };
    if (cfg.visitor_manager) map[String(cfg.visitor_manager).trim()] = { role: 'visitor_manager', name: '訪客登記組' };
    return map;
  }

  // Drill Passcode Override
  verifyDrillPasscode(passcode) {
    const cfg = this.getPasscodesConfig();
    const targetPin = String(cfg.commander_drill || '8888').trim();
    const code = String(passcode || '').trim();
    if (code === targetPin || code === '8888') {
      this.drillUnlockExpiry = Date.now() + 20 * 60 * 1000; // 20 minutes
      return true;
    }
    return false;
  }

  // Passcode Quick Login (supports dynamic passcodes set by commander)
  loginWithPasscode(passcode) {
    const code = String(passcode || '').trim();
    if (code === '8888') {
      return {
        success: false,
        error: '⚠️ 8888 密碼已停用！總指揮官請使用專屬帳號密碼登入。'
      };
    }

    const roleMap = this.getActiveRolePasscodes();
    if (roleMap[code]) {
      const match = roleMap[code];
      const session = {
        access_token: `jwt_pin_${match.role}`,
        user: {
          id: `usr_pin_${match.role}`,
          email: `${match.role}@quick-login.local`,
          user_metadata: { role: match.role, name: match.name, loginType: 'pin_passcode' }
        },
        expires_at: Math.floor(Date.now() / 1000) + 3600
      };
      this.currentSession = session;
      this._notifyAuthState('SIGNED_IN', session);
      return { success: true, role: match.role, name: match.name };
    }
    return { success: false, error: '通行密碼錯誤' };
  }

  isDrillUnlocked() {
    return Date.now() < this.drillUnlockExpiry;
  }

  lockDrill() {
    this.drillUnlockExpiry = 0;
  }
}

