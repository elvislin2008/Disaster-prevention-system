import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { FirestoreService, firestoreService } from '../../public/js/firestore-service.js';

describe('Unit Tests: FirestoreService (Milestone 3)', () => {
  let fs;

  beforeEach(async () => {
    fs = new FirestoreService();
    await fs.init();
    await fs.clearAllData();
  });

  describe('1. Initialization & Offline Queue', () => {
    it('1.1 FirestoreService initializes with genuine local store and offline queue', () => {
      assert.ok(fs.localStore);
      assert.equal(fs.isOnline(), true);
      assert.equal(fs.hasPendingWrites(), false);
    });

    it('1.2 goOffline transitions to offline mode and queues mutations', async () => {
      fs.goOffline();
      assert.equal(fs.isOnline(), false);

      const ref = fs.doc('class_reports', '一 1');
      const res = await fs.setDoc(ref, { total: 28, presentCount: 27 });
      assert.equal(res.fromCache, true);
      assert.equal(res.hasPendingWrites, true);
      assert.equal(fs.hasPendingWrites(), true);

      // Local optimistic read reflects update immediately
      const snap = await fs.getDoc(ref);
      assert.equal(snap.exists(), true);
      assert.equal(snap.data().presentCount, 27);
      assert.equal(snap.metadata.fromCache, true);
      assert.equal(snap.metadata.hasPendingWrites, true);
    });

    it('1.3 goOnline drains mutation queue to server store', async () => {
      fs.goOffline();
      const ref = fs.doc('class_reports', '一 2');
      await fs.setDoc(ref, { total: 28, presentCount: 26 });
      assert.equal(fs.hasPendingWrites(), true);

      await fs.goOnline();
      assert.equal(fs.isOnline(), true);
      assert.equal(fs.hasPendingWrites(), false);

      const snap = await fs.getDoc(ref);
      assert.equal(snap.metadata.fromCache, false);
      assert.equal(snap.metadata.hasPendingWrites, false);
      assert.equal(snap.data().presentCount, 26);
    });
  });

  describe('2. Granular Document-per-Class Operations (class_reports)', () => {
    it('2.1 setClassReport stores report under granular classKey without collisions', async () => {
      await fs.setClassReport('一 1', { total: 28, presentCount: 28, leaveCount: 0 });
      await fs.setClassReport('一 2', { total: 28, presentCount: 27, leaveCount: 1 });

      const rep1 = await fs.getClassReport('一 1');
      const rep2 = await fs.getClassReport('一 2');

      assert.equal(rep1.presentCount, 28);
      assert.equal(rep2.presentCount, 27);
      assert.equal(rep2.leaveCount, 1);
    });

    it('2.2 setClassReport with merge preserves existing fields', async () => {
      await fs.setClassReport('二 3', { total: 28, presentCount: 28 });
      await fs.setClassReport('二 3', { presentCount: 26, leaveCount: 2 }, { merge: true });

      const rep = await fs.getClassReport('二 3');
      assert.equal(rep.total, 28);
      assert.equal(rep.presentCount, 26);
      assert.equal(rep.leaveCount, 2);
    });

    it('2.3 deleteClassReport removes class report from collection', async () => {
      await fs.setClassReport('三 1', { total: 28, presentCount: 28 });
      assert.ok(await fs.getClassReport('三 1'));

      await fs.deleteClassReport('三 1');
      const rep = await fs.getClassReport('三 1');
      assert.equal(rep, null);
    });

    it('2.4 getAllClassReports aggregates all active class reports into a dictionary', async () => {
      await fs.setClassReport('一 1', { presentCount: 28 });
      await fs.setClassReport('一 2', { presentCount: 27 });
      await fs.setClassReport('二 1', { presentCount: 26 });

      const all = await fs.getAllClassReports();
      assert.equal(Object.keys(all).length, 3);
      assert.equal(all['一 1'].presentCount, 28);
      assert.equal(all['一 2'].presentCount, 27);
      assert.equal(all['二 1'].presentCount, 26);
    });
  });

  describe('3. Pullouts, Rescues, Contacts, Visitors & Buildings', () => {
    it('3.1 Pullouts CRUD maintains studentKey indexing and status', async () => {
      const sKey = '一 1_05號';
      await fs.setPullout(sKey, { studentKey: sKey, status: 'pending', type: 'studyCenter' });

      const pullout = await fs.getPullout(sKey);
      assert.equal(pullout.status, 'pending');
      assert.equal(pullout.type, 'studyCenter');

      await fs.setPullout(sKey, { status: 'safe' }, { merge: true });
      const updated = await fs.getPullout(sKey);
      assert.equal(updated.status, 'safe');
      assert.equal(updated.type, 'studyCenter');
    });

    it('3.2 Rescues CRUD records triage classification and escort count', async () => {
      const tKey = '三 2_10號';
      await fs.setRescue(tKey, {
        targetKey: tKey,
        status: 'injured',
        triage: 'yellow',
        escortCount: 2,
        searchDone: false
      });

      const rescue = await fs.getRescue(tKey);
      assert.equal(rescue.status, 'injured');
      assert.equal(rescue.triage, 'yellow');
      assert.equal(rescue.escortCount, 2);
      assert.equal(rescue.searchDone, false);
    });

    it('3.3 Contacts CRUD tracks missed call attempts and help request flag', async () => {
      const sKey = '四 1_08號';
      await fs.setContact(sKey, { status: '聯繫中', count: 5, isHelpReq: true });

      const contact = await fs.getContact(sKey);
      assert.equal(contact.count, 5);
      assert.equal(contact.isHelpReq, true);
    });

    it('3.4 Visitors CRUD supports registration, query, and checkout deletion', async () => {
      await fs.setVisitor('vis_001', {
        id: 'vis_001',
        title: '宏揚水電 2人',
        count: 2,
        type: 'vendor',
        status: 'safe'
      });

      const list = await fs.getAllVisitors();
      assert.equal(list.length, 1);
      assert.equal(list[0].title, '宏揚水電 2人');

      await fs.deleteVisitor('vis_001');
      assert.equal((await fs.getAllVisitors()).length, 0);
    });

    it('3.5 Buildings CRUD maintains safety indicators and inspector notes', async () => {
      await fs.setBuilding('慈愛樓', {
        buildingName: '慈愛樓',
        submitted: true,
        indicators: { column: false, beam: true, wall: true },
        notes: { column: '梁柱出現45度斜向剪力裂縫' }
      });

      const b = await fs.getBuilding('慈愛樓');
      assert.equal(b.submitted, true);
      assert.equal(b.indicators.column, false);
      assert.equal(b.notes.column, '梁柱出現45度斜向剪力裂縫');
    });

    it('3.6 System config state maintains securityMode and custom totals', async () => {
      await fs.setSystemState({
        securityMode: 'disaster',
        approvedCustomTotal: 2540,
        siteLocked: false
      });

      const state = await fs.getSystemState();
      assert.equal(state.securityMode, 'disaster');
      assert.equal(state.approvedCustomTotal, 2540);
    });
  });

  describe('4. Real-time Subscriptions (onSnapshot) & Broadcast Latency', () => {
    it('4.1 subscribeClassReports fires upon document modification with <500ms latency', async () => {
      const startTime = Date.now();
      let receivedReport = null;

      const unsub = fs.subscribeClassReports((reports) => {
        if (reports['五 1']) {
          receivedReport = reports['五 1'];
        }
      });

      await fs.setClassReport('五 1', { total: 28, presentCount: 25 });
      await new Promise(r => setTimeout(r, 20));

      const latency = Date.now() - startTime;
      assert.ok(latency < 500, `Broadcast latency was ${latency}ms, expected < 500ms`);
      assert.ok(receivedReport);
      assert.equal(receivedReport.presentCount, 25);
      unsub();
    });

    it('4.2 Unsubscribing halts notification propagation', async () => {
      let callCount = 0;
      const unsub = fs.subscribeClassReports(() => {
        callCount++;
      });

      await new Promise(r => setTimeout(r, 15));
      const beforeCount = callCount;
      unsub();

      await fs.setClassReport('六 2', { presentCount: 28 });
      await new Promise(r => setTimeout(r, 15));

      assert.equal(callCount, beforeCount);
    });

    it('4.3 Calling unsubscribe multiple times is idempotent and safe', () => {
      const unsub = fs.subscribeClassReports(() => {});
      assert.doesNotThrow(() => {
        unsub();
        unsub();
        unsub();
      });
    });

    it('4.4 clearAllSubscriptions unsubscribes all registered listeners cleanly', async () => {
      let aCalls = 0;
      let bCalls = 0;
      fs.subscribeClassReports(() => aCalls++);
      fs.subscribePullouts(() => bCalls++);

      await new Promise(r => setTimeout(r, 10));
      fs.clearAllSubscriptions();

      await fs.setClassReport('一 1', { presentCount: 20 });
      await fs.setPullout('一 1_01號', { status: 'safe' });
      await new Promise(r => setTimeout(r, 10));

      assert.equal(fs.activeSubscriptions.size, 0);
    });
  });

  describe('5. Boundary & Integrity Guards', () => {
    it('5.1 Oversized payload (>1MB) is blocked by size guard', async () => {
      const ref = fs.doc('class_reports', '一 1');
      const oversized = { padding: 'A'.repeat(1048577) };
      await assert.rejects(async () => {
        await fs.setDoc(ref, oversized);
      }, /exceeds 1MB/);
    });

    it('5.2 Prototype pollution keys are strictly blocked', async () => {
      const ref = fs.doc('class_reports', '一 1');
      const malicious = JSON.parse('{"__proto__": {"admin": true}}');
      await assert.rejects(async () => {
        await fs.setDoc(ref, malicious);
      }, /prototype pollution/);
    });

    it('5.3 Iron Rule 3: Deprecated table collections are strictly rejected', async () => {
      const ref = fs.doc('AfterSchoolSchedule', 'item1');
      await assert.rejects(async () => {
        await fs.setDoc(ref, { data: 'old' });
      }, /Iron Rule 3 Violation/);
    });
  });

  describe('6. Singleton Instance', () => {
    it('6.1 firestoreService singleton is properly instantiated and attached', () => {
      assert.ok(firestoreService instanceof FirestoreService);
      assert.equal(typeof firestoreService.setClassReport, 'function');
      assert.equal(typeof firestoreService.subscribeClassReports, 'function');
    });
  });
});
