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
    && rm -rf /var/cache/apk/*

# Create app directory
WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./

# Install dependencies with legacy peer deps for Node 24 compatibility
RUN npm install --only=production --legacy-peer-deps && npm cache clean --force

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs
RUN adduser -S whatsapp -u 1001

# Copy application code
COPY --chown=whatsapp:nodejs . .

# Create directories for WhatsApp sessions and logs
RUN mkdir -p .wwebjs_auth logs && \
    chown -R whatsapp:nodejs .wwebjs_auth logs

# Create public directory if it doesn't exist
RUN mkdir -p public && \
    chown -R whatsapp:nodejs public

# Set environment variables for Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser \
    CHROME_BIN=/usr/bin/chromium-browser \
    CHROME_PATH=/usr/bin/chromium-browser \
    DISPLAY=:99

# Switch to non-root user
USER whatsapp

# Expose port
EXPOSE 3000

# Health check with better error handling
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "const http = require('http'); const options = { hostname: 'localhost', port: 3000, path: '/api/clients', method: 'GET', timeout: 5000 }; const req = http.request(options, (res) => { if (res.statusCode === 200) { console.log('OK'); process.exit(0); } else { process.exit(1); } }); req.on('error', () => process.exit(1)); req.on('timeout', () => process.exit(1)); req.end();"

# Start the application with better process handling
CMD ["sh", "-c", "Xvfb :99 -screen 0 1024x768x24 > /dev/null 2>&1 & npm start"]