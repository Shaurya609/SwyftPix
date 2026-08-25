# SwyftPix — Persistent Project State

> **Purpose:** This document is the continuity/source-of-truth document for future development sessions. A new ChatGPT session should read this file before making changes. It captures the product idea, current architecture, implemented behavior, known issues, development history, testing workflow, and roadmap toward production readiness.

**Last updated:** 2026-08-25
**Active branch:** `phase-2d-retention`
**Current HEAD at time of writing:** `a912a49` (`feat: enable docx preview zoom`)

---

## 1. Product / App Idea

SwyftPix is a mobile media-management application focused on helping users review large collections of files efficiently.

The core review experience is:

1. Select a media/document category.
2. Open a review card for an item.
3. Preview the current item.
4. Choose **Keep** or **Trash**.
5. Move through the review queue without accidentally revisiting already-decided items.
6. Open **Trash** to inspect trashed items.
7. Preview trashed items.
8. Restore or permanently delete items, including single and multi-select permanent deletion.
9. Trash uses a configurable retention period and performs expiration cleanup.

The product should eventually be production-ready, reliable, fast, visually polished, and safe around destructive file operations.

---

## 2. Current Scope / Major Features

### Main review flow
- Category selection.
- Swipe/review card interaction.
- Keep / Trash actions.
- Action buttons positioned below the media card so they no longer overlap the card.
- Swipe snap behavior fixed.
- Review queue deduplication implemented.
- Stale preview state between card changes addressed.
- Review reset control/button removed by design.

### Preview support currently confirmed
- **Images:** preview works.
- **Video:** preview works.
- **PDF:** in-app preview works, including page navigation and pinch/zoom.
- **TXT:** preview works.
- **DOCX:** native visual thumbnail and native in-app preview now work after several iterations; pinch/zoom support has been added.
- **PPTX:** currently still uses the existing Office/text-oriented path; **native visual rendering is the next major task**.
- **XLSX:** existing preview works for many files but one known test file failed: `University_Health_LOA_Quick_Requirements_Tracker.xlsx`. Native visual XLSX rendering has not yet been completed.
- Other document types such as CSV may be detected/read depending on the current document pipeline, but have not been comprehensively validated on-device.

### Trash
- Trashed media is displayed.
- Trash automatically refreshes when the Trash screen gains focus, so newly trashed items appear without requiring pull-to-refresh.
- Pull-to-refresh still exists.
- Image/video/document thumbnails are shown where supported.
- Preview modal exists for Trash.
- Image, video, PDF and document previews are available in Trash.
- Review/preview behavior for images and video in Trash was explicitly requested and implemented.
- Single and multi-select permanent deletion has been tested.
- Restore/retention functionality exists through `utils/trash-service`.

### Document preview
`components/document-preview.tsx` is the central React document preview surface.

Current type detection includes:
- PDF
- TXT/CSV/LOG/JSON/XML/text MIME types
- DOCX
- XLSX
- PPTX

PDF uses native PDF page-count/page-render helpers.
DOCX uses native Office preview functionality to produce/render HTML through the native preview view.
XLSX/PPTX currently have a text/extracted-content fallback and are the next native-rendering targets.

---

## 3. Architecture

### Framework
- Expo SDK 54
- React Native 0.81.5
- React 19.1
- Expo Router
- TypeScript
- Android native modules under `modules/`

### Important dependencies
- `expo-dev-client`
- `expo-file-system`
- `expo-image`
- `expo-media-library`
- `expo-video`
- `expo-audio`
- `expo-asset`
- `react-native-gesture-handler`
- `react-native-reanimated`

`package.json` configures Expo native module autolinking through:

```json
"expo": {
  "autolinking": {
    "nativeModulesDir": "./modules"
  }
}
```

### Important application areas
- `app/` — Expo Router screens/routes.
- `components/` — reusable UI including review and preview components.
- `utils/` — file/trash services and helpers.
- `types/` — media/trash data types.
- `modules/swyftpix-media-delete/` — custom native Android module(s) for safe media operations and native document/PDF/Office preview support.

### Important files
- `components/media-review-card.tsx` — review card behavior and media presentation.
- `components/document-preview.tsx` — document thumbnail/full-preview logic.
- `components/trash-preview-modal.tsx` — Trash preview UI.
- `app/(tabs)/explore.tsx` — Trash screen and Trash lifecycle/refresh behavior.
- `utils/trash-service.ts` — Trash persistence, retention, restore and permanent-delete logic.
- `modules/swyftpix-media-delete/office-preview.ts` — Office document JS/native bridge helpers.
- `modules/swyftpix-media-delete/src/SwyftPixOfficePreviewView.tsx` — Expo native view wrapper for Office previews.
- Native Kotlin files under `modules/swyftpix-media-delete/android/src/main/java/expo/modules/swyftpixmedia/` — Android implementation.

---

## 4. Native Preview Architecture

