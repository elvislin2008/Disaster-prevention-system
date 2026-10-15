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
});
