/**
 * Backfill validGroupSum for existing sessions in the database.
 * Downloads full row data from S3 (atlas-data/<sessionId>-data.json),
 * computes validGroupSum for each numeric field, and updates dfInfo.
 */
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

// Placeholder values to filter (same as parseFile.ts)
const PLACEHOLDER_VALUES = new Set(["-", "—", "N/A", "无", "--", "——", "n/a", "NA", "na", "null", "NULL", "None", "none"]);

function isPlaceholder(v) {
  if (v === null || v === undefined) return false;
  return PLACEHOLDER_VALUES.has(String(v).trim());
}

function isNullOrEmpty(v) {
  if (v === null || v === undefined) return true;
  return String(v).trim() === "";
}

async function getDownloadUrl(fileKey) {
  const forgeApiUrl = process.env.BUILT_IN_FORGE_API_URL;
  const forgeApiKey = process.env.BUILT_IN_FORGE_API_KEY;
  
  const baseUrl = forgeApiUrl.endsWith('/') ? forgeApiUrl : forgeApiUrl + '/';
  const downloadApiUrl = new URL('v1/storage/downloadUrl', baseUrl);
  downloadApiUrl.searchParams.set('path', fileKey.replace(/^\/+/, ''));
  
  const response = await fetch(downloadApiUrl.toString(), {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${forgeApiKey}` }
  });
  
  if (!response.ok) {
    throw new Error(`Failed to get download URL: ${response.status} ${await response.text()}`);
  }
  
  const data = await response.json();
  return data.url;
}

async function downloadJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download: ${response.status}`);
  }
  return response.json();
}

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL);
  
  const fileNames = ['舒络', '时皙', '爱比爱尼'];
  
  for (const fname of fileNames) {
    console.log(`\n=== Processing ${fname} ===`);
    const [rows] = await conn.execute(
      'SELECT id, originalName FROM sessions WHERE originalName LIKE ? AND status = ? ORDER BY createdAt DESC LIMIT 1',
      ['%' + fname + '%', 'ready']
    );
    
    if (!rows[0]) { 
      console.log(`${fname}: NOT FOUND`); 
      continue; 
    }
    
    const session = rows[0];
    const sessionId = session.id;
    console.log(`${fname}: id=${sessionId}`);
    
    const [r2] = await conn.execute('SELECT dfInfo FROM sessions WHERE id = ?', [sessionId]);
    const dfInfo = r2[0].dfInfo;
    
    const gbField = dfInfo.groupByField;
    if (!gbField) { 
      console.log(`${fname}: no groupByField, skipping`); 
      continue; 
    }
    
    // Check if already has validGroupSum
    const keyNumericFields = ['商品金额', '订单应付金额', '订单金额', '销售额', '金额'];
    const fieldsNeedingUpdate = dfInfo.fields.filter(f => 
      keyNumericFields.some(kw => f.name.includes(kw)) && 
      f.sum !== undefined && 
      f.validGroupSum === undefined
    );
    
    if (fieldsNeedingUpdate.length === 0) {
      console.log(`${fname}: all fields already have validGroupSum, skipping`);
      continue;
    }
    
    // Get download URL for atlas-data JSON
    const dataKey = `atlas-data/${sessionId}-data.json`;
    let downloadUrl;
    try {
      downloadUrl = await getDownloadUrl(dataKey);
      console.log(`${fname}: got download URL for ${dataKey}`);
    } catch (e) {
      console.error(`${fname}: failed to get download URL:`, e.message);
      continue;
    }
    
    // Download full row data
    let rows_data;
    try {
      rows_data = await downloadJson(downloadUrl);
      console.log(`${fname}: loaded ${rows_data.length} rows from JSON`);
    } catch (e) {
      console.error(`${fname}: download/parse failed:`, e.message);
      continue;
    }
    
    // Compute validGroupSum for each field
    let updated = false;
    for (const f of dfInfo.fields) {
      if (!keyNumericFields.some(kw => f.name.includes(kw))) continue;
      if (f.sum === undefined) continue;
      if (f.validGroupSum !== undefined) continue; // already has it
      
      // Compute validGroupSum from full data
      const groupSums = new Map();
      for (const row of rows_data) {
        const groupVal = row[gbField];
        const numVal = Number(row[f.name]);
        if (groupVal === null || groupVal === undefined || groupVal === "") continue;
        if (isNaN(numVal)) continue;
        const key = String(groupVal).trim();
        if (isNullOrEmpty(key) || isPlaceholder(key)) continue;
        groupSums.set(key, (groupSums.get(key) || 0) + numVal);
      }
      const validGroupSum = Array.from(groupSums.values()).reduce((a, b) => a + b, 0);
      f.validGroupSum = validGroupSum;
      const nullAmt = Math.max(0, f.sum - validGroupSum);
      console.log(`${fname} | ${f.name} | sum=${f.sum.toFixed(2)} | validGroupSum=${validGroupSum.toFixed(2)} | nullAmt=${nullAmt.toFixed(2)}`);
      updated = true;
    }
    
    if (updated) {
      await conn.execute('UPDATE sessions SET dfInfo = ? WHERE id = ?', [JSON.stringify(dfInfo), sessionId]);
      console.log(`${fname}: dfInfo updated with validGroupSum ✅`);
    }
  }
  
  await conn.end();
  console.log('\nBackfill complete!');
}

main().catch(console.error);
