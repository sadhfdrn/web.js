# ✅ Use prebuilt Firefox headless image with GeckoDriver
FROM prantlf/geckodriver-headless:latest

# ✅ Set working directory
WORKDIR /app

# ✅ Copy your local files into the container
COPY . .

# ✅ Install production dependencies cleanly
RUN npm ci --omit=dev

# ✅ Set Firefox as the executable path (spoofing Chrome if needed)
ENV CHROME_EXECUTABLE_PATH=/usr/bin/firefox

# ✅ Optional: set Node environment to production
ENV NODE_ENV=production

# ✅ Expose app port (used by Express, Puppeteer status, etc.)
EXPOSE 3000

# ✅ Start your WPPConnect bot
CMD ["node", "index.js"]
