/**
 * Mock GAS Bridge Adapter implementing Interface Contract 1: window.google.script.run
 */
import { isClassActiveAtTime } from './timetable-engine.mjs';

export function createGasAdapter({ firestore, supabase, schedules = [], students = [] }) {
  class GasRunner {
    constructor() {
      this._successHandler = null;
      this._failureHandler = null;
    }

    withSuccessHandler(fn) {
      this._successHandler = fn;
      return this;
    }

    withFailureHandler(fn) {
      this._failureHandler = fn;
      return this;
    }

    _resolve(data) {
      queueMicrotask(() => {
        if (typeof this._successHandler === 'function') {
          this._successHandler(data);
        }
      });
    }

    _reject(err) {
      queueMicrotask(() => {
        if (typeof this._failureHandler === 'function') {
          this._failureHandler(err);
        }
      });
    }

    getStudentData() {
      this._resolve(students);
    }

    getScheduleConfigData() {
      this._resolve(schedules);
    }

    async getFullSystemState() {
      try {
        const stateSnap = await firestore.getDoc(firestore.doc('system_config', 'state'));
        const reportsSnap = await firestore._getCollectionSnapshot('class_reports', !firestore.isOnline);
        const pulloutsSnap = await firestore._getCollectionSnapshot('pullouts', !firestore.isOnline);
        const rescuesSnap = await firestore._getCollectionSnapshot('rescues', !firestore.isOnline);
        const contactsSnap = await firestore._getCollectionSnapshot('contacts', !firestore.isOnline);
        const visitorsSnap = await firestore._getCollectionSnapshot('visitors', !firestore.isOnline);
        const buildingsSnap = await firestore._getCollectionSnapshot('buildings', !firestore.isOnline);

        const reports = {};
        for (const doc of reportsSnap.docs) {
          reports[doc.id] = doc.data();
        }

        const pullouts = {};
        for (const doc of pulloutsSnap.docs) {
          pullouts[doc.id] = doc.data().status;
        }

        const rescues = {};
        const searchStatus = {};
        for (const doc of rescuesSnap.docs) {
          const d = doc.data();
          rescues[doc.id] = d;
          if (d.searchDone) searchStatus[doc.id] = true;
        }

        const contacts = {};
        const helpRequests = {};
        for (const doc of contactsSnap.docs) {
          const d = doc.data();
          contacts[doc.id] = d;
          if (d.isHelpReq) helpRequests[doc.id] = true;
        }

        const buildings = {};
        for (const doc of buildingsSnap.docs) {
          buildings[doc.id] = doc.data();
        }

        const visitors = [];
        for (const doc of visitorsSnap.docs) {
          visitors.push(doc.data());
        }

        this._resolve({
          CLASS_REPORTS_DATA: reports,
          PULLOUT_STATUS_MAP: pullouts,
          RESCUE_TRIAGE_MAP: rescues,
          SEARCH_STATUS_MAP: searchStatus,
          CONTACT_STATES: contacts,
          HELP_REQUEST_MAP: helpRequests,
          BUILDING_STATUS_DATA: buildings,
          VISITOR_LIST_DATA: visitors,
          SYSTEM_STATE: stateSnap.exists() ? stateSnap.data() : { isDrillMode: true }
        });
      } catch (e) {
        this._reject(e);
      }
    }

    async updateClassReportDelta(classKey, singleReport) {
      try {
        await firestore.setDoc(firestore.doc('class_reports', classKey), singleReport, { merge: true });
        this._resolve({ success: true, classKey, timestamp: Date.now() });
      } catch (e) {
        this._reject(e);
      }
    }

    async updatePulloutStatusDelta(studentKey, statusVal, rescueData) {
      try {
        await firestore.setDoc(firestore.doc('pullouts', studentKey), {
          studentKey,
          status: statusVal,
          updatedAt: Date.now()
        }, { merge: true });

        // If marked missing, propagate to rescues
        if (statusVal === 'missing' && rescueData) {
          await firestore.setDoc(firestore.doc('rescues', studentKey), {
            ...rescueData,
            status: 'missing',
            searchDone: false,
            updatedAt: Date.now()
          }, { merge: true });
        }

        this._resolve({ success: true, studentKey, status: statusVal });
      } catch (e) {
        this._reject(e);
      }
    }

    async updateRescueStatusDelta(targetKey, rescueData, searchDoneVal) {
      try {
        const payload = {
          ...rescueData,
          searchDone: Boolean(searchDoneVal),
          updatedAt: Date.now()
        };
        await firestore.setDoc(firestore.doc('rescues', targetKey), payload, { merge: true });

        // If search is done, pullout status becomes safe
        if (searchDoneVal) {
          await firestore.setDoc(firestore.doc('pullouts', targetKey), {
            status: 'safe',
            updatedAt: Date.now()
          }, { merge: true });
        }

        this._resolve({ success: true, targetKey, payload });
      } catch (e) {
        this._reject(e);
      }
    }

    async updateContactStateDelta(studentKey, stateObj, isHelpReq) {
      try {
        await firestore.setDoc(firestore.doc('contacts', studentKey), {
          ...stateObj,
          isHelpReq: Boolean(isHelpReq),
          updatedAt: Date.now()
        }, { merge: true });

        this._resolve({ success: true, studentKey, count: stateObj?.count || 0, isHelpReq });
      } catch (e) {
        this._reject(e);
      }
    }

    async updateBuildingStatusDelta(bName, bData) {
      try {
        await firestore.setDoc(firestore.doc('buildings', bName), {
          buildingName: bName,
          ...bData,
          updatedAt: Date.now()
        }, { merge: true });
        this._resolve({ success: true, buildingName: bName });
      } catch (e) {
        this._reject(e);
      }
    }

    async appendVisitorListDelta(newItems) {
      try {
        const items = Array.isArray(newItems) ? newItems : [newItems];
        for (const item of items) {
          const id = item.id || `vis_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
          await firestore.setDoc(firestore.doc('visitors', id), { ...item, id }, { merge: true });
        }
        this._resolve({ success: true, count: items.length });
      } catch (e) {
        this._reject(e);
      }
    }

    async saveFullSystemState(stateData) {
      try {
        await firestore.setDoc(firestore.doc('system_config', 'state'), stateData, { merge: true });
        this._resolve({ success: true });
      } catch (e) {
        this._reject(e);
      }
    }

    async clearAllReports() {
      try {
        // Clear collections in local/server
        firestore.serverStore.set('class_reports', new Map());
        firestore.serverStore.set('pullouts', new Map());
        firestore.serverStore.set('rescues', new Map());
        firestore.serverStore.set('contacts', new Map());
        firestore.serverStore.set('visitors', new Map());
        firestore.serverStore.set('buildings', new Map());
        firestore.localCache.set('class_reports', new Map());
        firestore.localCache.set('pullouts', new Map());
        firestore.localCache.set('rescues', new Map());
        firestore.localCache.set('contacts', new Map());
        firestore.localCache.set('visitors', new Map());
        firestore.localCache.set('buildings', new Map());
        this._resolve({ success: true, cleared: true });
      } catch (e) {
        this._reject(e);
      }
    }

    async runStressTest(simTimeMode = 'auto') {
      try {
        // Collect active classes
        const activeClasses = [];
        for (let g = 1; g <= 6; g++) {
          const grade = ['一', '二', '三', '四', '五', '六'][g - 1];
          for (let c = 1; c <= 15; c++) {
            if (isClassActiveAtTime(grade, String(c), simTimeMode, schedules)) {
              activeClasses.push(`${grade} ${c}`);
            }
          }
        }

        // Apply stress test capped anomalies:
        // 2 missing, 2 injured, 1 pullout, 1 missed call
        let missingAssigned = 0;
        let injuredAssigned = 0;
        let pulloutAssigned = 0;

        for (const classKey of activeClasses) {
          const report = {
            total: 28,
            presentCount: 28,
            leaveCount: 0,
            missingCount: 0,
            timestamp: Date.now()
          };

          if (missingAssigned < 2) {
            report.missingCount = 1;
            report.presentCount = 27;
            missingAssigned++;
            const sKey = `${classKey}_01號`;
            await firestore.setDoc(firestore.doc('rescues', sKey), {
              studentKey: sKey,
              classKey,
              name: `學生_${sKey}`,
              status: 'missing',
              searchDone: false
            });
          } else if (injuredAssigned < 2) {
            injuredAssigned++;
            const sKey = `${classKey}_02號`;
            await firestore.setDoc(firestore.doc('rescues', sKey), {
              studentKey: sKey,
              classKey,
              name: `學生_${sKey}`,
              triageCard: 'yellow',
              escortCount: 2,
              searchDone: false
            });
          } else if (pulloutAssigned < 1) {
            pulloutAssigned++;
            const sKey = `${classKey}_03號`;
            await firestore.setDoc(firestore.doc('pullouts', sKey), {
              studentKey: sKey,
              status: 'pending' // pending per Iron Rule 4
            });
          }

          await firestore.setDoc(firestore.doc('class_reports', classKey), report);
        }

        this._resolve({
          success: true,
          mode: simTimeMode,
          classesCount: activeClasses.length,
          activeClasses
        });
      } catch (e) {
        this._reject(e);
      }
    }

    async getLatestStressTestClassList() {
      this._resolve({ classes: [] });
    }
  }

  return {
    script: {
      run: new Proxy({}, {
        get(target, prop) {
          return (...args) => {
            const runner = new GasRunner();
            if (typeof runner[prop] === 'function') {
              runner[prop](...args);
              return runner;
            }
            throw new Error(`google.script.run.${prop} is not implemented`);
          };
        }
      })
    }
  };
}
