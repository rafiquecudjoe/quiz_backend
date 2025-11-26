# Build stage
FROM node:20-slim AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY prisma ./prisma/

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Generate Prisma client
RUN npm run prisma:generate

# Build application
RUN npm run build

# Production stage
FROM node:20-slim

# Install Python and system dependencies for OpenCV/PDF processing
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-venv \
    libgl1-mesa-glx \
    libglib2.0-0 \
    poppler-utils \
    tesseract-ocr \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY prisma ./prisma/

# Install production dependencies only
RUN npm ci --only=production

# Copy Prisma client from builder
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

# Copy built application
COPY --from=builder /app/dist ./dist

# Copy Python processor code
COPY pdf-processor ./pdf-processor

# Setup Python Virtual Environment
RUN python3 -m venv /app/venv
ENV PATH="/app/venv/bin:$PATH"

# Install Python dependencies
RUN /app/venv/bin/pip install --upgrade pip && \
    /app/venv/bin/pip install -r ./pdf-processor/requirements.txt && \
    /app/venv/bin/pip install google-generativeai

# Create directories for uploads and output
RUN mkdir -p /app/uploads /app/output

# Set Environment Variables for Python
ENV PYTHON_EXECUTABLE=/app/venv/bin/python
ENV PYTHON_VENV_PATH=/app/venv/bin/python
ENV PYTHON_SCRIPT_PATH=/app/pdf-processor/test_enriched_batch_processor.py

# Expose port
EXPOSE 3000

# Start application
CMD ["node", "dist/main"]

