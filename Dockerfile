FROM node:18-alpine

# Set working directory
WORKDIR /usr/src/app

# Copy dependency definition
COPY package*.json ./

# Install dependencies (only production)
RUN npm ci --only=production

# Copy application files
COPY . .

# Expose server port
EXPOSE 3000

# Environment variables defaults
ENV NODE_ENV=production
ENV PORT=3000

# Start server
CMD ["node", "src/server.js"]
