import React, { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, ActivityIndicator, Alert, Platform } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';

import { MOCK_MEDIA_ITEMS } from '@/constants/mock-media';
import { StorageSummary } from '@/components/storage-summary';
import { MediaReviewCard, MediaReviewCardRef } from '@/components/media-review-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { formatFileSize } from '@/utils/formatters';
import { MockMediaItem } from '@/types/media';
import { checkAndRequestPermissions, fetchDeviceMediaPage } from '@/utils/device-media';
import { canManageMedia, requestMediaManagementAccess } from '@/modules/swyftpix-media-delete';
import { initialize, trashAsset, restoreAsset, keepAsset, undoKeep, getReviewedAssetIds, getTrashedAssets } from '@/utils/trash-service';

interface SwipeHistory { item: MockMediaItem; direction: 'left' | 'right'; }
type HomeCategory = 'photo' | 'video' | 'audio' | 'document' | 'archive' | 'apk' | 'other' | 'all';

const CATEGORIES: Array<{ id: HomeCategory; label: string; subtitle: string; icon: string }> = [
  { id: 'photo', label: 'Photos', subtitle: 'Images & screenshots', icon: 'photo-library' },
  { id: 'video', label: 'Videos', subtitle: 'Clips & recordings', icon: 'videocam' },
  { id: 'audio', label: 'Audio', subtitle: 'Music & recordings', icon: 'audiotrack' },
  { id: 'document', label: 'Documents', subtitle: 'PDFs, Office & text files', icon: 'description' },
  { id: 'archive', label: 'Archives', subtitle: 'ZIP, RAR & compressed files', icon: 'folder-zip' },
  { id: 'apk', label: 'APKs', subtitle: 'Android installers', icon: 'android' },
  { id: 'other', label: 'Other Files', subtitle: 'Other shared files', icon: 'insert-drive-file' },
  { id: 'all', label: 'All Media', subtitle: 'Everything SwyftPix can review', icon: 'collections' },
];

function matchesCategory(item: MockMediaItem, category: HomeCategory): boolean {
  if (category === 'all') return true;
  return item.category === category || item.fileType === category;
}

