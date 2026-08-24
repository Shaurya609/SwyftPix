import * as MediaLibrary from 'expo-media-library';
import { File } from 'expo-file-system';
import { MockMediaItem, MediaType } from '../types/media';
import { listSharedFiles } from '../modules/swyftpix-media-delete';
import { listUserFiles } from './file-access';

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

/**
 * Centralized source classification for every media provider.
 * Safety filtering happens natively before shared files reach this function.
 * WhatsApp is intentionally checked before generic folder/category rules so
 * WhatsApp documents, archives and APKs retain their real source label.
 */
export function determineSource({
  fileName = '',
  uri = '',
  albumTitle = '',
  relativePath = '',
  mediaType,
  category,
}: {
  fileName?: string;
  uri?: string;
  albumTitle?: string;
  relativePath?: string;
  mediaType?: MediaLibrary.MediaTypeValue;
  category?: string;
}): MockMediaItem['source'] {
  const filename = fileName.toLowerCase();
  const path = `${relativePath} ${uri}`.toLowerCase();
  const album = albumTitle.toLowerCase();
  const isVideo = mediaType === MediaLibrary.MediaType.video || category === 'video';
  const isAudio = mediaType === MediaLibrary.MediaType.audio || category === 'audio';

  const whatsappSignals = [filename, path, album];
  if (whatsappSignals.some(value => value.includes('whatsapp'))) return 'WhatsApp';

  if (album.includes('screenshot') || filename.includes('screenshot') || path.includes('screenshot')) return 'Screenshots';
  if (album.includes('download') || filename.includes('download') || path.includes('download')) return 'Downloads';
  if (album.includes('music') || album.includes('audio') || album.includes('podcast') || path.includes('/music/') || path.includes('/audio/')) return 'Music';
  if (album.includes('archive') || path.includes('/archive/')) return 'Archives';
  if (album.includes('apk') || path.includes('/apk/')) return 'APKs';
  if (album.includes('document') || path.includes('/document/') || category === 'document') return 'Documents';
  if (album.includes('camera') || album.includes('dcim') || album.includes('camera roll') || album.includes('recents') || path.includes('/dcim/camera/')) {
    return isVideo ? 'Videos' : 'Camera';
  }
  if (album.includes('video') || path.includes('/video/')) return 'Videos';
  if (category === 'archive') return 'Archives';
  if (category === 'apk') return 'APKs';
  if (isAudio) return 'Music';
  if (isVideo) return 'Videos';
  return 'Camera';
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

async function mapSharedFiles(category: DeviceMediaCategory): Promise<MockMediaItem[]> {
  const nativeCategory = nativeFileCategory(category);
  const [mediaStoreFiles, userFiles] = await Promise.all([
    Promise.resolve(listSharedFiles(nativeCategory, 40)),
    listUserFiles(nativeCategory, 80),
  ]);
  const nativeFiles = [...mediaStoreFiles, ...userFiles];
  const seen = new Set<string>();
  return nativeFiles.filter(file => {
    if (seen.has(file.uri)) return false;
    seen.add(file.uri);
    return true;
  }).map(file => ({
    id: file.id,
    fileName: file.fileName,
    fileType: file.fileType as MockMediaItem['fileType'],
    category: file.fileType as MockMediaItem['category'],
    fileSize: file.fileSize,
    dateCreated: new Date(file.dateModified > 0 ? file.dateModified * 1000 : Date.now()).toISOString(),
    source: determineSource({
      fileName: file.fileName,
      uri: file.uri,
      relativePath: file.relativePath,
      category: file.fileType,
    }),
    uri: file.uri,
    mimeType: file.mimeType,
    thumbnailColor: file.fileType === 'document' ? '#8ab4f8' : file.fileType === 'archive' ? '#f9c74f' : file.fileType === 'apk' ? '#81c784' : '#b0bec5',
  }));
}

export async function fetchDeviceMediaPage(limit: number, afterAssetId?: string, category: DeviceMediaCategory = 'all'): Promise<FetchPageResult> {
  try {
    const isFileCategory = category === 'document' || category === 'archive' || category === 'apk' || category === 'other';
    if (isFileCategory) return { items: (await mapSharedFiles(category)).slice(0, limit), endCursor: '', hasNextPage: false };

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
      const source = determineSource({
        fileName: asset.filename || '',
        uri: asset.uri,
        albumTitle,
        mediaType: asset.mediaType,
      });
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

    const sharedFiles = await mapSharedFiles('all');
    const items = [...mappedMedia, ...sharedFiles].sort((a, b) => new Date(b.dateCreated).getTime() - new Date(a.dateCreated).getTime()).slice(0, limit);
    return { items, endCursor: pagedAssets.endCursor, hasNextPage: pagedAssets.hasNextPage };
  } catch (error) {
    console.error('[DeviceMedia] Error fetching page:', error);
    return { items: [], endCursor: '', hasNextPage: false };
  }
}
