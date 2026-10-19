FROM node:24-alpine AS build
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web ./
COPY addons /app/addons
RUN npm run build

FROM nginx:1.28-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/web/dist /usr/share/nginx/html
COPY LICENSE COPYRIGHT THIRD_PARTY_NOTICES.md /usr/share/licenses/panda-store/
COPY licenses /usr/share/licenses/panda-store/licenses/
EXPOSE 80
