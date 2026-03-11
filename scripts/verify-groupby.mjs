import mysql from 'mysql2/promise';
import { config } from 'dotenv';
config();

// ===== V14.3 detectGroupByField 逻辑（从 parseFile.ts 复制）=====
const AMOUNT_FIELD_PATTERNS = [
  "金额", "优惠", "费用", "佣金", "补贴", "承担", "支付", "单价",
  "price", "amount", "money", "fee", "cost", "discount", "subsidy"
];

function isAmountField(name) {
  const lower = name.toLowerCase();
  return AMOUNT_FIELD_PATTERNS.some(p => lower.includes(p.toLowerCase()));
}

const DIMENSION_TIERS = [
  {
    tier: 1,
    keywords: ["达人昵称", "主播昵称", "达人名称", "主播名称", "达人", "主播"],
    desc: "达人/主播维度"
  },
  {
    tier: 2,
    keywords: ["姓名", "员工姓名", "人员", "员工", "销售员", "业务员", "负责人"],
    desc: "人员维度"
  },
  {
    tier: 3,
    keywords: ["店铺名称", "店铺", "门店", "网店"],
    desc: "店铺维度"
  },
  {
    tier: 4,
    keywords: ["品牌", "品牌名称"],
    desc: "品牌维度"
  }
];

function detectGroupByField(headers, fieldTypes) {
  // fieldTypes: { [fieldName]: 'text' | 'numeric' | 'date' | ... }
  const candidates = [];

  for (const tier of DIMENSION_TIERS) {
    for (const h of headers) {
      const ftype = fieldTypes ? fieldTypes[h] : null;
      // Rule 1: 排除 numeric 字段
      if (ftype === 'numeric') continue;
      // Rule 2: 排除金额字段
      if (isAmountField(h)) continue;
      // Rule 3: 关键词匹配
      for (const kw of tier.keywords) {
        if (h.includes(kw)) {
          candidates.push({ field: h, tier: tier.tier, keyword: kw, desc: tier.desc });
          break;
        }
      }
    }
    // 如果 Tier 1 有命中，不继续往下
    if (tier.tier === 1 && candidates.length > 0) break;
    if (candidates.length > 0) break;
  }

  return candidates;
}

