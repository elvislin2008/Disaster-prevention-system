import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MockSupabaseAuth } from '../helpers/mock-supabase.mjs';
import { MockFirestore } from '../helpers/mock-firestore.mjs';

describe('Tier 3: Pairwise - Supabase Login Role Check with Firestore RBAC Access', () => {
  it('T3-11: Teacher logs in via Supabase -> writes to assigned class (allowed) -> other class (blocked)', async () => {
    const auth = new MockSupabaseAuth();
    const firestore = new MockFirestore();

    await auth.signInWithPassword({ email: 'teacher1_1@qs.edu.tw', password: 'tea123456' });
    const userRole = auth.getUserRole();
    assert.equal(userRole, 'teacher');

    const updateClassWithRbac = async (grade, className, report) => {
      if (!auth.canEditClass(grade, className)) {
        throw new Error(`Permission Denied: Teacher cannot edit ${grade} ${className}`);
      }
      return firestore.setDoc(firestore.doc('class_reports', `${grade} ${className}`), report);
    };

    // Edit own class
    const resOwn = await updateClassWithRbac('一', '1', { presentCount: 28 });
    assert.ok(resOwn);

    // Edit other class
    await assert.rejects(async () => {
      await updateClassWithRbac('一', '2', { presentCount: 28 });
    }, /Permission Denied/);
  });

  it('T3-12: Commander logs in -> accesses emergency unlock -> unmasks all parent phones', async () => {
    const auth = new MockSupabaseAuth();
    await auth.signInWithPassword({ email: 'commander@qs.edu.tw', password: 'cmd123456' });

    assert.equal(auth.canAccessCommander(), true);
    const unmaskPhone = (rawPhone, userAuth) => {
      if (userAuth.canAccessCommander()) return rawPhone;
      return '🔒 ***-***';
    };

    assert.equal(unmaskPhone('0912345678', auth), '0912345678');
  });

  it('T3-13: Visitor without login can read class reports but cannot perform write operations', async () => {
    const auth = new MockSupabaseAuth();
    const firestore = new MockFirestore();
    await firestore.setDoc(firestore.doc('class_reports', '一 1'), { total: 28, present: 28 });

    // Read allowed
    const snap = await firestore.getDoc(firestore.doc('class_reports', '一 1'));
    assert.equal(snap.data().total, 28);

    // Write blocked by RBAC
    const writeReport = (userAuth) => {
      if (userAuth.getUserRole() === 'visitor') throw new Error('Visitor cannot submit roll call');
    };
    assert.throws(() => writeReport(auth), /Visitor cannot submit roll call/);
  });

  it('T3-14: Drill passcode 8888 grants temporary commander override for drill evaluator', () => {
    const auth = new MockSupabaseAuth();
    assert.equal(auth.getUserRole(), 'visitor');

    auth.verifyDrillPasscode('8888');
    assert.equal(auth.getUserRole(), 'commander');
    assert.equal(auth.canAccessCommander(), true);
    assert.equal(auth.canEditClass('六', '15'), true);
  });

  it('T3-15: Logout from Supabase immediately revokes permissions back to visitor', async () => {
    const auth = new MockSupabaseAuth();
    await auth.signInWithPassword({ email: 'commander@qs.edu.tw', password: 'cmd123456' });
    assert.equal(auth.getUserRole(), 'commander');

    await auth.signOut();
    assert.equal(auth.getUserRole(), 'visitor');
    assert.equal(auth.canAccessCommander(), false);
  });

  it('T3-21: Disaster Fast PIN login - grants duty roles (1199, 7777, 3333, 5555) but strictly blocks commander access', async () => {
    const auth = new MockSupabaseAuth();

    // 1199 and 2222 -> Medical (搜救檢傷組)
    await auth.loginWithPasscode('1199');
    assert.equal(auth.getUserRole(), 'medical');
    assert.equal(auth.canAccessCommander(), false);

    await auth.loginWithPasscode('2222');
    assert.equal(auth.getUserRole(), 'medical', '2222 must map to medical (搜救檢傷組)');
    assert.equal(auth.canAccessCommander(), false);

    // 7777 -> Inspector
    await auth.loginWithPasscode('7777');
    assert.equal(auth.getUserRole(), 'inspector');
    assert.equal(auth.canAccessCommander(), false);

    // 3333 -> Pullout Teacher
    await auth.loginWithPasscode('3333');
    assert.equal(auth.getUserRole(), 'pullout_teacher');
    assert.equal(auth.canAccessCommander(), false);

    // 5555 and 4444 -> Visitor Manager (訪客登記組)
    await auth.loginWithPasscode('5555');
    assert.equal(auth.getUserRole(), 'visitor_manager');
    assert.equal(auth.canAccessCommander(), false);

    await auth.loginWithPasscode('4444');
    assert.equal(auth.getUserRole(), 'visitor_manager', '4444 must map to visitor_manager (訪客登記組)');
    assert.equal(auth.canAccessCommander(), false);

    // 8888 -> Strictly blocked from quick login and never grants commander role
    const drillRes = auth.loginWithPasscode('8888');
    assert.equal(drillRes.success, false);
    assert.ok(drillRes.error.includes('總指揮官') || drillRes.error.includes('8888'));
    assert.notEqual(auth.getUserRole(), 'commander');
    assert.equal(auth.canAccessCommander(), false);

    // Invalid PIN returns success: false
    const invalidRes = auth.loginWithPasscode('0000');
    assert.equal(invalidRes.success, false);
    assert.ok(invalidRes.error);
  });

  it('T3-22: Commander updates group passcodes dynamically and non-commander is strictly blocked', async () => {
    const auth = new MockSupabaseAuth();

    // 1. Unauthenticated or non-commander user tries to update passcodes -> rejected
    await assert.rejects(async () => {
      await auth.updatePasscodesConfig({ medical: '9999' });
    }, /權限受限/);

    // 2. Commander logs in
    await auth.signInWithPassword({ email: 'commander@qs.edu.tw', password: 'cmd123456' });
    assert.equal(auth.canAccessCommander(), true);

    // 3. Commander updates passcodes for each duty group
    const res = await auth.updatePasscodesConfig({
      medical: '9999',
      inspector: '8877',
      pullout_teacher: '6666',
      visitor_manager: '4321'
    });
    assert.equal(res.success, true);
    assert.equal(res.config.medical, '9999');
    assert.equal(res.config.inspector, '8877');
    assert.equal(res.config.pullout_teacher, '6666');
    assert.equal(res.config.visitor_manager, '4321');

    // 4. Logout commander
    await auth.signOut();

    // 5. Test logging in with newly configured PIN 9999 for medical
    const medRes = auth.loginWithPasscode('9999');
    assert.equal(medRes.success, true);
    assert.equal(auth.getUserRole(), 'medical');
    assert.equal(auth.canAccessCommander(), false);

    // 6. Test logging in with newly configured PIN 8877 for inspector
    const insRes = auth.loginWithPasscode('8877');
    assert.equal(insRes.success, true);
    assert.equal(auth.getUserRole(), 'inspector');

    // 7. Test logging in with newly configured PIN 6666 for pullout
    const pulRes = auth.loginWithPasscode('6666');
    assert.equal(pulRes.success, true);
    assert.equal(auth.getUserRole(), 'pullout_teacher');

    // 8. Test logging in with newly configured PIN 4321 for visitor
    const visRes = auth.loginWithPasscode('4321');
    assert.equal(visRes.success, true);
    assert.equal(auth.getUserRole(), 'visitor_manager');
  });

  it('T3-23: Passcode 2222 strictly maps to medical (搜救檢傷組) and 4444 strictly maps to visitor_manager (訪客登記組)', async () => {
    const auth = new MockSupabaseAuth();

    // Reset / ensure passcodes config with 2222 as medical and 4444 as visitor_manager
    await auth.signInWithPassword({ email: 'commander@qs.edu.tw', password: 'cmd123456' });
    await auth.updatePasscodesConfig({
      pullout_teacher: '1111',
      medical: '2222',
      inspector: '3333',
      visitor_manager: '4444'
    });
    await auth.signOut();

    // Verify 2222 strictly routes to medical (搜救檢傷組)
    const medRes = auth.loginWithPasscode('2222');
    assert.equal(medRes.success, true);
    assert.equal(auth.getUserRole(), 'medical', 'PIN 2222 must strictly enter medical (搜救檢傷組)');
    assert.notEqual(auth.getUserRole(), 'visitor_manager', 'PIN 2222 must never enter visitor_manager');
    assert.notEqual(auth.getUserRole(), 'inspector', 'PIN 2222 must never enter inspector');

    // Verify 4444 strictly routes to visitor_manager (訪客登記組)
    const visRes = auth.loginWithPasscode('4444');
    assert.equal(visRes.success, true);
    assert.equal(auth.getUserRole(), 'visitor_manager', 'PIN 4444 must strictly enter visitor_manager (訪客登記組)');
    assert.notEqual(auth.getUserRole(), 'medical', 'PIN 4444 must never enter medical');
  });
});



