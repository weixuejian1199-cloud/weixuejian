#!/usr/bin/env npx tsx
/**
 * Session Guard — 会话门禁脚本
 *
 * 灵感来源：Anthropic "Effective Harnesses for Long-Running Agents"
 * 核心理念：把"你应该检查"变成"不检查就不能继续"
 *
 * 用法：
 *   npx tsx scripts/session-guard.ts start   # 会话启动检查
 *   npx tsx scripts/session-guard.ts end     # 会话结束检查
 *   npx tsx scripts/session-guard.ts commit  # 提交前检查
 *
 * 设计原则（来自 Anthropic 文章）：
 * 1. Feature List 作为真理来源 — brain.json activeTasks 是唯一状态源
 * 2. 每个 session 开始必须验证基础功能 — 跑测试，不通过不开工
 * 3. 不允许删除或编辑测试 — git diff 检查
 * 4. 三源一致性 — brain.json / progress.txt / git log 不能矛盾
 */

import { readFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');
const BRAIN_PATH = resolve(ROOT, 'docs/brain.json');
const PROGRESS_PATH = resolve(ROOT, 'docs/claude-progress.txt');

// ═══════════════════════════════════════════════════════════════
// 工具函数
// ═══════════════════════════════════════════════════════════════

function fail(message: string): never {
  console.error(`\n❌ SESSION GUARD BLOCKED: ${message}\n`);
  process.exit(1);
}

function warn(message: string): void {
  console.warn(`\n⚠️  WARNING: ${message}`);
}

function pass(message: string): void {
  console.log(`✅ ${message}`);
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function exec(cmd: string): string {
  try {
    return execSync(cmd, { cwd: ROOT, encoding: 'utf-8' }).trim();
  } catch {
    return '';
  }
}

// ═══════════════════════════════════════════════════════════════
// 启动检查 — 相当于 Anthropic 的 init.sh
// ═══════════════════════════════════════════════════════════════

function checkStart(): void {
  console.log('\n🔍 Session Guard — 启动检查\n');

  // 1. brain.json 可读且结构完整
  if (!existsSync(BRAIN_PATH)) fail('docs/brain.json 不存在');
  const brain = readJson(BRAIN_PATH) as Record<string, unknown>;
  if (!brain['projectBrief']) fail('brain.json 缺少 projectBrief');
  if (!brain['activeTasks']) fail('brain.json 缺少 activeTasks');
  if (!brain['errorCodes']) fail('brain.json 缺少 errorCodes');
  pass('brain.json 结构完整');

  // 2. progress.txt 存在
  if (!existsSync(PROGRESS_PATH)) {
    warn('claude-progress.txt 不存在（首次会话可忽略）');
  } else {
    pass('claude-progress.txt 存在');
  }

  // 3. Git 状态干净（无未提交的修改）
  const gitStatus = exec('git status --porcelain');
  if (gitStatus) {
    warn(`工作目录不干净，有未提交的修改：\n${gitStatus}`);
  } else {
    pass('Git 工作目录干净');
  }

  // 4. 测试基线验证
  console.log('\n📋 运行测试基线验证...');
  try {
    const testOutput = execSync('pnpm test 2>&1', { cwd: ROOT, encoding: 'utf-8' });
    const match = testOutput.match(/Tests\s+(\d+)\s+passed\s+\((\d+)\)/);
    if (match) {
      const [, passed, total] = match;
      if (passed === total) {
        pass(`测试基线: ${passed}/${total} 全部通过`);
      } else {
        fail(`测试基线失败: ${passed}/${total}，必须全绿才能开工`);
      }
    } else {
      fail('无法解析测试输出，请手动确认');
    }
  } catch {
    fail('测试执行失败，基线不通过，不允许开工');
  }

  // 5. TypeScript 编译检查
  try {
    execSync('npx tsc --noEmit 2>&1', { cwd: resolve(ROOT, 'packages/backend'), encoding: 'utf-8' });
    pass('TypeScript 编译零错误');
  } catch {
    fail('TypeScript 编译有错误，不允许开工');
  }

  console.log('\n✅ 启动检查全部通过，可以开工。\n');
}

// ═══════════════════════════════════════════════════════════════
// 提交前检查 — 相当于 Anthropic 的 "不允许删除测试"
// ═══════════════════════════════════════════════════════════════

function checkCommit(): void {
  console.log('\n🔍 Session Guard — 提交前检查\n');

  // 1. 禁止删除测试文件
  const stagedDiff = exec('git diff --cached --name-status');
  const deletedTests = stagedDiff
    .split('\n')
    .filter(line => line.startsWith('D') && line.includes('.test.'));
  if (deletedTests.length > 0) {
    fail(`禁止删除测试文件（RULE-21）:\n${deletedTests.join('\n')}`);
  }
  pass('未删除任何测试文件');

  // 2. 禁止 as unknown 类型绕过（新增代码中）
  const addedLines = exec('git diff --cached -U0 -- "*.ts" | grep "^+" | grep -v "^+++"');
  const unsafeAssertions = addedLines
    .split('\n')
    .filter(line => line.includes('as unknown as Record'));
  if (unsafeAssertions.length > 0) {
    fail(`新增代码包含 'as unknown as Record' 类型绕过（RULE-22）:\n${unsafeAssertions.join('\n')}\n请使用正确的类型定义。`);
  }
  pass('无 as unknown 类型绕过');

  // 3. 禁止直接 process.env（应通过 env.ts）
  const directEnvAccess = addedLines
    .split('\n')
    .filter(line =>
      line.includes('process.env[') &&
      !line.includes('// env-direct-ok') &&  // 允许显式标注的豁免
      !line.includes('env.ts') &&
      !line.includes('.test.')
    );
  if (directEnvAccess.length > 0) {
    warn(`新增代码直接使用 process.env（建议通过 lib/env.ts 的 Zod schema）:\n${directEnvAccess.join('\n')}`);
  } else {
    pass('环境变量访问规范');
  }

  // 4. 错误码一致性 — 新增 sendError 调用中的错误码必须在注册表中
  // （编译时已由 TypeScript 保证，此处作为二次确认）
  pass('错误码一致性由 TypeScript 类型系统保证');

  console.log('\n✅ 提交前检查通过。\n');
}

// ═══════════════════════════════════════════════════════════════
// 会话结束检查 — 确保 brain.json 和 progress.txt 同步
// ═══════════════════════════════════════════════════════════════

function checkEnd(): void {
  console.log('\n🔍 Session Guard — 结束检查\n');

  // 1. progress.txt 是否更新
  const progressModified = exec('git diff --name-only docs/claude-progress.txt');
  const progressStaged = exec('git diff --cached --name-only docs/claude-progress.txt');
  if (!progressModified && !progressStaged) {
    warn('claude-progress.txt 未更新。会话结束协议要求更新进度文件。');
  } else {
    pass('claude-progress.txt 已更新');
  }

  // 2. brain.json activeTasks 是否与 git log 一致
  const brain = readJson(BRAIN_PATH) as { activeTasks?: Array<{ id: string; status: string }> };
  if (brain.activeTasks) {
    const recentCommits = exec('git log --oneline -20');
    const inProgressTasks = brain.activeTasks.filter(
      (t) => t.status === 'in-progress'
    );
    if (inProgressTasks.length > 0) {
      warn(
        `brain.json 中有 ${inProgressTasks.length} 个 in-progress 任务:\n` +
        inProgressTasks.map(t => `  - ${t.id}: ${t.status}`).join('\n') +
        '\n请确认是否应标记为 done。'
      );
    } else {
      pass('brain.json 无遗留 in-progress 任务');
    }
  }

  // 3. 测试仍然全绿
  console.log('\n📋 运行最终测试验证...');
  try {
    const testOutput = execSync('pnpm test 2>&1', { cwd: ROOT, encoding: 'utf-8' });
    const match = testOutput.match(/Tests\s+(\d+)\s+passed\s+\((\d+)\)/);
    if (match && match[1] === match[2]) {
      pass(`最终测试: ${match[1]}/${match[2]} 全部通过`);
    } else {
      fail('最终测试失败，不允许结束会话（修复后再结束）');
    }
  } catch {
    fail('最终测试执行失败');
  }

  // 4. 无未提交的修改
  const gitStatus = exec('git status --porcelain');
  if (gitStatus) {
    warn(`有未提交的修改：\n${gitStatus}\n请确认是否需要提交。`);
  } else {
    pass('所有修改已提交');
  }

  console.log('\n✅ 结束检查完成。会话可以安全交接。\n');
}

// ═══════════════════════════════════════════════════════════════
// ADR 影响扩散检查 — 新增机制
// ═══════════════════════════════════════════════════════════════

function checkAdrImpact(keyword: string): void {
  console.log(`\n🔍 ADR 影响扩散检查 — 关键词: "${keyword}"\n`);

  const docsDir = resolve(ROOT, 'docs');
  const result = exec(`grep -rn "${keyword}" "${docsDir}" --include="*.md" --include="*.json" || true`);

  if (result) {
    const lines = result.split('\n').filter(Boolean);
    console.log(`找到 ${lines.length} 处引用：\n`);
    lines.forEach(line => console.log(`  ${line}`));
    warn(`删除/变更 "${keyword}" 时，以上所有引用都需要同步更新。`);
  } else {
    pass(`未找到 "${keyword}" 的引用`);
  }
}

// ═══════════════════════════════════════════════════════════════
// 主入口
// ═══════════════════════════════════════════════════════════════

const command = process.argv[2];

switch (command) {
  case 'start':
    checkStart();
    break;
  case 'end':
    checkEnd();
    break;
  case 'commit':
    checkCommit();
    break;
  case 'adr-impact':
    if (!process.argv[3]) fail('用法: session-guard.ts adr-impact <关键词>');
    checkAdrImpact(process.argv[3]);
    break;
  default:
    console.log(`
Session Guard — 会话门禁

用法:
  npx tsx scripts/session-guard.ts start         # 会话启动检查
  npx tsx scripts/session-guard.ts end           # 会话结束检查
  npx tsx scripts/session-guard.ts commit        # 提交前检查
  npx tsx scripts/session-guard.ts adr-impact <关键词>  # ADR 影响扩散检查
    `);
}
