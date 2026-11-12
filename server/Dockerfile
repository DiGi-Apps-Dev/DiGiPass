# DiGiPass. Base Node 24.22.1 / Alpine 3.24 fissata per digest (stessa immagine usata dalle altre app DiGi).
FROM node:24.22.1-alpine3.24@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53 AS deps
WORKDIR /app
# better-sqlite3 non ha il binario precompilato per Alpine/Node 24: si compila.
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:24.22.1-alpine3.24@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53
# tzdata: senza, TZ non ha effetto fuori da Node.
RUN apk add --no-cache tzdata
ENV NODE_ENV=production PORTA=8797 INDIRIZZO=0.0.0.0 CARTELLA_DATI=/app/dati CARTELLA_BACKUP=/app/backups
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY public ./public
RUN mkdir -p /app/dati /app/backups && chown -R 1000:100 /app
USER 1000:100
EXPOSE 8797
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:8797/stato').then(r => { if (!r.ok) process.exit(1) }).catch(() => process.exit(1))"
CMD ["node", "src/server.js"]