### PDF
PDF rendering is native. The React preview requests page count and rendered page images. The rendered page is displayed in an animated image surface. Pinch/zoom and pan are handled with Gesture Handler/Reanimated.

Known history:
- Earlier PDF rendering had partial-page rendering and loading issues on some PDFs.
- A stale PDF thumbnail issue was fixed.
- PDF viewer loading state was fixed.
- Pinch/zoom was tested and is currently working.

### DOCX
DOCX now uses the native Office preview surface rather than the text-only fallback when rendering succeeds.

The flow is approximately:

`DocumentPreview` → `renderDocxHtml()` → native office preview module → `SwyftPixOfficePreviewView` → Android native view/WebView-based visual document surface.

A key bug was found where the native view existed but the full preview did not have reliable bounds. Explicit `flex`, width and height were added to the native preview surface. After that change, DOCX thumbnail and full preview finally worked.

### XLSX / PPTX
The code already detects both types and can read/extract Office content, but the current full preview is still fundamentally text-oriented for these types. The next goal is native visual rendering, analogous to DOCX, not simply better text extraction.

---

## 5. User-Validated End-to-End Flow

The following flow has been manually tested successfully:

**Select Category → Preview item → Keep & Trash → open Trash after adding new items → preview items in Trash → exit preview → single/multi permanent delete**

Trash also now refreshes automatically on screen focus.

Main and Trash preview support currently confirmed by the user:
- image
- video
- PDF
- TXT
- DOCX (native visual preview now working)

---

## 6. Known Issues / Open Work

### Immediate priority
1. **Native PPTX rendering**
   - Create a visual in-app presentation renderer.
   - Generate real slide thumbnails, ideally from slide 1.
   - Full preview should show slides visually rather than extracted text.
   - Support multi-slide navigation.
   - Preserve correct-file lifecycle when moving between review cards.
   - Support zoom where appropriate.
   - Make it work in Main Review and Trash Preview.

2. **Native XLSX rendering**
   - Build a visual spreadsheet renderer rather than text extraction.
   - Investigate the known failing file: `University_Health_LOA_Quick_Requirements_Tracker.xlsx`.
   - Support sheets/tabs if feasible.
   - Produce useful thumbnails.
   - Test both ordinary and complex workbooks.

3. **Document thumbnails for every supported document type**
   - DOCX thumbnail is working.
   - PDF thumbnail is working.
   - Ensure PPTX/XLSX get real visual thumbnails once native renderers exist.
   - Avoid generic icons when a visual preview is available.

### Reliability / correctness
4. Continue testing stale-preview prevention when rapidly switching files.
5. Ensure asynchronous document rendering is cancelled/invalidated when a card changes.
6. Ensure Trash state updates immediately after Keep/Trash operations and after restore/permanent deletion.
7. Test documents with unusual MIME types, file paths, Unicode names and large sizes.
8. Test malformed/corrupt documents gracefully without crashing the review flow.

### Production-readiness work after native document support
9. Comprehensive Android device testing across Android versions/devices.
10. Performance profiling for large media libraries and large Office/PDF files.
11. Memory management for rendering large documents and multiple previews.
12. Background/loading/error states for all preview types.
13. Permission handling and MediaStore edge cases.
14. Safe permanent deletion verification and failure recovery.
15. Trash retention/expiration edge-case testing.
16. Offline behavior and filesystem/content-URI reliability.
17. UI polish/accessibility and responsive layouts.
18. Automated tests for queue transitions, Trash state, preview lifecycle and native bridges.
19. Release configuration, signing, versioning and production build pipeline.
20. Crash/error logging and production diagnostics.
21. Final security/privacy review, especially around file access and destructive actions.
22. Documentation for architecture and native modules.

---

## 7. Important Bugs That Were Already Encountered and Fixed

These are valuable context for future development because they show failure modes that should not be reintroduced:

- Reanimated swipe crash.
- Swipe snap/movement behavior.
- Action buttons overlapping the media card.
- Unsupported files appearing in the wrong media category.
- Review reset control was removed.
- Duplicate review queue entries.
- Stale PDF thumbnail during card changes.
- PDF viewer loading state.
- Stale document preview showing the previously reviewed file.
- Previously reviewed/removed items reappearing after returning to a category.
- Native media URI helper functions were accidentally duplicated during development, causing Kotlin overload conflicts; duplicate helpers were removed and the Android build was restored.
- DOCX native preview surface lacked reliable dimensions; explicit native-view sizing fixed the full preview.
- Trash initially required manual pull-to-refresh after adding new items; `useFocusEffect` was added so Trash reloads automatically when focused.

---

## 8. Development / Git Workflow

The project is developed directly on GitHub branch:

`phase-2d-retention`

Typical workflow:

1. Changes are implemented and pushed to GitHub.
2. Local machine pulls the branch.
3. TypeScript check:

```bash
npx tsc --noEmit
```

4. Diff whitespace check:

