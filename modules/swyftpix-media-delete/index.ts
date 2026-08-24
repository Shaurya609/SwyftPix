import { Platform } from 'react-native';
import { requireNativeModule } from 'expo-modules-core';

type NativeMediaDeleteModule = {
  deleteMediaByPath(path: string): Promise<boolean>;
  canManageMedia(): boolean;
  requestMediaManagementAccess(): boolean;
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
/**
 * Load the native module lazily. This is important because Expo Go does not
 * contain SwyftPix's custom native module. Eagerly calling requireNativeModule
 * at import time prevents expo-router from loading any routes at all.
 */
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
