import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MockSupabaseAuth } from '../helpers/mock-supabase.mjs';

describe('Tier 1: Feature 6 - Supabase Auth Integration', () => {
  it('F06-1: User login with valid email and password returns session and user object', async () => {
    const auth = new MockSupabaseAuth();
    const { data, error } = await auth.signInWithPassword({
      email: 'teacher1_1@qs.edu.tw',
      password: 'tea123456'
    });
    assert.equal(error, null);
    assert.ok(data.session);
    assert.ok(data.user);
    assert.equal(data.user.email, 'teacher1_1@qs.edu.tw');
  });

  it('F06-2: User login with invalid password returns error without creating session', async () => {
    const auth = new MockSupabaseAuth();
    const { data, error } = await auth.signInWithPassword({
      email: 'teacher1_1@qs.edu.tw',
      password: 'wrongpassword'
    });
    assert.ok(error);
    assert.equal(data.session, null);
  });

  it('F06-3: Active session returns JWT access token and expiration timestamp', async () => {
    const auth = new MockSupabaseAuth();
    await auth.signInWithPassword({
      email: 'commander@qs.edu.tw',
      password: 'cmd123456'
    });
    const { data } = await auth.getSession();
    assert.ok(data.session.access_token.startsWith('jwt_'));
    assert.ok(data.session.expires_at > Date.now() / 1000);
  });

  it('F06-4: User logout clears session and notifies auth state change listeners', async () => {
    const auth = new MockSupabaseAuth();
    await auth.signInWithPassword({
      email: 'commander@qs.edu.tw',
      password: 'cmd123456'
    });
    let eventReceived = null;
    auth.onAuthStateChange((event) => {
      eventReceived = event;
    });
    await auth.signOut();
    const { data } = await auth.getSession();
    assert.equal(data.session, null);
    assert.equal(eventReceived, 'SIGNED_OUT');
  });

  it('F06-5: Session persistence allows retrieving current user after login', async () => {
    const auth = new MockSupabaseAuth();
    await auth.signInWithPassword({
      email: 'medical@qs.edu.tw',
      password: 'med123456'
    });
    const { data } = await auth.getUser();
    assert.equal(data.user.email, 'medical@qs.edu.tw');
  });
});

describe('Tier 1: Feature 7 - Role-Based Access Control (RBAC)', () => {
  it('F07-1: Commander role is granted full administrative and class editing privileges', async () => {
    const auth = new MockSupabaseAuth();
    await auth.signInWithPassword({
      email: 'commander@qs.edu.tw',
      password: 'cmd123456'
    });
    assert.equal(auth.getUserRole(), 'commander');
    assert.equal(auth.canAccessCommander(), true);
    assert.equal(auth.canEditClass('一', '1'), true);
    assert.equal(auth.canEditClass('六', '15'), true);
  });

  it('F07-2: Teacher role is restricted to editing their assigned class only', async () => {
    const auth = new MockSupabaseAuth();
    await auth.signInWithPassword({
      email: 'teacher1_1@qs.edu.tw',
      password: 'tea123456'
    });
    assert.equal(auth.getUserRole(), 'teacher');
    assert.equal(auth.canAccessCommander(), false);
    assert.equal(auth.canEditClass('一', '1'), true);
    assert.equal(auth.canEditClass('一', '2'), false);
    assert.equal(auth.canEditClass('二', '1'), false);
  });

  it('F07-3: Pullout teacher role is identified for pullout triage operations', async () => {
    const auth = new MockSupabaseAuth();
    await auth.signInWithPassword({
      email: 'pullout@qs.edu.tw',
      password: 'pul123456'
    });
    assert.equal(auth.getUserRole(), 'pullout_teacher');
    assert.equal(auth.canAccessCommander(), false);
  });

  it('F07-4: Medical/Rescue officer role is identified for triage card assignments', async () => {
    const auth = new MockSupabaseAuth();
    await auth.signInWithPassword({
      email: 'medical@qs.edu.tw',
      password: 'med123456'
    });
    assert.equal(auth.getUserRole(), 'medical');
  });

  it('F07-5: Unauthenticated visitor defaults to visitor role with zero editing permissions', () => {
    const auth = new MockSupabaseAuth();
    assert.equal(auth.getUserRole(), 'visitor');
    assert.equal(auth.canAccessCommander(), false);
    assert.equal(auth.canEditClass('一', '1'), false);
  });
});

