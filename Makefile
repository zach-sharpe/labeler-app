# Makefile for Labeler App Development
# Platform detection
ifeq ($(OS),Windows_NT)
	PYTHON := python
	RM := del /Q
	RMDIR := rmdir /S /Q
else
	PYTHON := python3
	RM := rm -f
	RMDIR := rm -rf
endif

.PHONY: help dev install build rebuild-python rebuild-electron rebuild clean test-backend

# Default target - show help
help:
	@echo "Labeler App - Development Commands"
	@echo "===================================="
	@echo ""
	@echo "Development:"
	@echo "  make install          - Install all dependencies (Python + Node.js)"
	@echo "  make dev              - Run Electron app in development mode"
	@echo ""
	@echo "Building:"
	@echo "  make rebuild-python   - Rebuild Python backend with PyInstaller"
	@echo "  make rebuild-electron - Rebuild Electron app (requires Python bundle)"
	@echo "  make build            - Full rebuild (Python + Electron)"
	@echo "  make rebuild          - Alias for 'make build'"
	@echo ""
	@echo "Cleaning:"
	@echo "  make clean            - Remove build artifacts and temp files"
	@echo ""
	@echo "Testing:"
	@echo "  make test-backend     - Test Python backend standalone"

# Install all dependencies
install:
	@echo "Installing Python dependencies..."
	pip install -r requirements.txt
	@echo "Installing Node.js dependencies..."
	npm install
	@echo "Installation complete!"

# Run Electron app in development mode
dev:
	npm run dev

# Run Electron app (no dev tools)
start:
	npm start

# Rebuild Python backend with PyInstaller
# Use temp directory for build to avoid OneDrive path issues with special characters
rebuild-python:
	@echo "Rebuilding Python backend..."
	@echo "Installing PyInstaller if needed..."
	pip install pyinstaller
	@echo "Creating standalone Python executable..."
ifeq ($(OS),Windows_NT)
	pyinstaller --onefile --distpath python_dist --workpath "$(TEMP)/pyinstaller_build" --specpath "$(TEMP)" --hidden-import scipy --hidden-import pandas --hidden-import h5py --hidden-import numpy backend/labeler_backend.py
else
	pyinstaller --onefile --distpath python_dist --workpath /tmp/pyinstaller_build --specpath /tmp --hidden-import scipy --hidden-import pandas --hidden-import h5py --hidden-import numpy backend/labeler_backend.py
endif
	@echo "Python backend rebuilt successfully!"

# Rebuild Electron app (requires Python bundle to exist)
rebuild-electron:
	@echo "Rebuilding Electron app..."
	@echo "Installing Node.js dependencies..."
	npm install
	@echo "Building Electron installer..."
	npm run build
	@echo "Electron app built successfully!"
	@echo "Installer located in: dist/"

# Full rebuild - Python backend + Electron app
build: rebuild-python rebuild-electron
	@echo "Full build complete!"

# Alias for build
rebuild: build

# Clean build artifacts
clean:
	@echo "Cleaning build artifacts..."
ifeq ($(OS),Windows_NT)
	@if exist python_dist $(RMDIR) python_dist
	@if exist dist $(RMDIR) dist
	@if exist __pycache__ $(RMDIR) __pycache__
	@if exist backend\__pycache__ $(RMDIR) backend\__pycache__
	@if exist backend_debug.log $(RM) backend_debug.log
else
	$(RMDIR) python_dist dist __pycache__ backend/__pycache__ 2>/dev/null || true
	$(RM) backend_debug.log 2>/dev/null || true
endif
	@echo "Clean complete!"

# Test Python backend standalone
test-backend:
	@echo "Testing Python backend..."
	@echo "Run the following command and send test JSON:"
	@echo "  python backend/labeler_backend.py"
	@echo ""
	@echo "Example test message:"
	@echo '  {"id": 1, "method": "get_csv_files", "params": {"folder": "."}}'
	$(PYTHON) backend/labeler_backend.py
