import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config({ path: '.env' });

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL);
  
  const files = ['舒络', '时皙', '爱比爱尼'];
  
  for (const fname of files) {
    console.log(`\n=== ${fname} ===`);
    const [rows] = await conn.execute(
      'SELECT id FROM sessions WHERE originalName LIKE ? AND status = ? ORDER BY createdAt DESC LIMIT 1',
      ['%' + fname + '%', 'ready']
    );
    if (!rows[0]) { console.log('NOT FOUND'); continue; }
    
    const [r2] = await conn.execute('SELECT dfInfo FROM sessions WHERE id = ?', [rows[0].id]);
    const dfInfo = r2[0].dfInfo;
    
    const gbField = dfInfo.groupByField;
    console.log('groupByField:', gbField || 'N/A');
    
    if (!gbField) continue;
    
    const dq = dfInfo.dataQuality;
    const affectedRows = dq ? Number(dq.affected_rows ?? 0) : 0;
    const nullOrEmpty = dq ? Number(dq.invalid_value_breakdown?.null_or_empty ?? 0) : 0;
    const placeholder = dq ? Number(dq.invalid_value_breakdown?.placeholder ?? 0) : 0;
    
    console.log(`affected_rows: ${affectedRows} (null/empty: ${nullOrEmpty}, placeholder: ${placeholder})`);
    
    if (affectedRows > 0) {
      // Simulate groupByFieldNullContext
      const keyNumericFields = ['商品金额', '订单应付金额', '订单金额', '销售额', '金额'];
      const nullAmountLines = [];
      for (const f of dfInfo.fields) {
        if (!keyNumericFields.some(kw => f.name.includes(kw))) continue;
        if (f.sum === undefined) continue;
        if (f.validGroupSum !== undefined && f.validGroupSum > 0) {
          const nullAmt = Math.max(0, f.sum - f.validGroupSum);
          nullAmountLines.push(`- 「${f.name}」中无有效${gbField}的订单金额: ${nullAmt.toFixed(2)}`);
        }
      }
      
      console.log('Injected context:');
      console.log(`【${gbField}字段空值说明（重要）】`);
      console.log(`- 字段「${gbField}」存在于数据中（字段存在，不是缺失）`);
      console.log(`- 共有 ${affectedRows} 行的「${gbField}」值为空值或占位符（null/空字符串: ${nullOrEmpty}行，占位符如"-"/"—"/"N/A": ${placeholder}行）`);
      console.log(`- 这些行在达人排名中被过滤，但其对应金额仍计入文件总金额`);
      if (nullAmountLines.length > 0) {
        nullAmountLines.forEach(l => console.log(l));
      } else {
        console.log('  (无精确无昵称金额，需重新上传文件)');
      }
      console.log(`- ⚠️ 禁止说「文件不包含${gbField}字段」——字段存在，只是部分行值为空`);
    } else {
      console.log('No affected rows, no null context injected');
    }
  }
  
  await conn.end();
}
main().catch(console.error);
