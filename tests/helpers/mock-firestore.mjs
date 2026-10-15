/**
 * In-memory Mock Firestore with onSnapshot and Offline Persistent Queue Simulation.
 */

export class MockFirestore {
  constructor() {
    this.serverStore = new Map(); // collectionName -> Map(docId -> data)
    this.localCache = new Map();  // collectionName -> Map(docId -> data)
    this.listeners = new Map();   // path -> Set(callback)
    this.collectionListeners = new Map(); // collName -> Set(callback)
    this.pendingQueue = [];       // queued mutations while offline
    this.isOnline = true;
    this.writeLatencyMs = 0;
  }

  _getOrCreateColl(store, collName) {
    if (!store.has(collName)) {
      store.set(collName, new Map());
    }
    return store.get(collName);
  }

  goOffline() {
    this.isOnline = false;
  }

  async goOnline() {
    this.isOnline = true;
    // Drain pending queue to server store
    while (this.pendingQueue.length > 0) {
      const op = this.pendingQueue.shift();
      const coll = this._getOrCreateColl(this.serverStore, op.collName);
      if (op.type === 'set') {
        const existing = coll.get(op.docId) || {};
        const merged = op.merge ? { ...existing, ...op.data } : { ...op.data };
        coll.set(op.docId, merged);
      } else if (op.type === 'update') {
        const existing = coll.get(op.docId) || {};
        coll.set(op.docId, { ...existing, ...op.data });
      } else if (op.type === 'delete') {
        coll.delete(op.docId);
      }
      this._notifyDoc(op.collName, op.docId, false);
      this._notifyColl(op.collName, false);
    }
  }

  async setDoc(docRef, data, options = {}) {
    const { collName, docId } = docRef;
    const merge = Boolean(options.merge);

    // Update local cache immediately (optimistic UI)
    const localColl = this._getOrCreateColl(this.localCache, collName);
    const existingLocal = localColl.get(docId) || {};
    const newLocal = merge ? { ...existingLocal, ...data } : { ...data };
    localColl.set(docId, newLocal);

    if (!this.isOnline) {
      // Offline: push to mutation queue
      this.pendingQueue.push({ type: 'set', collName, docId, data, merge, timestamp: Date.now() });
      this._notifyDoc(collName, docId, true);
      this._notifyColl(collName, true);
      return { fromCache: true, hasPendingWrites: true };
    }

    // Online: update server store directly
    const serverColl = this._getOrCreateColl(this.serverStore, collName);
    const existingServer = serverColl.get(docId) || {};
    const newServer = merge ? { ...existingServer, ...data } : { ...data };
    serverColl.set(docId, newServer);

    this._notifyDoc(collName, docId, false);
    this._notifyColl(collName, false);
    return { fromCache: false, hasPendingWrites: false };
  }

  async getDoc(docRef) {
    const { collName, docId } = docRef;
    let data;
    let fromCache = false;

    if (!this.isOnline) {
      const localColl = this._getOrCreateColl(this.localCache, collName);
      data = localColl.get(docId);
      fromCache = true;
    } else {
      const serverColl = this._getOrCreateColl(this.serverStore, collName);
      data = serverColl.get(docId);
      if (!data) {
        const localColl = this._getOrCreateColl(this.localCache, collName);
        data = localColl.get(docId);
      }
    }

    return {
      id: docId,
      exists: () => data !== undefined,
      data: () => (data ? JSON.parse(JSON.stringify(data)) : undefined),
      metadata: {
        fromCache,
        hasPendingWrites: this.pendingQueue.some(q => q.collName === collName && q.docId === docId)
      }
    };
  }

  onSnapshot(targetRef, onNext, onError) {
    if (targetRef.type === 'doc') {
      const { collName, docId } = targetRef;
      const key = `${collName}/${docId}`;
      if (!this.listeners.has(key)) {
        this.listeners.set(key, new Set());
      }
      const set = this.listeners.get(key);
      set.add(onNext);

      // Trigger initial call
      this.getDoc(targetRef).then(snap => onNext(snap)).catch(onError);

      return () => {
        set.delete(onNext);
      };
    } else if (targetRef.type === 'collection') {
      const { collName } = targetRef;
      if (!this.collectionListeners.has(collName)) {
        this.collectionListeners.set(collName, new Set());
      }
      const set = this.collectionListeners.get(collName);
      set.add(onNext);

      this._getCollectionSnapshot(collName, !this.isOnline).then(snap => onNext(snap)).catch(onError);

      return () => {
        set.delete(onNext);
      };
    }
  }

  async _getCollectionSnapshot(collName, isOffline) {
    const store = (isOffline || !this.isOnline) ? this.localCache : this.serverStore;
    const coll = this._getOrCreateColl(store, collName);
    const docs = [];
    for (const [id, data] of coll.entries()) {
      docs.push({
        id,
        data: () => JSON.parse(JSON.stringify(data)),
        metadata: {
          fromCache: !this.isOnline,
          hasPendingWrites: this.pendingQueue.some(q => q.collName === collName && q.docId === id)
        }
      });
    }
    return {
      docs,
      empty: docs.length === 0,
      size: docs.length,
      metadata: {
        fromCache: !this.isOnline,
        hasPendingWrites: this.pendingQueue.some(q => q.collName === collName)
      }
    };
  }

  _notifyDoc(collName, docId, fromCache) {
    const key = `${collName}/${docId}`;
    const set = this.listeners.get(key);
    if (set && set.size > 0) {
      this.getDoc({ collName, docId, type: 'doc' }).then(snap => {
        for (const cb of set) {
          try { cb(snap); } catch (e) { /* ignore */ }
        }
      });
    }
  }

  _notifyColl(collName, fromCache) {
    const set = this.collectionListeners.get(collName);
    if (set && set.size > 0) {
      this._getCollectionSnapshot(collName, fromCache).then(snap => {
        for (const cb of set) {
          try { cb(snap); } catch (e) { /* ignore */ }
        }
      });
    }
  }

  doc(collName, docId) {
    return { collName, docId, type: 'doc' };
  }

  collection(collName) {
    return { collName, type: 'collection' };
  }
}
