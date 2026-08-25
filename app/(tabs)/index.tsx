import React, { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, ActivityIndicator, Alert, Platform, ScrollView } from 'react-native';
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
import { MockMediaItem } from '@/types/media';
import { checkAndRequestPermissions, fetchDeviceMediaPage } from '@/utils/device-media';
import { hasUserFileAccess, requestUserDirectoryAccess } from '@/utils/file-access';
import { canManageMedia, requestMediaManagementAccess } from '@/modules/swyftpix-media-delete';
import { initialize, trashAsset, restoreAsset, keepAsset, undoKeep, getReviewedAssetIds, getTrashedAssets } from '@/utils/trash-service';

interface SwipeHistory { item: MockMediaItem; direction: 'left' | 'right'; }
type HomeCategory = 'photo' | 'video' | 'audio' | 'document' | 'archive' | 'apk' | 'all';

const CATEGORIES: Array<{ id: HomeCategory; label: string; subtitle: string; icon: string }> = [
  { id: 'photo', label: 'Photos', subtitle: 'Images & screenshots', icon: 'photo-library' },
  { id: 'video', label: 'Videos', subtitle: 'Clips & recordings', icon: 'videocam' },
  { id: 'audio', label: 'Audio', subtitle: 'Music & recordings', icon: 'audiotrack' },
  { id: 'document', label: 'Documents', subtitle: 'PDFs, Office & text files', icon: 'description' },
  { id: 'archive', label: 'Archives', subtitle: 'ZIP, RAR & compressed files', icon: 'folder-zip' },
  { id: 'apk', label: 'APKs', subtitle: 'Android installers', icon: 'android' },
  { id: 'all', label: 'All Media', subtitle: 'Everything SwyftPix can review', icon: 'collections' },
];

function matchesCategory(item: MockMediaItem, category: HomeCategory): boolean {
  if (category === 'all') return true;
  return item.category === category || item.fileType === category;
}

