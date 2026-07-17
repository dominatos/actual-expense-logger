FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files and install all dependencies (including dev)
COPY package.json package-lock.json* ./
RUN npm install

# Copy source code and build
COPY . .
RUN npm run build

# Production image
FROM node:22-alpine

WORKDIR /app

# Only install production dependencies
COPY package.json package-lock.json* ./
RUN npm install --production

# Copy built code from builder
COPY --from=builder /app/dist ./dist

# Create data directory with proper permissions
RUN mkdir -p /app/data && chown -R node:node /app/data

USER node
ENV NODE_ENV=production

CMD ["npm", "start"]
