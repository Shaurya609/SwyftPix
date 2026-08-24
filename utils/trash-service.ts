import * as SQLite from 'expo-sqlite';
import * as MediaLibrary from 'expo-media-library';
import { MockMediaItem, TrashedAsset } from '@/types/media';
import { deleteMediaByPath } from '@/modules/swyftpix-media-delete';
import { deleteUserFile } from '@/utils/file-access';

// Retention is a global Trash policy. 0 means never auto-delete.
export const RETENTION_OPTIONS = [1, 7, 30, 60, 90, 0] as const;
export type RetentionDays = (typeof RETENTION_OPTIONS)[number];
export const DEFAULT_RETENTION_DAYS: RetentionDays = 30;

interface TrashedMediaRow {
  id: string;
  file_name: string;
  file_type: MockMediaItem['fileType'];
  file_size: number;
  date_created: string;
  source: MockMediaItem['source'];
  uri: string;
  duration: string | null;
  thumbnail_color: string | null;
  deleted_at: string;
  expires_at: string | null;
}

let dbInstance: SQLite.SQLiteDatabase | null = null;
let dbOpenPromise: Promise<SQLite.SQLiteDatabase> | null = null;
let initializationPromise: Promise<void> | null = null;

async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (dbInstance) return dbInstance;
  if (!dbOpenPromise) {
    dbOpenPromise = SQLite.openDatabaseAsync('swyftpix.db')
      .then(db => { dbInstance = db; return db; })
      .finally(() => { dbOpenPromise = null; });
  }
  return dbOpenPromise;
}

function calculateExpiresAt(deletedAt: string, retention: RetentionDays): string | null {
  if (retention === 0) return null;
  const durationMs = retention * 24 * 60 * 60 * 1000;
  return new Date(new Date(deletedAt).getTime() + durationMs).toISOString();
}

async function readRetentionDays(db: SQLite.SQLiteDatabase): Promise<RetentionDays> {
  const row = await db.getFirstAsync<{ value: string }>(`SELECT value FROM app_settings WHERE key = 'trash_retention_days';`);
  const value = Number(row?.value ?? DEFAULT_RETENTION_DAYS);
  return RETENTION_OPTIONS.includes(value as RetentionDays) ? (value as RetentionDays) : DEFAULT_RETENTION_DAYS;
}

