import * as MediaLibrary from 'expo-media-library';
import { File } from 'expo-file-system';
import { MockMediaItem, MediaType } from '../types/media';
import { listSharedFiles } from '../modules/swyftpix-media-delete';

let albumCache: Map<string, string> | null = null;

export async function checkAndRequestPermissions(): Promise<boolean> {
  try {
    const { status, canAskAgain } = await MediaLibrary.getPermissionsAsync(false, ['photo', 'video', 'audio']);
    if (status === 'granted') return true;
    if (canAskAgain) {
      const { status: requestStatus } = await MediaLibrary.requestPermissionsAsync(false, ['photo', 'video', 'audio']);
      return requestStatus === 'granted';
    }
    return false;
  } catch (error) {
    console.error('[DeviceMedia] Error checking/requesting permissions:', error);
    return false;
  }
}

async function getAlbumMap(): Promise<Map<string, string>> {
  if (albumCache) return albumCache;
  const map = new Map<string, string>();
  try {
    const albums = await MediaLibrary.getAlbumsAsync({ includeSmartAlbums: true });
    for (const album of albums) if (album.id && album.title) map.set(album.id, album.title);
    albumCache = map;
  } catch (error) {
    console.error('[DeviceMedia] Error loading albums:', error);
  }
  return map;
}

function determineSource(asset: MediaLibrary.Asset, albumTitle?: string): MockMediaItem['source'] {
  const isVideo = asset.mediaType === 'video';
  const isAudio = asset.mediaType === 'audio';
  if (albumTitle) {
    const name = albumTitle.toLowerCase();
    if (name.includes('screenshot')) return 'Screenshots';
    if (name.includes('whatsapp')) return 'WhatsApp';
    if (name.includes('download')) return 'Downloads';
    if (name.includes('music') || name.includes('audio') || name.includes('podcast')) return 'Music';
    if (name.includes('archive')) return 'Archives';
    if (name.includes('apk')) return 'APKs';
    if (name.includes('camera') || name.includes('dcim') || name.includes('camera roll') || name.includes('recents')) return isVideo ? 'Videos' : 'Camera';
    if (name.includes('video')) return 'Videos';
  }
  const filename = (asset.filename || '').toLowerCase();
  const uri = (asset.uri || '').toLowerCase();
  if (filename.includes('screenshot') || uri.includes('screenshot')) return 'Screenshots';
  if (filename.includes('whatsapp') || uri.includes('whatsapp')) return 'WhatsApp';
  if (filename.includes('download') || uri.includes('download')) return 'Downloads';
  if (isAudio) return 'Music';
  return isVideo ? 'Videos' : 'Camera';
}

function formatDuration(seconds: number): string {
  if (!seconds || isNaN(seconds) || seconds <= 0) return '0:00';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const formattedSecs = secs < 10 ? `0${secs}` : `${secs}`;
  if (hrs > 0) return `${hrs}:${mins < 10 ? `0${mins}` : mins}:${formattedSecs}`;
  return `${mins}:${formattedSecs}`;
}

async function fetchAssetSize(fallbackUri?: string): Promise<number> {
  if (!fallbackUri) return 0;
  try {
    const file = new File(fallbackUri);
    const fileInfo = file.info();
    if (typeof fileInfo.size === 'number' && fileInfo.size > 0) return fileInfo.size;
  } catch {
    // Some MediaStore URIs may not expose file metadata through expo-file-system.
  }
  return 0;
}

export interface FetchPageResult {
  items: MockMediaItem[];
  endCursor: string;
  hasNextPage: boolean;
}

export type DeviceMediaCategory = 'photo' | 'video' | 'audio' | 'document' | 'archive' | 'apk' | 'other' | 'all';
type NativeFileCategory = 'document' | 'archive' | 'apk' | 'other' | 'all';

function nativeFileCategory(category: DeviceMediaCategory): NativeFileCategory {
  return category === 'document' || category === 'archive' || category === 'apk' || category === 'other' ? category : 'all';
}

function sourceForSharedFile(relativePath: string, category: string): MockMediaItem['source'] {
  const path = relativePath.toLowerCase();
  if (category === 'apk') return 'APKs';
  if (category === 'archive') return 'Archives';
  if (path.includes('/download')) return 'Downloads';
  if (path.includes('/document')) return 'Documents';
  if (path.includes('/music') || path.includes('/audio')) return 'Music';
  if (path.includes('/video')) return 'Videos';
  if (path.includes('/whatsapp')) return 'WhatsApp';
  return 'Other';
}

