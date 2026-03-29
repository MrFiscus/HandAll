FROM node:20-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    python3 \
    build-essential \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
COPY frontend/package*.json frontend/
COPY backend/package*.json backend/

RUN npm install \
  && npm --prefix frontend install --include=dev \
  && npm --prefix backend install

COPY . .

RUN npm --prefix frontend run build

ENV NODE_ENV=production
ENV PORT=3001
ENV HOST=0.0.0.0

EXPOSE 3001

CMD ["npm", "--prefix", "backend", "start"]
