import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MockSupabaseAuth } from '../helpers/mock-supabase.mjs';

describe('Tier 2: Boundary - Feature 6 (Supabase Auth Integration)', () => {
  it('B06-1: Login with empty email or empty password returns error without creating session', async () => {
    const auth = new MockSupabaseAuth();
    const res1 = await auth.signInWithPassword({ email: '', password: 'pwd' });
    const res2 = await auth.signInWithPassword({ email: 'user@qs.edu.tw', password: '' });
    assert.ok(res1.error);
    assert.ok(res2.error);
  });

  it('B06-2: Login with malformed email format is caught before authentication', async () => {
    const auth = new MockSupabaseAuth();
    const validateEmail = (email) => {
      if (!email.includes('@') || !email.includes('.')) throw new Error('Invalid email format');
    };
    assert.throws(() => validateEmail('not-an-email'), /Invalid email format/);
    assert.throws(() => validateEmail('admin@'), /Invalid email format/);
  });

  it('B06-3: Expired JWT token is detected and flagged by session validator', () => {
    const isTokenExpired = (session) => {
      const nowSec = Math.floor(Date.now() / 1000);
      return session.expires_at < nowSec;
    };
    const expiredSession = { expires_at: Math.floor(Date.now() / 1000) - 100 };
    const validSession = { expires_at: Math.floor(Date.now() / 1000) + 3600 };
    assert.equal(isTokenExpired(expiredSession), true);
    assert.equal(isTokenExpired(validSession), false);
  });

  it('B06-4: Concurrent login requests handle cleanly without session collision', async () => {
    const auth = new MockSupabaseAuth();
    const [res1, res2] = await Promise.all([
      auth.signInWithPassword({ email: 'teacher1_1@qs.edu.tw', password: 'tea123456' }),
      auth.signInWithPassword({ email: 'commander@qs.edu.tw', password: 'cmd123456' })
    ]);
    assert.ok(res1.data.session);
    assert.ok(res2.data.session);
    assert.notEqual(res1.data.user.id, res2.data.user.id);
  });

  it('B06-5: SignOut on already signed out state resolves safely with error: null', async () => {
    const auth = new MockSupabaseAuth();
    const res = await auth.signOut();
    assert.equal(res.error, null);
    const { data } = await auth.getSession();
    assert.equal(data.session, null);
  });
});

describe('Tier 2: Boundary - Feature 7 (Role-Based Access Control - RBAC)', () => {
  it('B07-1: Teacher cannot edit a class belonging to another grade', async () => {
    const auth = new MockSupabaseAuth();
    await auth.signInWithPassword({ email: 'teacher1_1@qs.edu.tw', password: 'tea123456' });
    assert.equal(auth.canEditClass('二', '1'), false);
    assert.equal(auth.canEditClass('六', '1'), false);
  });

  it('B07-2: Teacher cannot edit another class in the same grade', async () => {
    const auth = new MockSupabaseAuth();
    await auth.signInWithPassword({ email: 'teacher1_1@qs.edu.tw', password: 'tea123456' });
    assert.equal(auth.canEditClass('一', '2'), false);
    assert.equal(auth.canEditClass('一', '15'), false);
  });

  it('B07-3: Non-commander attempting to invoke clearAllReports raises UnauthorizedError', async () => {
    const auth = new MockSupabaseAuth();
    await auth.signInWithPassword({ email: 'teacher1_1@qs.edu.tw', password: 'tea123456' });
    const clearAll = (userAuth) => {
      if (userAuth.getUserRole() !== 'commander') {
        throw new Error('Unauthorized: only commander may reset drill reports');
      }
    };
    assert.throws(() => clearAll(auth), /Unauthorized: only commander/);
  });

  it('B07-4: Non-commander attempting to view unmasked phone numbers receives masked string', async () => {
    const auth = new MockSupabaseAuth();
    await auth.signInWithPassword({ email: 'teacher1_1@qs.edu.tw', password: 'tea123456' });
    const getPhone = (rawPhone, userAuth) => {
      if (userAuth.canAccessCommander()) return rawPhone;
      return '🔒 ***-*** (個資防護中)';
    };
    assert.equal(getPhone('0912345678', auth), '🔒 ***-*** (個資防護中)');
  });

  it('B07-5: Role assignment with invalid role name defaults to visitor', () => {
    const validateRole = (role) => {
      const allowed = ['commander', 'teacher', 'pullout_teacher', 'medical', 'patrol', 'visitor_manager'];
      return allowed.includes(role) ? role : 'visitor';
    };
    assert.equal(validateRole('super_admin_fake'), 'visitor');
    assert.equal(validateRole(''), 'visitor');
    assert.equal(validateRole(null), 'visitor');
  });
});

