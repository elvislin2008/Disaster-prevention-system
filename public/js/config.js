/**
 * ==============================================================================
 * 清水國小校園災難與演練即時點名通報系統 V20.4
 * 客戶端環境組態配置模組 (public/js/config.js)
 * ==============================================================================
 * 職責：
 * 1. 統一管理 Firebase Web SDK 與 Supabase Auth 的連線金鑰與端點
 * 2. 支援環境變數注入、LocalStorage 開發除錯覆蓋與優雅降級預設值
 * 3. 封裝系統關鍵時段常數 (如 12:40 邊界: 760 分鐘) 與演練授權常數
 */

(function (window) {
  'use strict';

  // 讀取可能的注入來源 (伺服器注入 window.__ENV__ 或 LocalStorage 覆蓋)
  const env = window.__ENV__ || {};

  function getStorageItem(key) {
    try {
      if (typeof window.localStorage !== 'undefined') {
        const val = window.localStorage.getItem(key);
        if (val) return JSON.parse(val);
      }
    } catch (e) {
      // 忽略 LocalStorage 存取限制
    }
    return null;
  }

  const localFirebaseOverride = getStorageItem('APP_FIREBASE_CONFIG') || {};
  const localSupabaseOverride = getStorageItem('APP_SUPABASE_CONFIG') || {};

  // Firebase Web SDK 組態 (支援 onSnapshot 推播與 IndexedDB 離線快取)
  const firebaseConfig = {
    apiKey: localFirebaseOverride.apiKey || env.FIREBASE_API_KEY || env.VITE_FIREBASE_API_KEY || 'AIzaSyExampleApiKey1234567890abcdef',
    authDomain: localFirebaseOverride.authDomain || env.FIREBASE_AUTH_DOMAIN || env.VITE_FIREBASE_AUTH_DOMAIN || 'qingshui-disaster.firebaseapp.com',
    projectId: localFirebaseOverride.projectId || env.FIREBASE_PROJECT_ID || env.VITE_FIREBASE_PROJECT_ID || 'qingshui-disaster',
    storageBucket: localFirebaseOverride.storageBucket || env.FIREBASE_STORAGE_BUCKET || env.VITE_FIREBASE_STORAGE_BUCKET || 'qingshui-disaster.appspot.com',
    messagingSenderId: localFirebaseOverride.messagingSenderId || env.FIREBASE_MESSAGING_SENDER_ID || env.VITE_FIREBASE_MESSAGING_SENDER_ID || '123456789012',
    appId: localFirebaseOverride.appId || env.FIREBASE_APP_ID || env.VITE_FIREBASE_APP_ID || '1:123456789012:web:abcdef1234567890abcdef',
    measurementId: localFirebaseOverride.measurementId || env.FIREBASE_MEASUREMENT_ID || env.VITE_FIREBASE_MEASUREMENT_ID || 'G-ABCDEF1234'
  };

  // Supabase Auth 組態 (負責教職員與指揮官帳號、Session 與身分權限管理 - R6)
  const supabaseConfig = {
    url: localSupabaseOverride.url || env.SUPABASE_URL || env.VITE_SUPABASE_URL || 'https://example-project.supabase.co',
    anonKey: localSupabaseOverride.anonKey || env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.exampleAnonKey1234567890'
  };

  const APP_CONFIG = {
    // 版本與系統標記
    VERSION: 'V20.4',
    VERSION_CODE: 204,
    SYSTEM_NAME: '新北市土城區清水國小校園緊急疏散、點名追蹤、抽離安全確認、危難檢傷與指揮中心彙整系統',

    // Firebase 連線組態
    firebase: Object.freeze(firebaseConfig),

    // Supabase Auth 連線組態 (R6)
    supabase: Object.freeze(supabaseConfig),

    // 系統關鍵業務常數
    DRILL: {
      DEFAULT_PASSWORD: '8888',
      SESSION_EXPIRY_MINUTES: 20
    },

    // 作息時段邊界常數 (精準對齊 12:40 午餐放學邊界: 760 分鐘)
    SCHEDULE: {
      MORNING_START_MINUTES: 480,   // 08:00
      MORNING_CUTOFF_MINUTES: 760,  // 12:40 (08:00~12:40 在校)
      PM1_CUTOFF_MINUTES: 960,      // 16:00 (12:40~16:00)
      PM2_CUTOFF_MINUTES: 1060,     // 17:40 (16:00~17:40)
      NIGHT_CUTOFF_MINUTES: 1110    // 18:30 (17:40~18:30)
    },

    // 角色清單 (RBAC)
    AUTH_ROLES: Object.freeze([
      'commander',       // 指揮官 / 系統管理員
      'teacher',         // 班級導師
      'pullout_teacher', // 抽離教師 (學習中心 / 本土語 / 團隊)
      'medical',         // 緊急救護組
      'patrol',          // 安全防護與巡檢組
      'visitor_manager'  // 訪客管理組
    ]),

    // 檢查 Firebase 是否為有效設定 (非 placeholder)
    isFirebaseConfigured: function () {
      return Boolean(
        this.firebase.apiKey &&
        this.firebase.projectId &&
        !this.firebase.apiKey.includes('ExampleApiKey') &&
        !this.firebase.projectId.includes('example')
      );
    },

    // 檢查 Supabase 是否為有效設定 (非 placeholder)
    isSupabaseConfigured: function () {
      return Boolean(
        this.supabase.url &&
        this.supabase.anonKey &&
        !this.supabase.url.includes('example-project') &&
        !this.supabase.anonKey.includes('exampleAnonKey')
      );
    },

    // 取得 Firebase 連線物件
    getFirebaseConfig: function () {
      return Object.assign({}, this.firebase);
    },

    // 取得 Supabase 連線物件
    getSupabaseConfig: function () {
      return Object.assign({}, this.supabase);
    },

    // 允許於本機開發或展示時自訂雲端金鑰
    setLocalStorageOverride: function (type, cfg) {
      try {
        if (type === 'firebase') {
          window.localStorage.setItem('APP_FIREBASE_CONFIG', JSON.stringify(cfg));
        } else if (type === 'supabase') {
          window.localStorage.setItem('APP_SUPABASE_CONFIG', JSON.stringify(cfg));
        }
        return true;
      } catch (e) {
        console.error('儲存本機金鑰設定失敗：', e);
        return false;
      }
    },

    // 清除本機金鑰覆蓋
    clearLocalStorageOverride: function () {
      try {
        window.localStorage.removeItem('APP_FIREBASE_CONFIG');
        window.localStorage.removeItem('APP_SUPABASE_CONFIG');
        return true;
      } catch (e) {
        return false;
      }
    }
  };

  // 掛載至全域
  window.__APP_CONFIG__ = Object.freeze(APP_CONFIG);
  window.APP_CONFIG = window.__APP_CONFIG__;

})(typeof window !== 'undefined' ? window : globalThis);
