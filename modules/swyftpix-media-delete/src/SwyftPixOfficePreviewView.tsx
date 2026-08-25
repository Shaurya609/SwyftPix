import { requireNativeView } from 'expo';
import * as React from 'react';
import type { StyleProp, ViewStyle } from 'react-native';

type Props = {
  html: string;
  style?: StyleProp<ViewStyle>;
};

const NativeView: React.ComponentType<Props> = requireNativeView('SwyftPixOfficePreview');

export default function SwyftPixOfficePreviewView(props: Props) {
  return <NativeView {...props} />;
}
