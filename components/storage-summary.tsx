import React from 'react';
import { StyleSheet, View } from 'react-native';
import { ThemedText } from './themed-text';
import { ThemedView } from './themed-view';
import { formatFileSize } from '../utils/formatters';
import { useColorScheme } from '@/hooks/use-color-scheme';

interface StorageSummaryProps {
  reviewableSize: number;
  reviewableCount: number;
  cleanedSize: number;
}

export function StorageSummary({ reviewableSize, reviewableCount, cleanedSize }: StorageSummaryProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const TOTAL_CAPACITY = 128 * 1024 * 1024 * 1024;
  const SYSTEM_USED = 75.2 * 1024 * 1024 * 1024;
  const systemUsedPercent = (SYSTEM_USED / TOTAL_CAPACITY) * 100;
  const reviewablePercent = Math.max(1, (reviewableSize / TOTAL_CAPACITY) * 100);

  return (
    <ThemedView style={styles.container}>
      <View style={styles.headerRow}>
        <View style={styles.headerText}>
          <ThemedText type="defaultSemiBold" style={styles.title}>Device Storage</ThemedText>
          <ThemedText style={styles.subtitle} lightColor="#687076" darkColor="#9BA1A6">{formatFileSize(SYSTEM_USED)} of {formatFileSize(TOTAL_CAPACITY)} used</ThemedText>
        </View>
        <View style={styles.badgeContainer}><ThemedText style={styles.badgeLabel}>{reviewableCount} left</ThemedText></View>
      </View>
      <View style={[styles.progressBarContainer, isDark ? styles.barDark : styles.barLight]}>
        <View style={[styles.barSegment, styles.barUsed, { width: `${systemUsedPercent}%` }]} />
        <View style={[styles.barSegment, styles.barReview, { width: `${reviewablePercent}%` }]} />
      </View>
      <View style={styles.statsRow}>
        <View style={[styles.statBox, isDark ? styles.boxDark : styles.boxLight]}>
          <View style={styles.statLabelRow}><View style={styles.reviewIndicator} /><ThemedText type="defaultSemiBold" style={styles.statTitle}>To review</ThemedText></View>
          <ThemedText type="subtitle" style={styles.statAmount} lightColor="#0a7ea4" darkColor="#fff">{formatFileSize(reviewableSize)}</ThemedText>
        </View>
        <View style={[styles.statBox, isDark ? styles.boxDark : styles.boxLight]}>
          <View style={styles.statLabelRow}><View style={[styles.reviewIndicator, styles.cleanedIndicator]} /><ThemedText type="defaultSemiBold" style={styles.statTitle}>Cleaned</ThemedText></View>
          <ThemedText type="subtitle" style={[styles.statAmount, styles.cleanedAmount]}>{formatFileSize(cleanedSize)}</ThemedText>
        </View>
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 10, paddingVertical: 7, borderRadius: 14, marginHorizontal: 0, marginTop: 4, marginBottom: 3, borderWidth: 1, borderColor: 'rgba(128, 128, 128, 0.15)' },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 },
  headerText: { flex: 1 },
  title: { fontSize: 15 },
  subtitle: { fontSize: 11, marginTop: 1 },
  badgeContainer: { backgroundColor: 'rgba(10, 126, 164, 0.1)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  badgeLabel: { fontSize: 11, fontWeight: '600', color: '#0a7ea4' },
  progressBarContainer: { height: 5, borderRadius: 3, flexDirection: 'row', overflow: 'hidden', marginBottom: 5 },
  barLight: { backgroundColor: '#E5E5EA' },
  barDark: { backgroundColor: '#3A3A3C' },
  barSegment: { height: '100%' },
  barUsed: { backgroundColor: '#8E8E93' },
  barReview: { backgroundColor: '#FF9500', borderLeftWidth: 1, borderLeftColor: '#fff' },
  statsRow: { flexDirection: 'row', gap: 6 },
  statBox: { flex: 1, minHeight: 34, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 9, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  boxLight: { backgroundColor: '#F2F2F7' },
  boxDark: { backgroundColor: '#1C1C1E' },
  statLabelRow: { flexDirection: 'row', alignItems: 'center', flexShrink: 1 },
  reviewIndicator: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#FF9500', marginRight: 5 },
  cleanedIndicator: { backgroundColor: '#34C759' },
  statTitle: { fontSize: 10 },
  statAmount: { fontSize: 13, fontWeight: '700', marginTop: 0, marginLeft: 4 },
  cleanedAmount: { color: '#34C759' },
});