import { Platform } from 'react-native';
import { requireNativeModule } from 'expo-modules-core';

type PptxPreviewNativeModule = {
  renderPptxHtml(uri: string): Promise<string | null>;
  lockLandscape(): boolean;
  lockPortrait(): boolean;
};

function nativeModule(): PptxPreviewNativeModule | null {
  if (Platform.OS !== 'android') return null;
  try { return requireNativeModule<PptxPreviewNativeModule>('SwyftPixPptxPreview'); } catch { return null; }
}

export async function renderPptxHtml(uri: string): Promise<string | null> {
  try {
    const native = nativeModule();
    if (!native) return null;
    return await native.renderPptxHtml(uri);
  } catch (error) {
    console.warn('[SwyftPixPptxPreview] PPTX visual rendering failed:', error);
    return null;
  }
}

export function lockPptxLandscape() { nativeModule()?.lockLandscape(); }
export function lockPortrait() { nativeModule()?.lockPortrait(); }
