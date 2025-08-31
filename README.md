# Drive Rotate Viewer

A Chrome extension that adds rotation controls to images and videos in Google Drive.

## Features

- **Rotate images/videos** in Google Drive preview
- **90° left/right rotation** with keyboard shortcuts
- **Horizontal flip** functionality
- **Reset to original** orientation
- **Remembers rotations** for each file
- **Clean, minimal toolbar** that appears only when needed

## Installation

1. Download or clone this repository
2. Open Chrome and go to `chrome://extensions/`
3. Enable "Developer mode" (toggle in top right)
4. Click "Load unpacked" and select the project folder
5. The extension is now active on Google Drive

## Usage

1. Go to Google Drive and open any image or video file
2. A toolbar will appear in the bottom-right corner
3. Use the buttons to rotate or flip the media:
   - **⟲ 90°** - Rotate left
   - **⟳ 90°** - Rotate right  
   - **⇋ Flip** - Mirror horizontally
   - **Reset** - Return to original orientation

### Keyboard Shortcuts

- `Shift + L` - Rotate left
- `Shift + R` - Rotate right
- `Shift + F` - Flip horizontally
- `Shift + 0` - Reset

## How It Works

- Detects images and videos in Google Drive's preview interface
- Applies CSS transforms for rotation without affecting image quality
- Saves rotation state using Chrome's storage API
- Works with Google Drive's native zoom and navigation

---

*Simple, lightweight, and non-intrusive rotation controls for Google Drive media.*
