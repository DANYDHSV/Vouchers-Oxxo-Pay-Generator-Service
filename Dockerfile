# Usar una imagen base de Node.js con Alpine Linux
FROM node:18-alpine

# Instalar dependencias básicas
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    && rm -rf /var/cache/apk/*

# Configurar variables de entorno para Puppeteer
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# Instalar Puppeteer globalmente
RUN npm install -g puppeteer@latest

# Copiar el script JavaScript
WORKDIR /app
COPY generate_screenshot.js /app/generate_screenshot.js

# Exponer el puerto 4000
EXPOSE 4000

# Ejecutar un servidor HTTP simple para recibir solicitudes
CMD ["node", "-e", "const http = require('http'); const { exec } = require('child_process'); http.createServer((req, res) => { let body = ''; req.on('data', chunk => body += chunk); req.on('end', () => { const url = new URL(body).searchParams.get('url'); if (!url) { res.writeHead(400); res.end('URL is required'); return; } exec(`node /app/generate_screenshot.js ${encodeURIComponent(url)}`, (error, stdout, stderr) => { if (error) { res.writeHead(500); res.end(stderr); return; } res.writeHead(200); res.end(stdout); }); }); }).listen(4000); console.log('Puppeteer service listening on port 4000');"]
