import { Platform } from 'react-native';
import { requireNativeModule } from 'expo-modules-core';

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
  listFiles(category: FileAccessCategory, limit: number): UserFileAccessItem[];
  deleteFile(uri: string): Promise<boolean>;
};

function getNativeFileAccess(): NativeFileAccessModule | null {
  if (Platform.OS !== 'android') return null;
  try {
    return requireNativeModule<NativeFileAccessModule>('SwyftPixFileAccess');
  } catch (error) {
    console.warn('[FileAccess] Native file access module is unavailable:', error);
    return null;
  }
}

/** Platform-neutral entry point for user-authorized non-media file access. */
export function hasUserFileAccess(): boolean {
  return getNativeFileAccess()?.hasAccess() ?? false;
}

/** Opens the platform file/folder picker for a user-selected directory. */
export async function requestUserDirectoryAccess(): Promise<boolean> {
  return (await getNativeFileAccess()?.pickDirectory()) ?? false;
}

/** Opens the platform file picker for individual files when folder access is unavailable or unsuitable. */
export async function requestUserFileAccess(): Promise<boolean> {
  return (await getNativeFileAccess()?.pickFiles()) ?? false;
}

export function listUserFiles(category: FileAccessCategory, limit = 40): UserFileAccessItem[] {
  const nativeModule = getNativeFileAccess();
  if (!nativeModule) return [];
  try {
    return nativeModule.listFiles(category, limit);
  } catch (error) {
    console.warn('[FileAccess] User-authorized file discovery failed:', error);
    return [];
  }
}

export async function deleteUserFile(uri: string): Promise<boolean> {
  return (await getNativeFileAccess()?.deleteFile(uri)) ?? false;
}