function mapSharedFiles(category: DeviceMediaCategory): MockMediaItem[] {
  return listSharedFiles(nativeFileCategory(category), 40).map(file => ({
    id: file.id,
    fileName: file.fileName,
    fileType: file.fileType as MockMediaItem['fileType'],
    category: file.fileType as MockMediaItem['category'],
    fileSize: file.fileSize,
    dateCreated: new Date(file.dateModified > 0 ? file.dateModified * 1000 : Date.now()).toISOString(),
    source: sourceForSharedFile(file.relativePath, file.fileType),
    uri: file.uri,
    mimeType: file.mimeType,
    thumbnailColor: file.fileType === 'document' ? '#8ab4f8' : file.fileType === 'archive' ? '#f9c74f' : file.fileType === 'apk' ? '#81c784' : '#b0bec5',
  }));
}

export async function fetchDeviceMediaPage(limit: number, afterAssetId?: string, category: DeviceMediaCategory = 'all'): Promise<FetchPageResult> {
  try {
    const isFileCategory = category === 'document' || category === 'archive' || category === 'apk' || category === 'other';
    if (isFileCategory) return { items: mapSharedFiles(category).slice(0, limit), endCursor: '', hasNextPage: false };

    const albumMap = await getAlbumMap();
    const mediaType = category === 'photo'
      ? [MediaLibrary.MediaType.photo]
      : category === 'video'
        ? [MediaLibrary.MediaType.video]
        : category === 'audio'
          ? [MediaLibrary.MediaType.audio]
          : [MediaLibrary.MediaType.photo, MediaLibrary.MediaType.video, MediaLibrary.MediaType.audio];

    const pagedAssets = await MediaLibrary.getAssetsAsync({ first: limit, after: afterAssetId, mediaType, sortBy: [MediaLibrary.SortBy.creationTime] });
    const mappedMedia: MockMediaItem[] = await Promise.all(pagedAssets.assets.map(async asset => {
      const finalSize = await fetchAssetSize(asset.uri);
      const dateCreatedStr = asset.creationTime ? new Date(asset.creationTime).toISOString() : new Date().toISOString();
      const albumTitle = asset.albumId ? albumMap.get(asset.albumId) : undefined;
      const source = determineSource(asset, albumTitle);
      const isVideo = asset.mediaType === 'video';
      const isAudio = asset.mediaType === 'audio';
      let fileType: MediaType;
      let itemCategory: MockMediaItem['category'];
      if (isVideo) { fileType = 'video'; itemCategory = 'video'; }
      else if (isAudio) { fileType = 'audio'; itemCategory = 'audio'; }
      else { fileType = source === 'Screenshots' ? 'screenshot' : source === 'WhatsApp' ? 'whatsapp' : 'photo'; itemCategory = 'photo'; }
      const item: MockMediaItem = { id: asset.id, fileName: asset.filename || `MEDIA_${asset.id}`, fileType, category: itemCategory, fileSize: finalSize, dateCreated: dateCreatedStr, source, uri: asset.uri, mimeType: isVideo ? 'video/*' : isAudio ? 'audio/*' : 'image/*' };
      if ((isVideo || isAudio) && asset.duration !== undefined) item.duration = formatDuration(asset.duration);
      item.thumbnailColor = isVideo ? '#a1c4fd' : isAudio ? '#b8a1ff' : '#ff9a9e';
      return item;
    }));

    if (category !== 'all') return { items: mappedMedia, endCursor: pagedAssets.endCursor, hasNextPage: pagedAssets.hasNextPage };

    const sharedFiles = mapSharedFiles('all');
    const items = [...mappedMedia, ...sharedFiles].sort((a, b) => new Date(b.dateCreated).getTime() - new Date(a.dateCreated).getTime()).slice(0, limit);
    return { items, endCursor: pagedAssets.endCursor, hasNextPage: pagedAssets.hasNextPage };
  } catch (error) {
    console.error('[DeviceMedia] Error fetching page:', error);
    return { items: [], endCursor: '', hasNextPage: false };
  }
}