export async function initialize(): Promise<void> {
  if (initializationPromise) return initializationPromise;
  initializationPromise = (async () => {
    const db = await getDb();
    await db.execAsync(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS reviewed_assets (id TEXT PRIMARY KEY, action TEXT NOT NULL, reviewed_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS trashed_media (
        id TEXT PRIMARY KEY, file_name TEXT NOT NULL, file_type TEXT NOT NULL, file_size INTEGER NOT NULL,
        date_created TEXT NOT NULL, source TEXT NOT NULL, uri TEXT NOT NULL, duration TEXT,
        thumbnail_color TEXT, deleted_at TEXT NOT NULL, expires_at TEXT
      );
      CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT OR IGNORE INTO app_settings (key, value) VALUES ('trash_retention_days', '30');
    `);
    const columns = await db.getAllAsync<{ name: string; notnull: number }>(`PRAGMA table_info(trashed_media);`);
    const expiresColumn = columns.find(column => column.name === 'expires_at');
    if (expiresColumn?.notnull === 1) {
      await db.withTransactionAsync(async () => {
        await db.execAsync(`
          CREATE TABLE trashed_media_migrating (
            id TEXT PRIMARY KEY, file_name TEXT NOT NULL, file_type TEXT NOT NULL, file_size INTEGER NOT NULL,
            date_created TEXT NOT NULL, source TEXT NOT NULL, uri TEXT NOT NULL, duration TEXT,
            thumbnail_color TEXT, deleted_at TEXT NOT NULL, expires_at TEXT
          );
          INSERT INTO trashed_media_migrating
            (id, file_name, file_type, file_size, date_created, source, uri, duration, thumbnail_color, deleted_at, expires_at)
          SELECT id, file_name, file_type, file_size, date_created, source, uri, duration, thumbnail_color, deleted_at, expires_at FROM trashed_media;
          DROP TABLE trashed_media;
          ALTER TABLE trashed_media_migrating RENAME TO trashed_media;
        `);
      });
    }

    const retention = await readRetentionDays(db);
    const rows = await db.getAllAsync<{ id: string; deleted_at: string }>(`SELECT id, deleted_at FROM trashed_media;`);
    for (const row of rows) {
      const expiresAt = calculateExpiresAt(row.deleted_at, retention);
      await db.runAsync(`UPDATE trashed_media SET expires_at = ? WHERE id = ?;`, [expiresAt, row.id]);
    }
  })();
  try { await initializationPromise; } finally { initializationPromise = null; }
}

export async function getRetentionDays(): Promise<RetentionDays> {
  await initialize();
  return readRetentionDays(await getDb());
}

export async function setRetentionDays(retention: RetentionDays): Promise<void> {
  if (!RETENTION_OPTIONS.includes(retention)) throw new Error(`Unsupported trash retention period: ${retention}`);
  await initialize();
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    await db.runAsync(`INSERT OR REPLACE INTO app_settings (key, value) VALUES ('trash_retention_days', ?);`, [String(retention)]);
    const rows = await db.getAllAsync<{ id: string; deleted_at: string }>(`SELECT id, deleted_at FROM trashed_media;`);
    for (const row of rows) {
      const expiresAt = calculateExpiresAt(row.deleted_at, retention);
      await db.runAsync(`UPDATE trashed_media SET expires_at = ? WHERE id = ?;`, [expiresAt, row.id]);
    }
  });
}

export async function trashAsset(item: MockMediaItem): Promise<void> {
  await initialize();
  const db = await getDb();
  const deletedAt = new Date().toISOString();
  const expiresAt = calculateExpiresAt(deletedAt, await readRetentionDays(db));
  await db.withTransactionAsync(async () => {
    await db.runAsync(`INSERT OR REPLACE INTO reviewed_assets (id, action, reviewed_at) VALUES (?, ?, ?);`, [item.id, 'trash', deletedAt]);
    await db.runAsync(`INSERT OR REPLACE INTO trashed_media (id, file_name, file_type, file_size, date_created, source, uri, duration, thumbnail_color, deleted_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`, [item.id, item.fileName, item.fileType, item.fileSize, item.dateCreated, item.source, item.uri, item.duration || null, item.thumbnailColor || null, deletedAt, expiresAt]);
  });
}

export async function restoreAsset(id: string): Promise<void> {
  await initialize();
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    await db.runAsync(`DELETE FROM reviewed_assets WHERE id = ?;`, [id]);
    await db.runAsync(`DELETE FROM trashed_media WHERE id = ?;`, [id]);
  });
}

export async function keepAsset(id: string): Promise<void> {
  await initialize();
  await (await getDb()).runAsync(`INSERT OR REPLACE INTO reviewed_assets (id, action, reviewed_at) VALUES (?, ?, ?);`, [id, 'keep', new Date().toISOString()]);
}

export async function undoKeep(id: string): Promise<void> {
  await initialize();
  await (await getDb()).runAsync(`DELETE FROM reviewed_assets WHERE id = ?;`, [id]);
}

export async function getReviewedAssetIds(): Promise<Set<string>> {
  await initialize();
  const rows = await (await getDb()).getAllAsync<{ id: string }>(`SELECT id FROM reviewed_assets;`);
  return new Set(rows.map(r => r.id));
}

export async function getTrashedAssets(): Promise<TrashedAsset[]> {
  await initialize();
  const rows = await (await getDb()).getAllAsync<TrashedMediaRow>(`SELECT * FROM trashed_media ORDER BY deleted_at DESC;`);
  return rows.map(r => ({
    id: r.id, fileName: r.file_name, fileType: r.file_type, fileSize: r.file_size,
    dateCreated: r.date_created, source: r.source, uri: r.uri,
    duration: r.duration || undefined, thumbnailColor: r.thumbnail_color || undefined,
    deletedAt: r.deleted_at, expiresAt: r.expires_at,
  }));
}

export async function getTrashStats(): Promise<{ count: number; totalSize: number }> {
  await initialize();
  const result = await (await getDb()).getFirstAsync<{ count: number; totalSize: number | null }>(
    `SELECT COUNT(*) as count, SUM(file_size) as totalSize FROM trashed_media;`
  );
  if (!result) return { count: 0, totalSize: 0 };
  return { count: result.count, totalSize: result.totalSize || 0 };
}

async function removeTrashRecord(id: string): Promise<void> {
  await initialize();
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    await db.runAsync(`DELETE FROM reviewed_assets WHERE id = ?;`, [id]);
    await db.runAsync(`DELETE FROM trashed_media WHERE id = ?;`, [id]);
  });
}

async function findAssetForTrashItem(item: TrashedMediaRow): Promise<MediaLibrary.Asset | null> {
  try {
    return await MediaLibrary.getAssetInfoAsync(item.id);
  } catch {
    // The MediaLibrary ID can become stale on Android while the file remains.
  }

  let after: string | undefined;
  try {
    for (let page = 0; page < 100; page += 1) {
      const result = await MediaLibrary.getAssetsAsync({
        first: 100,
        after,
        mediaType: [
          MediaLibrary.MediaType.photo,
          MediaLibrary.MediaType.video,
          MediaLibrary.MediaType.audio,
        ],
        sortBy: [MediaLibrary.SortBy.creationTime],
      });
      const match = result.assets.find(asset => asset.uri === item.uri)
        ?? result.assets.find(asset => asset.filename === item.file_name);
      if (match) return match;
      if (!result.hasNextPage || !result.endCursor) break;
      after = result.endCursor;
    }
  } catch (error) {
    console.error(`[TrashService] Failed to resolve asset ${item.id} from MediaLibrary:`, error);
  }
  return null;
}

async function isPhysicalMediaPresent(item: TrashedMediaRow): Promise<boolean | null> {
  if (!item.uri.startsWith('file://')) return null;
  try {
    const asset = await findAssetForTrashItem(item);
    if (asset) return true;
    return false;
  } catch {
    return null;
  }
}

async function purgeStaleTrashRecords(): Promise<number> {
  const db = await getDb();
  const rows = await db.getAllAsync<TrashedMediaRow>(`SELECT * FROM trashed_media ORDER BY deleted_at DESC;`);
  let removed = 0;
  for (const row of rows) {
    const present = await isPhysicalMediaPresent(row);
    if (present === false) {
      await removeTrashRecord(row.id);
      removed += 1;
      console.log(`[TrashService] Removed stale Trash record for missing asset ${row.file_name} (${row.id}).`);
    }
  }
  return removed;
}

export async function permanentlyDeleteAsset(id: string): Promise<void> {
  await initialize();
  const db = await getDb();
  const item = await db.getFirstAsync<TrashedMediaRow>(`SELECT * FROM trashed_media WHERE id = ?;`, [id]);
  if (!item) throw new Error('Trash record no longer exists.');

  // SAF files were explicitly authorized by the user through the platform file picker.
  // Never fall through to MediaLibrary for these items: doing so could remove the
  // local Trash record without deleting the actual document.
  if (item.id.startsWith('saf:')) {
    try {
      const deleted = await deleteUserFile(item.uri);
      if (deleted) {
        await removeTrashRecord(id);
        return;
      }
      throw new Error('The selected file provider did not authorize deletion of this file.');
    } catch (error) {
      console.error(`[TrashService] SAF deletion failed for ${item.file_name}:`, error);
      throw error instanceof Error ? error : new Error('Could not delete this user-authorized file.');
    }
  }

  try {
    console.log(`[TrashService] Requesting native MediaStore deletion for ${item.file_name}: ${item.uri}`);
    const nativeDeleted = await deleteMediaByPath(item.uri);
    console.log(`[TrashService] Native MediaStore deletion result: ${nativeDeleted}`);
    if (nativeDeleted) {
      await removeTrashRecord(id);
      return;
    }
  } catch (error) {
    console.error('[TrashService] Native MediaStore deletion failed:', error);
  }

  const asset = await findAssetForTrashItem(item);
  if (!asset) {
    await removeTrashRecord(id);
    console.warn(`[TrashService] Asset ${id} was already missing; removing stale Trash record.`);
    return;
  }

  try {
    const deleted = await MediaLibrary.deleteAssetsAsync([asset.id]);
    console.log(`[TrashService] MediaLibrary deletion result for ${asset.id}: ${deleted}`);
    if (!deleted) throw new Error('Android reported that the media file was not deleted.');
  } catch (error) {
    console.error(`[TrashService] MediaLibrary deletion failed for ${asset.id}:`, error);
    throw new Error('Android did not authorize or complete deletion of this media file.');
  }

  const verificationDelays = [100, 250, 500, 1000, 1500, 2500];
  for (const delay of verificationDelays) {
    await new Promise(resolve => setTimeout(resolve, delay));
    try {
      await MediaLibrary.getAssetInfoAsync(asset.id);
    } catch {
      await removeTrashRecord(id);
      return;
    }
  }

  throw new Error('Android reported deletion, but the media library still contains the asset.');
}

export async function cleanupExpiredTrash(): Promise<number> {
  await initialize();
  const db = await getDb();
  const rows = await db.getAllAsync<{ id: string }>(`SELECT id FROM trashed_media WHERE expires_at IS NOT NULL AND expires_at <= ? ORDER BY expires_at ASC;`, [new Date().toISOString()]);
  let cleaned = 0;
  for (const row of rows) {
    try {
      await permanentlyDeleteAsset(row.id);
      cleaned += 1;
    } catch (error) {
      console.error(`[TrashService] Failed to permanently delete expired asset ${row.id}:`, error);
    }
  }
  return cleaned;
}
