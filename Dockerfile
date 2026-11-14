FROM node:22-bookworm-slim AS frontend
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/index.html frontend/tsconfig.json frontend/vite.config.ts ./
COPY frontend/src ./src
COPY frontend/public ./public
RUN npm run build

FROM python:3.14-slim-bookworm
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 AEGIS_PUBLIC_DEMO=1
WORKDIR /app/backend
COPY backend/requirements-runtime.txt ./
RUN python -m pip install --no-cache-dir -r requirements-runtime.txt
COPY backend/app ./app
COPY --from=frontend /build/dist /app/frontend/dist
USER 10001:10001
EXPOSE 10000
CMD ["python", "-m", "app.serve"]
