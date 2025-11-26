#!/bin/bash

# Setup Python Environment for PDF Processor
# Usage: ./setup-python.sh

set -e  # Exit on error

echo "🐍 Setting up Python environment..."

# 1. Check for Python 3
if ! command -v python3 &> /dev/null; then
    echo "❌ Error: python3 is not installed."
    echo "   Please install Python 3.10 or higher."
    exit 1
fi

PYTHON_VERSION=$(python3 --version)
echo "   Found $PYTHON_VERSION"

# 2. Define paths
BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROCESSOR_DIR="$BASE_DIR/pdf-processor"
VENV_DIR="$PROCESSOR_DIR/venv"

# 3. Create Virtual Environment
if [ ! -d "$VENV_DIR" ]; then
    echo "📦 Creating virtual environment in $VENV_DIR..."
    python3 -m venv "$VENV_DIR"
else
    echo "📦 Virtual environment already exists."
fi

# 4. Activate and Install Dependencies
echo "⬇️  Installing dependencies..."
source "$VENV_DIR/bin/activate"

# Upgrade pip
pip install --upgrade pip

# Install requirements
if [ -f "$PROCESSOR_DIR/requirements.txt" ]; then
    pip install -r "$PROCESSOR_DIR/requirements.txt"
    echo "✅ Dependencies installed successfully."
else
    echo "⚠️  Warning: requirements.txt not found in $PROCESSOR_DIR"
fi

# 5. Verify Installation
echo "🔍 Verifying installation..."
if python3 -c "import google.generativeai; import cv2; import fitz" &> /dev/null; then
    echo "✅ Verification passed: Key libraries (google-generativeai, opencv, pymupdf) are loadable."
else
    echo "❌ Verification failed: Could not import key libraries."
    exit 1
fi

echo ""
echo "🎉 Python setup complete!"
echo "   Interpreter path: $VENV_DIR/bin/python"
echo "   Please ensure your .env file has: PYTHON_EXECUTABLE=$VENV_DIR/bin/python"
echo ""
