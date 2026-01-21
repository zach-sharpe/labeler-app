# Distribution Guide

## For Developers: How to Build for Distribution

### Prerequisites (Developer Machine Only)

- Python 3.11+ installed
- Node.js 18+ installed
- All dependencies from requirements.txt
- Git Bash (for build.sh) OR Windows Command Prompt (for build.bat)

### Build Process

1. **Ensure you're on the electron branch:**
   ```bash
   git checkout electron
   ```

2. **Run the build script:**
   ```bash
   # Git Bash / Linux / macOS:
   ./build.sh

   # Windows Command Prompt:
   build.bat
   ```

3. **Wait for build to complete** (~2-5 minutes):
   - PyInstaller bundles Python
   - electron-builder packages the app
   - Installer is created

4. **Find the installer:**
   ```
   dist/Labeler App Setup 1.0.0.exe  (Windows)
   dist/Labeler App-1.0.0.dmg        (macOS)
   dist/Labeler-App-1.0.0.AppImage   (Linux)
   ```

### What Gets Bundled

The installer contains:
- ✅ Electron application (UI)
- ✅ Python runtime (no installation needed)
- ✅ All Python packages (scipy, pandas, h5py, numpy)
- ✅ Your Python code (labeler_backend.py)
- ✅ Application resources

**File size:** Approximately 150-250 MB

### Testing Before Distribution

**Critical:** Test on a machine WITHOUT Python or Node.js to ensure it works standalone.

#### Option 1: Windows VM/Clean Machine
1. Copy `Labeler App Setup 1.0.0.exe` to a clean Windows machine
2. Double-click to install
3. Launch the app from desktop shortcut
4. Test full workflow:
   - Select folder with test data
   - Load a file
   - Navigate segments
   - Add/remove labels
   - Save labels
   - Verify label files are created

#### Option 2: Portable Version (No Install Required)
The `win-unpacked/` folder in `dist/` is a portable version:
1. Copy the entire `win-unpacked/` folder to a USB drive
2. Run `Labeler App.exe` from inside that folder
3. No installation needed - runs directly

## For End Users: How to Install and Use

### Installation

1. **Download the installer:**
   - Receive `Labeler App Setup 1.0.0.exe` from your administrator
   - Or download from shared location/GitHub Release

2. **Run the installer:**
   - Double-click `Labeler App Setup 1.0.0.exe`
   - Windows may show a security warning (click "More info" → "Run anyway")
   - Click through the installation wizard

3. **Launch the app:**
   - Find "Labeler App" on your desktop
   - Or search for "Labeler App" in Start Menu
   - Double-click to launch

### First-Time Setup

**No setup required!** Unlike the Python version:
- ❌ No Python installation needed
- ❌ No pip install commands
- ❌ No terminal/command prompt
- ❌ No browser needed
- ✅ Just double-click and use

### Using the Application

1. **Select Data Folder:**
   - Click "Select Folder"
   - Navigate to folder containing your .h5 or .csv files
   - Click "Select Folder"

2. **Load a File:**
   - Choose a file from the dropdown
   - The first segment loads automatically

3. **Label Your Data:**
   - Click on the graph to add labels
   - Click near existing labels to remove them
   - Use keyboard shortcuts:
     - `A` - Previous segment
     - `D` - Next segment
     - `W` - Previous label type
     - `S` - Next label type

4. **Save Your Work:**
   - Click "Save Labels" button
   - Labels are saved to `labels/{labeler_name}/{filename}.json`
   - Green confirmation message appears

### Where Are Labels Saved?

Labels are saved in the same directory as the application data:

**Windows:** `C:\Users\{YourUsername}\AppData\Local\Programs\labeler-app-electron\labels\`

**To access your labels:**
1. Press `Win + R`
2. Type: `%LOCALAPPDATA%\Programs\labeler-app-electron\labels`
3. Press Enter

**Or configure a custom location** by selecting your data folder that already contains a `labels/` subfolder.

### Troubleshooting

#### "Windows protected your PC" warning
This appears because the app isn't digitally signed (signing requires a code signing certificate ~$200-400/year).

**Solution:**
1. Click "More info"
2. Click "Run anyway"

This is safe if you trust the source you received the installer from.

#### App won't launch
**Check:**
- Windows 10 or 11 (64-bit)
- At least 500 MB free disk space
- Try running as Administrator (right-click → "Run as administrator")

#### Labels aren't saving
**Check:**
- You clicked the "Save Labels" button
- You have write permissions to the application directory
- Check the labels folder (see "Where Are Labels Saved?" above)

#### Can't see my CSV files
**Check:**
- Files end in `.csv`, `.h5`, or `.hdf5`
- You selected the correct folder
- Files aren't corrupted

## Distribution Methods

### Method 1: Direct File Share (Small Teams)

**Best for:** 1-10 users in the same organization

1. Build the installer
2. Copy `Labeler App Setup 1.0.0.exe` to:
   - Shared network drive
   - OneDrive/Google Drive/Dropbox
   - Email (if under email size limits)
3. Send link/path to users
4. Users download and install

**Pros:**
- Simple and quick
- No external hosting needed

**Cons:**
- Manual distribution
- Hard to track who has which version

### Method 2: GitHub Releases (Recommended)

**Best for:** Ongoing development, multiple versions, larger teams

1. **Create a Git tag:**
   ```bash
   git tag -a v1.0.0 -m "Initial release"
   git push origin v1.0.0
   ```

2. **Create GitHub Release:**
   - Go to your GitHub repository
   - Click "Releases" → "Create a new release"
   - Choose the tag (v1.0.0)
   - Write release notes
   - Upload `Labeler App Setup 1.0.0.exe` as an asset
   - Click "Publish release"

3. **Share the release URL:**
   - Example: `https://github.com/yourusername/labeler-app/releases/tag/v1.0.0`
   - Users click the installer to download

