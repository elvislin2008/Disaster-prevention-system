import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SupabaseAuth } from '../../public/js/supabase-auth.js';
import { MockSupabaseAuth } from '../helpers/mock-supabase.mjs';

describe('Adversarial Verification: 3. Phone Masking Privacy Leakage', () => {
  it('ADV-3.1: Teacher account CANNOT view unmasked phone numbers of students outside assigned class in drill mode', async () => {
    const auth = new SupabaseAuth();
    await auth.init();

    // Log in as Teacher assigned to Class "一 1"
    const loginRes = await auth.login('teacher1_1@qs.edu.tw', 'tea123456');
    assert.equal(loginRes.error, null);
    assert.equal(auth.getUserRole(), 'teacher');
    assert.equal(auth.getAssignedClass(), '一 1');

    // Security mode is drill
    const securityMode = 'drill';

    // Verify teacher cannot unlock phones in drill mode
    assert.equal(auth.canUnlockMaskedPhones(securityMode), false);

    // Simulated students from outside classes
    const outsideStudents = [
      { studentKey: '一 2_05號', rawPhone: '0911222333' },
      { studentKey: '二 1_12號', rawPhone: '0922333444' },
      { studentKey: '三 4_01號', rawPhone: '0933444555' },
      { studentKey: '六 15_28號', rawPhone: '0966777888' }
    ];

    for (const s of outsideStudents) {
      const masked = auth.getMaskedPhone(s.rawPhone, securityMode);
      assert.equal(masked, '🔒 ***-*** (個資防護中)');
      assert.equal(masked.includes(s.rawPhone), false, `Raw phone ${s.rawPhone} must never leak in masked output`);
    }

    // Verify teacher cannot edit outside classes either
    assert.equal(auth.canEditClass('一', '2'), false);
    assert.equal(auth.canEditClass('二', '1'), false);
    assert.equal(auth.canEditClass('六', '15'), false);
  });

  it('ADV-3.2: Drill mode strictly enforces phone masking across all non-commander roles', async () => {
    const auth = new SupabaseAuth();
    await auth.init();

    const rolesToTest = [
      { email: 'teacher1_1@qs.edu.tw', pwd: 'tea123456', expectedRole: 'teacher' },
      { email: 'pullout@qs.edu.tw', pwd: 'pul123456', expectedRole: 'pullout_teacher' },
      { email: 'medical@qs.edu.tw', pwd: 'med123456', expectedRole: 'medical' },
      { email: 'inspector@qs.edu.tw', pwd: 'ins123456', expectedRole: 'inspector' }
    ];

    for (const r of rolesToTest) {
      await auth.login(r.email, r.pwd);
      assert.equal(auth.getUserRole(), r.expectedRole);
      assert.equal(auth.canUnlockMaskedPhones('drill'), false, `${r.expectedRole} must not unlock phones in drill mode`);
      const masked = auth.getMaskedPhone('0912345678', 'drill');
      assert.equal(masked, '🔒 ***-*** (個資防護中)');
      await auth.logout();
    }

    // Unauthenticated visitor
    assert.equal(auth.getUserRole(), 'visitor');
    assert.equal(auth.canUnlockMaskedPhones('drill'), false);
    assert.equal(auth.getMaskedPhone('0912345678', 'drill'), '🔒 ***-*** (個資防護中)');
  });

  it('ADV-3.3: Commander account unlocks full phone numbers in drill mode', async () => {
    const auth = new SupabaseAuth();
    await auth.init();

    await auth.login('commander@qs.edu.tw', 'cmd123456');
    assert.equal(auth.getUserRole(), 'commander');
    assert.equal(auth.canAccessCommander(), true);

    // In drill mode, commander has authority to unlock
    assert.equal(auth.canUnlockMaskedPhones('drill'), true);

    const raw = '0912345678';
    const unlocked = auth.getMaskedPhone(raw, 'drill');
    assert.equal(unlocked, raw, 'Commander must receive full unmasked phone number');
  });

  it('ADV-3.4: Disaster mode unlocks full numbers for teacher accounts during real emergency', async () => {
    const auth = new SupabaseAuth();
    await auth.init();

    await auth.login('teacher1_1@qs.edu.tw', 'tea123456');
    assert.equal(auth.getUserRole(), 'teacher');

    // In disaster mode, emergency contact takes precedence
    const securityMode = 'disaster';
    assert.equal(auth.canUnlockMaskedPhones(securityMode), true);

    const raw = '0988776655';
    const unlocked = auth.getMaskedPhone(raw, securityMode);
    assert.equal(unlocked, raw, 'In disaster mode, emergency contact phone must be unmasked');
  });

  it('ADV-3.5: Drill Passcode 8888 grants temporary 20-min unlock, immediate relock re-masks all phones', async () => {
    const auth = new SupabaseAuth();
    await auth.init();

    await auth.login('teacher1_1@qs.edu.tw', 'tea123456');
    assert.equal(auth.canUnlockMaskedPhones('drill'), false);

    // Verify drill passcode
    const ok = auth.verifyDrillPasscode('8888');
    assert.equal(ok, true);
    assert.equal(auth.isDrillUnlocked(), true);
    assert.equal(auth.canUnlockMaskedPhones('drill'), true);
    assert.equal(auth.getMaskedPhone('0912345678', 'drill'), '0912345678');

    // Relock drill
    auth.lockDrill();
    assert.equal(auth.isDrillUnlocked(), false);
    assert.equal(auth.canUnlockMaskedPhones('drill'), false);
    assert.equal(auth.getMaskedPhone('0912345678', 'drill'), '🔒 ***-*** (個資防護中)');
  });

  it('ADV-3.6: Malicious phone string injection attack does not leak or execute dangerous scripts', async () => {
    const auth = new SupabaseAuth();
    await auth.init();

    const maliciousPhone = '<script>alert("xss")</script>0912345678';
    const masked = auth.getMaskedPhone(maliciousPhone, 'drill');

    assert.equal(masked, '🔒 ***-*** (個資防護中)');
    assert.equal(masked.includes('<script>'), false);
    assert.equal(masked.includes('0912345678'), false);
  });
});
