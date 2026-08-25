import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, RefreshControl, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import { useFocusEffect } from '@react-navigation/native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { DocumentPreview } from '@/components/document-preview';
import { TrashPreviewModal } from '@/components/trash-preview-modal';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { formatFileSize } from '@/utils/formatters';
import {
  cleanupExpiredTrash,
  DEFAULT_RETENTION_DAYS,
  getRetentionDays,
  getTrashedAssets,
  getTrashStats,
  initialize,
  permanentlyDeleteAsset,
  RETENTION_OPTIONS,
  restoreAsset,
  RetentionDays,
  setRetentionDays,
} from '@/utils/trash-service';
import { TrashedAsset } from '@/types/media';

function retentionLabel(retention: RetentionDays): string {
  if (retention === 0) return 'Never';
  return `${retention} days`;
}

function isDocument(item: TrashedAsset): boolean {
  return item.category === 'document'
    || item.fileType === 'document'
    || item.fileType === 'pdf'
    || item.mimeType?.toLowerCase() === 'application/pdf';
}

export default function TrashScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const [items, setItems] = useState<TrashedAsset[]>([]);
  const [stats, setStats] = useState({ count: 0, totalSize: 0 });
  const [retentionDays, setRetentionDaysState] = useState<RetentionDays>(DEFAULT_RETENTION_DAYS);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [previewItem, setPreviewItem] = useState<TrashedAsset | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  const loadTrash = useCallback(async () => {
    try {
      await initialize();
      await cleanupExpiredTrash();
      const [trashedAssets, trashStats, currentRetention] = await Promise.all([
        getTrashedAssets(),
        getTrashStats(),
        getRetentionDays(),
      ]);
      setItems(trashedAssets);
      setStats(trashStats);
      setRetentionDaysState(currentRetention);
      setSelectedIds(previous => {
        const availableIds = new Set(trashedAssets.map(item => item.id));
        return new Set([...previous].filter(id => availableIds.has(id)));
      });
      setPreviewItem(previous => previous && trashedAssets.some(item => item.id === previous.id) ? previous : null);
    } catch (error) {
      console.error('[TrashScreen] Error loading Trash:', error);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadTrash();
    }, [loadTrash])
  );

  const handleRefresh = () => {
    setIsRefreshing(true);
    loadTrash();
  };

  const enterSelectionMode = (id: string) => {
    if (isProcessing) return;
    setIsSelectionMode(true);
    setSelectedIds(previous => {
      const next = new Set(previous);
      next.add(id);
      return next;
    });
  };

  const exitSelectionMode = () => {
    if (isProcessing) return;
    setSelectedIds(new Set());
    setIsSelectionMode(false);
  };

  const toggleSelection = (id: string) => {
    if (isProcessing) return;
    setSelectedIds(previous => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleItemPress = (item: TrashedAsset) => {
    if (isSelectionMode) {
      toggleSelection(item.id);
      return;
    }
    setPreviewItem(item);
  };

  const selectAll = () => {
    if (isProcessing) return;
    if (selectedIds.size === items.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(items.map(item => item.id)));
    }
  };

  const processSelected = async (action: 'restore' | 'delete') => {
    const ids = [...selectedIds];
    if (ids.length === 0 || isProcessing) return;

    setIsProcessing(true);
    try {
      for (const id of ids) {
        if (action === 'restore') await restoreAsset(id);
        else await permanentlyDeleteAsset(id);
      }
      setSelectedIds(new Set());
      setIsSelectionMode(false);
      await loadTrash();
    } catch (error) {
      console.error(`[TrashScreen] Error processing selected items (${action}):`, error);
      Alert.alert(
        action === 'restore' ? 'Restore failed' : 'Delete failed',
        action === 'restore'
          ? 'One or more selected items could not be restored.'
          : 'One or more selected items could not be permanently deleted.'
      );
      await loadTrash();
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRestoreSelected = () => {
    const count = selectedIds.size;
    if (!count) return;
    Alert.alert(
      count === 1 ? 'Restore item?' : `Restore ${count} items?`,
      count === 1
        ? 'The selected item will be returned to the review deck.'
        : 'The selected items will be returned to the review deck.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Restore', onPress: () => processSelected('restore') },
      ]
    );
  };

  const handleDeleteSelected = () => {
    const count = selectedIds.size;
    if (!count) return;
    Alert.alert(
      count === 1 ? 'Delete permanently?' : `Delete ${count} items permanently?`,
      count === 1
        ? 'The selected item will be permanently deleted from your device. This cannot be undone.'
        : 'The selected items will be permanently deleted from your device. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete Permanently', style: 'destructive', onPress: () => processSelected('delete') },
      ]
    );
  };

  const handleEmptyTrash = () => {
    if (items.length === 0 || isProcessing) return;
    Alert.alert(
      'Empty Trash?',
      `This will permanently delete all ${items.length} item${items.length === 1 ? '' : 's'} from your device. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Empty Trash',
          style: 'destructive',
          onPress: () => {
            setSelectedIds(new Set(items.map(item => item.id)));
            setIsSelectionMode(true);
            processSelected('delete');
          },
        },
      ]
    );
  };

  const handleRestorePreview = async (item: TrashedAsset) => {
    if (isProcessing) return;
    setIsProcessing(true);
    try {
      await restoreAsset(item.id);
      setPreviewItem(null);
      await loadTrash();
    } catch (error) {
      console.error('[TrashScreen] Error restoring preview item:', error);
      Alert.alert('Restore failed', 'The item could not be restored to the review deck.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDeletePreview = async (item: TrashedAsset) => {
    if (isProcessing) return;
    setIsProcessing(true);
    try {
      await permanentlyDeleteAsset(item.id);
      setPreviewItem(null);
      await loadTrash();
    } catch (error) {
      console.error('[TrashScreen] Error permanently deleting preview item:', error);
      Alert.alert('Delete failed', 'The item could not be permanently deleted.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRetentionChange = (nextRetention: RetentionDays) => {
    if (nextRetention === retentionDays) return;
    const description = nextRetention === 0
      ? 'All items currently in Trash will stop auto-deleting. New items will also be kept until you restore or permanently delete them.'
      : `All items in Trash will automatically delete after ${retentionLabel(nextRetention)}. This policy applies to items already in Trash and new items, using each item’s original Trash date.`;

    Alert.alert(
      'Change Trash retention?',
      description,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Save',
          onPress: async () => {
            try {
              await setRetentionDays(nextRetention);
              setRetentionDaysState(nextRetention);
              await loadTrash();
            } catch (error) {
              console.error('[TrashScreen] Error changing retention:', error);
              Alert.alert('Could not save', 'The Trash retention setting could not be changed.');
            }
          },
        },
      ]
    );
  };

  const renderItem = ({ item }: { item: TrashedAsset }) => {
    const selected = selectedIds.has(item.id);
    return (
      <TouchableOpacity
        onPress={() => handleItemPress(item)}
        onLongPress={() => enterSelectionMode(item.id)}
        delayLongPress={450}
        activeOpacity={0.8}
        disabled={isProcessing}
        style={styles.gridItem}
      >
        <View style={[styles.thumbnailWrap, isDark && styles.thumbnailWrapDark, selected && styles.thumbnailWrapSelected]}>
          {isDocument(item) ? (
            <DocumentPreview item={item} thumbnail />
          ) : item.fileType === 'audio' ? (
            <View style={styles.genericThumbnail}>
              <View style={styles.genericIconCircle}><MaterialIcons name="audiotrack" size={38} color="#FFFFFF" /></View>
              <ThemedText style={styles.genericThumbnailLabel}>AUDIO</ThemedText>
            </View>
          ) : (
            <Image source={{ uri: item.uri }} style={styles.thumbnail} contentFit="cover" />
          )}
          {item.fileType === 'video' && (
            <View style={styles.videoBadge}>
              <MaterialIcons name="play-arrow" size={14} color="#FFFFFF" />
            </View>
          )}
          {isSelectionMode && (
            <View style={[styles.selectionBadge, selected && styles.selectionBadgeSelected]}>
              {selected && <MaterialIcons name="check" size={16} color="#FFFFFF" />}
            </View>
          )}
        </View>
        <ThemedText numberOfLines={1} style={styles.fileName}>{item.fileName}</ThemedText>
        <ThemedText lightColor="#687076" darkColor="#9BA1A6" style={styles.meta}>
          {formatFileSize(item.fileSize)}
        </ThemedText>
      </TouchableOpacity>
    );
  };

  const selectedCount = selectedIds.size;
  const allSelected = items.length > 0 && selectedCount === items.length;

  return (
    <ThemedView style={styles.screen}>
      <View style={styles.header}>
        {isSelectionMode ? (
          <TouchableOpacity onPress={exitSelectionMode} disabled={isProcessing} style={styles.headerAction}>
            <MaterialIcons name="close" size={22} color="#0a7ea4" />
            <ThemedText style={styles.headerActionText}>Cancel</ThemedText>
          </TouchableOpacity>
        ) : (
          <View style={styles.headerTitleWrap}>
            <ThemedText type="title" style={styles.title}>Trash</ThemedText>
            <ThemedText lightColor="#687076" darkColor="#9BA1A6" style={styles.subtitle}>
              Tap an item to preview. Long-press to select.
            </ThemedText>
          </View>
        )}

        {isSelectionMode ? (
          <View style={styles.selectionHeaderActions}>
            <TouchableOpacity onPress={selectAll} disabled={isProcessing || items.length === 0} style={styles.headerAction}>
              <MaterialIcons name={allSelected ? 'deselect' : 'select-all'} size={21} color="#0a7ea4" />
              <ThemedText style={styles.headerActionText}>{allSelected ? 'Clear' : 'All'}</ThemedText>
            </TouchableOpacity>
            <View style={styles.selectedBadge}>
              <ThemedText style={styles.selectedBadgeText}>{selectedCount}</ThemedText>
            </View>
          </View>
        ) : (
          <View style={styles.headerActions}>
            <View style={styles.countBadge}>
              <ThemedText style={styles.countText}>{stats.count}</ThemedText>
            </View>
          </View>
        )}
      </View>

      <View style={[styles.summary, isDark && styles.summaryDark]}>
        <View>
          <ThemedText lightColor="#687076" darkColor="#9BA1A6" style={styles.summaryLabel}>Trash size</ThemedText>
          <ThemedText style={styles.summaryValue}>{formatFileSize(stats.totalSize)}</ThemedText>
        </View>
        <View style={styles.summaryActions}>
          {items.length > 0 && !isSelectionMode && (
            <TouchableOpacity onPress={handleEmptyTrash} style={styles.emptyTrashButton} activeOpacity={0.8}>
              <MaterialIcons name="delete-sweep" size={18} color="#FF3B30" />
              <ThemedText style={styles.emptyTrashText}>Empty</ThemedText>
            </TouchableOpacity>
          )}
          <MaterialIcons name="delete-outline" size={34} color="#FF3B30" />
        </View>
      </View>

      <View style={[styles.retentionCard, isDark && styles.retentionCardDark]}>
        <View style={styles.retentionHeader}>
          <View style={styles.retentionTitleRow}>
            <MaterialIcons name="schedule" size={20} color="#0a7ea4" />
            <ThemedText style={styles.retentionTitle}>Automatic deletion</ThemedText>
          </View>
          <ThemedText lightColor="#687076" darkColor="#9BA1A6" style={styles.retentionCurrent}>
            {retentionLabel(retentionDays)}
          </ThemedText>
        </View>
        <ThemedText lightColor="#687076" darkColor="#9BA1A6" style={styles.retentionDescription}>
          Applies to all items in Trash. Changing this setting updates the policy for existing and new items.
        </ThemedText>
        <View style={styles.retentionOptions}>
          {RETENTION_OPTIONS.map(option => {
            const selected = option === retentionDays;
            return (
              <TouchableOpacity
                key={option}
                onPress={() => handleRetentionChange(option)}
                style={[styles.retentionOption, selected && styles.retentionOptionSelected]}
                activeOpacity={0.8}
                disabled={isProcessing || isSelectionMode}
              >
                <ThemedText
                  lightColor="#1C1C1E"
                  darkColor="#1C1C1E"
                  style={[styles.retentionOptionText, selected && styles.retentionOptionTextSelected]}
                >
                  {retentionLabel(option)}
                </ThemedText>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {isLoading ? (
        <View style={styles.center}><ActivityIndicator size="large" color="#0a7ea4" /></View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={item => item.id}
          renderItem={renderItem}
          numColumns={2}
          columnWrapperStyle={styles.columnWrapper}
          contentContainerStyle={items.length === 0 ? styles.emptyList : styles.list}
          refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />}
          ListEmptyComponent={
            <View style={styles.center}>
              <MaterialIcons name="delete-sweep" size={58} color={isDark ? '#636366' : '#AEAEB2'} />
              <ThemedText style={styles.emptyTitle}>Trash is empty</ThemedText>
              <ThemedText lightColor="#687076" darkColor="#9BA1A6" style={styles.emptyText}>
                Items you swipe left will appear here.
              </ThemedText>
            </View>
          }
        />
      )}

      {isSelectionMode && selectedCount > 0 && (
        <View style={[styles.actionBar, isDark && styles.actionBarDark]}>
          <TouchableOpacity onPress={handleRestoreSelected} disabled={isProcessing} style={styles.actionButton} activeOpacity={0.8}>
            <MaterialIcons name="restore" size={20} color="#0a7ea4" />
            <ThemedText style={styles.restoreActionText}>Restore</ThemedText>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleDeleteSelected} disabled={isProcessing} style={styles.actionButton} activeOpacity={0.8}>
            <MaterialIcons name="delete-forever" size={20} color="#FF3B30" />
            <ThemedText style={styles.deleteActionText}>Delete</ThemedText>
          </TouchableOpacity>
        </View>
      )}

      <TrashPreviewModal
        item={previewItem}
        visible={previewItem !== null}
        onClose={() => setPreviewItem(null)}
        onRestore={handleRestorePreview}
        onDelete={handleDeletePreview}
        isProcessing={isProcessing}
      />

      {isProcessing && !previewItem && (
        <View style={styles.processingOverlay}>
          <View style={[styles.processingCard, isDark && styles.processingCardDark]}>
            <ActivityIndicator size="small" color="#0a7ea4" />
            <ThemedText style={styles.processingText}>Updating Trash…</ThemedText>
          </View>
        </View>
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingTop: 56 },
  header: { paddingHorizontal: 20, paddingBottom: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerTitleWrap: { flex: 1 },
  title: { fontSize: 28, fontWeight: '800' },
  subtitle: { fontSize: 12, marginTop: 4 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  selectionHeaderActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerAction: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 7, paddingHorizontal: 4 },
  headerActionText: { color: '#0a7ea4', fontSize: 13, fontWeight: '700' },
  countBadge: { minWidth: 40, height: 40, paddingHorizontal: 10, borderRadius: 20, backgroundColor: 'rgba(255, 59, 48, 0.12)', alignItems: 'center', justifyContent: 'center' },
  countText: { color: '#FF3B30', fontWeight: '800', fontSize: 16 },
  selectedBadge: { minWidth: 34, height: 34, paddingHorizontal: 8, borderRadius: 17, backgroundColor: 'rgba(10, 126, 164, 0.12)', alignItems: 'center', justifyContent: 'center' },
  selectedBadgeText: { color: '#0a7ea4', fontWeight: '800', fontSize: 14 },
  summary: { marginHorizontal: 20, marginBottom: 12, padding: 16, borderRadius: 16, backgroundColor: '#F2F2F7', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  summaryDark: { backgroundColor: '#1C1C1E' },
  summaryLabel: { fontSize: 12, fontWeight: '500' },
  summaryValue: { fontSize: 20, fontWeight: '800', marginTop: 2 },
  summaryActions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  emptyTrashButton: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 9, paddingVertical: 7, borderRadius: 9, backgroundColor: 'rgba(255, 59, 48, 0.10)' },
  emptyTrashText: { color: '#FF3B30', fontSize: 11, fontWeight: '700' },
  retentionCard: { marginHorizontal: 20, marginBottom: 12, padding: 14, borderRadius: 16, backgroundColor: '#F2F2F7' },
  retentionCardDark: { backgroundColor: '#1C1C1E' },
  retentionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  retentionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  retentionTitle: { fontSize: 14, fontWeight: '700' },
  retentionCurrent: { fontSize: 12, fontWeight: '700' },
  retentionDescription: { fontSize: 11, marginTop: 5, marginBottom: 10 },
  retentionOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  retentionOption: { paddingHorizontal: 11, paddingVertical: 8, borderRadius: 10, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: 'rgba(128, 128, 128, 0.15)' },
  retentionOptionSelected: { backgroundColor: '#0a7ea4', borderColor: '#0a7ea4' },
  retentionOptionText: { fontSize: 11, fontWeight: '600' },
  retentionOptionTextSelected: { color: '#FFFFFF' },
  list: { paddingHorizontal: 16, paddingBottom: 110 },
  columnWrapper: { justifyContent: 'space-between', paddingHorizontal: 4 },
  emptyList: { flexGrow: 1, paddingHorizontal: 20 },
  gridItem: { width: '48%', marginBottom: 14 },
  thumbnailWrap: { height: 170, borderRadius: 16, overflow: 'hidden', backgroundColor: '#E5E5EA', borderWidth: 2, borderColor: 'transparent' },
  thumbnailWrapDark: { backgroundColor: '#2C2C2E' },
  thumbnailWrapSelected: { borderColor: '#0a7ea4' },
  thumbnail: { width: '100%', height: '100%' },
  genericThumbnail: { flex: 1, width: '100%', alignItems: 'center', justifyContent: 'center', backgroundColor: '#202124' },
  genericIconCircle: { width: 82, height: 82, borderRadius: 41, backgroundColor: '#6C5CE7', alignItems: 'center', justifyContent: 'center' },
  genericThumbnailLabel: { color: '#FFFFFF', fontSize: 12, fontWeight: '800', letterSpacing: 1.5, marginTop: 9 },
  videoBadge: { position: 'absolute', left: 9, bottom: 9, width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.65)', alignItems: 'center', justifyContent: 'center' },
  selectionBadge: { position: 'absolute', top: 9, right: 9, width: 26, height: 26, borderRadius: 13, backgroundColor: 'rgba(0,0,0,0.35)', borderWidth: 2, borderColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  selectionBadgeSelected: { backgroundColor: '#0a7ea4', borderColor: '#0a7ea4' },
  fileName: { fontSize: 12, fontWeight: '700', marginTop: 7 },
  meta: { fontSize: 10, marginTop: 3 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30 },
  emptyTitle: { fontSize: 19, fontWeight: '700', marginTop: 14 },
  emptyText: { fontSize: 13, textAlign: 'center', marginTop: 6 },
  actionBar: { position: 'absolute', left: 16, right: 16, bottom: 18, height: 62, borderRadius: 18, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: 'rgba(128, 128, 128, 0.18)', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 5 },
  actionBarDark: { backgroundColor: '#1C1C1E', borderColor: '#2C2C2E' },
  actionButton: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 20, paddingVertical: 10 },
  restoreActionText: { color: '#0a7ea4', fontWeight: '700', fontSize: 13 },
  deleteActionText: { color: '#FF3B30', fontWeight: '700', fontSize: 13 },
  processingOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.18)', alignItems: 'center', justifyContent: 'center' },
  processingCard: { paddingHorizontal: 18, paddingVertical: 14, borderRadius: 14, backgroundColor: '#FFFFFF', flexDirection: 'row', alignItems: 'center', gap: 10 },
  processingCardDark: { backgroundColor: '#1C1C1E' },
  processingText: { fontSize: 13, fontWeight: '600' },
});