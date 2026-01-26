@echo off
REM Build script for Labeler App Electron version (Windows)
REM This script automates the process of bundling Python and building the Electron app

echo =========================================
echo  Labeler App - Build Script (Windows)
echo =========================================
echo.

REM Check for GitHub token (required for auto-updates from private repo)
if "%GH_TOKEN%"=="" (
    echo Warning: GH_TOKEN environment variable not set
    echo Auto-updates will not work for private repo.
    echo Set it with: set GH_TOKEN=your_github_pat
    echo.
    set /p CONTINUE="Continue without auto-update support? (y/N) "
    if /i not "%CONTINUE%"=="y" exit /b 1
) else (
    echo GitHub token found - auto-updates will be enabled
)

REM Check if PyInstaller is installed
pyinstaller --version >nul 2>&1
if %errorlevel% neq 0 (
    echo Installing PyInstaller...
    pip install pyinstaller
)

REM Clean previous builds
echo Cleaning previous builds...
if exist python_dist rmdir /s /q python_dist
if exist dist rmdir /s /q dist
if exist build rmdir /s /q build

REM Step 1: Bundle Python backend
echo.
echo Step 1/3: Bundling Python backend...
pyinstaller --onefile --distpath python_dist --name labeler_backend --hidden-import scipy --hidden-import pandas --hidden-import h5py --hidden-import numpy backend/labeler_backend.py

if not exist python_dist\labeler_backend.exe (
    echo Failed to create Python bundle
    exit /b 1
)

echo Python backend bundled successfully

REM Step 2: Install Node.js dependencies
echo.
echo Step 2/3: Installing Node.js dependencies...
if not exist node_modules (
    call npm install
) else (
    echo Node modules already installed
)

REM Step 3: Create update token file (if token provided)
echo.
echo Step 3/4: Setting up auto-update token...
if not "%GH_TOKEN%"=="" (
    echo %GH_TOKEN%> src\main\update-token.txt
    echo Update token created
) else (
    echo.> src\main\update-token.txt
    echo No token - auto-updates disabled
)

REM Step 4: Build Electron app
echo.
echo Step 4/4: Building Electron app...
call npm run build

echo.
echo =========================================
echo  Build Complete!
echo =========================================
echo.
echo Output directory: dist\
echo.

REM List built files
if exist dist (
    echo Built files:
    dir /b dist
)

echo.
echo To test the app:
echo   npm start
REM Clean up token file (don't leave it in source)
if exist src\main\update-token.txt del src\main\update-token.txt

echo.
echo To distribute:
echo   1. Find the installer/executable in dist\
echo   2. Test it on a clean system without Python/Node.js
echo   3. Distribute to users
echo.

pause
