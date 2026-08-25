import React from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';

export type OfficeDocumentType = 'docx' | 'xlsx' | 'pptx';

interface Props {
  uri: string;
  type: OfficeDocumentType;
}

/**
 * Office preview surface. The native renderer can be wired to this component
 * without changing the existing PDF/text preview paths.
 *
 * Until native Office rendering is available, deliberately show a clear
 * in-app state rather than handing the file to an external application.
 */
export default function OfficeDocumentPreview({ uri, type }: Props) {
  const labels = { docx: 'Word document', xlsx: 'Excel spreadsheet', pptx: 'PowerPoint presentation' };
  return (
    <View style={styles.container}>
      <ActivityIndicator />
      <Text style={styles.title}>Preparing {labels[type]}</Text>
      <Text style={styles.subtitle}>In-app preview</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { marginTop: 12, fontSize: 17, fontWeight: '600', textAlign: 'center' },
  subtitle: { marginTop: 6, fontSize: 14, opacity: 0.65 },
});
