FROM node:20-bookworm-slim

WORKDIR /app

# O pacote git é necessário porque algumas dependências do npm podem ser baixadas via Git.
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

ENV NODE_ENV=production
EXPOSE 3000

CMD ["npm", "start"]
