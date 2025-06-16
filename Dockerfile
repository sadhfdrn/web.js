# Use Node.js 24 Alpine as base image
FROM node:24-alpine

# Install necessary packages for Chromium and virtual display
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    freetype-dev \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    ttf-liberation \
    udev \
    xvfb \
    dbus \
    font-noto-emoji \
    wqy-zenhei \
    wget \
    curl \
    && rm -rf /var/cache/apk/*

# Create app directory
WORKDIR /usr/src/app

# Copy package files first for better caching
COPY package*.json ./

# Install dependencies with legacy peer deps for Node 24 compatibility
RUN npm install --only=production --legacy-peer-deps && npm cache clean --force

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S whatsapp -u 1001 -G nodejs

# Create necessary directories
RUN mkdir -p .wwebjs_auth logs tmp public && \
    mkdir -p tmp/chrome-user-data tmp/chrome-data tmp/chrome-cache && \
    chown -R whatsapp:nodejs .wwebjs_auth logs tmp public

# Copy application code
COPY --chown=whatsapp:nodejs . .

# Set environment variables for Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser \
    CHROME_BIN=/usr/bin/chromium-browser \
    CHROME_PATH=/usr/bin/chromium-browser \
    DISPLAY=:99 \
    TMPDIR=/usr/src/app/tmp \
    NODE_ENV=production \
    PORT=3000

# No need for a separate startup script

# Switch to non-root user
USER whatsapp

# Expose port
EXPOSE 8000

# Health check with better error handling
HEALTHCHECK --interval=30s --timeout=15s --start-period=60s --retries=5 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Start the application with Xvfb
CMD ["sh", "-c", "Xvfb :99 -screen 0 1366x768x24 -ac +extension GLX +render -noreset > /dev/null 2>&1 & sleep 3 && npm start"]