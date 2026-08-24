import React from 'react';
import { Alert, Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { MockMediaItem } from '../types/media';
import { formatFileSize, formatDate } from '../utils/formatters';

interface DocumentPreviewProps { item: MockMediaItem; }

export function DocumentPreview({ item }: DocumentPreviewProps) {
  const isPdf = item.fileType === 'pdf' || item.fileName.toLowerCase().endsWith('.pdf');

  const openDocument = async () => {
    try {
      const supported = await Linking.canOpenURL(item.uri);
      if (!supported) {
        Alert.alert('No compatible viewer', 'There is no app available on this device to open this document.');
        return;
      }
      await Linking.openURL(item.uri);
    } catch (error) {
      console.error('[DocumentPreview] Unable to open document:', error);
      Alert.alert('Unable to open document', 'SwyftPix could not hand this document to a compatible viewer.');
    }
  };

  return (
    <View style={styles.container}>
      <View style={[styles.iconCircle, isPdf ? styles.pdfCircle : styles.documentCircle]}>
        <MaterialIcons name={isPdf ? 'picture-as-pdf' : 'description'} size={68} color="#FFFFFF" />
      </View>
      <Text style={styles.typeLabel}>{isPdf ? 'PDF DOCUMENT' : 'DOCUMENT'}</Text>
      <Text style={styles.fileName} numberOfLines={3}>{item.fileName}</Text>
      <View style={styles.metaRow}>
        <Text style={styles.meta}>{formatFileSize(item.fileSize)}</Text>
        <View style={styles.dot} />
        <Text style={styles.meta}>{formatDate(item.dateCreated)}</Text>
      </View>
      <TouchableOpacity style={styles.openButton} onPress={openDocument} activeOpacity={0.82} accessibilityRole="button" accessibilityLabel="Open document">
        <MaterialIcons name="open-in-new" size={20} color="#FFFFFF" />
        <Text style={styles.openButtonText}>Open Document</Text>
      </TouchableOpacity>
      <Text style={styles.safeNote}>Opened with your device's compatible document viewer. SwyftPix does not execute document contents.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, width: '100%', alignItems: 'center', justifyContent: 'center', padding: 28, backgroundColor: '#101010' },
  iconCircle: { width: 150, height: 150, borderRadius: 75, justifyContent: 'center', alignItems: 'center', marginBottom: 22 },
  pdfCircle: { backgroundColor: '#FF3B30' },
  documentCircle: { backgroundColor: '#3478F6' },
  typeLabel: { color: '#FFFFFF', fontSize: 13, fontWeight: '800', letterSpacing: 1.8, marginBottom: 12 },
  fileName: { color: '#FFFFFF', fontSize: 18, fontWeight: '700', textAlign: 'center', maxWidth: 340 },
  metaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 12 },
  meta: { color: '#B0B0B0', fontSize: 13 },
  dot: { width: 4, height: 4, borderRadius: 2, backgroundColor: '#777777', marginHorizontal: 9 },
  openButton: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#0A7EA4', paddingHorizontal: 20, paddingVertical: 13, borderRadius: 15, marginTop: 26 },
  openButtonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  safeNote: { color: '#777777', fontSize: 11, lineHeight: 17, textAlign: 'center', maxWidth: 320, marginTop: 16 },
});