FROM node:22.23.3-bookworm-slim AS base
WORKDIR /app
COPY package.json yarn.lock ./

FROM base AS build
RUN yarn install --frozen-lockfile --non-interactive --production=false
COPY nest-cli.json tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN yarn build && test -f dist/main.js

FROM base AS production-dependencies
RUN yarn install --frozen-lockfile --non-interactive --production=true

FROM base AS runtime
ENV NODE_ENV=production \
    PORT=3000
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