**Pros:**
- Professional distribution
- Version tracking
- Download statistics
- Automatic update notifications (if you add electron-updater later)

**Cons:**
- Requires GitHub repository
- Public or private repo decision

### Method 3: Internal Software Distribution

**Best for:** Large organizations with IT departments

1. Provide installer to IT department
2. IT adds to internal software catalog
3. Users install via company software portal

**Pros:**
- Centralized management
- IT can push updates
- Security scanning by IT

**Cons:**
- Requires IT involvement
- May take time for approval

### Method 4: USB Drive (Offline Distribution)

**Best for:** Offline environments, security-restricted networks

1. Copy installer to USB drive
2. Physically deliver USB to users
3. Users install from USB

**Pros:**
- Works in air-gapped environments
- No network needed

**Cons:**
- Manual process
- Slow for large user bases

## Updating the Application

### For Developers

1. Make changes to the code
2. Update version in `package.json`:
   ```json
   "version": "1.1.0"
   ```
3. Rebuild:
   ```bash
   ./build.sh
   ```
4. Distribute new installer: `Labeler App Setup 1.1.0.exe`

### For End Users

**Currently:** Manual reinstall
1. Download new version
2. Run new installer (automatically uninstalls old version)
3. Launch updated app

**Future:** Auto-update (requires electron-updater implementation)

## Code Signing (Optional but Recommended)

To remove "Windows protected your PC" warnings:

1. **Purchase a code signing certificate** (~$200-400/year):
   - DigiCert
   - Sectigo
   - GlobalSign

2. **Configure electron-builder:**
   ```json
   "win": {
     "certificateFile": "path/to/cert.pfx",
     "certificatePassword": "password",
     "target": ["nsis"]
   }
   ```

3. **Rebuild** - installer will be signed

**Pros:**
- Professional appearance
- No security warnings
- User trust

**Cons:**
- Annual cost
- Renewal required

## Checklist Before Distribution

- [ ] Tested on clean Windows machine without Python/Node.js
- [ ] All features work (load files, label, save, navigate)
- [ ] Labels persist and can be reloaded
- [ ] Version number updated in package.json
- [ ] Release notes written
- [ ] README or user guide included
- [ ] Support contact information provided
- [ ] Known issues documented

## File Size Optimization

The installer is large (~150-250 MB) because it bundles Python + dependencies.

**To reduce size:**

1. **Remove unused dependencies** from requirements.txt
2. **Use UPX compression** in PyInstaller:
   ```bash
   pyinstaller --onefile --upx-dir=/path/to/upx labeler_backend.py
   ```
3. **Enable Electron asar compression** (already enabled in package.json)

**Realistic size:** 150-200 MB is normal for Electron + Python apps.

## Support & Maintenance

### User Support

**Common questions:**
1. Where are my labels saved? → See "Where Are Labels Saved?" above
2. How do I use the app? → User guide in app or separate PDF
3. Can I use this on Mac? → Yes, if you build the .dmg version

### Maintenance

**Regular tasks:**
1. Update dependencies (npm audit fix, pip list --outdated)
2. Rebuild quarterly to include security patches
3. Monitor user feedback for bugs/feature requests
4. Keep documentation updated

## Security Considerations

### Data Privacy

The application:
- ✅ Runs entirely locally (no internet connection required)
- ✅ No data sent to external servers
- ✅ Labels stored on local machine only
- ✅ No telemetry or analytics

### Antivirus False Positives

PyInstaller-bundled apps may trigger antivirus warnings.

**Solution:**
1. Submit to antivirus vendors as false positive
2. Code sign the application
3. Add to antivirus exclusions (enterprise environments)

## License & Legal

**Remind users:**
- This is internal research/medical software
- FDA approval may be required for clinical use
- Check your institution's policies
- Include appropriate disclaimers in documentation

---

## Quick Start for Impatient Users

1. **Developer:** Run `./build.sh` → Find `dist/Labeler App Setup 1.0.0.exe`
2. **Distribute:** Copy installer to users
3. **User:** Double-click installer → Launch app → Use!

That's it! No Python, no Node.js, no terminal - just a native desktop app.
