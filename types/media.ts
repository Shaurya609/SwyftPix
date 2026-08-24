export type MediaType =
  | 'photo'
  | 'video'
  | 'audio'
  | 'pdf'
  | 'document'
  | 'archive'
  | 'apk'
  | 'screenshot'
  | 'whatsapp'
  | 'other';

export type MediaCategory =
  | 'photo'
  | 'video'
  | 'audio'
  | 'document'
  | 'archive'
  | 'apk'
  | 'other';

/**
 * Normalized asset shape used by the SwyftPix review/trash pipeline.
 * Providers can populate this shape regardless of where the file was discovered.
 */
export interface SwyftPixAsset {
  id: string;
  fileName: string;
  fileType: MediaType;
  category: MediaCategory;
  fileSize: number; // in bytes
  dateCreated: string; // ISO date format
  source: 'Camera' | 'Screenshots' | 'WhatsApp' | 'Downloads' | 'Documents' | 'Videos' | 'Music' | 'Archives' | 'APKs' | 'Other';
  uri: string;
  mimeType?: string;
  duration?: string; // e.g. "0:15" for videos/audio
  thumbnailColor?: string; // backup solid or gradient color representation
}

/**
 * Backwards-compatible name used throughout the existing review/trash code.
 * New media providers should produce SwyftPixAsset-shaped objects.
 */
export type MockMediaItem = SwyftPixAsset;

export type SwipeAction = 'keep' | 'trash';

export interface ReviewedAssetRef {
  id: string;
  action: SwipeAction;
  reviewedAt: string; // ISO timestamp when reviewed
}

export interface TrashedAsset extends MockMediaItem {
  deletedAt: string; // ISO timestamp when swiped left / trashed
  expiresAt: string | null; // Global retention policy expiration
}

export interface StorageCategory {
  name: string;
  size: number; // in bytes
  color: string;
}

export interface StorageStats {
  totalStorage: number; // in bytes (e.g. 128 GB)
  usedStorage: number; // in bytes (e.g. 75.2 GB)
  reviewableStorage: number; // in bytes (calculated dynamically based on pending items)
  categories: StorageCategory[];
}
