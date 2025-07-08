# ✅ Use browserless base image with full Google Chrome
FROM browserless/chrome:latest

# ✅ Set working directory
WORKDIR /app

# ✅ Copy your local files into the container
COPY . .

# ✅ Install dependencies cleanly
RUN npm ci --omit=dev

# ✅ Set the correct Chrome executable path
ENV CHROME_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

# ✅ Optional: set Node env to production
ENV NODE_ENV=production

# ✅ Expose app port (used by Express or Puppeteer status)
EXPOSE 3000

# ✅ Start your WPPConnect bot
CMD ["node", "index.js"]
