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
    procps \
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

# Create necessary directories with proper permissions
RUN mkdir -p .wwebjs_auth logs tmp public && \
    mkdir -p tmp/chrome-user-data tmp/chrome-data tmp/chrome-cache && \
    chown -R whatsapp:nodejs .wwebjs_auth logs tmp public && \
    chmod -R 755 tmp

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
    PORT=8000

# Create startup script for better process management
RUN echo '#!/bin/sh' > /usr/src/app/start.sh && \
    echo 'set -e' >> /usr/src/app/start.sh && \
    echo '' >> /usr/src/app/start.sh && \
    echo '# Clean up any existing chrome processes and lock files' >> /usr/src/app/start.sh && \
    echo 'pkill -f chromium || true' >> /usr/src/app/start.sh && \
    echo 'pkill -f chrome || true' >> /usr/src/app/start.sh && \
    echo 'find /usr/src/app/tmp -name "SingletonLock*" -delete 2>/dev/null || true' >> /usr/src/app/start.sh && \
    echo 'find /usr/src/app/tmp -name "SingletonCookie*" -delete 2>/dev/null || true' >> /usr/src/app/start.sh && \
    echo 'find /usr/src/app/tmp -name "SingletonSocket*" -delete 2>/dev/null || true' >> /usr/src/app/start.sh && \
    echo '' >> /usr/src/app/start.sh && \
    echo '# Start Xvfb in background' >> /usr/src/app/start.sh && \
    echo 'Xvfb :99 -screen 0 1366x768x24 -ac +extension GLX +render -noreset > /dev/null 2>&1 &' >> /usr/src/app/start.sh && \
    echo 'XVFB_PID=$!' >> /usr/src/app/start.sh && \
    echo '' >> /usr/src/app/start.sh && \
    echo '# Wait for Xvfb to start' >> /usr/src/app/start.sh && \
    echo 'sleep 5' >> /usr/src/app/start.sh && \
    echo '' >> /usr/src/app/start.sh && \
    echo '# Function to cleanup on exit' >> /usr/src/app/start.sh && \
    echo 'cleanup() {' >> /usr/src/app/start.sh && \
    echo '    echo "Cleaning up..."' >> /usr/src/app/start.sh && \
    echo '    pkill -f chromium || true' >> /usr/src/app/start.sh && \
    echo '    pkill -f chrome || true' >> /usr/src/app/start.sh && \
    echo '    kill $XVFB_PID 2>/dev/null || true' >> /usr/src/app/start.sh && \
    echo '    exit 0' >> /usr/src/app/start.sh && \
    echo '}' >> /usr/src/app/start.sh && \
    echo '' >> /usr/src/app/start.sh && \
    echo '# Set up signal handlers' >> /usr/src/app/start.sh && \
    echo 'trap cleanup TERM INT' >> /usr/src/app/start.sh && \
    echo '' >> /usr/src/app/start.sh && \
    echo '# Start the application' >> /usr/src/app/start.sh && \
    echo 'exec npm start' >> /usr/src/app/start.sh && \
    chmod +x /usr/src/app/start.sh && \
    chown whatsapp:nodejs /usr/src/app/start.sh

# Switch to non-root user
USER whatsapp

# Expose port
EXPOSE 8000

# Fixed health check to use correct port
HEALTHCHECK --interval=30s --timeout=15s --start-period=60s --retries=5 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:8000/health || exit 1

# Start the application with the new startup script
CMD ["/usr/src/app/start.sh"]