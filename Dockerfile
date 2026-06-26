FROM node:20-slim

WORKDIR /app

# Install dependencies first (better layer caching)
COPY package.json package-lock.json* ./
RUN npm install

# Copy source
COPY . .

# Build the server bundle
RUN npm run build

ENV NODE_ENV=production
ENV PORT=15000
EXPOSE 15000

# Push schema, then start. (db:push is idempotent.)
CMD ["sh", "-c", "npm run db:push && node dist/index.cjs"]
