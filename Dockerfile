ARG APIFY_PLAYWRIGHT_IMAGE=apify/actor-node-playwright-chrome:26
ARG APIFY_PLAYWRIGHT_PLATFORM=linux/amd64

FROM --platform=${APIFY_PLAYWRIGHT_PLATFORM} ${APIFY_PLAYWRIGHT_IMAGE} AS builder

USER root
RUN useradd -m -s /bin/bash screenshot
WORKDIR /home/screenshot
ENV PLAYWRIGHT_EXECUTABLE_PATH=/usr/bin/google-chrome
RUN npm install --global pnpm@11.18.0
USER screenshot

COPY --chown=screenshot package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY --chown=screenshot src ./src
COPY --chown=screenshot tsconfig.json ./
RUN pnpm run build

FROM --platform=${APIFY_PLAYWRIGHT_PLATFORM} ${APIFY_PLAYWRIGHT_IMAGE} AS final

USER root
RUN useradd -m -s /bin/bash screenshot
WORKDIR /home/screenshot
ENV PLAYWRIGHT_EXECUTABLE_PATH=/usr/bin/google-chrome
ENV NODE_ENV=production
ENV PORT=3000
RUN npm install --global pnpm@11.18.0
USER screenshot

COPY --chown=screenshot package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile
COPY --from=builder --chown=screenshot /home/screenshot/dist ./dist

EXPOSE 3000
CMD ["pnpm", "start"]
