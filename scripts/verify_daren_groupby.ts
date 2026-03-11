/**
 * 验收脚本：验证 detectGroupByField 新逻辑
 * 从数据库读取爱比爱尼和时皙的 dfInfo，模拟新的过滤+排序规则，输出 Top10 结果
 */
import mysql from 'mysql2/promise';
import * as dotenv from 'dotenv';
dotenv.config();

// ─── 复制 parseFile.ts 的新规则 ───────────────────────────────────────────────

const AMOUNT_FIELD_PATTERNS = [
  "金额", "优惠", "费用", "佣金", "补贴", "承担", "支付", "单价",
  "price", "amount", "money", "fee", "cost",
];

function isAmountField(fieldName: string): boolean {
  const lower = fieldName.toLowerCase();
  return AMOUNT_FIELD_PATTERNS.some((p) => fieldName.includes(p) || lower.includes(p.toLowerCase()));
}

const DIMENSION_TIERS = [
  { tier: 1, keywords: ["达人昵称", "主播昵称", "达人名称", "主播名称", "达人ID", "主播ID", "达人", "主播"] },
  { tier: 2, keywords: ["昵称"] },
  { tier: 3, keywords: ["姓名", "员工姓名", "用户名", "名字"] },
  { tier: 4, keywords: ["店铺名称", "店铺", "商家名称", "商家"] },
  { tier: 5, keywords: ["商品名称", "商品", "SKU", "品牌"] },
];

function detectAllGroupByFields(
  headers: string[],
  fieldTypes: Record<string, string>
): Array<{ field: string; tier: number; reason?: string }> {
  const result: Array<{ field: string; tier: number }> = [];
  const seen = new Set<string>();

  for (const { tier, keywords } of DIMENSION_TIERS) {
    for (const kw of keywords) {
      const exactMatches = headers.filter((h) => !seen.has(h) && h === kw);
      const containsMatches = headers.filter((h) => !seen.has(h) && h !== kw && h.includes(kw));
      for (const h of [...exactMatches, ...containsMatches]) {
        if (seen.has(h)) continue;
        if (fieldTypes[h] === "numeric") continue;  // Rule 1: must be text
        if (isAmountField(h)) continue;              // Rule 2: no amount patterns
        result.push({ field: h, tier });
        seen.add(h);
      }
    }
  }
  return result;
}

// ─── 数据库查询 ────────────────────────────────────────────────────────────────

const conn = await mysql.createConnection(process.env.DATABASE_URL!);

const [rows] = await conn.execute(
  `SELECT id, originalName, rowCount,
          JSON_EXTRACT(dfInfo, '$.fields') as fields_json,
          JSON_EXTRACT(dfInfo, '$.groupByField') as groupByField_json,
          JSON_EXTRACT(dfInfo, '$.allGroupByFields') as allGroupByFields_json
   FROM sessions
   WHERE originalName LIKE '%爱比爱尼%' OR originalName LIKE '%时皙%'
   ORDER BY createdAt DESC
   LIMIT 4`
) as any[];

for (const row of rows as any[]) {
  const rawFields = row.fields_json;
  const fields = (typeof rawFields === 'string' ? JSON.parse(rawFields) : rawFields) as Array<{
    name: string; type: string; sum?: number; groupedTop5?: Array<{label: string; sum: number; source?: string}>; groupByField?: string;
  }>;

  const headers = fields.map(f => f.name);
  const fieldTypes: Record<string, string> = {};
  for (const f of fields) fieldTypes[f.name] = f.type;

  // 模拟新规则
  const candidates = detectAllGroupByFields(headers, fieldTypes);
  const selectedField = candidates.length > 0 ? candidates[0].field : null;

  // 找出所有命中达人关键词的字段（过滤前）
  const allDarenRaw = headers.filter(h => h.includes('达人') || h.includes('主播') || h.includes('昵称'));
  // 找出被排除的字段及原因
  const excluded = allDarenRaw.filter(h => !candidates.find(c => c.field === h)).map(h => {
    const reasons = [];
    if (fieldTypes[h] === 'numeric') reasons.push('类型为 numeric');
    if (isAmountField(h)) reasons.push(`名称含金额关键词`);
    return { field: h, type: fieldTypes[h], reasons: reasons.join(' + ') || '未命中关键词' };
  });

  console.log('='.repeat(70));
  console.log('文件:', row.originalName, '| 行数:', row.rowCount);
  console.log('');
  console.log('【候选达人字段列表（过滤前，命中达人/主播/昵称关键词）】');
  allDarenRaw.forEach(h => console.log(`  ${h} (type: ${fieldTypes[h]})`));
  console.log('');
  console.log('【被排除字段及原因】');
  if (excluded.length === 0) {
    console.log('  无排除');
  } else {
    excluded.forEach(e => console.log(`  ❌ ${e.field} (type: ${e.type}) → ${e.reasons}`));
  }
  console.log('');
  console.log('【新规则选中的 group by 字段】', selectedField ?? '❌ null（无合格达人字段）');
  if (selectedField) {
    console.log('【字段类型】', fieldTypes[selectedField]);
  }
  console.log('');

  // 输出 Top10（从 dfInfo.fields 中找商品金额字段的 groupedTop5）
  // 注意：dfInfo 中的 groupedTop5 是用旧规则计算的，这里只验证字段选择是否正确
  // 真实 Top10 需要重新上传文件触发新规则
  const amountField = fields.find(f => f.name === '商品金额' && f.type === 'numeric');
  if (amountField?.groupedTop5 && amountField.groupByField) {
    console.log(`【DB 中存储的 groupedTop5（旧规则，groupByField="${amountField.groupByField}"）】`);
    amountField.groupedTop5.slice(0, 10).forEach((e, i) => {
      console.log(`  ${i+1}. ${e.label} → ${e.sum.toFixed(2)}`);
    });
    if (amountField.groupByField === selectedField) {
      console.log('  ✅ 旧规则和新规则选中的字段一致，Top10 结果可信');
    } else {
      console.log(`  ⚠️  旧规则选中的是 "${amountField.groupByField}"，新规则选中的是 "${selectedField}"，结果不同，需重新上传文件触发新规则`);
    }
  } else {
    console.log('【DB 中无商品金额的 groupedTop5 数据，需重新上传文件】');
  }
  console.log('');
}

await conn.end();
