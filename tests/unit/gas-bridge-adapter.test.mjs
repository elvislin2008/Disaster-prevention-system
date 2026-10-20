import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { FirestoreService } from '../../public/js/firestore-service.js';
import { GASBridgeAdapter, createGasAdapter } from '../../public/js/gas-bridge-adapter.js';

describe('Unit Tests: GASBridgeAdapter & google.script.run Emulator (Milestone 3)', () => {
  let firestore;
  let adapter;
  let google;

  beforeEach(async () => {
    firestore = new FirestoreService();
    await firestore.init();
    await firestore.clearAllData();

    adapter = new GASBridgeAdapter({ firestore });
    google = createGasAdapter({ firestore });
  });

  describe('1. google.script.run Chaining & Runner Mechanics', () => {
    it('1.1 withSuccessHandler resolves asynchronous data via microtask', async () => {
      const data = await new Promise(resolve => {
        google.script.run.withSuccessHandler(resolve).getScheduleConfigData();
      });
      assert.ok(Array.isArray(data));
      assert.ok(data.length > 0);
    });

    it('1.2 withSuccessHandler and withFailureHandler can be chained in any order', async () => {
      // Order 1: Success then Failure
      const res1 = await new Promise((resolve, reject) => {
        google.script.run
          .withSuccessHandler(resolve)
          .withFailureHandler(reject)
          .getScheduleConfigData();
      });
      assert.ok(Array.isArray(res1));

      // Order 2: Failure then Success
      const res2 = await new Promise((resolve, reject) => {
        google.script.run
          .withFailureHandler(reject)
          .withSuccessHandler(resolve)
          .getScheduleConfigData();
      });
      assert.ok(Array.isArray(res2));
    });

    it('1.3 withFailureHandler catches runtime exceptions during execution', async () => {
      const originalSet = firestore.setClassReport;
      firestore.setClassReport = async () => {
        throw new Error('Simulated database write timeout');
      };

      const err = await new Promise(resolve => {
        google.script.run
          .withFailureHandler(resolve)
          .updateClassReportDelta('一 1', { presentCount: 28 });
      });

      assert.ok(err instanceof Error);
      assert.equal(err.message, 'Simulated database write timeout');
      firestore.setClassReport = originalSet;
    });

    it('1.4 Non-function parameters to handlers do not throw or crash', () => {
      assert.doesNotThrow(() => {
        google.script.run
          .withSuccessHandler(null)
          .withFailureHandler(undefined)
          .getStudentData();
      });
    });

    it('1.5 Calling undefined method throws informative error (B11-1)', () => {
      assert.throws(() => {
        google.script.run.nonExistentGasMethod();
      }, /google\.script\.run\.nonExistentGasMethod is not implemented/);
    });

    it('1.6 Sequential async calls resolve preserving execution order (B11-4)', async () => {
      const executionOrder = [];
      await Promise.all([
        new Promise(r => {
          google.script.run.withSuccessHandler(() => {
            executionOrder.push('step1');
            r();
          }).getScheduleConfigData();
        }),
        new Promise(r => {
          google.script.run.withSuccessHandler(() => {
            executionOrder.push('step2');
            r();
          }).getStudentData();
        })
      ]);

      assert.equal(executionOrder.length, 2);
    });
  });

  describe('2. 18 Call Sites Implementation', () => {
    it('2.1 getStudentData returns full student roster', async () => {
      const students = await new Promise(resolve => {
        google.script.run.withSuccessHandler(resolve).getStudentData();
      });
      assert.ok(Array.isArray(students));
      assert.ok(students.length > 0);
      assert.ok(students[0].seatRaw);
      assert.ok(students[0].name);
    });

    it('2.2 getScheduleConfigData returns 20-slot schedule configuration', async () => {
      const schedules = await new Promise(resolve => {
        google.script.run.withSuccessHandler(resolve).getScheduleConfigData();
      });
      assert.ok(Array.isArray(schedules));
      const g1 = schedules.find(s => s.groupName === '一');
      assert.ok(g1);
      assert.equal(g1.tue_pm1, true); // Tue full day
      assert.equal(g1.mon_pm1, false); // Mon half day
    });

    it('2.3 getFullSystemState returns comprehensive system state and handles empty state gracefully', async () => {
      const state = await new Promise(resolve => {
        google.script.run.withSuccessHandler(resolve).getFullSystemState();
      });
      // Upper case compatibility
      assert.ok(state.CLASS_REPORTS_DATA);
      assert.ok(state.PULLOUT_STATUS_MAP);
      assert.ok(state.RESCUE_TRIAGE_MAP);
      assert.ok(state.SEARCH_STATUS_MAP);
      assert.ok(state.CONTACT_STATES);
      assert.ok(state.HELP_REQUEST_MAP);
      assert.ok(state.BUILDING_STATUS_DATA);
      assert.ok(Array.isArray(state.VISITOR_LIST_DATA));

      // Native camelCase compatibility
      assert.ok(state.classReports);
      assert.ok(state.pulloutStatusMap);
      assert.ok(state.rescueTriageMap);
      assert.equal(state.securityMode, 'drill');
    });

    it('2.4 updateClassReportDelta saves granular report to Firestore', async () => {
      const res = await new Promise(resolve => {
        google.script.run
          .withSuccessHandler(resolve)
          .updateClassReportDelta('一 1', { total: 28, presentCount: 28 });
      });
      assert.equal(res.success, true);
      assert.equal(res.classKey, '一 1');

      const saved = await firestore.getClassReport('一 1');
      assert.equal(saved.presentCount, 28);
    });

    it('2.5 updatePulloutStatusDelta handles pending isolation and missing propagation (Iron Rule 4)', async () => {
      const sKeyPending = '一 1_03號';
      // 1. Pending pullout does not propagate to rescue
      await new Promise(resolve => {
        google.script.run
          .withSuccessHandler(resolve)
          .updatePulloutStatusDelta(sKeyPending, 'pending', { name: '陳小明' });
      });
      const pendingPullout = await firestore.getPullout(sKeyPending);
      const pendingRescue = await firestore.getRescue(sKeyPending);
      assert.equal(pendingPullout.status, 'pending');
      assert.equal(pendingRescue, null); // Strictly isolated

      // 2. Missing pullout DOES propagate to rescue
      const sKeyMissing = '一 1_05號';
      await new Promise(resolve => {
        google.script.run
          .withSuccessHandler(resolve)
          .updatePulloutStatusDelta(sKeyMissing, 'missing', { name: '林小華', classKey: '一 1' });
      });
      const missingPullout = await firestore.getPullout(sKeyMissing);
      const missingRescue = await firestore.getRescue(sKeyMissing);
      assert.equal(missingPullout.status, 'missing');
      assert.ok(missingRescue);
      assert.equal(missingRescue.status, 'missing');
      assert.equal(missingRescue.searchDone, false);
    });

    it('2.6 updateRescueStatusDelta marks searchDone and links safe status to pullout', async () => {
      const sKey = '二 2_08號';
      await firestore.setPullout(sKey, { studentKey: sKey, status: 'missing' });
      await firestore.setRescue(sKey, { targetKey: sKey, status: 'missing', searchDone: false });

      await new Promise(resolve => {
        google.script.run
          .withSuccessHandler(resolve)
          .updateRescueStatusDelta(sKey, { triage: 'green' }, true);
      });

      const rescue = await firestore.getRescue(sKey);
      const pullout = await firestore.getPullout(sKey);
      assert.equal(rescue.searchDone, true);
      assert.equal(pullout.status, 'safe');
    });

    it('2.7 updateContactStateDelta records dial counts and emergency escalation', async () => {
      const sKey = '三 1_12號';
      const res = await new Promise(resolve => {
        google.script.run
          .withSuccessHandler(resolve)
          .updateContactStateDelta(sKey, { status: '聯繫中', count: 5 }, true);
      });
      assert.equal(res.success, true);
      assert.equal(res.count, 5);
      assert.equal(res.isHelpReq, true);

      const contact = await firestore.getContact(sKey);
      assert.equal(contact.count, 5);
      assert.equal(contact.isHelpReq, true);
    });

    it('2.8 updateBuildingStatusDelta and saveBuildingStatus update building records', async () => {
      await new Promise(resolve => {
        google.script.run
          .withSuccessHandler(resolve)
          .updateBuildingStatusDelta('至善樓', { submitted: true, indicators: { column: false } });
      });
      const b = await firestore.getBuilding('至善樓');
      assert.equal(b.submitted, true);
      assert.equal(b.indicators.column, false);

      await new Promise(resolve => {
        google.script.run
          .withSuccessHandler(resolve)
          .saveBuildingStatus({
            維揚樓: { submitted: true, indicators: { beam: false } }
          });
      });
      const b2 = await firestore.getBuilding('維揚樓');
      assert.equal(b2.submitted, true);
      assert.equal(b2.indicators.beam, false);
    });

    it('2.9 appendVisitorListDelta appends new visitors to collection', async () => {
      const newItems = [
        { id: 'v_1', title: '訪客甲 1人', type: 'parent', count: 1, status: 'safe' },
        { id: 'v_2', title: '廠商乙 2人', type: 'vendor', count: 2, status: 'safe' }
      ];

      const res = await new Promise(resolve => {
        google.script.run
          .withSuccessHandler(resolve)
          .appendVisitorListDelta(newItems);
      });
      assert.equal(res.success, true);
      assert.equal(res.count, 2);

      const visitors = await firestore.getAllVisitors();
      assert.equal(visitors.length, 2);
    });

    it('2.10 saveFullSystemState updates system state configuration', async () => {
      await new Promise(resolve => {
        google.script.run
          .withSuccessHandler(resolve)
          .saveFullSystemState({ securityMode: 'disaster', approvedCustomTotal: 2500 });
      });

      const state = await firestore.getSystemState();
      assert.equal(state.securityMode, 'disaster');
      assert.equal(state.approvedCustomTotal, 2500);
    });

    it('2.11 clearAllReports resets data while restoring default buildings and state', async () => {
      await firestore.setClassReport('一 1', { presentCount: 20 });
      await firestore.setVisitor('v_1', { name: '訪客' });

      await new Promise(resolve => {
        google.script.run
          .withSuccessHandler(resolve)
          .clearAllReports();
      });

      assert.equal(Object.keys(await firestore.getAllClassReports()).length, 0);
      assert.equal((await firestore.getAllVisitors()).length, 0);

      // Default buildings are restored
      const b = await firestore.getBuilding('慈愛樓');
      assert.ok(b);
      assert.equal(b.indicators.column, true);
    });

    it('2.12 runStressTest and getLatestStressTestClassList execute concurrency simulation with capped anomalies', async () => {
      const res = await new Promise(resolve => {
        google.script.run
          .withSuccessHandler(resolve)
          .runStressTest('mon_am');
      });

      assert.equal(res.success, true);
      assert.ok(res.classesCount > 0);
      assert.equal(res.mode, 'mon_am');

      // Verify: 剛好 10 班失蹤 (搜救檢傷)，其餘班級綠色全到
      const allRescues = await firestore.getAllRescues();
      const allPullouts = await firestore.getAllPullouts();
      assert.equal(Object.keys(allRescues).length, 10, 'Has exactly 10 missing students in rescues');
      assert.ok(Object.keys(allPullouts).length > 0, 'Has pullout students in pullouts');
      
      // Rescues are in initial searching state, awaiting live demo triage
      for (const r of Object.values(allRescues)) {
        assert.equal(r.status, 'searching');
        assert.equal(r.searchDone, false);
        assert.equal(r.triage, 'none');
      }

      // Pullouts are pending per Iron Rule 4
      for (const p of Object.values(allPullouts)) {
        assert.equal(p.status, 'pending');
        assert.equal(p.safe, false);
      }

      // Check getLatestStressTestClassList
      const listData = await new Promise(resolve => {
        google.script.run
          .withSuccessHandler(resolve)
          .getLatestStressTestClassList();
      });

      assert.equal(listData.simTimeMode, 'mon_am');
      assert.equal(listData.selectedClassesCount, res.classesCount);
      assert.ok(Array.isArray(listData.classList));
    });
  });

  describe('3. Polling Eradication & Real-time Sync (initRealtimeSync)', () => {
    it('3.1 initRealtimeSync triggers callback on data updates with <500ms latency', async () => {
      let receivedUpdate = null;
      const startTime = Date.now();

      const unsubscribe = adapter.initRealtimeSync((update) => {
        receivedUpdate = update;
      });

      await firestore.setClassReport('四 1', { presentCount: 27 });
      await new Promise(r => setTimeout(r, 60));

      const latency = Date.now() - startTime;
      assert.ok(latency < 500, `Update latency was ${latency}ms, expected < 500ms`);
      assert.ok(receivedUpdate);
      unsubscribe();
    });

    it('3.2 Unsubscribing realtime sync cleanly prevents future updates', async () => {
      let callCount = 0;
      const unsubscribe = adapter.initRealtimeSync(() => {
        callCount++;
      });

      await new Promise(r => setTimeout(r, 50));
      const beforeCount = callCount;
      unsubscribe();

      await firestore.setClassReport('五 5', { presentCount: 26 });
      await new Promise(r => setTimeout(r, 50));

      assert.equal(callCount, beforeCount);
    });
  });
});
