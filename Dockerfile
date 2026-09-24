FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
RUN mkdir -p /app/data /app/backups && chown -R node:node /app
USER node
EXPOSE 3000
CMD ["npm","start"]
