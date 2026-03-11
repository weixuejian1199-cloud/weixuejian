import mysql from 'mysql2/promise';
import * as dotenv from 'dotenv';
dotenv.config();

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}

const conn = await mysql.createConnection(dbUrl);

const [rows] = await conn.execute(
  `SELECT id, originalName, rowCount, colCount, 
          JSON_EXTRACT(dfInfo, '$.fields') as fields_json
   FROM sessions
   WHERE originalName LIKE '%爱比爱尼%' OR originalName LIKE '%时皙%'
   ORDER BY createdAt DESC
   LIMIT 6`
) as any[];

if (rows.length === 0) {
  console.log('数据库中未找到爱比爱尼或时皙的文件记录。请确认文件已重新上传。');
  await conn.end();
  process.exit(0);
}

for (const row of rows as any[]) {
  // mysql2 may auto-parse JSON columns; handle both string and object
  const rawFields = row.fields_json;
  const fields = (typeof rawFields === 'string' ? JSON.parse(rawFields) : rawFields) as Array<{name: string; type: string; sample?: unknown[]}>;
  const fieldNames = fields.map((f: any) => f.name);
  const darenFields = fieldNames.filter((n: string) => 
    n.includes('达人') || n.includes('主播') || n.includes('昵称')
  );
  
  console.log('='.repeat(60));
  console.log('文件:', row.originalName);
  console.log('行数:', row.rowCount, '| 列数(DB):', row.colCount, '| 解析字段数:', fields.length);
  console.log('');
  console.log('全部解析字段名:');
  fieldNames.forEach((n: string, i: number) => console.log(`  [${i+1}] ${n}`));
  console.log('');
  console.log('达人/主播/昵称相关字段:', darenFields.length > 0 ? darenFields.join(', ') : '【无】');
  
  // 检查是否有达人ID/达人昵称
  const hasdarenId = fieldNames.some((n: string) => n === '达人ID' || n === '达人Id' || n.toLowerCase() === '达人id');
  const hasdarenNickname = fieldNames.some((n: string) => n === '达人昵称');
  console.log('是否有"达人ID":', hasdarenId ? '✅ 是' : '❌ 否');
  console.log('是否有"达人昵称":', hasdarenNickname ? '✅ 是' : '❌ 否');
  
  // 检查字段数 vs colCount 是否一致
  if (fields.length !== row.colCount) {
    console.log(`⚠️  字段数不一致：DB colCount=${row.colCount}，实际解析字段数=${fields.length}，可能有字段被截断！`);
  }
  console.log('');
}

await conn.end();
