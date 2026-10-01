FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig*.json ./
COPY src ./src
RUN npm run build

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY assets ./assets
# SQLite lives here: mount a persistent volume or installs/lines are lost on every deploy.
VOLUME /app/data
EXPOSE 3000
CMD ["node", "dist/index.js"]
