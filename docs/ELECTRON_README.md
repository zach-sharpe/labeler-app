# Labeler App - Electron Version

This directory contains an Electron-based desktop application version of the physiological waveform labeler, designed to be distributed as a standalone executable.

## Architecture

The Electron version uses a hybrid architecture:

- **Frontend**: Electron (HTML/CSS/JavaScript) with Plotly.js for visualization
- **Backend**: Python subprocess handling data processing and signal analysis
- **Communication**: JSON-based IPC (Inter-Process Communication)

### Directory Structure

```
labeler-app/
├── src/
│   ├── main/
│   │   ├── main.js           # Electron main process
│   │   ├── preload.js        # Secure IPC bridge
│   │   └── python-bridge.js  # Python subprocess manager
│   └── renderer/
│       ├── index.html        # Main UI
│       ├── styles.css        # Styling
│       └── renderer.js       # Frontend logic
├── backend/
│   ├── labeler_backend.py    # Python backend
│   └── config.py             # Configuration utilities
├── build/                    # Build resources (icons)
├── docs/                     # Documentation
├── package.json              # Node.js dependencies
└── requirements.txt          # Python dependencies
```

## Development Setup

### Prerequisites

- **Node.js** (v18 or later): https://nodejs.org/
- **Python** (3.11+): Ensure it's in your PATH
- **Git Bash** (Windows): For running shell commands

### Installation

1. **Install Node.js dependencies**:
   ```bash
   npm install
   ```

2. **Install Python dependencies** (if not already installed):
   ```bash
   pip install -r requirements.txt
   ```

### Running in Development Mode

To run the Electron app in development mode:

```bash
npm start
# OR with DevTools open:
npm run dev
```

This will:
- Launch the Electron app
- Start the Python backend as a subprocess
- Enable hot-reload for development

### Testing the Python Backend Standalone

You can test the Python backend independently:

```bash
python backend/labeler_backend.py
```

Then send JSON messages via stdin:
```json
{"id": 1, "method": "get_csv_files", "params": {"folder": "."}}
```

## Building for Distribution

### Preparing Python for Bundling

Before building the Electron app, you need to bundle Python into a standalone distribution:

1. **Install PyInstaller**:
   ```bash
   pip install pyinstaller
   ```

2. **Create Python distribution**:
   ```bash
   pyinstaller --onefile --distpath python_dist backend/labeler_backend.py
   ```

   This creates a standalone Python executable in `python_dist/`.

### Building the Electron App

#### Windows

Build a Windows installer (NSIS):
```bash
npm run build
```

This creates an executable in `dist/`:
- `Labeler App Setup X.X.X.exe` - Installer
- `Labeler App X.X.X.exe` - Portable executable

#### macOS

Build a macOS DMG:
```bash
npm run build
```

#### Linux

Build an AppImage:
```bash
npm run build
```

#### All Platforms

To build for all platforms (requires appropriate OS or cross-compilation tools):
```bash
npm run build:all
```

### Build Output

The built applications will be in the `dist/` directory:

- **Windows**: `.exe` installer and portable executable
- **macOS**: `.dmg` disk image
- **Linux**: `.AppImage` executable

## Configuration

### Application Settings

Edit `src/main/main.js` to configure:
- Window size and initial position
- Development mode settings
- Python path for production builds

### Python Backend Settings

Edit `backend/labeler_backend.py` to configure:
- Sampling frequency (default: 250 Hz)
- Segment length (default: 2000 samples)
- Labels directory (default: `labels/`)

## Architecture Details

### IPC Communication Flow

1. **User Action** → Renderer process (renderer.js)
2. **IPC Call** → Main process (main.js) via preload.js
3. **Python Call** → Python subprocess (labeler_backend.py) via python-bridge.js
4. **Processing** → Python executes method and returns result
5. **Response** → Back through IPC to renderer
6. **UI Update** → Renderer updates the interface

### Python-Electron Bridge

The `python-bridge.js` module manages the Python subprocess:

- **Development**: Uses system Python (`python` command)
- **Production**: Uses bundled Python from `resources/python/`

Messages are sent as JSON via stdin and received via stdout.

### Security

The Electron app uses:
- **Context Isolation**: Renderer process cannot access Node.js directly
- **Preload Script**: Exposes only specific IPC methods to renderer
- **No Node Integration**: Renderer runs in a sandboxed environment

## Troubleshooting

### Python Backend Not Starting

**Issue**: Electron app shows errors about Python not being found.

**Solution**:
- Ensure Python is in your system PATH
- Check that `python` command works in terminal
- For production builds, verify `python_dist/` contains the bundled Python

### Port Already in Use

**Issue**: If you previously ran the Dash version, ports might conflict.

**Solution**: The Electron version doesn't use ports - it communicates via subprocess IPC.

### Build Fails on Windows

**Issue**: electron-builder fails to create Windows installer.

**Solution**:
- Install Windows Build Tools: `npm install --global windows-build-tools`
- Run as Administrator if necessary

### Labels Not Saving

**Issue**: Labels are not persisted to disk.

**Solution**:
- Check that `labels/` directory exists
- Verify write permissions in the application directory
- Check DevTools console for errors (run with `npm run dev`)

## Development Workflow

1. **Make changes** to frontend (src/renderer/) or backend (backend/labeler_backend.py)
2. **Test in development mode**: `npm run dev`
3. **Verify functionality** with sample data files
4. **Build Python distribution** if backend changed: `pyinstaller --onefile --distpath python_dist backend/labeler_backend.py`
5. **Build Electron app**: `npm run build`
6. **Test packaged app** from `dist/` directory

## Differences from Dash Version

| Feature | Dash Version | Electron Version |
|---------|-------------|------------------|
| **Runtime** | Python server + browser | Standalone desktop app |
| **Port** | Requires port 8050 | No ports needed |
| **Distribution** | Python script | Packaged executable |
| **File Dialogs** | Tkinter dialogs | Native OS dialogs |
| **Updates** | Edit and rerun | Rebuild and redistribute |
| **Dependencies** | User must have Python | Bundled with app |

## Future Enhancements

Potential improvements for the Electron version:

- [ ] Auto-update functionality (electron-updater)
- [ ] Custom application icons (`.ico`, `.icns`, `.png`)
- [ ] Menu bar with keyboard shortcuts
- [ ] Dark mode support
- [ ] Multiple file processing (batch mode)
- [ ] Export labels to CSV/Excel
- [ ] Cloud backup of labels
- [ ] Collaborative labeling (multi-user)

## License

Same license as the parent project.

## Support

For issues specific to the Electron version, check:
1. DevTools console (F12 or `npm run dev`)
2. Terminal output from Python backend
3. Electron Builder logs in `dist/` directory
