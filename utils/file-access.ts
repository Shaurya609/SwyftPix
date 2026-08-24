import { Platform } from 'react-native';
import { requireNativeModule } from 'expo-modules-core';
import { hasAllFilesAccess, requestAllFilesAccess } from '../modules/swyftpix-media-delete';

type FileAccessCategory = 'document' | 'archive' | 'apk' | 'other' | 'all';

export interface UserFileAccessItem {
  id: string;
  fileName: string;
  fileType: FileAccessCategory;
  mimeType: string;
  fileSize: number;
  dateModified: number;
  relativePath: string;
  uri: string;
  canDelete?: boolean;
}

type NativeFileAccessModule = {
  hasAccess(): boolean;
  pickDirectory(): Promise<boolean>;
  pickFiles(): Promise<boolean>;
  listFiles(category: FileAccessCategory, limit: number): Promise<UserFileAccessItem[]>;
  deleteFile(uri: string): Promise<boolean>;
};

function getNativeFileAccess(): NativeFileAccessModule | null {
  if (Platform.OS !== 'android') return null;
  try {
    return requireNativeModule<NativeFileAccessModule>('SwyftPixFileAccess');
  } catch (error) {
    console.warn('[FileAccess] Legacy SAF module is unavailable:', error);
    return null;
  }
}

/**
 * SwyftPix uses Android All Files Access as the primary storage-scanning
 * capability. This avoids forcing users to manually select Download,
 * Documents, WhatsApp and other folders one by one.
 */
export function hasUserFileAccess(): boolean {
  if (Platform.OS === 'android') return hasAllFilesAccess();
  return false;
}

/** Opens Android's All Files Access settings. SAF remains available in the native module as a fallback. */
export async function requestUserDirectoryAccess(): Promise<boolean> {
  if (Platform.OS === 'android') return requestAllFilesAccess();
  return false;
}

/** Compatibility entry point: broad storage access is preferred over individual file selection. */
export async function requestUserFileAccess(): Promise<boolean> {
  if (Platform.OS === 'android') return requestAllFilesAccess();
  return false;
}

/** Legacy SAF listing retained as a fallback; normal Android scanning uses listSharedFiles(). */
export async function listUserFiles(category: FileAccessCategory, limit = 40): Promise<UserFileAccessItem[]> {
  const nativeModule = getNativeFileAccess();
  if (!nativeModule) return [];
  try {
    if (!nativeModule.hasAccess()) return [];
    return await nativeModule.listFiles(category, limit);
  } catch (error) {
    console.warn('[FileAccess] Legacy user-authorized file discovery failed:', error);
    return [];
  }
}

export async function deleteUserFile(uri: string): Promise<boolean> {
  return (await getNativeFileAccess()?.deleteFile(uri)) ?? false;
}
