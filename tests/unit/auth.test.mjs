import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { SupabaseAuth, AuthManager } from '../../public/js/supabase-auth.js';

describe('Unit Tests: SupabaseAuth & AuthManager (Milestone 2)', () => {
  let auth;

  beforeEach(() => {
    // Reset a clean instance for each test
    auth = new SupabaseAuth();
  });

  describe('1. Authentication APIs (login, logout, session)', () => {
    it('1.1 Login with valid teacher credentials creates active session and JWT token', async () => {
      const { data, error } = await auth.login('teacher1_1@qs.edu.tw', 'tea123456');
      assert.equal(error, null);
      assert.ok(data.session);
      assert.ok(data.user);
      assert.equal(data.user.email, 'teacher1_1@qs.edu.tw');
      assert.ok(data.session.access_token.startsWith('jwt_'));
      assert.ok(data.session.expires_at > Date.now() / 1000);
    });

    it('1.2 Login with invalid password returns error without creating session', async () => {
      const { data, error } = await auth.login('teacher1_1@qs.edu.tw', 'wrongpassword');
      assert.ok(error);
      assert.equal(data.session, null);
      assert.equal(data.user, null);
    });

    it('1.3 Login with empty email or empty password returns error', async () => {
      const res1 = await auth.login('', 'pwd');
      const res2 = await auth.login('teacher1_1@qs.edu.tw', '');
      assert.ok(res1.error);
      assert.ok(res2.error);
    });

    it('1.4 Login with malformed email format returns error', async () => {
      const res1 = await auth.login('not-an-email', 'pwd');
      const res2 = await auth.login('teacher@', 'pwd');
      assert.ok(res1.error);
      assert.ok(res2.error);
    });

    it('1.5 Logout clears active session and notifies auth listeners', async () => {
      await auth.login('commander@qs.edu.tw', 'cmd123456');
      let eventFired = null;
      auth.onAuthStateChange((event) => {
        eventFired = event;
      });

      const res = await auth.logout();
      assert.equal(res.error, null);
      assert.equal(auth.getCurrentUser(), null);
      assert.equal(eventFired, 'SIGNED_OUT');

      const { data } = await auth.getSession();
      assert.equal(data.session, null);
    });

    it('1.6 Logout on already logged out instance resolves cleanly', async () => {
      const res = await auth.logout();
      assert.equal(res.error, null);
    });

    it('1.7 Active session persists current user retrieval', async () => {
      await auth.login('medical@qs.edu.tw', 'med123456');
      const user = auth.getCurrentUser();
      assert.ok(user);
      assert.equal(user.email, 'medical@qs.edu.tw');
      assert.equal(user.user_metadata?.role, 'medical');
    });

    it('1.8 Compatible with Supabase native SDK signatures (signInWithPassword, signOut, getUser)', async () => {
      const res = await auth.signInWithPassword({
        email: 'pullout@qs.edu.tw',
        password: 'pul123456'
      });
      assert.equal(res.error, null);
      assert.ok(res.data.session);

      const userRes = await auth.getUser();
      assert.equal(userRes.data.user.email, 'pullout@qs.edu.tw');

      const outRes = await auth.signOut();
      assert.equal(outRes.error, null);
    });
  });

  describe('2. Role-Based Access Control (RBAC)', () => {
    it('2.1 Commander role has full administrative and class editing permissions', async () => {
      await auth.login('commander@qs.edu.tw', 'cmd123456');
      assert.equal(auth.getUserRole(), 'commander');
      assert.equal(auth.canAccessCommander(), true);
      assert.equal(auth.canAccessPullout(), true);
      assert.equal(auth.canAccessRescue(), true);
      assert.equal(auth.canAccessPatrol(), true);
      assert.equal(auth.canEditClass('一', '1'), true);
      assert.equal(auth.canEditClass('六', '15'), true);
      assert.equal(auth.canUnlockMaskedPhones('drill'), true);
    });

    it('2.2 Teacher role is strictly restricted to assigned class only (Iron Rule 2: single-char grade)', async () => {
      await auth.login('teacher1_1@qs.edu.tw', 'tea123456');
      assert.equal(auth.getUserRole(), 'teacher');
      assert.equal(auth.getAssignedClass(), '一 1');
      assert.equal(auth.canAccessCommander(), false);
      assert.equal(auth.canAccessPullout(), false);
      assert.equal(auth.canAccessRescue(), false);

      // Allowed: exact assigned class
      assert.equal(auth.canEditClass('一', '1'), true);

      // Denied: same grade different class
      assert.equal(auth.canEditClass('一', '2'), false);
      assert.equal(auth.canEditClass('一', '15'), false);

      // Denied: different grade
      assert.equal(auth.canEditClass('二', '1'), false);
      assert.equal(auth.canEditClass('六', '1'), false);
    });

    it('2.3 Pullout teacher role can access pullout triage but cannot access commander', async () => {
      await auth.login('pullout@qs.edu.tw', 'pul123456');
      assert.equal(auth.getUserRole(), 'pullout_teacher');
      assert.equal(auth.canAccessPullout(), true);
      assert.equal(auth.canAccessCommander(), false);
      assert.equal(auth.canEditClass('一', '1'), false);
    });

    it('2.4 Medical / Rescue officer role can access rescue and triage operations', async () => {
      await auth.login('medical@qs.edu.tw', 'med123456');
      assert.equal(auth.getUserRole(), 'medical');
      assert.equal(auth.canAccessRescue(), true);
      assert.equal(auth.canAccessCommander(), false);
    });

    it('2.5 Inspector / Patrol role can access building patrol checklist', async () => {
      await auth.login('inspector@qs.edu.tw', 'ins123456');
      assert.equal(auth.getUserRole(), 'inspector');
      assert.equal(auth.canAccessPatrol(), true);
      assert.equal(auth.canAccessCommander(), false);
    });

    it('2.6 Unauthenticated visitor defaults to visitor role with zero editing permissions', () => {
      assert.equal(auth.getUserRole(), 'visitor');
      assert.equal(auth.canAccessCommander(), false);
      assert.equal(auth.canAccessPullout(), false);
      assert.equal(auth.canAccessRescue(), false);
      assert.equal(auth.canAccessPatrol(), false);
      assert.equal(auth.canEditClass('一', '1'), false);
    });

    it('2.7 Phone number masking protects student privacy unless commander or disaster mode', async () => {
      // Unauthenticated visitor
      assert.equal(auth.getMaskedPhone('0912345678', 'drill'), '🔒 ***-*** (個資防護中)');

      // Teacher in drill mode
      await auth.login('teacher1_1@qs.edu.tw', 'tea123456');
      assert.equal(auth.getMaskedPhone('0912345678', 'drill'), '🔒 ***-*** (個資防護中)');

      // Teacher in disaster mode (emergency full unmask)
      assert.equal(auth.getMaskedPhone('0912345678', 'disaster'), '0912345678');

      // Commander in drill mode
      await auth.login('commander@qs.edu.tw', 'cmd123456');
      assert.equal(auth.getMaskedPhone('0912345678', 'drill'), '0912345678');
    });
  });

  describe('3. Emergency Drill Fallback (Passcode 8888)', () => {
    it('3.1 Passcode 8888 unlocks temporary commander mode for 20 minutes', () => {
      const res = auth.loginWithPasscode('8888');
      assert.equal(res.success, true);
      assert.equal(auth.isDrillUnlocked(), true);
      assert.equal(auth.getUserRole(), 'commander');
      assert.equal(auth.canAccessCommander(), true);
      assert.equal(auth.canEditClass('一', '1'), true);
      assert.equal(auth.canEditClass('六', '15'), true);

      const now = Date.now();
      assert.ok(auth.drillUnlockExpiry >= now + 19 * 60 * 1000);
      assert.ok(auth.drillUnlockExpiry <= now + 21 * 60 * 1000);
    });

    it('3.2 Passcode with leading or trailing whitespace is accepted', () => {
      assert.equal(auth.verifyDrillPasscode('   8888   '), true);
      assert.equal(auth.isDrillUnlocked(), true);
    });

    it('3.3 Invalid passcode is rejected and does not unlock commander access', () => {
      assert.equal(auth.verifyDrillPasscode('888'), false);
      assert.equal(auth.verifyDrillPasscode('88888'), false);
      assert.equal(auth.verifyDrillPasscode('1234'), false);
      assert.equal(auth.isDrillUnlocked(), false);
      assert.equal(auth.getUserRole(), 'visitor');
    });

    it('3.4 Rate limiting throttles after 5 consecutive incorrect passcode attempts', () => {
      for (let i = 0; i < 5; i++) {
        auth.verifyDrillPasscode('1111');
      }
      assert.throws(() => auth.verifyDrillPasscode('1111'), /Too many passcode attempts/);
    });

    it('3.5 Expired drill session automatically reverts to default role', () => {
      auth.verifyDrillPasscode('8888');
      assert.equal(auth.isDrillUnlocked(), true);

      // Fast forward past 20 minutes
      auth.drillUnlockExpiry = Date.now() - 1000;
      assert.equal(auth.isDrillUnlocked(), false);
      assert.equal(auth.getUserRole(), 'visitor');
    });

    it('3.6 Severe clock drift backwards resets drill unlock status', () => {
      auth.verifyDrillPasscode('8888');
      // Simulate extreme clock rollback
      auth.drillUnlockExpiry = Date.now() + 3600000; // 1 hour ahead > 20 mins
      assert.equal(auth.isDrillUnlocked(), false);
    });

    it('3.7 lockDrill immediately relocks drill access', () => {
      auth.verifyDrillPasscode('8888');
      assert.equal(auth.isDrillUnlocked(), true);
      auth.lockDrill();
      assert.equal(auth.isDrillUnlocked(), false);
    });

    it('3.8 Drill unlock does not erase underlying Supabase user account identity', async () => {
      await auth.login('teacher1_1@qs.edu.tw', 'tea123456');
      auth.verifyDrillPasscode('8888');

      assert.equal(auth.isDrillUnlocked(), true);
      assert.equal(auth.getUserRole(), 'commander');

      // User account is preserved
      const user = auth.getCurrentUser();
      assert.equal(user.email, 'teacher1_1@qs.edu.tw');
    });
  });

  describe('4. Non-Intrusive UI Integration & Security Helpers', () => {
    it('4.1 escapeHtml safely prevents XSS injection', () => {
      const malicious = '<script>alert("xss")</script>&"\'';
      const safe = auth._escapeHtml(malicious);
      assert.ok(!safe.includes('<script>'));
      assert.ok(safe.includes('&lt;script&gt;'));
      assert.ok(safe.includes('&amp;'));
      assert.ok(safe.includes('&quot;'));
      assert.ok(safe.includes('&#39;'));
    });

    it('4.2 truncateName properly truncates long names with ellipsis', () => {
      const longName = '新北市土城區清水國小六年級十五班暨緊急應變代理導師';
      const truncated = auth._truncateName(longName, 15);
      assert.ok(truncated.length <= 18);
      assert.ok(truncated.endsWith('...'));
    });

    it('4.3 renderAuthBadge generates compact markup conforming to height <= 45px', () => {
      const htmlVisitor = auth.renderAuthBadge({ innerHTML: '', querySelector: () => null });
      assert.ok(htmlVisitor.includes('未登入 (訪客)'));
      assert.ok(htmlVisitor.includes('max-height:45px'));
      assert.ok(htmlVisitor.includes('height:38px'));
    });
  });

  describe('5. Global Singleton and Default Export', () => {
    it('5.1 AuthManager is properly instantiated singleton', () => {
      assert.ok(AuthManager instanceof SupabaseAuth);
      assert.equal(typeof AuthManager.login, 'function');
      assert.equal(typeof AuthManager.getUserRole, 'function');
    });
  });
});
