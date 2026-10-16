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

  // Drill Passcode 8888 Override
  verifyDrillPasscode(passcode) {
    if (String(passcode).trim() === '8888') {
      this.drillUnlockExpiry = Date.now() + 20 * 60 * 1000; // 20 minutes
      return true;
    }
    return false;
  }

  isDrillUnlocked() {
    return Date.now() < this.drillUnlockExpiry;
  }

  lockDrill() {
    this.drillUnlockExpiry = 0;
  }
}
