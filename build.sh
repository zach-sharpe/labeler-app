#!/bin/bash
# Build script for Labeler App Electron version
# This script automates the process of bundling Python and building the Electron app

set -e  # Exit on error

echo "========================================="
echo " Labeler App - Build Script"
echo "========================================="
echo ""

# Check if PyInstaller is installed
if ! command -v pyinstaller &> /dev/null; then
    echo "⚠️  PyInstaller not found. Installing..."
    pip install pyinstaller
fi

# Clean previous builds
echo "🧹 Cleaning previous builds..."
rm -rf python_dist
rm -rf dist
rm -rf build

# Step 1: Bundle Python backend
echo ""
echo "📦 Step 1/3: Bundling Python backend..."
pyinstaller \
    --onefile \
    --distpath python_dist \
    --name labeler_backend \
    --hidden-import scipy \
    --hidden-import pandas \
    --hidden-import h5py \
    --hidden-import numpy \
    backend/labeler_backend.py

if [ ! -f "python_dist/labeler_backend.exe" ] && [ ! -f "python_dist/labeler_backend" ]; then
    echo "❌ Failed to create Python bundle"
    exit 1
fi

echo "✅ Python backend bundled successfully"

# Step 2: Install Node.js dependencies (if needed)
echo ""
echo "📦 Step 2/3: Installing Node.js dependencies..."
if [ ! -d "node_modules" ]; then
    npm install
else
    echo "✅ Node modules already installed"
fi

# Step 3: Build Electron app
echo ""
echo "🔨 Step 3/3: Building Electron app..."

# Detect platform
if [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "win32" ]]; then
    PLATFORM="Windows"
    npm run build
elif [[ "$OSTYPE" == "darwin"* ]]; then
    PLATFORM="macOS"
    npm run build
else
    PLATFORM="Linux"
    npm run build
fi

echo ""
echo "========================================="
echo " ✅ Build Complete!"
echo "========================================="
echo ""
echo "Platform: $PLATFORM"
echo "Output directory: dist/"
echo ""

# List built files
if [ -d "dist" ]; then
    echo "Built files:"
    ls -lh dist/ | grep -v "^d" | awk '{print "  - " $9 " (" $5 ")"}'
fi

echo ""
echo "To test the app:"
echo "  npm start"
echo ""
echo "To distribute:"
echo "  1. Find the installer/executable in dist/"
echo "  2. Test it on a clean system without Python/Node.js"
echo "  3. Distribute to users"
echo ""
