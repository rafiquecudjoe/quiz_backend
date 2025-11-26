#!/bin/bash
# Setup script for the PDF processor backend

echo "=================================================="
echo "PDF Processor Backend - Setup"
echo "=================================================="
echo ""

# Check if Python is installed
if ! command -v python3 &> /dev/null; then
    echo "❌ Error: Python 3 is not installed"
    exit 1
fi

echo "✓ Python 3 found: $(python3 --version)"
echo ""

# Create virtual environment
echo "Creating virtual environment..."
python3 -m venv venv

# Activate virtual environment
echo "Activating virtual environment..."
source venv/bin/activate

# Upgrade pip
echo "Upgrading pip..."
pip install --upgrade pip

# Install dependencies
echo "Installing dependencies..."
pip install -r requirements.txt

# Create .env file if it doesn't exist
if [ ! -f .env ]; then
    echo "Creating .env file..."
    cp .env.example .env
    echo ""
    echo "⚠️  IMPORTANT: Edit .env file and add your DeepSeek API key!"
    echo ""
fi

# Create empty files in directories
touch uploads/.gitkeep
touch output/.gitkeep

echo ""
echo "=================================================="
echo "Setup complete!"
echo "=================================================="
echo ""
echo "Next steps:"
echo "  1. Edit .env and add your DeepSeek API key"
echo "  2. Activate the virtual environment: source venv/bin/activate"
echo "  3. Run the server: python main.py"
echo "  4. Test with: python test_processor.py sample.pdf"
echo ""
