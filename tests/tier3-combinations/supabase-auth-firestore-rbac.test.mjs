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

    // 1199 -> Medical
    await auth.loginWithPasscode('1199');
    assert.equal(auth.getUserRole(), 'medical');
    assert.equal(auth.canAccessCommander(), false);

    // 7777 -> Inspector
    await auth.loginWithPasscode('7777');
    assert.equal(auth.getUserRole(), 'inspector');
    assert.equal(auth.canAccessCommander(), false);

    // 3333 -> Pullout Teacher
    await auth.loginWithPasscode('3333');
    assert.equal(auth.getUserRole(), 'pullout_teacher');
    assert.equal(auth.canAccessCommander(), false);

    // 5555 -> Visitor Manager
    await auth.loginWithPasscode('5555');
    assert.equal(auth.getUserRole(), 'visitor_manager');
    assert.equal(auth.canAccessCommander(), false);

    // 8888 -> Drill Commander Override
    const drillRes = auth.loginWithPasscode('8888');
    assert.equal(drillRes.success, true);
    assert.equal(auth.getUserRole(), 'commander');
    assert.equal(auth.canAccessCommander(), true);

    // Invalid PIN returns success: false
    const invalidRes = auth.loginWithPasscode('0000');
    assert.equal(invalidRes.success, false);
    assert.ok(invalidRes.error);
  });
});


