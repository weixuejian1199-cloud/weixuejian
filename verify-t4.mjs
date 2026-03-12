import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config({ path: '.env' });

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL);
  const [rows] = await conn.execute(
    'SELECT id FROM sessions WHERE originalName LIKE ? AND status = ? ORDER BY createdAt DESC LIMIT 1',
    ['%爱比爱尼%', 'ready']
  );
  const sessionId = rows[0].id;
  const [r2] = await conn.execute('SELECT dfInfo FROM sessions WHERE id = ?', [sessionId]);
  const dfInfo = r2[0].dfInfo;
  
  const keyNumericFields = ['商品金额', '订单应付金额', '订单金额', '销售额', '金额'];
  for (const f of dfInfo.fields) {
    if (!keyNumericFields.some(kw => f.name.includes(kw))) continue;
    if (!f.groupedTop5 || f.groupedTop5.length === 0) continue;
    const n = f.groupedTop5.length;
    const top5Str = f.groupedTop5.map(e => `${e.label}(${e.sum.toFixed(2)})`).join(' / ');
    console.log(`Field: ${f.name} | Top N count: ${n}`);
    console.log(`Injected: ${f.name}前${n}名: ${top5Str}`);
    console.log(`Rule: 必须将以上全部 ${n} 名展示，不得只展示 Top1`);
    console.log('');
  }
  
  // Also check dataQuality
  if (dfInfo.dataQuality) {
    const dq = dfInfo.dataQuality;
    console.log('dataQuality.affected_rows:', dq.affected_rows);
    console.log('dataQuality.invalid_value_breakdown:', JSON.stringify(dq.invalid_value_breakdown));
  }
  
  await conn.end();
}
main().catch(console.error);
