# Use Node.js 18 Alpine as base image
FROM node:24-alpine

# Install necessary packages for Chromium
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    freetype-dev \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    udev \
    xvfb \
    && rm -rf /var/cache/apk/*

# Create app directory
WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --only=production && npm cache clean --force

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs
RUN adduser -S whatsapp -u 1001

# Copy application code
COPY --chown=whatsapp:nodejs . .

# Create directories for WhatsApp sessions
RUN mkdir -p .wwebjs_auth && \
    chown -R whatsapp:nodejs .wwebjs_auth

# Create public directory if it doesn't exist
RUN mkdir -p public

# Set environment variables for Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser \
    CHROME_BIN=/usr/bin/chromium-browser \
    CHROME_PATH=/usr/bin/chromium-browser

# Switch to non-root user
USER whatsapp

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "const http = require('http'); const options = { hostname: 'localhost', port: 3000, path: '/api/clients', method: 'GET' }; const req = http.request(options, (res) => { if (res.statusCode === 200) { console.log('OK'); process.exit(0); } else { process.exit(1); } }); req.on('error', () => process.exit(1)); req.end();"

# Start the application
CMD ["npm", "start"]
