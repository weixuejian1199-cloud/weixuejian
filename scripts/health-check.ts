#!/usr/bin/env tsx
/**
 * 定期体检脚本 — 检测慢性漂移
 *
 * CI 管的是"这一刀切没切歪"，体检管的是"伤口有没有在慢慢发炎"。
 * 建议每 3 个 Wave 或每周一运行一次。
 *
 * 用法：pnpm --filter backend exec tsx ../../scripts/health-check.ts
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { execSync } from 'child_process';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');
const BRAIN_PATH = resolve(ROOT, 'docs/brain.json');
const SRC_DIR = resolve(ROOT, 'packages/backend/src');
const TEST_DIR = resolve(ROOT, 'packages/backend/src/__tests__');

let score = 100;
let issues: Array<{ severity: 'critical' | 'warning' | 'info'; message: string; deduction: number }> = [];

function deduct(severity: 'critical' | 'warning' | 'info', message: string, points: number): void {
  score -= points;
  issues.push({ severity, message, deduction: points });
}

function exec(cmd: string): string {
  try {
    return execSync(cmd, { cwd: ROOT, encoding: 'utf-8', timeout: 60000 }).trim();
  } catch {
    return '';
  }
}

function countFiles(dir: string, pattern: RegExp): number {
  if (!existsSync(dir)) return 0;
  let count = 0;
  const walk = (d: string): void => {
    for (const entry of readdirSync(d)) {
      const full = join(d, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) walk(full);
      else if (pattern.test(entry)) count++;
    }
  };
  walk(dir);
  return count;
}

// ═══════════════════════════════════════════════════════════════
// 检查 1: brain.json 任务状态 vs 实际进度
// ═══════════════════════════════════════════════════════════════

function checkBrainTaskSync(): void {
  console.log('\n📋 检查 1: brain.json 任务状态一致性\n');

  const brain = JSON.parse(readFileSync(BRAIN_PATH, 'utf-8'));
  const tasks = brain.activeTasks as Array<{ id: string; status: string; title: string }>;
  if (!tasks) {
    deduct('critical', 'brain.json 缺少 activeTasks', 10);
    return;
  }

  const recentCommits = exec('git log --oneline -50');

  let suspiciousTasks = 0;
  for (const task of tasks) {
    if (task.status === 'pending' || task.status === 'in-progress') {
      // 检查 git log 中是否有该任务相关的提交
      const taskMentioned = recentCommits.includes(task.id);
      if (taskMentioned) {
        console.log(`  ⚠️  ${task.id} 状态="${task.status}" 但 git log 中有相关提交`);
        suspiciousTasks++;
      }
    }
  }

  if (suspiciousTasks > 0) {
    deduct('critical', `${suspiciousTasks} 个任务可能状态未同步（git有提交但brain.json未更新为done）`, suspiciousTasks * 3);
  } else {
    console.log('  ✅ 任务状态与 git log 一致');
  }
}

// ═══════════════════════════════════════════════════════════════
// 检查 2: 错误码一致性
// ═══════════════════════════════════════════════════════════════

function checkErrorCodeSync(): void {
  console.log('\n📋 检查 2: 错误码注册表一致性\n');

  // 从 brain.json 统计错误码数量
  const brain = JSON.parse(readFileSync(BRAIN_PATH, 'utf-8'));
  const errorCodes = brain.errorCodes;
  let brainCount = 0;
  for (const [key, value] of Object.entries(errorCodes)) {
    if (key.startsWith('_')) continue;
    if (Array.isArray(value)) brainCount += (value as unknown[]).length;
  }

  // 从 error-codes.ts 统计
  const errorCodesFile = readFileSync(resolve(SRC_DIR, 'lib/error-codes.ts'), 'utf-8');
  const codeMatches = errorCodesFile.match(/^\s+\w+:\s*\{/gm);
  const codeCount = codeMatches ? codeMatches.length : 0;

  console.log(`  brain.json: ${brainCount} 个错误码`);
  console.log(`  error-codes.ts: ${codeCount} 个错误码`);

  if (brainCount !== codeCount) {
    deduct('critical', `错误码数量不一致: brain.json=${brainCount}, code=${codeCount}`, 5);
  } else {
    console.log('  ✅ 错误码数量一致');
  }
}

// ═══════════════════════════════════════════════════════════════
// 检查 3: 测试覆盖率趋势
// ═══════════════════════════════════════════════════════════════

function checkTestCoverage(): void {
  console.log('\n📋 检查 3: 测试覆盖率\n');

  // 统计源文件（排除类型文件和纯声明）
  const srcFiles = countFiles(SRC_DIR, /\.ts$/);
  const testFiles = countFiles(TEST_DIR, /\.test\.ts$/);

  // 统计排除 __tests__ 后的源文件
  let realSrcFiles = 0;
  const walkSrc = (d: string): void => {
    for (const entry of readdirSync(d)) {
      const full = join(d, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        if (entry !== '__tests__' && entry !== 'node_modules') walkSrc(full);
      } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
        realSrcFiles++;
      }
    }
  };
  walkSrc(SRC_DIR);

  const ratio = testFiles / realSrcFiles;
  console.log(`  源文件: ${realSrcFiles}`);
  console.log(`  测试文件: ${testFiles}`);
  console.log(`  覆盖比: ${(ratio * 100).toFixed(1)}%`);

  if (ratio < 0.5) {
    deduct('critical', `测试覆盖比 ${(ratio * 100).toFixed(1)}% < 50%，存在大量未测试模块`, 10);
  } else if (ratio < 0.7) {
    deduct('warning', `测试覆盖比 ${(ratio * 100).toFixed(1)}% < 70%，建议补充`, 3);
  } else {
    console.log('  ✅ 测试覆盖比健康');
  }

  // 运行实际测试
  const testOutput = exec('pnpm test 2>&1');
  const match = testOutput.match(/Tests\s+(\d+)\s+passed\s+\((\d+)\)/);
  if (match) {
    const [, passed, total] = match;
    console.log(`  测试结果: ${passed}/${total}`);
    if (passed !== total) {
      deduct('critical', `${Number(total) - Number(passed)} 个测试失败`, 15);
    } else {
      console.log('  ✅ 全部通过');
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// 检查 4: 技术债指标
// ═══════════════════════════════════════════════════════════════

function checkTechDebt(): void {
  console.log('\n📋 检查 4: 技术债指标\n');

  // as unknown 使用次数
  const unsafeCount = exec(`grep -r "as unknown as Record" ${SRC_DIR} --include="*.ts" -l 2>/dev/null | grep -v __tests__ | wc -l`).trim();
  const unsafeNum = parseInt(unsafeCount) || 0;
  console.log(`  as unknown as Record: ${unsafeNum} 个文件`);
  if (unsafeNum > 0) {
    deduct('warning', `${unsafeNum} 个文件使用了 as unknown as Record 类型绕过`, unsafeNum * 2);
  } else {
    console.log('  ✅ 无类型绕过');
  }

  // 直接 process.env 使用
  const directEnv = exec(`grep -r "process\\.env\\[" ${SRC_DIR} --include="*.ts" -l 2>/dev/null | grep -v __tests__ | grep -v env.ts | wc -l`).trim();
  const directEnvNum = parseInt(directEnv) || 0;
  console.log(`  直接 process.env: ${directEnvNum} 个文件`);
  if (directEnvNum > 0) {
    deduct('warning', `${directEnvNum} 个文件直接使用 process.env（应走 env.ts）`, directEnvNum);
  } else {
    console.log('  ✅ 环境变量集中管理');
  }

  // TODO/FIXME/HACK
  const todoCount = exec(`grep -rn "TODO\\|FIXME\\|HACK" ${SRC_DIR} --include="*.ts" 2>/dev/null | grep -v __tests__ | grep -v node_modules | wc -l`).trim();
  console.log(`  TODO/FIXME/HACK: ${todoCount} 处`);
  const todoNum = parseInt(todoCount) || 0;
  if (todoNum > 10) {
    deduct('warning', `${todoNum} 处 TODO/FIXME/HACK 待处理`, 2);
  }

  // TypeScript 编译
  try {
    execSync('npx tsc --noEmit 2>&1', { cwd: resolve(ROOT, 'packages/backend'), encoding: 'utf-8' });
    console.log('  ✅ TypeScript 编译零错误');
  } catch (e) {
    const output = (e as { stdout?: string }).stdout || '';
    const errorCount = (output.match(/error TS/g) || []).length;
    deduct('critical', `TypeScript 编译 ${errorCount} 个错误`, Math.min(errorCount * 2, 15));
  }
}

// ═══════════════════════════════════════════════════════════════
// 检查 5: 文档残留扫描
// ═══════════════════════════════════════════════════════════════

function checkDocStaleness(): void {
  console.log('\n📋 检查 5: 文档残留扫描\n');

  const brain = JSON.parse(readFileSync(BRAIN_PATH, 'utf-8'));

  // 检查 brain.json version 和 CLAUDE.md version 是否一致
  const claudeMd = readFileSync(resolve(ROOT, 'CLAUDE.md'), 'utf-8');
  const brainVersion = brain.version;
  const claudeMatch = claudeMd.match(/v([\d.]+)\s*·/);
  const claudeVersion = claudeMatch ? claudeMatch[1] : 'unknown';

  // 比较主版本号（忽略 patch 和 v 前缀）
  const brainMajorMinor = brainVersion.replace(/\.\d+$/, ''); // "2.7.0" → "2.7"
  const claudeNormalized = claudeVersion.replace(/^v/, '');    // "2.7" → "2.7"
  if (brainMajorMinor !== claudeNormalized && brainVersion !== claudeNormalized) {
    deduct('warning', `版本号不一致: brain.json=${brainVersion}, CLAUDE.md=v${claudeVersion}`, 2);
  } else {
    console.log(`  ✅ 版本号一致: ${brainVersion}`);
  }

  // 检查 currentPhase 是否合理
  const currentPhase = brain.currentPhase;
  const progress = existsSync(resolve(ROOT, 'docs/claude-progress.txt'))
    ? readFileSync(resolve(ROOT, 'docs/claude-progress.txt'), 'utf-8')
    : '';

  if (currentPhase && progress) {
    const progressMentionsPhase = progress.includes(currentPhase);
    if (!progressMentionsPhase) {
      deduct('warning', `brain.json currentPhase="${currentPhase}" 在 progress.txt 中未提及`, 2);
    } else {
      console.log(`  ✅ currentPhase="${currentPhase}" 与 progress.txt 一致`);
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// 生成报告
// ═══════════════════════════════════════════════════════════════

function generateReport(): void {
  console.log('\n' + '═'.repeat(60));
  console.log('  系统健康报告');
  console.log('═'.repeat(60));

  const grade =
    score >= 95 ? 'A+' :
    score >= 90 ? 'A' :
    score >= 85 ? 'B+' :
    score >= 80 ? 'B' :
    score >= 70 ? 'C' :
    score >= 60 ? 'D' : 'F';

  console.log(`\n  健康分: ${Math.max(0, score)}/100 (${grade})`);
  console.log(`  检查时间: ${new Date().toISOString()}\n`);

  if (issues.length === 0) {
    console.log('  🎉 零问题，系统状态完美。\n');
    return;
  }

  const criticals = issues.filter(i => i.severity === 'critical');
  const warnings = issues.filter(i => i.severity === 'warning');
  const infos = issues.filter(i => i.severity === 'info');

  if (criticals.length > 0) {
    console.log('  🔴 严重问题:');
    criticals.forEach(i => console.log(`     -${i.deduction} | ${i.message}`));
  }
  if (warnings.length > 0) {
    console.log('  🟡 警告:');
    warnings.forEach(i => console.log(`     -${i.deduction} | ${i.message}`));
  }
  if (infos.length > 0) {
    console.log('  🔵 建议:');
    infos.forEach(i => console.log(`     -${i.deduction} | ${i.message}`));
  }

  console.log(`\n  共 ${issues.length} 个问题，扣 ${100 - Math.max(0, score)} 分。`);
  console.log('═'.repeat(60) + '\n');
}

// ═══════════════════════════════════════════════════════════════
// 主入口
// ═══════════════════════════════════════════════════════════════

console.log('🏥 企业AI工作站 — 系统体检\n');

checkBrainTaskSync();
checkErrorCodeSync();
checkTestCoverage();
checkTechDebt();
checkDocStaleness();
generateReport();

process.exit(score >= 80 ? 0 : 1);
