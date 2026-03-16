// Local file storage for ATLAS
// Stores files in /root/atlas-report/storage/ directory

import fs from 'fs';
import path from 'path';
import { ENV } from './_core/env';

const STORAGE_DIR = path.join(process.cwd(), 'storage');

// Ensure storage directory exists
if (!fs.existsSync(STORAGE_DIR)) {
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
}

function normalizeKey(relKey: string): string {
  return relKey.replace(/^\/+/, "").replace(/\//g, '_');
}

function getFilePath(relKey: string): string {
  const key = normalizeKey(relKey);
  return path.join(STORAGE_DIR, key);
}

function getPublicUrl(relKey: string): string {
  // For local storage, return a relative path that can be served by Express
  return `/api/storage/${normalizeKey(relKey)}`;
}

export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream"
): Promise<{ key: string; url: string }> {
  const filePath = getFilePath(relKey);
  const key = normalizeKey(relKey);
  
  // Ensure parent directory exists
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Write file to disk
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data as string);
  await fs.promises.writeFile(filePath, buffer);
  
  console.log(`[Storage] Wrote ${buffer.length} bytes to ${filePath}`);
  
  return { key, url: getPublicUrl(relKey) };
}

export async function storageGet(relKey: string): Promise<{ key: string; url: string }> {
  const key = normalizeKey(relKey);
  return {
    key,
    url: getPublicUrl(relKey),
  };
}

export async function storageDelete(relKey: string): Promise<void> {
  const filePath = getFilePath(relKey);
  try {
    if (fs.existsSync(filePath)) {
      await fs.promises.unlink(filePath);
      console.log(`[Storage] Deleted ${filePath}`);
    }
  } catch (err) {
    console.warn(`[Storage] Delete failed for ${filePath}:`, err);
  }
}

// Helper to read file content (for local storage)
export async function storageReadFile(relKey: string): Promise<Buffer> {
  const filePath = getFilePath(relKey);
  return await fs.promises.readFile(filePath);
}
