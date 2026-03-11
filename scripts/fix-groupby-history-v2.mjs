/**
 * fix-groupby-history-v2.mjs
 * 修复历史 session 数据：将错误的 groupByField=选购商品 改为 达人昵称
 * 从 S3 加载 500 行 preview 数据重新计算 groupedTop5
 */
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
dotenv.config();

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// S3 配置（从环境变量读取）
const s3Client = new S3Client({
  region: process.env.S3_REGION || process.env.AWS_REGION || 'auto',
  endpoint: process.env.S3_ENDPOINT,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY || '',
  },
});
const S3_BUCKET = process.env.S3_BUCKET || process.env.AWS_S3_BUCKET || '';

console.log('S3 config:', { bucket: S3_BUCKET, region: process.env.S3_REGION || 'auto' });

async function loadS3Data(sessionId) {
  try {
    const key = `atlas-data/${sessionId}`;
    const cmd = new GetObjectCommand({ Bucket: S3_BUCKET, Key: key });
    const url = await getSignedUrl(s3Client, cmd, { expiresIn: 60 });
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    return null;
  }
}

// 获取所有 groupByField 错误的 sessions（按选购商品分组的）
const [rows] = await conn.execute(
  `SELECT id, originalName, dfInfo FROM sessions 
   WHERE JSON_EXTRACT(dfInfo, '$.fields[0].groupByField') = '选购商品' 
   ORDER BY createdAt DESC LIMIT 50`
);

console.log('Found sessions with wrong groupByField (选购商品):', rows.length);

let fixedCount = 0;
let skippedCount = 0;

for (const row of rows) {
  const di = row.dfInfo;
  const sessionId = row.id;
  const filename = row.originalName;
  
  // 找到 达人昵称 字段
  const darenField = di.fields.find(f => f.name === '达人昵称');
  if (!darenField) {
    console.log('  SKIP', sessionId, filename, '- no 达人昵称 field');
    skippedCount++;
    continue;
  }
  
  // 从 S3 加载 500 行数据
  let s3Data = await loadS3Data(sessionId);
  
  // 如果 S3 没有数据，用数据库中的 5 行 preview
  const previewRows = s3Data || di.preview || [];
  console.log(`  Processing ${sessionId} ${filename} | data rows: ${previewRows.length} (${s3Data ? 'S3' : 'DB preview'})`);
  
  for (const field of di.fields) {
    // 清除旧的错误 groupedTop5 和 groupByField
    delete field.groupedTop5;
    delete field.groupByField;
    
    if (field.type === 'numeric' && previewRows.length > 0) {
      // 重新计算按 达人昵称 分组的 groupedTop5
      const groupSums = new Map();
      for (const r of previewRows) {
        const groupVal = r['达人昵称'];
        const numVal = Number(r[field.name]);
        if (groupVal == null || groupVal === '' || isNaN(numVal)) continue;
        const key = String(groupVal);
        groupSums.set(key, (groupSums.get(key) ?? 0) + numVal);
      }
      const top20 = Array.from(groupSums.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20)
        .map(([label, sum]) => ({ label, sum, source: filename }));
      
      if (top20.length > 0) {
        field.groupedTop5 = top20;
        field.groupByField = '达人昵称';
      }
    }
  }
  
  // 设置顶层 groupByField
  di.groupByField = '达人昵称';
  
  // 更新数据库
  await conn.execute(
    'UPDATE sessions SET dfInfo = ? WHERE id = ?',
    [JSON.stringify(di), sessionId]
  );
  console.log('  FIXED', sessionId, filename);
  fixedCount++;
}

await conn.end();
console.log(`\nDone! Fixed: ${fixedCount}, Skipped: ${skippedCount}`);
