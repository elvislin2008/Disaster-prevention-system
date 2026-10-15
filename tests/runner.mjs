#!/usr/bin/env node
/**
 * Automated Test Runner for Campus Disaster Roll Call System V20.4 Migration.
 * Executes all 4 tiers of test suites and generates comprehensive metrics.
 * 
 * Usage:
 *   node tests/runner.mjs
 *   node tests/runner.mjs --tier=1
 *   node tests/runner.mjs --json
 */

import { run } from 'node:test';
import { spec } from 'node:test/reporters';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdirSync } from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const args = process.argv.slice(2);
const jsonMode = args.includes('--json');
const tierFilterArg = args.find(a => a.startsWith('--tier='));
const targetTier = tierFilterArg ? tierFilterArg.split('=')[1] : null;

function getTestFiles(dir) {
  try {
    const fullDir = resolve(__dirname, dir);
    return readdirSync(fullDir)
      .filter(f => f.endsWith('.test.mjs'))
      .map(f => resolve(fullDir, f));
  } catch (e) {
    return [];
  }
}

const suiteMap = {
  tier1: getTestFiles('tier1-features'),
  tier2: getTestFiles('tier2-boundaries'),
  tier3: getTestFiles('tier3-combinations'),
  tier4: getTestFiles('tier4-scenarios')
};

let filesToRun = [];
if (targetTier) {
  const key = `tier${targetTier}`;
  if (!suiteMap[key]) {
    console.error(`Invalid tier: ${targetTier}. Allowed values: 1, 2, 3, 4.`);
    process.exit(1);
  }
  filesToRun = suiteMap[key];
} else {
  filesToRun = [
    ...suiteMap.tier1,
    ...suiteMap.tier2,
    ...suiteMap.tier3,
    ...suiteMap.tier4
  ];
}

if (!jsonMode) {
  console.log('='.repeat(78));
  console.log('🏫 清水國小校園災難與演練即時點名通報系統 V20.4 — 雲端遷移測試套件');
  console.log(`執行範圍: ${targetTier ? `Tier ${targetTier}` : '全部 4 Tiers'} | 檔案總數: ${filesToRun.length}`);
  console.log('='.repeat(78));
}

const startTime = Date.now();
const testStream = run({
  files: filesToRun,
  concurrency: true
});

let passCount = 0;
let failCount = 0;
let skipCount = 0;
const failureDetails = [];

testStream.on('test:pass', () => {
  passCount++;
});

testStream.on('test:fail', (data) => {
  failCount++;
  failureDetails.push({
    name: data.name,
    file: data.file,
    error: data.details?.error?.message || data.details?.error || 'Unknown error'
  });
});

testStream.on('test:skip', () => {
  skipCount++;
});

if (!jsonMode) {
  testStream.compose(new spec()).pipe(process.stdout);
} else {
  testStream.resume();
}

testStream.on('end', () => {
  const durationMs = Date.now() - startTime;
  const total = passCount + failCount + skipCount;

  if (jsonMode) {
    console.log(JSON.stringify({
      total,
      passed: passCount,
      failed: failCount,
      skipped: skipCount,
      durationMs,
      failures: failureDetails
    }, null, 2));
  } else {
    console.log('\n' + '='.repeat(78));
    console.log('📊 測試執行結果統計總表');
    console.log('='.repeat(78));
    console.log(`總測試案例 (Total Tests) : ${total}`);
    console.log(`通過案例 (Passed)       : \x1b[32m${passCount}\x1b[0m`);
    console.log(`失敗案例 (Failed)       : ${failCount > 0 ? `\x1b[31m${failCount}\x1b[0m` : '0'}`);
    console.log(`跳過案例 (Skipped)      : ${skipCount}`);
    console.log(`執行耗時 (Duration)     : ${durationMs}ms`);
    console.log('='.repeat(78));

    if (failCount === 0) {
      console.log('\x1b[32m✔ 100% 測試驗證全數通過！系統具備高並發、操場極限離線與鐵律隔離保護韌性。\x1b[0m\n');
    } else {
      console.error('\x1b[31m✖ 存在失敗案例，請檢視詳細錯誤日誌。\x1b[0m\n');
    }
  }

  process.exit(failCount === 0 ? 0 : 1);
});
