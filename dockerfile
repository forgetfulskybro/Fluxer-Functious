FROM node:20-slim

RUN apt-get update && apt-get install -y \
    fontconfig \
    fonts-dejavu \
    fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

RUN fc-cache -fv

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .

CMD ["node", "index.js"]