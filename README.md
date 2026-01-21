# Labeler App

A desktop application for labeling physiological waveform signals (arterial blood pressure, ECG, etc.) in HDF5 files.

## Features

- Interactive labeling of systolic and diastolic points in 8-second segments
- Support for compression and spontaneous waveform classification
- Automated peak detection using scipy signal processing
- Multi-signal visualization with synchronized crosshairs
- Keyboard shortcuts for efficient labeling workflow
- Labels saved per-labeler in JSON format

## Installation

### Prerequisites

- **Node.js** (v18 or later): https://nodejs.org/
- **Python** (3.11+): Must be in your PATH

### Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/YOUR_USERNAME/labeler-app.git
   cd labeler-app
   ```

2. Install Node.js dependencies:
   ```bash
   npm install
   ```

3. Install Python dependencies:
   ```bash
   pip install -r requirements.txt
   ```

## Usage

### Development Mode

Run the application in development mode with DevTools:

```bash
npm run dev
```

Or without DevTools:

```bash
npm start
```

### Building for Distribution

To build a standalone executable:

**Windows (Git Bash):**
```bash
./build.sh
```

**Windows (Command Prompt):**
```bash
build.bat
```

This creates:
- Python backend bundle in `python_dist/`
- Installer in `dist/`

## Project Structure

```
labeler-app/
├── src/
│   ├── main/                 # Electron main process
│   │   ├── main.js           # Application entry point
│   │   ├── preload.js        # Secure IPC bridge
│   │   └── python-bridge.js  # Python subprocess manager
│   └── renderer/             # Frontend UI
│       ├── index.html
│       ├── renderer.js
│       └── styles.css
├── backend/                  # Python data processing
│   ├── labeler_backend.py
│   └── config.py
├── build/                    # Build resources (icons)
├── docs/                     # Documentation
├── package.json
└── requirements.txt
```

## Data Format

The application processes HDF5 files (`.h5`, `.hdf5`) containing physiological signals:

- Expected sampling frequency: 250 Hz
- Segments: 8 seconds (2000 samples)
- Signal names stored as HDF5 dataset keys

See [docs/HDF5_FORMAT.md](docs/HDF5_FORMAT.md) for detailed format specifications.

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| W/S | Cycle through label types |
| A/D | Navigate between segments |
| Click | Add/remove label point |

## Documentation

- [Electron Architecture](docs/ELECTRON_README.md) - Detailed technical documentation
- [Distribution Guide](docs/DISTRIBUTION_GUIDE.md) - Building and distributing the app
- [HDF5 Format](docs/HDF5_FORMAT.md) - Data file format specification

## License

ISC
