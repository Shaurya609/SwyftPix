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
type HomeCategory = 'all' | 'photo' | 'video' | 'audio';

const CATEGORIES: Array<{ id: HomeCategory; label: string; subtitle: string; icon: string }> = [
  { id: 'all', label: 'All Media', subtitle: 'Photos, videos & audio', icon: 'collections' },
  { id: 'photo', label: 'Photos', subtitle: 'Images & screenshots', icon: 'photo-library' },
  { id: 'video', label: 'Videos', subtitle: 'Clips & recordings', icon: 'videocam' },
  { id: 'audio', label: 'Audio', subtitle: 'Music & recordings', icon: 'audiotrack' },
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

  const refreshMediaManagementAccess = useCallback(() => {
    if (Platform.OS !== 'android' || Platform.Version < 31) {
      setHasMediaManagementAccess(true);
      return true;
    }
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
        setEndCursor(undefined);
        setHasNextPage(false);
        return;
      }
      const result = await fetchDeviceMediaPage(20);
      setItems(filterItems(result.items, category, reviewedIds));
      setEndCursor(result.endCursor);
      setHasNextPage(result.hasNextPage);
    } catch (err) {
      console.error('[HomeScreen] Error loading category:', err);
      setItems([]);
    } finally {
      setIsLoadingDeviceMedia(false);
    }
  }, [filterItems, hasPermission]);

  useEffect(() => {
    async function init() {
      try {
        await initialize();
        setDeletedItems(await getTrashedAssets());
        const granted = await checkAndRequestPermissions();
        setHasPermission(granted);
        if (!granted) setHasMediaManagementAccess(true);
        else refreshMediaManagementAccess();
      } catch (err) {
        console.error('[HomeScreen] Error initializing persistent review state:', err);
        const granted = await checkAndRequestPermissions();
        setHasPermission(granted);
        if (granted) refreshMediaManagementAccess();
        else setHasMediaManagementAccess(true);
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
    setSelectedCategory(category);
    setHistory([]);
    setKeptItems([]);
    setItems([]);
    await loadFirstPage(category);
  }, [loadFirstPage]);

  const handleChangeCategory = useCallback(() => {
    setSelectedCategory(null);
    setItems([]);
    setHistory([]);
    setKeptItems([]);
    setEndCursor(undefined);
    setHasNextPage(false);
  }, []);

  useEffect(() => {
    if (!selectedCategory || !hasPermission || !hasNextPage || isLoadingDeviceMedia || items.length > 5) return;
    const category = selectedCategory;
    async function loadMore() {
      setIsLoadingDeviceMedia(true);
      try {
        const reviewedIds = await getReviewedAssetIds();
        const result = await fetchDeviceMediaPage(20, endCursor);
        setItems(prev => {
          const existingIds = new Set(prev.map(i => i.id));
          return [...prev, ...result.items.filter(item => matchesCategory(item, category) && !existingIds.has(item.id) && !reviewedIds.has(item.id))];
        });
        setEndCursor(result.endCursor);
        setHasNextPage(result.hasNextPage);
      } catch (err) {
        console.error('[HomeScreen] Error loading more device media:', err);
      } finally { setIsLoadingDeviceMedia(false); }
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
      await trashAsset(item);
      setHistory(h => h.some(e => e.item.id === item.id) ? h : [...h, { item, direction: 'left' }]);
      setDeletedItems(d => d.some(i => i.id === item.id) ? d : [...d, item]);
      setItems(prev => prev.length && prev[0].id === item.id ? prev.slice(1) : prev);
    } catch (err) { console.error('[HomeScreen] Error persisting trash action:', err); }
  };

  const handleSwipeRight = async (item: MockMediaItem) => {
    if (items.length === 0 || items[0].id !== item.id) return;
    try {
      await keepAsset(item.id);
      setHistory(h => h.some(e => e.item.id === item.id) ? h : [...h, { item, direction: 'right' }]);
      setKeptItems(k => k.some(i => i.id === item.id) ? k : [...k, item]);
      setItems(prev => prev.length && prev[0].id === item.id ? prev.slice(1) : prev);
    } catch (err) { console.error('[HomeScreen] Error persisting keep action:', err); }
  };

  const handleUndo = async () => {
    if (!history.length) return;
    const lastSwipe = history[history.length - 1];
    try {
      if (lastSwipe.direction === 'left') await restoreAsset(lastSwipe.item.id);
      else await undoKeep(lastSwipe.item.id);
      setHistory(h => h.slice(0, -1));
      setDeletedItems(d => d.filter(i => i.id !== lastSwipe.item.id));
      setKeptItems(k => k.filter(i => i.id !== lastSwipe.item.id));
      setItems(prev => prev.some(i => i.id === lastSwipe.item.id) ? prev : [lastSwipe.item, ...prev]);
    } catch (err) { console.error('[HomeScreen] Error persisting undo action:', err); }
  };

  const handleReset = async () => {
    setHistory([]); setKeptItems([]);
    if (selectedCategory) await loadFirstPage(selectedCategory);
  };

  const categorySelection = (
    <View style={styles.categoryContainer}>
      <ThemedText style={styles.categoryHeading} type="title">What do you want to clean?</ThemedText>
      <ThemedText style={styles.categorySubheading} lightColor="#687076" darkColor="#9BA1A6">Choose a media type to start swiping.</ThemedText>
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
              <TouchableOpacity onPress={handleChangeCategory} style={styles.modeBackButton} activeOpacity={0.8}>
                <MaterialIcons name="arrow-back" size={22} color="#0a7ea4" />
              </TouchableOpacity>
              <View style={styles.modeTitleContainer}>
                <ThemedText style={styles.modeTitle} type="defaultSemiBold">{CATEGORIES.find(c => c.id === selectedCategory)?.label}</ThemedText>
                <ThemedText style={styles.modeSubtitle} lightColor="#687076" darkColor="#9BA1A6">Swipe to keep or trash</ThemedText>
              </View>
            </View>
            <View style={styles.cardContainer}>
              {hasPermission && hasMediaManagementAccess === false ? (
                <View style={styles.emptyContainer}><View style={[styles.emptyCard, isDark ? styles.emptyCardDark : styles.emptyCardLight]}><View style={styles.emptyIconContainer}><MaterialIcons name="security" size={44} color="#0a7ea4" /></View><ThemedText style={styles.emptyTitle}>Finish Setup</ThemedText><ThemedText style={styles.emptyDescription} lightColor="#687076" darkColor="#9BA1A6">Give SwyftPix one-time Android media-management access. This prevents Android from showing another permission prompt every time you permanently delete an item.</ThemedText><TouchableOpacity style={styles.resetButton} onPress={requestMediaManagementSetup} activeOpacity={0.8}><ThemedText style={styles.resetButtonText}>Open Android Settings</ThemedText></TouchableOpacity></View></View>
              ) : isLoadingDeviceMedia && items.length === 0 ? <ActivityIndicator size="large" color="#0a7ea4" /> : items.length > 0 ? (
                items.slice(0, 2).reverse().map((item, index) => {
                  const isTop = index === items.slice(0, 2).length - 1;
                  return <MediaReviewCard key={item.id} item={item} isTop={isTop} onSwipeLeft={() => handleSwipeLeft(item)} onSwipeRight={() => handleSwipeRight(item)} ref={isTop ? cardRef : null} />;
                })
              ) : (
                <View style={styles.emptyContainer}><View style={[styles.emptyCard, isDark ? styles.emptyCardDark : styles.emptyCardLight]}><View style={styles.emptyIconContainer}><MaterialIcons name="celebration" size={44} color="#34C759" /></View><ThemedText style={styles.emptyTitle}>All Caught Up!</ThemedText><ThemedText style={styles.emptyDescription} lightColor="#687076" darkColor="#9BA1A6">You've finished reviewing this category.</ThemedText><View style={styles.statsContainer}><View style={styles.statRow}><ThemedText style={styles.statLabel} lightColor="#687076" darkColor="#9BA1A6">Space Cleaned</ThemedText><ThemedText style={styles.statValue} lightColor="#34C759" darkColor="#30D158">{formatFileSize(spaceSaved)}</ThemedText></View><View style={styles.statRow}><ThemedText style={styles.statLabel} lightColor="#687076" darkColor="#9BA1A6">Files Deleted</ThemedText><ThemedText style={styles.statValue}>{deletedItems.length}</ThemedText></View><View style={styles.statRow}><ThemedText style={styles.statLabel} lightColor="#687076" darkColor="#9BA1A6">Files Kept</ThemedText><ThemedText style={styles.statValue}>{keptItems.length}</ThemedText></View></View><TouchableOpacity style={styles.resetButton} onPress={handleReset} activeOpacity={0.8}><MaterialIcons name="replay" size={20} color="#FFF" /><Text style={styles.resetButtonText}>Reset Category</Text></TouchableOpacity></View></View>
              )}
            </View>
            {items.length > 0 && <View style={styles.buttonsContainer}><TouchableOpacity onPress={handleUndo} disabled={!history.length} style={[styles.roundButton, isDark && styles.roundButtonDark, styles.undoButton, !history.length && styles.disabledButton]} activeOpacity={0.7}><MaterialIcons name="undo" size={22} color={!history.length ? (isDark ? '#48484A' : '#AEAEB2') : '#FF9500'} /></TouchableOpacity><TouchableOpacity onPress={() => cardRef.current?.swipeLeft()} style={[styles.roundButton, isDark && styles.roundButtonDark, styles.deleteButton]} activeOpacity={0.7}><MaterialIcons name="close" size={32} color="#FF3B30" /></TouchableOpacity><TouchableOpacity onPress={() => cardRef.current?.swipeRight()} style={[styles.roundButton, isDark && styles.roundButtonDark, styles.keepButton]} activeOpacity={0.7}><MaterialIcons name="check" size={32} color="#34C759" /></TouchableOpacity><TouchableOpacity onPress={handleChangeCategory} style={[styles.roundButton, isDark && styles.roundButtonDark, styles.categoryButton]} activeOpacity={0.7}><MaterialIcons name="category" size={22} color="#0a7ea4" /></TouchableOpacity></View>}
          </>
        )}
      </ThemedView>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 }, screen: { flex: 1 },
  header: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 4, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 }, headerTitle: { fontSize: 26, fontWeight: '800', letterSpacing: 0.2 }, headerSubtitle: { fontSize: 13, fontWeight: '500', marginTop: 4 },
  categoryContainer: { flex: 1, paddingHorizontal: 20, paddingTop: 18 }, categoryHeading: { fontSize: 28, fontWeight: '800', marginBottom: 6 }, categorySubheading: { fontSize: 14, marginBottom: 20 },
  categoryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 }, categoryCard: { width: '48%', borderRadius: 22, padding: 18, borderWidth: 1, borderColor: 'rgba(128,128,128,0.15)' }, categoryCardLight: { backgroundColor: '#FFFFFF' }, categoryCardDark: { backgroundColor: '#1C1C1E' }, categoryIcon: { width: 64, height: 64, borderRadius: 20, backgroundColor: 'rgba(10,126,164,0.1)', justifyContent: 'center', alignItems: 'center', marginBottom: 14 }, categoryLabel: { fontSize: 16, marginBottom: 4 }, categorySubtitle: { fontSize: 12, lineHeight: 17 },
  modeHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 2 }, modeBackButton: { width: 42, height: 42, borderRadius: 21, justifyContent: 'center', alignItems: 'center' }, modeTitleContainer: { marginLeft: 4 }, modeTitle: { fontSize: 17 }, modeSubtitle: { fontSize: 12, marginTop: 2 },
  cardContainer: { flex: 1, marginHorizontal: 16, marginVertical: 12, position: 'relative', justifyContent: 'center', alignItems: 'center' },
  buttonsContainer: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 14, paddingBottom: 12, paddingHorizontal: 16 },
  roundButton: { width: 56, height: 56, borderRadius: 28, justifyContent: 'center', alignItems: 'center', backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: 'rgba(128,128,128,0.15)', shadowColor: '#000000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.1, shadowRadius: 5, elevation: 3 },
  roundButtonDark: { backgroundColor: '#1C1C1E', borderColor: '#2C2C2E' }, undoButton: { width: 48, height: 48, borderRadius: 24 }, deleteButton: { width: 64, height: 64, borderRadius: 32, borderColor: 'rgba(255,59,48,0.2)' }, keepButton: { width: 64, height: 64, borderRadius: 32, borderColor: 'rgba(52,199,89,0.2)' }, categoryButton: { width: 48, height: 48, borderRadius: 24 }, disabledButton: { opacity: 0.4 },
  emptyContainer: { flex: 1, width: '100%', justifyContent: 'center', alignItems: 'center', padding: 8 }, emptyCard: { width: '100%', borderRadius: 24, padding: 24, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(128,128,128,0.15)', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.1, shadowRadius: 10, elevation: 4 }, emptyCardLight: { backgroundColor: '#FFFFFF', shadowColor: '#000000' }, emptyCardDark: { backgroundColor: '#1C1C1E', shadowColor: '#000000' },
  emptyIconContainer: { width: 72, height: 72, borderRadius: 36, backgroundColor: 'rgba(52,199,89,0.15)', justifyContent: 'center', alignItems: 'center', marginBottom: 16 }, emptyTitle: { fontSize: 20, fontWeight: '700', textAlign: 'center', marginBottom: 8 }, emptyDescription: { fontSize: 13, textAlign: 'center', lineHeight: 18, marginBottom: 20 },
  statsContainer: { width: '100%', gap: 12, marginBottom: 20 }, statRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: 'rgba(128,128,128,0.1)' }, statLabel: { fontSize: 13, fontWeight: '500' }, statValue: { fontSize: 14, fontWeight: '600' },
  resetButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12, backgroundColor: '#0a7ea4', gap: 8, shadowColor: '#0a7ea4', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 5, elevation: 3 }, resetButtonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
});