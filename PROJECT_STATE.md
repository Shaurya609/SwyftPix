# SwyftPix — Living Project State

> **This is the working state of the project, not a one-time README.** Update this document whenever a major feature, decision, test result, blocker, or next step changes.

**Branch:** `phase-2d-retention`

## Current objective

Build a reliable on-device media and document review workflow for SwyftPix, including retention/trash handling and in-app previews for common media and document formats.

## Current status

### Working and tested

- [x] Category-based media review flow.
- [x] Image preview in main review.
- [x] Video preview in main review.
- [x] PDF preview in main review.
- [x] PDF thumbnail generation.
- [x] PDF pinch/zoom.
- [x] Document review actions: **Keep** and **Trash/Delete**.
- [x] Review queue persistence and deduplication.
- [x] Trash persistence foundation.
- [x] Trash refresh when returning to the Trash screen.
- [x] Trash thumbnails for supported media/document types.
- [x] Trash preview for images, videos and PDFs.
- [x] Trash review actions for images and videos.
- [x] Single and multi-item permanent deletion from Trash.
- [x] TXT document preview.
- [x] DOCX thumbnail generation.
- [x] DOCX in-app preview surface.
- [x] DOCX preview zoom.
- [x] DOCX preview was verified working after the native-view sizing fix.
- [x] PPTX/XLSX basic document preview path exists.

## Current workstream

### Native PPTX rendering — next

The goal is to move PPTX from text/extracted-content rendering to a visual, native in-app presentation experience.

Target behavior:

- [ ] Generate a visual PPTX thumbnail.
- [ ] Render PPTX slides visually in the in-app preview.
- [ ] Navigate between slides.
- [ ] Support pinch-to-zoom where appropriate.
- [ ] Prevent stale previews when switching between presentations.
- [ ] Support PPTX preview consistently in main review and Trash.
- [ ] Test multi-slide presentations with text, images, tables/shapes and different layouts.

### XLSX — after PPTX

The known problematic workbook is `University_Health_LOA_Quick_Requirements_Tracker.xlsx`. Other test spreadsheets have rendered through the existing fallback path.

Target behavior:

- [ ] Investigate the failing workbook.
- [ ] Decide whether native visual spreadsheet rendering is required.
- [ ] If native rendering is implemented, provide sheet navigation and readable zoom/scroll behavior.
- [ ] Ensure thumbnails work consistently.

## Known issues / watchlist

- Office document formats should not silently fall back to a poor text-only experience when a visual preview is expected.
- Large/complex documents may expose renderer limitations even when simple test files work.
- PDF rendering previously had partial-page and stale-preview issues; these have been addressed during the current workstream but should remain regression tests.
- Generated Android build directories under `modules/swyftpix-media-delete/android/build/` are local build artifacts and should not be committed.

## Test matrix

| Type | Main thumbnail | Main preview | Zoom | Trash thumbnail | Trash preview | Status |
|---|---|---|---|---|---|---|
| Image | Yes | Yes | Existing | Yes | Yes | Working |
| Video | Yes | Yes | Existing | Yes | Yes | Working |
| PDF | Yes | Yes | Yes | Yes | Yes | Working |
| TXT | Basic | Yes | N/A | TBD | TBD | Working in main |
| DOCX | Yes | Yes | Yes | Expected via shared preview | Expected via shared preview | Working |
| PPTX | Needs native visual work | Needs native visual work | Planned | Planned | Planned | **Next** |
| XLSX | Needs improvement | Fallback works for some files | Planned | Planned | Planned | **After PPTX** |
| CSV | Not fully tested | Not fully tested | N/A | Not fully tested | Not fully tested | Pending test |

## Retention / Trash state

The retention workflow currently covers:

`Select Category → Review Item → Keep / Trash → Trash → Preview → Exit Preview → Single/Multi Permanent Delete`

This flow has been tested successfully for the currently supported media and document preview paths.

## Development workflow

### JS/TS-only change

Pull the branch, run type checks, then use the existing development build with Metro:

```bash
git pull --ff-only origin phase-2d-retention
npx tsc --noEmit
git diff --check
npx expo start --dev-client -c
```

### Native Android/Kotlin change

A native rebuild/reinstall is required:

```bash
rm -rf modules/swyftpix-media-delete/android/build
npx tsc --noEmit
git diff --check
cd android
./gradlew app:assembleDebug -x lint -x test
cd ..
npx expo run:android
```

### Before committing

```bash
git status
git diff --check
npx tsc --noEmit
git add <changed-files>
git commit -m "<message>"
git push origin phase-2d-retention
```

Do not commit `modules/swyftpix-media-delete/android/build/`.

## Recent implementation history

The current branch has evolved through the following major stages:

1. Real-device media review.
2. Persistent review actions and trash foundation.
3. PDF in-app rendering and thumbnails.
4. Review-card stale-preview and queue fixes.
5. Trash previews and automatic Trash refresh.
6. TXT/document preview support.
7. DOCX native preview surface and thumbnail integration.
8. DOCX native-view sizing/zoom fixes.
9. **Next: native visual PPTX rendering.**

## Definition of done for the current workstream

The document-preview workstream is considered complete when common document formats can be reviewed without confusing text-only fallbacks, thumbnails accurately represent the document type, preview state never leaks from a previously reviewed item, and the same behavior works from both the main review flow and Trash.

## Update rule

Whenever we complete a feature or discover a meaningful issue:

1. Update the relevant checkbox/status above.
2. Add the new behavior or regression to the test matrix.
3. Record important architectural decisions.
4. Move the **Current workstream** section to the next concrete task.
5. Keep this file concise enough to be useful during the next development session.