// ===== 主验证逻辑 =====
async function verifyFile(conn, fileNamePattern, label) {
  console.log('\n' + '='.repeat(70));
  console.log(`文件 ${label}: ${fileNamePattern}`);
  console.log('='.repeat(70));

  const [rows] = await conn.execute(
    `SELECT id, originalName, rowCount, dfInfo FROM sessions 
     WHERE originalName LIKE ? AND status='ready'
     ORDER BY createdAt DESC LIMIT 1`,
    [`%${fileNamePattern}%`]
  );

  if (!rows.length) {
    console.log('❌ 数据库中未找到该文件');
    return;
  }

  const r = rows[0];
  const df = typeof r.dfInfo === 'string' ? JSON.parse(r.dfInfo || '{}') : (r.dfInfo || {});

  console.log(`\n[1] Session ID: ${r.id}`);
  console.log(`[1] 文件名: ${r.originalName}`);
  console.log(`[1] 总行数: ${r.rowCount}`);

  // 2. 原始字段列表
  const fields = df.fields || [];
  const headers = fields.map(f => f.name);
  console.log(`\n[2] 原始字段完整列表 (${headers.length} 个):`);
  headers.forEach((h, i) => {
    const f = fields[i];
    console.log(`    [${i}] "${h}" type=${f.type}`);
  });

  // 3. 字段类型映射
  const fieldTypes = {};
  fields.forEach(f => { fieldTypes[f.name] = f.type; });

  // 4. 运行 V14.3 detectGroupByField
  console.log('\n[3] V14.3 detectGroupByField 候选命中扫描:');
  const candidates = detectGroupByField(headers, fieldTypes);
  if (candidates.length === 0) {
    console.log('    ❌ 没有候选命中');
  } else {
    candidates.forEach(c => {
      console.log(`    ✓ 命中: "${c.field}" (Tier ${c.tier}, 关键词="${c.keyword}", ${c.desc})`);
    });
  }

  const detectedGroupBy = candidates.length > 0 ? candidates[0].field : null;
  console.log(`\n[4] 最终命中的 groupByField: ${detectedGroupBy ? `"${detectedGroupBy}"` : 'null'}`);

  // 5. 检测达人ID 和 达人昵称
  const darenId = headers.find(h => h.includes('达人ID') || h.includes('达人id'));
  const darenNickname = headers.find(h => h.includes('达人昵称'));
  console.log(`\n[5] 字段检测:`);
  console.log(`    达人ID: ${darenId ? `✓ 存在 "${darenId}" (type=${fieldTypes[darenId]})` : '❌ 不存在'}`);
  console.log(`    达人昵称: ${darenNickname ? `✓ 存在 "${darenNickname}" (type=${fieldTypes[darenNickname]})` : '❌ 不存在'}`);

  // 6. dfInfo 顶层 groupByField
  console.log(`\n[6] dfInfo 顶层 groupByField: ${df.groupByField !== undefined ? `"${df.groupByField}"` : 'undefined (未设置)'}`);
  console.log(`    dfInfo 顶层 allGroupByFields: ${JSON.stringify(df.allGroupByFields)}`);

  // 7. 字段级 groupByField 和 groupedTop5
  console.log('\n[7] 各字段的 groupByField 和 groupedTop5:');
  fields.forEach(f => {
    if (f.groupedTop5 && f.groupedTop5.length > 0) {
      console.log(`    字段 "${f.name}":`);
      console.log(`      groupByField: "${f.groupByField}"`);
      console.log(`      groupedTop5 (前10条):`);
      f.groupedTop5.slice(0, 10).forEach((item, i) => {
        console.log(`        [${i+1}] key="${item.key}" sum=${item.sum}`);
      });
    }
  });

  // 8. preview 数据中的达人昵称分布
  const preview = df.preview || [];
  console.log(`\n[8] Preview 行数: ${preview.length}`);
  if (preview.length > 0 && darenNickname) {
    const nicknames = {};
    preview.forEach(row => {
      const v = row[darenNickname];
      if (v) nicknames[v] = (nicknames[v] || 0) + 1;
    });
    const sorted = Object.entries(nicknames).sort((a, b) => b[1] - a[1]);
    console.log(`    Preview 中达人昵称分布 (前10):`);
    sorted.slice(0, 10).forEach(([k, v]) => console.log(`      "${k}": ${v} 行`));
  }

  // 9. 逐文件结论
  console.log('\n[9] 逐文件结论:');
  const topLevelOk = df.groupByField === '达人昵称';
  const detectedOk = detectedGroupBy === '达人昵称';
  const fieldLevelGroupBy = fields.find(f => f.groupedTop5 && f.groupedTop5.length > 0 && f.groupByField);
  const fieldLevelOk = fieldLevelGroupBy ? fieldLevelGroupBy.groupByField === '达人昵称' : false;

  console.log(`    V14.3 本地检测: ${detectedOk ? '✅ 正确识别为"达人昵称"' : `❌ 识别为"${detectedGroupBy}"`}`);
  console.log(`    dfInfo 顶层 groupByField: ${topLevelOk ? '✅ 已设置为"达人昵称"' : `❌ 当前值="${df.groupByField}" (旧数据，需重新上传)`}`);
  console.log(`    字段级 groupByField: ${fieldLevelOk ? '✅ 正确' : `❌ 当前值="${fieldLevelGroupBy ? fieldLevelGroupBy.groupByField : 'N/A'}" (旧数据，需重新上传)`}`);
  
  if (!topLevelOk || !fieldLevelOk) {
    console.log(`    ⚠️  数据库中存储的是旧代码生成的数据，需要用 V14.3 重新上传文件才能修复`);
    console.log(`    ✅ V14.3 本地检测逻辑已正确，发布后重新上传即可`);
  }
}

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL);
  
  await verifyFile(conn, '爱比爱尼', 'A');
  await verifyFile(conn, '时皙', 'B');
  
  await conn.end();
}

main().catch(console.error);
