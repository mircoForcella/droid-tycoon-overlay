# Droid Icon Templates

Place cropped screenshots of each droid icon here for auto-detection.

Naming convention:
- `w1.png` ... `w11.png` = Worker droids
- `a1.png` ... `a9.png` = Astromech droids
- `b1.png` ... `b11.png` = Battle droids
- `c3po.png` = C-3PO

How to capture templates:
1. In-game, zoom on base, screenshot (Win+Shift+S or F12)
2. Crop to just the droid icon (~64x64 px)
3. Save with matching ID from `src/renderer/data/droids.ts`
4. Restart overlay - templates auto-load on startup

Template matching uses normalized cross-correlation with 0.75 confidence threshold.
No game memory reading, no injection - pure passive screen capture via Windows Graphics Capture (desktopCapturer).