export default function HomeScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<MockMediaItem[]>([]);
  const [history, setHistory] = useState<SwipeHistory[]>([]);
  const [deletedItems, setDeletedItems] = useState<MockMediaItem[]>([]);
  const [keptItems, setKeptItems] = useState<MockMediaItem[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<HomeCategory | null>(null);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [hasMediaManagementAccess, setHasMediaManagementAccess] = useState<boolean | null>(null);
  const [endCursor, setEndCursor] = useState<string | undefined>(undefined);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [isLoadingDeviceMedia, setIsLoadingDeviceMedia] = useState(false);
  const firstPageCache = useRef(new Map<HomeCategory, Awaited<ReturnType<typeof fetchDeviceMediaPage>>>());

  const refreshMediaManagementAccess = useCallback(() => {
    if (Platform.OS !== 'android' || Platform.Version < 31) { setHasMediaManagementAccess(true); return true; }
    const granted = canManageMedia();
    setHasMediaManagementAccess(granted);
    return granted;
  }, []);

  const requestMediaManagementSetup = useCallback(() => {
    if (Platform.OS !== 'android' || Platform.Version < 31) return true;
    if (canManageMedia()) { setHasMediaManagementAccess(true); return true; }
    Alert.alert('Allow media management', 'SwyftPix needs one-time Android media-management access so it can permanently delete items from Trash without asking you for permission every time.', [
      { text: 'Not now', style: 'cancel', onPress: () => setHasMediaManagementAccess(false) },
      { text: 'Open Settings', onPress: () => { const opened = requestMediaManagementAccess(); if (!opened) setHasMediaManagementAccess(false); } },
    ]);
    return false;
  }, []);

  const filterItems = useCallback((source: MockMediaItem[], category: HomeCategory | null, reviewedIds: Set<string>) => {
    if (!category) return [];
    return source.filter(item => matchesCategory(item, category) && !reviewedIds.has(item.id));
  }, []);

  const loadFirstPage = useCallback(async (category: HomeCategory) => {
    setIsLoadingDeviceMedia(true);
    try {
      const reviewedIds = await getReviewedAssetIds();
      if (!hasPermission) {
        setItems(filterItems(MOCK_MEDIA_ITEMS, category, reviewedIds));
        setEndCursor(undefined); setHasNextPage(false); return;
      }
      const cached = firstPageCache.current.get(category);
      const result = cached ?? await fetchDeviceMediaPage(40, undefined, category);
      if (!cached) firstPageCache.current.set(category, result);
      setItems(filterItems(result.items, category, reviewedIds));
      setEndCursor(result.endCursor); setHasNextPage(result.hasNextPage);
    } catch (err) {
      console.error('[HomeScreen] Error loading category:', err);
      setItems([]);
    } finally { setIsLoadingDeviceMedia(false); }
  }, [filterItems, hasPermission]);

  useEffect(() => {
    async function init() {
      try {
        await initialize();
        setDeletedItems(await getTrashedAssets());
        const granted = await checkAndRequestPermissions();
        setHasPermission(granted);
        if (!granted) setHasMediaManagementAccess(true); else refreshMediaManagementAccess();
      } catch (err) {
        console.error('[HomeScreen] Error initializing persistent review state:', err);
        const granted = await checkAndRequestPermissions();
        setHasPermission(granted);
        if (granted) refreshMediaManagementAccess(); else setHasMediaManagementAccess(true);
      }
    }
    init();
  }, [refreshMediaManagementAccess]);

  useFocusEffect(useCallback(() => {
    if (hasPermission === null) return;
    let cancelled = false;
    async function refreshAfterFocus() {
      try {
        const managementGranted = refreshMediaManagementAccess();
        if (!managementGranted && hasPermission) { setItems([]); return; }
        await initialize();
        const persistedTrash = await getTrashedAssets();
        if (cancelled) return;
        setDeletedItems(persistedTrash);
        if (selectedCategory) await loadFirstPage(selectedCategory);
      } catch (err) {
        if (!cancelled) console.error('[HomeScreen] Error refreshing on focus:', err);
      }
    }
    refreshAfterFocus();
    return () => { cancelled = true; };
  }, [hasPermission, refreshMediaManagementAccess, selectedCategory, loadFirstPage]));

  const handleSelectCategory = useCallback(async (category: HomeCategory) => {
    setSelectedCategory(category); setHistory([]); setKeptItems([]); setItems([]); await loadFirstPage(category);
  }, [loadFirstPage]);

  const handleChangeCategory = useCallback(() => {
    setSelectedCategory(null); setItems([]); setHistory([]); setKeptItems([]); setEndCursor(undefined); setHasNextPage(false);
  }, []);

  useEffect(() => {
    if (!selectedCategory || !hasPermission || !hasNextPage || isLoadingDeviceMedia || items.length > 5) return;
    const category = selectedCategory;
    async function loadMore() {
      setIsLoadingDeviceMedia(true);
      try {
        const reviewedIds = await getReviewedAssetIds();
        const result = await fetchDeviceMediaPage(20, endCursor, category);
        setItems(prev => {
          const existingIds = new Set(prev.map(i => i.id));
          return [...prev, ...result.items.filter(item => !existingIds.has(item.id) && !reviewedIds.has(item.id))];
        });
        setEndCursor(result.endCursor); setHasNextPage(result.hasNextPage);
      } catch (err) { console.error('[HomeScreen] Error loading more device media:', err); }
      finally { setIsLoadingDeviceMedia(false); }
    }
    loadMore();
  }, [items.length, hasPermission, hasNextPage, isLoadingDeviceMedia, endCursor, selectedCategory]);

  const cardRef = useRef<MediaReviewCardRef>(null);
  const reviewableSize = useMemo(() => items.reduce((sum, item) => sum + item.fileSize, 0), [items]);
  const reviewableCount = items.length;
  const spaceSaved = useMemo(() => deletedItems.reduce((sum, item) => sum + item.fileSize, 0), [deletedItems]);

  const handleSwipeLeft = async (item: MockMediaItem) => {
    if (items.length === 0 || items[0].id !== item.id) return;
    try {
      await trashAsset(item); setHistory(h => h.some(e => e.item.id === item.id) ? h : [...h, { item, direction: 'left' }]);
      setDeletedItems(d => d.some(i => i.id === item.id) ? d : [...d, item]); setItems(prev => prev.length && prev[0].id === item.id ? prev.slice(1) : prev);
    } catch (err) { console.error('[HomeScreen] Error persisting trash action:', err); }
  };

  const handleSwipeRight = async (item: MockMediaItem) => {
    if (items.length === 0 || items[0].id !== item.id) return;
    try {
      await keepAsset(item.id); setHistory(h => h.some(e => e.item.id === item.id) ? h : [...h, { item, direction: 'right' }]);
      setKeptItems(k => k.some(i => i.id === item.id) ? k : [...k, item]); setItems(prev => prev.length && prev[0].id === item.id ? prev.slice(1) : prev);
    } catch (err) { console.error('[HomeScreen] Error persisting keep action:', err); }
  };

  const handleUndo = async () => {
    if (!history.length) return;
    const lastSwipe = history[history.length - 1];
    try {
      if (lastSwipe.direction === 'left') await restoreAsset(lastSwipe.item.id); else await undoKeep(lastSwipe.item.id);
      setHistory(h => h.slice(0, -1)); setDeletedItems(d => d.filter(i => i.id !== lastSwipe.item.id)); setKeptItems(k => k.filter(i => i.id !== lastSwipe.item.id));
      setItems(prev => prev.some(i => i.id === lastSwipe.item.id) ? prev : [lastSwipe.item, ...prev]);
    } catch (err) { console.error('[HomeScreen] Error persisting undo action:', err); }
  };

  const handleReset = async () => { setHistory([]); setKeptItems([]); if (selectedCategory) await loadFirstPage(selectedCategory); };

  const categorySelection = (
    <View style={styles.categoryContainer}>
      <ThemedText style={styles.categoryHeading} type="title">What do you want to clean?</ThemedText>
      <ThemedText style={styles.categorySubheading} lightColor="#687076" darkColor="#9BA1A6">Choose a file type to start swiping.</ThemedText>
      <View style={styles.categoryGrid}>
        {CATEGORIES.map(category => (
          <TouchableOpacity key={category.id} style={[styles.categoryCard, isDark ? styles.categoryCardDark : styles.categoryCardLight]} onPress={() => handleSelectCategory(category.id)} activeOpacity={0.85}>
            <View style={styles.categoryIcon}><MaterialIcons name={category.icon as any} size={34} color="#0a7ea4" /></View>
            <ThemedText style={styles.categoryLabel} type="defaultSemiBold">{category.label}</ThemedText>
            <ThemedText style={styles.categorySubtitle} lightColor="#687076" darkColor="#9BA1A6">{category.subtitle}</ThemedText>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );

  return (
    <GestureHandlerRootView style={styles.container}>
      <ThemedView style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom || 16 }]}>
        <View style={styles.header}>
          <View style={styles.headerLeft}><MaterialIcons name="auto-awesome" size={24} color="#0a7ea4" /><ThemedText style={styles.headerTitle} type="title">SwyftPix</ThemedText></View>
          <ThemedText style={styles.headerSubtitle} lightColor="#687076" darkColor="#9BA1A6">Clean up your storage</ThemedText>
        </View>
        <StorageSummary reviewableSize={reviewableSize} reviewableCount={reviewableCount} cleanedSize={spaceSaved} />
        {selectedCategory === null ? categorySelection : (
          <>
            <View style={styles.modeHeader}>
              <TouchableOpacity onPress={handleChangeCategory} style={styles.modeBackButton} activeOpacity={0.8}><MaterialIcons name="arrow-back" size={22} color="#0a7ea4" /></TouchableOpacity>
              <View style={styles.modeTitleContainer}>
                <ThemedText style={styles.modeTitle} type="defaultSemiBold">{CATEGORIES.find(c => c.id === selectedCategory)?.label}</ThemedText>
                <ThemedText style={styles.modeSubtitle} lightColor="#687076" darkColor="#9BA1A6">Swipe to keep or trash</ThemedText>
              </View>
            </View>
            <View style={styles.cardContainer}>
              {hasPermission && hasMediaManagementAccess === false ? (
                <View style={styles.emptyContainer}>
                  <View style={[styles.emptyCard, isDark ? styles.emptyCardDark : styles.emptyCardLight]}>
                    <View style={styles.emptyIconContainer}><MaterialIcons name="security" size={44} color="#0a7ea4" /></View>
                    <ThemedText style={styles.emptyTitle}>Finish Setup</ThemedText>
                    <ThemedText style={styles.emptyDescription} lightColor="#687076" darkColor="#9BA1A6">Give SwyftPix one-time media-management access. This prevents Android from showing another permission prompt every time you permanently delete an item.</ThemedText>
                    <TouchableOpacity style={styles.resetButton} onPress={requestMediaManagementSetup} activeOpacity={0.8}><ThemedText style={styles.resetButtonText}>Open Android Settings</ThemedText></TouchableOpacity>
                  </View>
                </View>
              ) : isLoadingDeviceMedia && items.length === 0 ? (
                <ActivityIndicator size="large" color="#0a7ea4" />
              ) : items.length > 0 ? (
                <MediaReviewCard ref={cardRef} items={items.slice(0, 2)} onSwipeLeft={handleSwipeLeft} onSwipeRight={handleSwipeRight} onUndo={handleUndo} onReset={handleReset} isDark={isDark} />
              ) : (
                <View style={styles.emptyContainer}>
                  <View style={[styles.emptyCard, isDark ? styles.emptyCardDark : styles.emptyCardLight]}>
                    <View style={styles.emptyIconContainer}><MaterialIcons name="check-circle" size={44} color="#0a7ea4" /></View>
                    <ThemedText style={styles.emptyTitle}>You're all caught up</ThemedText>
                    <ThemedText style={styles.emptyDescription} lightColor="#687076" darkColor="#9BA1A6">No more {CATEGORIES.find(c => c.id === selectedCategory)?.label.toLowerCase()} need review.</ThemedText>
                    <TouchableOpacity style={styles.resetButton} onPress={handleChangeCategory} activeOpacity={0.8}><ThemedText style={styles.resetButtonText}>Choose Another Category</ThemedText></TouchableOpacity>
                  </View>
                </View>
              )}
            </View>
          </>
        )}
      </ThemedView>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  screen: { flex: 1, paddingHorizontal: 16 },
  header: { paddingTop: 8, paddingBottom: 10 },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerTitle: { fontSize: 28 },
  headerSubtitle: { fontSize: 13, marginTop: 2 },
  categoryContainer: { flex: 1, justifyContent: 'center' },
  categoryHeading: { fontSize: 25, textAlign: 'center', marginBottom: 6 },
  categorySubheading: { fontSize: 14, textAlign: 'center', marginBottom: 20 },
  categoryGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 12 },
  categoryCard: { width: '48%', minHeight: 128, borderRadius: 18, padding: 14, justifyContent: 'center', alignItems: 'center', borderWidth: 1 },
  categoryCardLight: { backgroundColor: '#fff', borderColor: '#e5e7eb' },
  categoryCardDark: { backgroundColor: '#151718', borderColor: '#2b2f31' },
  categoryIcon: { width: 58, height: 58, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginBottom: 8, backgroundColor: 'rgba(10,126,164,0.10)' },
  categoryLabel: { fontSize: 16 },
  categorySubtitle: { fontSize: 11, textAlign: 'center', marginTop: 3 },
  modeHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  modeBackButton: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(10,126,164,0.10)', marginRight: 10 },
  modeTitleContainer: { flex: 1 },
  modeTitle: { fontSize: 19 },
  modeSubtitle: { fontSize: 12, marginTop: 2 },
  cardContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyContainer: { width: '100%', alignItems: 'center' },
  emptyCard: { width: '100%', maxWidth: 420, borderRadius: 20, padding: 24, alignItems: 'center', borderWidth: 1 },
  emptyCardLight: { backgroundColor: '#fff', borderColor: '#e5e7eb' },
  emptyCardDark: { backgroundColor: '#151718', borderColor: '#2b2f31' },
  emptyIconContainer: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(10,126,164,0.10)', marginBottom: 14 },
  emptyTitle: { fontSize: 20, marginBottom: 6 },
  emptyDescription: { fontSize: 13, textAlign: 'center', lineHeight: 19, marginBottom: 18 },
  resetButton: { paddingHorizontal: 18, paddingVertical: 11, borderRadius: 12, backgroundColor: '#0a7ea4' },
  resetButtonText: { color: '#fff', fontSize: 13, fontWeight: '600' },
});
