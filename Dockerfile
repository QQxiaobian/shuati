ARG NODE_IMAGE=node:24-alpine
FROM ${NODE_IMAGE}

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/data/shutibao.db

COPY . /app
RUN mkdir -p /data

EXPOSE 3000
CMD ["node", "--no-warnings", "server.js"]