function isFileCategory(category: HomeCategory | null): boolean {
  return category === 'document' || category === 'archive' || category === 'apk';
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
  const [hasFileAccess, setHasFileAccess] = useState(false);
  const [hasMediaManagementAccess, setHasMediaManagementAccess] = useState<boolean | null>(null);
  const [endCursor, setEndCursor] = useState<string | undefined>(undefined);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [isLoadingDeviceMedia, setIsLoadingDeviceMedia] = useState(false);

  const refreshMediaManagementAccess = useCallback(() => {
    if (Platform.OS !== 'android' || Platform.Version < 31) { setHasMediaManagementAccess(true); return true; }
    const granted = canManageMedia();
    setHasMediaManagementAccess(granted);
    return granted;
  }, []);

  const refreshFileAccess = useCallback(() => {
    const granted = hasUserFileAccess();
    setHasFileAccess(granted);
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

  const requestFileAccessSetup = useCallback(() => {
    if (Platform.OS !== 'android') {
      Alert.alert('File cleanup unavailable', 'This platform-specific storage provider has not been implemented yet. Your supported media categories remain available.');
      return;
    }
    Alert.alert('Allow SwyftPix to manage storage?', 'SwyftPix needs broad shared-storage access to find documents, APKs and archives automatically. It will not scan Android system or app-private directories, and protected locations are excluded before files reach the review queue.', [
      { text: 'Not now', style: 'cancel' },
      { text: 'Open Android Settings', onPress: async () => { await requestUserDirectoryAccess(); } },
    ]);
  }, []);

  const filterItems = useCallback((source: MockMediaItem[], category: HomeCategory | null, reviewedIds: Set<string>) => {
    if (!category) return [];
    return source.filter(item => matchesCategory(item, category) && !reviewedIds.has(item.id));
  }, []);

  const loadFirstPage = useCallback(async (category: HomeCategory) => {
    setIsLoadingDeviceMedia(true);
    try {
      const reviewedIds = await getReviewedAssetIds();
      if (isFileCategory(category) && !hasFileAccess) { setItems([]); setEndCursor(undefined); setHasNextPage(false); return; }
      if (!hasPermission && !isFileCategory(category)) { setItems(filterItems(MOCK_MEDIA_ITEMS, category, reviewedIds)); setEndCursor(undefined); setHasNextPage(false); return; }

      const result = await fetchDeviceMediaPage(40, undefined, category);
      setItems(filterItems(result.items, category, reviewedIds));
      setEndCursor(result.endCursor); setHasNextPage(result.hasNextPage);
    } catch (err) { console.error('[HomeScreen] Error loading category:', err); setItems([]); }
    finally { setIsLoadingDeviceMedia(false); }
  }, [filterItems, hasPermission, hasFileAccess]);

  useEffect(() => {
    async function init() {
      try {
        await initialize();
        setDeletedItems(await getTrashedAssets());
        setHasFileAccess(hasUserFileAccess());
        const granted = await checkAndRequestPermissions();
        setHasPermission(granted);
        if (!granted) setHasMediaManagementAccess(true); else refreshMediaManagementAccess();
      } catch (err) {
        console.error('[HomeScreen] Error initializing persistent review state:', err);
        setHasFileAccess(hasUserFileAccess());
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
        const fileAccessGranted = refreshFileAccess();
        const managementGranted = refreshMediaManagementAccess();
        if (!managementGranted && hasPermission) { setItems([]); return; }
        await initialize();
        const persistedTrash = await getTrashedAssets();
        if (cancelled) return;
        setDeletedItems(persistedTrash);
        if (selectedCategory) await loadFirstPage(selectedCategory);
        if (!fileAccessGranted && selectedCategory && isFileCategory(selectedCategory)) {
          setItems([]);
          setEndCursor(undefined);
          setHasNextPage(false);
        }
      } catch (err) {
        if (!cancelled) console.error('[HomeScreen] Error refreshing on focus:', err);
      }
    }
    refreshAfterFocus();
    return () => { cancelled = true; };
  }, [hasPermission, refreshMediaManagementAccess, refreshFileAccess, selectedCategory, loadFirstPage]));

  const handleSelectCategory = useCallback(async (category: HomeCategory) => {
    setSelectedCategory(category); setHistory([]); setKeptItems([]); setItems([]); setEndCursor(undefined); setHasNextPage(false); await loadFirstPage(category);
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
    try { await trashAsset(item); setHistory(h => h.some(e => e.item.id === item.id) ? h : [...h, { item, direction: 'left' }]); setDeletedItems(d => d.some(i => i.id === item.id) ? d : [...d, item]); setItems(prev => prev.length && prev[0].id === item.id ? prev.slice(1) : prev); }
    catch (err) { console.error('[HomeScreen] Error persisting trash action:', err); }
  };

  const handleSwipeRight = async (item: MockMediaItem) => {
    if (items.length === 0 || items[0].id !== item.id) return;
    try { await keepAsset(item.id); setHistory(h => h.some(e => e.item.id === item.id) ? h : [...h, { item, direction: 'right' }]); setKeptItems(k => k.some(i => i.id === item.id) ? k : [...k, item]); setItems(prev => prev.length && prev[0].id === item.id ? prev.slice(1) : prev); }
    catch (err) { console.error('[HomeScreen] Error persisting keep action:', err); }
  };

  const handleUndo = async () => {
    if (!history.length) return;
    const lastSwipe = history[history.length - 1];
    try { if (lastSwipe.direction === 'left') await restoreAsset(lastSwipe.item.id); else await undoKeep(lastSwipe.item.id); setHistory(h => h.slice(0, -1)); setDeletedItems(d => d.filter(i => i.id !== lastSwipe.item.id)); setKeptItems(k => k.filter(i => i.id !== lastSwipe.item.id)); setItems(prev => prev.some(i => i.id === lastSwipe.item.id) ? prev : [lastSwipe.item, ...prev]); }
    catch (err) { console.error('[HomeScreen] Error persisting undo action:', err); }
  };

  const categorySelection = (
    <View style={styles.categoryContainer}>
      <ScrollView style={styles.categoryScroll} contentContainerStyle={styles.categoryScrollContent} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <ThemedText style={styles.categoryHeading} type="title">What do you want to clean?</ThemedText>
        <ThemedText style={styles.categorySubheading} lightColor="#687076" darkColor="#9BA1A6">Choose a file type to start swiping.</ThemedText>
        <View style={styles.categoryGrid}>{CATEGORIES.map(category => <TouchableOpacity key={category.id} style={[styles.categoryCard, isDark ? styles.categoryCardDark : styles.categoryCardLight]} onPress={() => handleSelectCategory(category.id)} activeOpacity={0.85}><View style={styles.categoryIcon}><MaterialIcons name={category.icon as any} size={34} color="#0a7ea4" /></View><ThemedText style={styles.categoryLabel} type="defaultSemiBold">{category.label}</ThemedText><ThemedText style={styles.categorySubtitle} lightColor="#687076" darkColor="#9BA1A6">{category.subtitle}</ThemedText></TouchableOpacity>)}</View>
      </ScrollView>
    </View>
  );

  const fileAccessCard = (
    <View style={styles.emptyContainer}><View style={[styles.emptyCard, isDark ? styles.emptyCardDark : styles.emptyCardLight]}><View style={styles.emptyIconContainer}><MaterialIcons name="folder-open" size={44} color="#0a7ea4" /></View><ThemedText style={styles.emptyTitle}>Enable storage access</ThemedText><ThemedText style={styles.emptyDescription} lightColor="#687076" darkColor="#9BA1A6">SwyftPix needs Android's All Files Access to automatically find documents, APKs and archives. Protected Android system and app-private locations are excluded from scanning.</ThemedText><TouchableOpacity style={styles.resetButton} onPress={requestFileAccessSetup} activeOpacity={0.8}><ThemedText style={styles.resetButtonText}>Allow Storage Access</ThemedText></TouchableOpacity></View></View>
  );

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemedView style={[styles.container, { paddingTop: insets.top + 8 }]}>
        <View style={styles.header}><View><ThemedText style={styles.headerTitle} type="title">SwyftPix</ThemedText><ThemedText style={styles.headerSubtitle} lightColor="#687076" darkColor="#9BA1A6">Clean up your storage</ThemedText></View></View>
        <StorageSummary reviewableSize={reviewableSize} reviewableCount={reviewableCount} cleanedSize={spaceSaved} />
        {selectedCategory === null ? categorySelection : (
          <>
            <View style={styles.modeHeader}><TouchableOpacity onPress={handleChangeCategory} style={styles.modeBackButton} activeOpacity={0.8}><MaterialIcons name="arrow-back" size={22} color="#0a7ea4" /></TouchableOpacity><View style={styles.modeTitleContainer}><ThemedText style={styles.modeTitle} type="defaultSemiBold">{CATEGORIES.find(c => c.id === selectedCategory)?.label}</ThemedText><ThemedText style={styles.modeSubtitle} lightColor="#687076" darkColor="#9BA1A6">Swipe to keep or trash</ThemedText></View></View>
            <View style={styles.cardContainer}>
              {hasPermission && hasMediaManagementAccess === false ? <View style={styles.emptyContainer}><View style={[styles.emptyCard, isDark ? styles.emptyCardDark : styles.emptyCardLight]}><View style={styles.emptyIconContainer}><MaterialIcons name="security" size={44} color="#0a7ea4" /></View><ThemedText style={styles.emptyTitle}>Finish Setup</ThemedText><ThemedText style={styles.emptyDescription} lightColor="#687076" darkColor="#9BA1A6">Give SwyftPix one-time media-management access. This prevents Android from showing another permission prompt every time you permanently delete an item.</ThemedText><TouchableOpacity style={styles.resetButton} onPress={requestMediaManagementSetup} activeOpacity={0.8}><ThemedText style={styles.resetButtonText}>Open Android Settings</ThemedText></TouchableOpacity></View></View> : isFileCategory(selectedCategory) && !hasFileAccess ? fileAccessCard : isLoadingDeviceMedia && items.length === 0 ? <ActivityIndicator size="large" color="#0a7ea4" /> : items.length > 0 ? <MediaReviewCard ref={cardRef} items={items.slice(0, 2)} onSwipeLeft={handleSwipeLeft} onSwipeRight={handleSwipeRight} onUndo={handleUndo} isDark={isDark} /> : <View style={styles.emptyContainer}><View style={[styles.emptyCard, isDark ? styles.emptyCardDark : styles.emptyCardLight]}><View style={styles.emptyIconContainer}><MaterialIcons name="check-circle" size={44} color="#0a7ea4" /></View><ThemedText style={styles.emptyTitle}>You're all caught up</ThemedText><ThemedText style={styles.emptyDescription} lightColor="#687076" darkColor="#9BA1A6">No more {CATEGORIES.find(c => c.id === selectedCategory)?.label.toLowerCase()} need review.</ThemedText><TouchableOpacity style={styles.resetButton} onPress={handleChangeCategory} activeOpacity={0.8}><ThemedText style={styles.resetButtonText}>Choose Another Category</ThemedText></TouchableOpacity></View></View>}
            </View>
          </>
        )}
      </ThemedView>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 16 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  headerTitle: { fontSize: 32, fontWeight: '800' }, headerSubtitle: { fontSize: 14, marginTop: 2 },
  categoryContainer: { flex: 1 }, categoryScroll: { flex: 1 }, categoryScrollContent: { paddingTop: 8, paddingBottom: 28 },
  categoryHeading: { fontSize: 25, fontWeight: '800', marginTop: 8 }, categorySubheading: { fontSize: 14, marginTop: 4, marginBottom: 18 },
  categoryGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 12 },
  categoryCard: { width: '48.5%', minHeight: 132, borderRadius: 20, padding: 16, justifyContent: 'center', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.1, shadowRadius: 5, elevation: 3 },
  categoryCardLight: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E5E5EA' }, categoryCardDark: { backgroundColor: '#1C1C1E', borderWidth: 1, borderColor: '#2C2C2E' },
  categoryIcon: { width: 54, height: 54, borderRadius: 16, backgroundColor: 'rgba(10,126,164,0.1)', justifyContent: 'center', alignItems: 'center', marginBottom: 10 },
  categoryLabel: { fontSize: 16 }, categorySubtitle: { fontSize: 11, marginTop: 3 },
  modeHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 }, modeBackButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(10,126,164,0.1)', justifyContent: 'center', alignItems: 'center', marginRight: 10 }, modeTitleContainer: { flex: 1 }, modeTitle: { fontSize: 20 }, modeSubtitle: { fontSize: 12, marginTop: 2 },
  cardContainer: { flex: 1, minHeight: 0 },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 18 }, emptyCard: { width: '100%', maxWidth: 420, borderRadius: 24, padding: 24, alignItems: 'center' }, emptyCardLight: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E5E5EA' }, emptyCardDark: { backgroundColor: '#1C1C1E', borderWidth: 1, borderColor: '#2C2C2E' }, emptyIconContainer: { width: 72, height: 72, borderRadius: 36, backgroundColor: 'rgba(10,126,164,0.1)', justifyContent: 'center', alignItems: 'center', marginBottom: 16 }, emptyTitle: { fontSize: 20, fontWeight: '800', textAlign: 'center' }, emptyDescription: { fontSize: 14, lineHeight: 21, textAlign: 'center', marginTop: 8 }, resetButton: { marginTop: 18, backgroundColor: '#0a7ea4', paddingHorizontal: 18, paddingVertical: 12, borderRadius: 14 }, resetButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
});