# Build stage
FROM node:20 AS node-build

# Install netcat-openbsd, mariadb-client, ffmpeg, and curl
RUN apt-get update && apt-get install -y netcat-openbsd mariadb-client ffmpeg curl && rm -rf /var/lib/apt/lists/*

# Update npm to latest compatible version
RUN npm install -g npm@11.4.0

WORKDIR /app

# Copy frontend and backend package.json and lock files
COPY frontend/package.json frontend/package-lock.json ./frontend/
COPY backend/package.json backend/package-lock.json ./backend/

# Install frontend and backend dependencies
RUN cd frontend && npm ci
RUN cd backend && npm ci

# Copy all frontend and backend source files
COPY frontend/ ./frontend/
COPY backend/ ./backend/

# Set environment variables for frontend build
#ENV NODE_ENV=production
# ENV REACT_APP_API_URL=https://internetdj.co/api

# Build the frontend
RUN cd frontend && npm run build

# Production stage
FROM node:20-slim

# Install netcat-openbsd, mariadb-client, ffmpeg, curl, and Supercronic
RUN apt-get update && apt-get install -y netcat-openbsd mariadb-client ffmpeg curl ca-certificates && rm -rf /var/lib/apt/lists/*

ENV SUPERCRONIC_URL=https://github.com/aptible/supercronic/releases/download/v0.2.29/supercronic-linux-amd64 \
    SUPERCRONIC=supercronic-linux-amd64 \
    SUPERCRONIC_SHA1SUM=cd48d45c4b10f3f0bfdd3a57d054cd05ac96812b
RUN curl -fsSLO "$SUPERCRONIC_URL" && \
    echo "${SUPERCRONIC_SHA1SUM} ${SUPERCRONIC}" | sha1sum -c - && \
    chmod +x "$SUPERCRONIC" && \
    mv "$SUPERCRONIC" "/usr/local/bin/${SUPERCRONIC}" && \
    ln -s "/usr/local/bin/${SUPERCRONIC}" /usr/local/bin/supercronic

WORKDIR /app

# Copy built frontend and backend from node-build stage
COPY --from=node-build /app/frontend/build ./frontend/build
COPY --from=node-build /app/backend ./backend

# Copy crontab file
COPY crontab /app/crontab

# Install production backend dependencies
RUN cd backend && npm ci --production

# Expose port 5000
EXPOSE 5000

# Start Supercronic, worker, and server (removed redis-server start)
CMD ["sh", "-c", "supercronic /app/crontab & node backend/workers/stemWorker.js & node backend/server.js"]