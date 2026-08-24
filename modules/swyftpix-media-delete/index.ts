import { Platform } from 'react-native';
import { requireNativeModule } from 'expo-modules-core';

type NativeSharedFile = {
  id: string;
  fileName: string;
  fileType: 'document' | 'archive' | 'apk' | 'other';
  mimeType: string;
  fileSize: number;
  dateModified: number;
  relativePath: string;
  uri: string;
};

type NativeMediaDeleteModule = {
  deleteMediaByPath(path: string): Promise<boolean>;
  canManageMedia(): boolean;
  requestMediaManagementAccess(): boolean;
  listSharedFiles(category: 'document' | 'archive' | 'apk' | 'other' | 'all', limit: number): NativeSharedFile[];
};

export function canManageMedia(): boolean {
  const nativeModule = getNativeMediaDelete();
  if (!nativeModule) return false;
  return nativeModule.canManageMedia();
}

export function requestMediaManagementAccess(): boolean {
  const nativeModule = getNativeMediaDelete();
  if (!nativeModule) return false;
  return nativeModule.requestMediaManagementAccess();
}

export function listSharedFiles(
  category: 'document' | 'archive' | 'apk' | 'apks' | 'other' | 'all',
  limit = 40
): NativeSharedFile[] {
  const nativeModule = getNativeMediaDelete();
  if (!nativeModule) return [];

  try {
    return nativeModule.listSharedFiles(category === 'apks' ? 'apk' : category, limit);
  } catch (error) {
    console.warn('[SwyftPixMediaDelete] Shared file discovery failed:', error);
    return [];
  }
}

function getNativeMediaDelete(): NativeMediaDeleteModule | null {
  if (Platform.OS !== 'android') return null;

  try {
    return requireNativeModule<NativeMediaDeleteModule>('SwyftPixMediaDelete');
  } catch (error) {
    console.warn('[SwyftPixMediaDelete] Native module is unavailable; using MediaLibrary fallback.', error);
    return null;
  }
}

export async function deleteMediaByPath(path: string): Promise<boolean> {
  const nativeModule = getNativeMediaDelete();
  if (!nativeModule) return false;
  return nativeModule.deleteMediaByPath(path);
}
