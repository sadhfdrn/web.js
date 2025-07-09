FROM browserless/chrome:latest
# ✅ Install Node.js + npm (LTS version)

# ✅ Set working directory
WORKDIR /app

# ✅ Copy project files
COPY . .

# ✅ Install only production dependencies
RUN npm ci --omit=dev

# ✅ Set Firefox path (used by Puppeteer or Playwright)
ENV CHROME_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

# ✅ Set Node environment
ENV NODE_ENV=production

# ✅ Expose application port
EXPOSE 3000
# ✅ Run the bot
CMD ["node", "index.js"]
