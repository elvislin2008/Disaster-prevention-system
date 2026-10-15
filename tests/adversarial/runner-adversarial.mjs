#!/usr/bin/env node
/**
 * Adversarial Stress & Verification Test Runner.
 * Executes all tests in tests/adversarial/ and outputs comprehensive empirical metrics.
 */

import { run } from 'node:test';
import { spec } from 'node:test/reporters';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdirSync } from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const testFiles = readdirSync(__dirname)
  .filter(f => f.endsWith('.test.mjs'))
  .map(f => resolve(__dirname, f));

console.log('='.repeat(78));
console.log('🥊 清水國小校園災難與演練即時點名通報系統 V20.4 — 對抗性壓力測試 (Adversarial)');
console.log(`執行對抗檔案數: ${testFiles.length} 份`);
console.log('='.repeat(78));

const startTime = performance.now();
const testStream = run({
  files: testFiles,
  concurrency: false // run adversarial suites sequentially to avoid port/resource interference
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

testStream.compose(new spec()).pipe(process.stdout);

testStream.on('end', () => {
  const durationMs = Math.round(performance.now() - startTime);
  const total = passCount + failCount + skipCount;

  console.log('\n' + '='.repeat(78));
  console.log('📊 對抗性測試驗證結果 (Adversarial Stress Test Summary)');
  console.log('='.repeat(78));
  console.log(`總測試案例 (Total Tests) : ${total}`);
  console.log(`通過案例 (Passed)       : \x1b[32m${passCount}\x1b[0m`);
  console.log(`失敗案例 (Failed)       : ${failCount > 0 ? `\x1b[31m${failCount}\x1b[0m` : '0'}`);
  console.log(`跳過案例 (Skipped)      : ${skipCount}`);
  console.log(`總執行耗時 (Duration)   : ${durationMs}ms`);
  console.log('='.repeat(78));

  if (failCount === 0) {
    console.log('\x1b[32m✔ 對抗性壓力測試全數通過！系統在高並發、離線競態及個資隱私防護上均達最高水準。\x1b[0m\n');
  } else {
    console.error('\x1b[31m✖ 存在對抗性測試失敗，請檢視詳細錯誤。\x1b[0m\n');
  }

  process.exit(failCount === 0 ? 0 : 1);
});
