import { Platform } from 'react-native';
import { requireNativeModule } from 'expo-modules-core';

type NativeSharedFile = {
  id: string;
  fileName: string;
  fileType: 'photo' | 'video' | 'audio' | 'document' | 'archive' | 'apk' | 'other';
  mimeType: string;
  fileSize: number;
  dateModified: number;
  relativePath: string;
  uri: string;
};

type NativeMediaDeleteModule = {
  deleteMediaByPath(path: string): Promise<boolean>;
  hasAllFilesAccess(): boolean;
  requestAllFilesAccess(): boolean;
  listSharedFiles(category: 'photo' | 'video' | 'audio' | 'document' | 'archive' | 'apk' | 'other' | 'all', limit: number): NativeSharedFile[];
  renderPdfPage(uri: string, pageIndex: number, maxWidth: number): Promise<string | null>;
  getPdfPageCount(uri: string): Promise<number>;
  readTextFile(uri: string, maxChars: number): Promise<string | null>;
};

export function hasAllFilesAccess(): boolean {
  const nativeModule = getNativeMediaDelete();
  if (!nativeModule) return false;
  try {
    return nativeModule.hasAllFilesAccess();
  } catch (error) {
    console.warn('[SwyftPixMediaDelete] All Files Access check failed:', error);
    return false;
  }
}

export function requestAllFilesAccess(): boolean {
  const nativeModule = getNativeMediaDelete();
  if (!nativeModule) return false;
  try {
    return nativeModule.requestAllFilesAccess();
  } catch (error) {
    console.warn('[SwyftPixMediaDelete] Could not open All Files Access settings:', error);
    return false;
  }
}

export function listSharedFiles(
  category: 'photo' | 'video' | 'audio' | 'document' | 'archive' | 'apk' | 'apks' | 'other' | 'all',
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

export async function renderPdfPage(uri: string, pageIndex = 0, maxWidth = 1200): Promise<string | null> {
  const nativeModule = getNativeMediaDelete();
  if (!nativeModule) return null;
  try {
    return await nativeModule.renderPdfPage(uri, pageIndex, maxWidth);
  } catch (error) {
    console.warn('[SwyftPixMediaDelete] PDF page rendering failed:', error);
    return null;
  }
}

export async function getPdfPageCount(uri: string): Promise<number> {
  const nativeModule = getNativeMediaDelete();
  if (!nativeModule) return 0;
  try {
    return await nativeModule.getPdfPageCount(uri);
  } catch (error) {
    console.warn('[SwyftPixMediaDelete] PDF page count failed:', error);
    return 0;
  }
}

export async function readTextFile(uri: string, maxChars = 65536): Promise<string | null> {
  const nativeModule = getNativeMediaDelete();
  if (!nativeModule) return null;
  try {
    return await nativeModule.readTextFile(uri, Math.max(1024, Math.min(maxChars, 262144)));
  } catch (error) {
    console.warn('[SwyftPixMediaDelete] Text document read failed:', error);
    return null;
  }
}

function getNativeMediaDelete(): NativeMediaDeleteModule | null {
  if (Platform.OS !== 'android') return null;
  try {
    return requireNativeModule<NativeMediaDeleteModule>('SwyftPixMediaDelete');
  } catch (error) {
    console.warn('[SwyftPixMediaDelete] Native module is unavailable; using platform fallback.', error);
    return null;
  }
}

export async function deleteMediaByPath(path: string): Promise<boolean> {
  const nativeModule = getNativeMediaDelete();
  if (!nativeModule) return false;
  return nativeModule.deleteMediaByPath(path);
}