```bash
git diff --check
```

5. Remove generated native module build output before checking status when necessary:

```bash
rm -rf modules/swyftpix-media-delete/android/build
```

6. Native Android build when native code/dependencies change:

```bash
cd android
./gradlew app:assembleDebug -x lint -x test
cd ..
```

7. Install/run development build when needed:

```bash
npx expo run:android
```

8. For JS/TS-only changes, an existing development build can generally be used with:

```bash
npx expo start --dev-client -c
```

### Important Git caution
The branch has previously diverged because another environment pushed commits. When the local branch is behind and has no local work, use:

```bash
git pull --ff-only origin phase-2d-retention
```

If local and remote histories genuinely diverge, inspect first and do not blindly force-push. A previous rebase/`--force-with-lease` was used to integrate a local commit after confirming the remote history.

### Generated build directory
`modules/swyftpix-media-delete/android/build/` is generated output and should **not** be committed.

---

## 9. Testing Philosophy

Do not assume a build succeeding means the feature works. The user is manually testing on a physical Android phone and has found several issues that compilation alone cannot detect.

For every new preview type, test at minimum:

### Thumbnail
- Appears in category list.
- Represents the correct file.
- Does not show the previous file's thumbnail.
- Handles loading and failure states.

### Full preview
- Opens the selected file, not the previous file.
- Correct content is visible.
- Large/multi-page files render correctly.
- Close/reopen works.
- Switching rapidly between files does not display stale content.
- Zoom/navigation works where supported.

### Review lifecycle
- Preview → Keep.
- Preview → Trash.
- Next card is correct.
- Reviewed item does not reappear.
- Returning to category does not resurrect decided items.

### Trash lifecycle
- New trash items appear without manual refresh after navigating back to Trash.
- Correct thumbnail.
- Correct preview.
- Exit preview safely.
- Restore works.
- Single permanent delete works.
- Multi-select permanent delete works.

---

## 10. Current Session Handoff

### Where we intentionally stopped
The user requested a break after beginning work on native PPTX rendering.

**Do not continue coding automatically just because this file was read.** First understand the current state and ask/confirm what the user wants if the next task is ambiguous.

### Last known user-confirmed state
- DOCX thumbnail: **working**.
- DOCX full native preview: **working**.
- PDF preview: **working**.
- Image preview: **working**.
- Video preview: **working**.
- TXT preview: **working**.
- Main review flow: **working in tested scenarios**.
- Trash preview flow: **working in tested scenarios**.
- Trash auto-refresh on focus: **working**.
- Pinch/zoom for PDF: **working**.
- User wants native visual PPTX rendering next.
- User also wants native visual XLSX rendering afterward.

### Current Git state
The branch was clean from tracked changes in the last local status, apart from generated/untracked:

`modules/swyftpix-media-delete/android/build/`

The current branch contains the native DOCX preview work and the initial Office/PPTX infrastructure.

---

## 11. Continuity Instructions for Future AI Sessions

Before making code changes:

1. Read this file completely.
2. Inspect the current branch and recent commits.
3. Check the actual current implementation rather than assuming this document is newer than code.
4. Treat user-confirmed behavior as higher confidence than assumptions.
5. If a feature is marked working, do not rewrite it unnecessarily while implementing a neighboring feature.
6. Preserve the existing review/Trash lifecycle and stale-preview protections.
7. For native features, distinguish JS/TS changes from native Android changes so the user knows whether a full development build is required.
8. Run TypeScript and Android compilation checks before asking the user to test.
9. Do not commit generated `android/build` output.
10. When a bug is found, record the root cause and fix in this document so future sessions do not repeat the same investigation.
11. For destructive file operations, favor safe failure over silent deletion.
12. Do not declare a preview feature production-ready merely because it compiles; require device validation against representative real files.

---

## 12. Definition of Production Ready

SwyftPix should not be considered production-ready until:

- Core review flow is stable.
- Keep/Trash decisions are durable and cannot accidentally resurrect reviewed items.
- Trash and retention behavior is reliable.
- Permanent deletion is safe and predictable.
- Image/video/PDF previews are reliable.
- DOCX/PPTX/XLSX visual previews are reliable or have a deliberate, tested fallback.
- All supported document types have appropriate thumbnails.
- Large and malformed files fail gracefully.
- Preview lifecycle never shows stale content.
- Native modules work on supported Android versions.
- Permissions and MediaStore behavior are robust.
- Performance/memory usage is acceptable for realistic libraries.
- Automated regression coverage exists for the critical review/trash state machine.
- Production signing/build/update process is documented.
- Privacy/security and destructive-action behavior have been reviewed.

---

## 13. Key Principle

**SwyftPix is a file-review and cleanup product first; previews exist to make review decisions fast and trustworthy.** Every future preview feature should therefore be evaluated not only for visual rendering quality, but also for correct file identity, speed, lifecycle correctness, and safe integration with Keep/Trash decisions.
