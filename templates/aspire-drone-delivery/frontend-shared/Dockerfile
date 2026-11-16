FROM node:22-alpine AS build
ARG FRONTEND
WORKDIR /src/${FRONTEND}
COPY ${FRONTEND}/package*.json ./
RUN npm ci
COPY ${FRONTEND}/ ./
COPY frontend-shared/ /src/frontend-shared/
RUN npm run build

FROM scratch
ARG FRONTEND
COPY --from=build /src/${FRONTEND}/dist /app/dist
