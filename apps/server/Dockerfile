FROM oven/bun:1.3.14 AS base

WORKDIR /app

FROM base AS pruner

RUN bun install --global turbo@2.10.0

COPY . .

RUN turbo prune server --docker

FROM base AS installer

COPY --from=pruner /app/out/json/ .

RUN bun install --frozen-lockfile --production --ignore-scripts

COPY --from=pruner /app/out/full/ .

RUN bun run --cwd apps/server build

FROM base AS runner

ENV HOST=0.0.0.0
ENV NODE_ENV=production

COPY --from=installer --chown=bun:bun /app/apps/server/dist/server ./server

USER bun

CMD ["./server"]
