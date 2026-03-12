/**
 * T4/T7 Regression Verification Script
 * Validates that the fixes are correctly applied for both issues.
 */
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config({ path: '.env' });

const PLACEHOLDER_VALUES = new Set(["-", "—", "N/A", "无", "--", "——", "n/a", "NA", "na", "null", "NULL", "None", "none"]);

function isPlaceholder(v) {
  if (v === null || v === undefined) return false;
  return PLACEHOLDER_VALUES.has(String(v).trim());
}

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL);
  
  let allPassed = true;
  const results = [];
  
  // ─── T4: 爱比爱尼 groupedTop5 完整性验证 ───────────────────────────────────
  console.log('\n═══════════════════════════════════════');
  console.log('T4 验证：爱比爱尼单文件达人 Top5 排名完整性');
  console.log('═══════════════════════════════════════');
  
  const [rows] = await conn.execute(
    'SELECT id FROM sessions WHERE originalName LIKE ? AND status = ? ORDER BY createdAt DESC LIMIT 1',
    ['%爱比爱尼%', 'ready']
  );
  
  if (!rows[0]) {
    console.log('❌ 爱比爱尼文件未找到');
    allPassed = false;
  } else {
    const [r2] = await conn.execute('SELECT dfInfo FROM sessions WHERE id = ?', [rows[0].id]);
    const dfInfo = r2[0].dfInfo;
    
    // Find 商品金额 field
    const amountField = dfInfo.fields.find(f => f.name === '商品金额');
    if (!amountField) {
      console.log('❌ 商品金额字段未找到');
      allPassed = false;
    } else {
      const top5 = amountField.groupedTop5;
      const topCount = top5 ? top5.length : 0;
      
      console.log(`groupedTop5 条目数: ${topCount}`);
      if (top5) {
        top5.forEach((e, i) => console.log(`  ${i+1}. ${e.label}: ${e.sum.toFixed(2)}`));
      }
      
      // Validate T4 fix
      const t4Pass = topCount >= 5;
      console.log(`\nT4 验收: groupedTop5 >= 5 条 → ${t4Pass ? '✅ PASS' : '❌ FAIL'}`);
      
      // Validate expected values
      const expectedTop1 = { label: '胡说老王', sum: 2513.20 };
      const actualTop1 = top5?.[0];
      const t4ValuePass = actualTop1 && actualTop1.label === expectedTop1.label && Math.abs(actualTop1.sum - expectedTop1.sum) < 0.01;
      console.log(`T4 验收: Top1 = 胡说老王(2513.20) → ${t4ValuePass ? '✅ PASS' : '❌ FAIL'}`);
      
      if (!t4Pass || !t4ValuePass) allPassed = false;
      results.push({ test: 'T4', pass: t4Pass && t4ValuePass });
    }
  }
  
  // ─── T7: 三文件达人昵称字段空值说明注入验证 ──────────────────────────────────
  console.log('\n═══════════════════════════════════════');
  console.log('T7 验证：三文件达人昵称字段空值说明');
  console.log('═══════════════════════════════════════');
  
  const fileNames = ['舒络', '时皙', '爱比爱尼'];
  const expectedAffectedRows = {
    '舒络': 2975,
    '时皙': 99,
    '爱比爱尼': 1303,
  };
  
  for (const fname of fileNames) {
    const [frows] = await conn.execute(
      'SELECT id FROM sessions WHERE originalName LIKE ? AND status = ? ORDER BY createdAt DESC LIMIT 1',
      ['%' + fname + '%', 'ready']
    );
    
    if (!frows[0]) {
      console.log(`❌ ${fname}: 文件未找到`);
      allPassed = false;
      continue;
    }
    
    const [fr2] = await conn.execute('SELECT dfInfo FROM sessions WHERE id = ?', [frows[0].id]);
    const dfInfo = fr2[0].dfInfo;
    
    const gbField = dfInfo.groupByField;
    const dq = dfInfo.dataQuality;
    const affectedRows = dq ? Number(dq.affected_rows ?? 0) : 0;
    const nullOrEmpty = dq ? Number(dq.invalid_value_breakdown?.null_or_empty ?? 0) : 0;
    const placeholder = dq ? Number(dq.invalid_value_breakdown?.placeholder ?? 0) : 0;
    
    console.log(`\n${fname}:`);
    console.log(`  groupByField: ${gbField || 'N/A'}`);
    console.log(`  affected_rows: ${affectedRows} (null/empty: ${nullOrEmpty}, placeholder: ${placeholder})`);
    
    // T7 check 1: groupByField must be 达人昵称
    const t7GbFieldPass = gbField === '达人昵称';
    console.log(`  T7 验收: groupByField = 达人昵称 → ${t7GbFieldPass ? '✅ PASS' : '❌ FAIL'}`);
    
    // T7 check 2: affected_rows must match expected
    const expectedAR = expectedAffectedRows[fname];
    const t7ARPass = affectedRows === expectedAR;
    console.log(`  T7 验收: affected_rows = ${expectedAR} → ${t7ARPass ? '✅ PASS' : `❌ FAIL (got ${affectedRows})`}`);
    
    // T7 check 3: groupByFieldNullContext would be injected (affected_rows > 0)
    const t7ContextPass = affectedRows > 0;
    console.log(`  T7 验收: 空值上下文会被注入 (affected_rows > 0) → ${t7ContextPass ? '✅ PASS' : '❌ FAIL'}`);
    
    // T7 check 4: no validGroupSum (old files - should not have incorrect backfill)
    const amountField = dfInfo.fields.find(f => f.name === '商品金额');
    const hasValidGroupSum = amountField?.validGroupSum !== undefined;
    console.log(`  T7 验收: 旧文件无错误 validGroupSum → ${!hasValidGroupSum ? '✅ PASS (no backfill)' : '⚠️ WARNING (has validGroupSum)'}`);
    
    if (!t7GbFieldPass || !t7ARPass || !t7ContextPass) allPassed = false;
    results.push({ test: `T7-${fname}`, pass: t7GbFieldPass && t7ARPass && t7ContextPass });
  }
  
  // ─── Summary ──────────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════');
  console.log('回归测试汇总');
  console.log('═══════════════════════════════════════');
  results.forEach(r => console.log(`  ${r.test}: ${r.pass ? '✅ PASS' : '❌ FAIL'}`));
  console.log(`\n总体结果: ${allPassed ? '✅ ALL PASS' : '❌ SOME FAILED'}`);
  
  await conn.end();
}

main().catch(console.error);