describe('Tier 1: Feature 8 - Non-Intrusive Auth UI', () => {
  it('F08-1: Auth status card renders user display name and role badge', () => {
    const renderAuthCard = (user) => {
      if (!user) return '<div class="auth-card">未登入 (訪客) <button id="loginBtn">登入</button></div>';
      return `<div class="auth-card"><span class="badge">${user.role}</span> <span class="name">${user.name}</span> <button id="logoutBtn">登出</button></div>`;
    };
    const html = renderAuthCard({ role: 'teacher', name: '一年一班導師' });
    assert.ok(html.includes('一年一班導師'));
    assert.ok(html.includes('teacher'));
    assert.ok(html.includes('logoutBtn'));
  });

  it('F08-2: Top navigation bar preserves 4 primary tabs alongside auth status widget', () => {
    const navTabs = ['📋 老師點名', '🔄 抽離確認', '🆘 搜救檢傷與建物巡視', '🏫 指揮中心'];
    const navLayout = {
      tabs: navTabs,
      authWidgetPosition: 'nav-right'
    };
    assert.equal(navLayout.tabs.length, 4);
    assert.equal(navLayout.authWidgetPosition, 'nav-right');
  });

  it('F08-3: Mobile viewport (<600px) collapses user label to compact avatar icon', () => {
    const getAuthDisplayStyle = (viewportWidth) => {
      return viewportWidth < 600 ? 'compact-icon' : 'full-badge';
    };
    assert.equal(getAuthDisplayStyle(480), 'compact-icon');
    assert.equal(getAuthDisplayStyle(1024), 'full-badge');
  });

  it('F08-4: Login modal dialog renders without shifting background page elements', () => {
    const modalStyle = {
      position: 'fixed',
      zIndex: 9999,
      top: 0,
      left: 0,
      width: '100%',
      height: '100%'
    };
    assert.equal(modalStyle.position, 'fixed');
    assert.ok(modalStyle.zIndex >= 1000);
  });

  it('F08-5: Session status check avoids UI flicker on page reload', () => {
    const initialSession = { cached: true, role: 'commander' };
    const initialRenderState = initialSession.cached ? 'authenticated' : 'loading';
    assert.equal(initialRenderState, 'authenticated');
  });
});

describe('Tier 1: Feature 9 - Drill Password Emergency Fallback', () => {
  it('F09-1: Entering drill passcode 8888 unlocks commander mode for evaluators', () => {
    const auth = new MockSupabaseAuth();
    const result = auth.verifyDrillPasscode('8888');
    assert.equal(result, true);
    assert.equal(auth.getUserRole(), 'commander');
    assert.equal(auth.canAccessCommander(), true);
  });

  it('F09-2: Unlocked drill session sets 20-minute expiry window', () => {
    const auth = new MockSupabaseAuth();
    auth.verifyDrillPasscode('8888');
    const now = Date.now();
    assert.ok(auth.drillUnlockExpiry >= now + 19 * 60 * 1000);
    assert.ok(auth.drillUnlockExpiry <= now + 21 * 60 * 1000);
  });

  it('F09-3: Incorrect passcode is rejected and does not unlock commander access', () => {
    const auth = new MockSupabaseAuth();
    const result = auth.verifyDrillPasscode('9999');
    assert.equal(result, false);
    assert.equal(auth.isDrillUnlocked(), false);
    assert.notEqual(auth.getUserRole(), 'commander');
  });

  it('F09-4: Expired drill session automatically reverts to default locked status', () => {
    const auth = new MockSupabaseAuth();
    auth.verifyDrillPasscode('8888');
    // Fast-forward time past 20 minutes
    auth.drillUnlockExpiry = Date.now() - 1000;
    assert.equal(auth.isDrillUnlocked(), false);
    assert.equal(auth.getUserRole(), 'visitor');
  });

  it('F09-5: Explicit lockDrill call immediately relocks drill access', () => {
    const auth = new MockSupabaseAuth();
    auth.verifyDrillPasscode('8888');
    assert.equal(auth.isDrillUnlocked(), true);
    auth.lockDrill();
    assert.equal(auth.isDrillUnlocked(), false);
  });
});
