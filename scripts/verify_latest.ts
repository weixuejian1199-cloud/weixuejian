import mysql from 'mysql2/promise';
import * as dotenv from 'dotenv';
dotenv.config();

const conn = await mysql.createConnection(process.env.DATABASE_URL!);

// 最新的爱比爱尼和时皙 session（最近2小时内）
const [rows] = await conn.execute(
  `SELECT id, originalName, rowCount, createdAt,
          JSON_EXTRACT(dfInfo, '$.groupByField') as groupByField,
          JSON_EXTRACT(dfInfo, '$.allGroupByFields') as allGroupByFields,
          JSON_EXTRACT(dfInfo, '$.fields') as fields_json
   FROM sessions
   WHERE (originalName LIKE '%爱比爱尼%' OR originalName LIKE '%时皙%')
   ORDER BY createdAt DESC
   LIMIT 4`
) as any[];

for (const row of rows as any[]) {
  const fields = (typeof row.fields_json === 'string' ? JSON.parse(row.fields_json) : row.fields_json) as any[];
  const groupByField = row.groupByField ? JSON.parse(row.groupByField) : null;
  const allGroupByFields = row.allGroupByFields ? JSON.parse(row.allGroupByFields) : null;

  console.log('='.repeat(60));
  console.log('文件:', row.originalName);
  console.log('上传时间:', row.createdAt);
  console.log('总行数:', row.rowCount);
  console.log('');
  console.log('【Q1】groupByField:', JSON.stringify(groupByField));
  console.log('【Q1】allGroupByFields:', JSON.stringify(allGroupByFields));
  console.log('');

  // 达人昵称字段的 groupedTop5
  const darenField = fields.find((f: any) => f.name === '达人昵称');
  if (darenField) {
    console.log('【Q2】达人昵称字段:');
    console.log('  类型:', darenField.type);
    console.log('  unique_count:', darenField.unique_count);
    console.log('  null_count:', darenField.null_count);
    console.log('');
  }

  // 商品金额字段的 groupedTop5
  const amtField = fields.find((f: any) => f.name === '商品金额');
  if (amtField) {
    console.log('【Q3/Q4】商品金额 groupedTop5:');
    console.log('  groupByField:', amtField.groupByField);
    if (amtField.groupedTop5 && amtField.groupedTop5.length > 0) {
      console.log('  条数:', amtField.groupedTop5.length, '（TopN 上限=20）');
      amtField.groupedTop5.forEach((e: any, i: number) => {
        console.log(`  ${i+1}. "${e.label}" → ${typeof e.sum === 'number' ? e.sum.toFixed(2) : e.sum}`);
      });
    } else {
      console.log('  ⚠️  groupedTop5 为空');
    }
  }
  console.log('');
}

await conn.end();