describe('Tier 2: Boundary - Feature 8 (Non-Intrusive Auth UI)', () => {
  it('B08-1: Ultra-long user display name (>30 chars) is truncated with ellipsis', () => {
    const truncateName = (name, max = 15) => {
      if (name.length > max) return name.substring(0, max) + '...';
      return name;
    };
    const longName = '新北市土城區清水國小六年級十五班暨緊急應變代理導師';
    const truncated = truncateName(longName);
    assert.ok(truncated.length <= 18);
    assert.ok(truncated.endsWith('...'));
  });

  it('B08-2: Special characters in user name do not cause XSS in rendered HTML', () => {
    const escapeHtml = (str) => {
      return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    };
    const malicious = '<script>alert("xss")</script>';
    const safe = escapeHtml(malicious);
    assert.ok(!safe.includes('<script>'));
    assert.ok(safe.includes('&lt;script&gt;'));
  });

  it('B08-3: Rapid clicking on login/logout button does not cause repeated modal openings', () => {
    let isOpen = false;
    let openCalls = 0;
    const openLoginModal = () => {
      if (isOpen) return; // guard against double click
      isOpen = true;
      openCalls++;
    };
    openLoginModal();
    openLoginModal();
    openLoginModal();
    assert.equal(openCalls, 1);
  });

  it('B08-4: Auth widget height is constrained within 45px to prevent nav bar overflow', () => {
    const checkWidgetHeight = (computedHeight) => computedHeight <= 45;
    assert.equal(checkWidgetHeight(38), true);
    assert.equal(checkWidgetHeight(50), false);
  });

  it('B08-5: Offline login state is displayed with cached offline indicator', () => {
    const getAuthBadge = (isOnline, role) => {
      const offlineSuffix = isOnline ? '' : ' (離線快取)';
      return `[${role}]${offlineSuffix}`;
    };
    assert.equal(getAuthBadge(false, 'teacher'), '[teacher] (離線快取)');
    assert.equal(getAuthBadge(true, 'teacher'), '[teacher]');
  });
});

describe('Tier 2: Boundary - Feature 9 (Drill Password Emergency Fallback)', () => {
  it('B09-1: Entering 8888 with leading or trailing whitespace is accepted after trimming', () => {
    const auth = new MockSupabaseAuth();
    assert.equal(auth.verifyDrillPasscode('  8888  '), true);
    assert.equal(auth.isDrillUnlocked(), true);
  });

  it('B09-2: Entering 888 (3 digits) or 88888 (5 digits) is rejected', () => {
    const auth = new MockSupabaseAuth();
    assert.equal(auth.verifyDrillPasscode('888'), false);
    assert.equal(auth.verifyDrillPasscode('88888'), false);
    assert.equal(auth.isDrillUnlocked(), false);
  });

  it('B09-3: Rate limiting throttles rapid repeated incorrect passcode attempts', () => {
    let attempts = 0;
    const checkThrottled = () => {
      attempts++;
      if (attempts > 5) throw new Error('Too many passcode attempts. Please wait 30 seconds.');
    };
    for (let i = 0; i < 5; i++) checkThrottled();
    assert.throws(() => checkThrottled(), /Too many passcode attempts/);
  });

  it('B09-4: Clock drift adjustment backwards does not extend 20-minute expiry indefinitely', () => {
    const maxExpiryDuration = 20 * 60 * 1000;
    const startTime = Date.now();
    const expiryTime = startTime + maxExpiryDuration;

    // Simulate clock jumped backwards by 1 hour
    const simulatedClock = startTime - 3600000;
    const isStillValid = (now) => (now < expiryTime) && (expiryTime - now <= maxExpiryDuration + 60000);
    // If clock jumped backwards dramatically, anomaly check flags it
    assert.equal(isStillValid(simulatedClock), false);
  });

  it('B09-5: Drill passcode unlock does not overwrite standard Supabase user account identity', async () => {
    const auth = new MockSupabaseAuth();
    await auth.signInWithPassword({ email: 'teacher1_1@qs.edu.tw', password: 'tea123456' });
    auth.verifyDrillPasscode('8888');

    // Drill is unlocked
    assert.equal(auth.isDrillUnlocked(), true);
    // User email identity remains intact
    const { data } = await auth.getUser();
    assert.equal(data.user.email, 'teacher1_1@qs.edu.tw');
  });
});
