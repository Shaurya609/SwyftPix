import { requireNativeViewManager } from 'expo-modules-core';
import * as React from 'react';
import { StyleProp, ViewStyle } from 'react-native';

type Props = { html?: string | null; style?: StyleProp<ViewStyle> };

const NativeView = requireNativeViewManager<Props>('SwyftPixPptxPreview');

export default function SwyftPixPptxPreviewView({ html, style }: Props) {
  return <NativeView html={html ?? ''} style={style} />;
}
