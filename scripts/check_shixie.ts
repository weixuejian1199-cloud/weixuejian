import mysql from 'mysql2/promise';
import * as dotenv from 'dotenv';
dotenv.config();

const conn = await mysql.createConnection(process.env.DATABASE_URL!);
const [rows] = await conn.execute(
  `SELECT originalName, rowCount, JSON_EXTRACT(dfInfo, '$.fields') as fields_json
   FROM sessions
   WHERE originalName LIKE '%时皙%' AND originalName LIKE '%副本%'
   ORDER BY createdAt DESC LIMIT 2`
) as any[];

for (const row of rows as any[]) {
  const fields = (typeof row.fields_json === 'string' ? JSON.parse(row.fields_json) : row.fields_json) as any[];
  const f = fields.find((x: any) => x.name === '达人昵称');
  console.log('文件:', row.originalName, '| 总行数:', row.rowCount);
  if (f) {
    console.log('  unique_count:', f.unique_count);
    console.log('  null_count:', f.null_count);
    console.log('  sample:', JSON.stringify(f.sample));
  } else {
    console.log('  未找到达人昵称字段');
  }
}
await conn.end();
