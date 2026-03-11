/**
 * 深度排查脚本：检查最新上传的 session 的 groupByField 和 groupedTopN 原始内容
 */
import mysql from 'mysql2/promise';
import * as dotenv from 'dotenv';
dotenv.config();

const conn = await mysql.createConnection(process.env.DATABASE_URL!);

// 获取最新的爱比爱尼和时皙 session（最近1小时内上传的）
const [rows] = await conn.execute(
  `SELECT id, originalName, rowCount, createdAt,
          JSON_EXTRACT(dfInfo, '$.groupByField') as groupByField,
          JSON_EXTRACT(dfInfo, '$.allGroupByFields') as allGroupByFields,
          JSON_EXTRACT(dfInfo, '$.fields') as fields_json
   FROM sessions
   WHERE (originalName LIKE '%爱比爱尼%' OR originalName LIKE '%时皙%')
   ORDER BY createdAt DESC
   LIMIT 6`
) as any[];

console.log(`找到 ${(rows as any[]).length} 条记录\n`);

for (const row of rows as any[]) {
  const fields = (typeof row.fields_json === 'string' ? JSON.parse(row.fields_json) : row.fields_json) as any[];
  const groupByField = row.groupByField ? JSON.parse(row.groupByField) : null;
  const allGroupByFields = row.allGroupByFields ? JSON.parse(row.allGroupByFields) : null;

  console.log('='.repeat(70));
  console.log('文件:', row.originalName);
  console.log('上传时间:', row.createdAt);
  console.log('总行数:', row.rowCount);
  console.log('');
  console.log('【检查点1】groupByField:', JSON.stringify(groupByField));
  console.log('【检查点1】allGroupByFields:', JSON.stringify(allGroupByFields));
  console.log('');

  // 检查点2：达人昵称字段详情
  const darenField = fields.find((f: any) => f.name === '达人昵称');
  if (darenField) {
    console.log('【检查点2】达人昵称字段:');
    console.log('  类型:', darenField.type);
    console.log('  unique_count:', darenField.unique_count);
    console.log('  null_count:', darenField.null_count);
    console.log('  sample:', JSON.stringify(darenField.sample));
    console.log('');
  }

  // 检查点3：找商品金额字段的 groupedTop5 原始内容
  const amountField = fields.find((f: any) => f.name === '商品金额');
  if (amountField) {
    console.log('【检查点3】商品金额字段的 groupedTop5:');
    console.log('  groupByField:', amountField.groupByField);
    if (amountField.groupedTop5 && amountField.groupedTop5.length > 0) {
      console.log('  条数:', amountField.groupedTop5.length);
      amountField.groupedTop5.slice(0, 20).forEach((e: any, i: number) => {
        console.log(`  ${i+1}. "${e.label}" → ${typeof e.sum === 'number' ? e.sum.toFixed(2) : e.sum}`);
      });
    } else {
      console.log('  ⚠️  groupedTop5 为空！');
    }
    console.log('');
  }

  // 检查点4：找所有有 groupedTop5 的字段
  const fieldsWithGrouped = fields.filter((f: any) => f.groupedTop5 && f.groupedTop5.length > 0);
  console.log(`【检查点4】有 groupedTop5 的字段数: ${fieldsWithGrouped.length}`);
  for (const f of fieldsWithGrouped.slice(0, 3)) {
    console.log(`  - ${f.name}（groupByField="${f.groupByField}"，条数=${f.groupedTop5.length}）`);
    f.groupedTop5.slice(0, 5).forEach((e: any, i: number) => {
      console.log(`    ${i+1}. "${e.label}" → ${typeof e.sum === 'number' ? e.sum.toFixed(2) : e.sum}`);
    });
  }
  console.log('');
}

await conn.end();
