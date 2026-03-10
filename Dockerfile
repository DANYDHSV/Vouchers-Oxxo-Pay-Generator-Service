FROM ghcr.io/puppeteer/puppeteer:latest

USER root
WORKDIR /app

# 1. Copiar package.json e instalar dependencias
COPY package.json ./
RUN npm install

# 2. Copiar el código fuente (puppeteer-server.js)
COPY . .

# 3. Exponer puerto
EXPOSE 4000

# 4. Ejecutar el servidor correcto
CMD ["node", "puppeteer-server.js"]