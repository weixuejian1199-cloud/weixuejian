/**
 * 深度排查脚本：检查达人昵称字段的唯一值数量和 groupedTop20 原始分组结果
 * 目标：找出"按达人昵称分组后只有1个唯一值"的根本原因
 */
import mysql from 'mysql2/promise';
import * as dotenv from 'dotenv';
dotenv.config();

const conn = await mysql.createConnection(process.env.DATABASE_URL!);

// 获取最新的爱比爱尼和时皙 session
const [rows] = await conn.execute(
  `SELECT id, originalName, rowCount,
          JSON_EXTRACT(dfInfo, '$.fields') as fields_json,
          JSON_EXTRACT(dfInfo, '$.groupByField') as groupByField,
          JSON_EXTRACT(dfInfo, '$.allGroupByFields') as allGroupByFields
   FROM sessions
   WHERE (originalName LIKE '%爱比爱尼%' OR originalName LIKE '%时皙%')
     AND originalName LIKE '%副本%'
   ORDER BY createdAt DESC
   LIMIT 4`
) as any[];

for (const row of rows as any[]) {
  const fields = (typeof row.fields_json === 'string' ? JSON.parse(row.fields_json) : row.fields_json) as Array<{
    name: string;
    type: string;
    unique_count: number;
    null_count: number;
    sample: (string | number)[];
    sum?: number;
    groupedTop5?: Array<{ label: string; sum: number; source?: string }>;
    groupByField?: string;
  }>;

  const groupByField = row.groupByField ? JSON.parse(row.groupByField) : null;
  const allGroupByFields = row.allGroupByFields ? JSON.parse(row.allGroupByFields) : null;

  console.log('='.repeat(70));
  console.log('文件:', row.originalName, '| 总行数:', row.rowCount);
  console.log('DB 存储的 groupByField:', groupByField);
  console.log('DB 存储的 allGroupByFields:', JSON.stringify(allGroupByFields));
  console.log('');

  // 找达人昵称字段
  const darenField = fields.find(f => f.name === '达人昵称');
  if (darenField) {
    console.log('【达人昵称字段详情】');
    console.log('  类型:', darenField.type);
    console.log('  unique_count:', darenField.unique_count);
    console.log('  null_count:', darenField.null_count);
    console.log('  sample（前5个非空值）:', JSON.stringify(darenField.sample));
    console.log('');

    // 检查 groupedTop5 是否挂在达人昵称字段上
    if (darenField.groupedTop5) {
      console.log('  ⚠️  达人昵称字段本身有 groupedTop5（不应该，这是维度字段不是数值字段）');
    } else {
      console.log('  ✅ 达人昵称字段无 groupedTop5（正确，维度字段不应有 groupedTop5）');
    }
    console.log('');
  } else {
    console.log('❌ 未找到"达人昵称"字段！');
    console.log('所有字段名:', fields.map(f => f.name).join(', '));
    console.log('');
  }

  // 找商品金额字段，查看其 groupedTop5
  const amountFields = fields.filter(f => f.name.includes('商品金额') || f.name.includes('金额'));
  for (const af of amountFields) {
    if (af.groupedTop5 && af.groupedTop5.length > 0) {
      console.log(`【"${af.name}" 字段的 groupedTop5（groupByField="${af.groupByField}"）】`);
      console.log('  条数:', af.groupedTop5.length);
      af.groupedTop5.slice(0, 20).forEach((e, i) => {
        console.log(`  ${i+1}. "${e.label}" → ${e.sum.toFixed(2)}`);
      });
      console.log('');
    }
  }

  // 找所有有 groupedTop5 的字段
  const fieldsWithGrouped = fields.filter(f => f.groupedTop5 && f.groupedTop5.length > 0);
  if (fieldsWithGrouped.length === 0) {
    console.log('⚠️  该文件没有任何字段有 groupedTop5 数据！');
    console.log('   这意味着文件上传时 groupByField 为 null，computeGroupedTopN 没有被调用');
    console.log('');
  } else {
    console.log(`共 ${fieldsWithGrouped.length} 个字段有 groupedTop5 数据：`);
    for (const f of fieldsWithGrouped) {
      console.log(`  - ${f.name}（groupByField="${f.groupByField}"，条数=${f.groupedTop5!.length}）`);
      // 显示前3条
      f.groupedTop5!.slice(0, 3).forEach((e, i) => {
        console.log(`    ${i+1}. "${e.label}" → ${e.sum.toFixed(2)}`);
      });
    }
    console.log('');
  }
}

await conn.end();
