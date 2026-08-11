# AGENTS.md - vouchers-oxxopay-generator-service

## Proposito

Servicio Docker que genera imagenes de vouchers OXXO a partir de URLs hospedadas
por Stripe. Es consumido por el plugin UCRM `siip-whatsapp-notifications`.

## Antes de modificar

- Leer `DEPLOY.md` antes de cambiar Compose, redes, puertos o configuracion.
- Revisar `docker-compose.yml`, `.env.example` y el estado real con `docker compose ps`.
- No leer, imprimir ni subir `.env`; contiene credenciales de UCRM, PostgreSQL y MinIO.
- Revisar el flujo del plugin antes de cambiar endpoints o nombres de respuesta.

## Servicios y contratos

- `puppeteer`: API HTTP en el puerto interno 4000, publicado normalmente como 4100.
- `db`: PostgreSQL local; persiste en el volumen `oxxo_db_data`.
- `minio`: API S3 en 9000, consola en 9001; persiste en `minio_data`.
- `pdf-cropper`: API FastAPI en el puerto interno 8000, publicado normalmente como 8050.

Endpoints principales de Puppeteer:

- `POST /orders`
- `POST /orders/:id/generate`
- `POST /orders/:id/complete`
- `GET /orders/:id`
- `GET /stripe-metadata/:id`
- `PATCH /payments/:id/user`
- `PATCH /payments/:id/method`

## Seguridad y datos

- Nunca incluir secretos, tokens, contrasenas, URLs firmadas ni datos de clientes en codigo, logs o commits.
- No ejecutar `docker compose down -v` en produccion: elimina ordenes y objetos persistidos.
- No publicar PostgreSQL, Puppeteer o PDF Cropper en Internet salvo una necesidad temporal controlada.
- Validar que `.env` continue ignorado por Git despues de cualquier cambio.

## Verificacion

```bash
docker compose config --quiet
docker compose ps
curl -fsS http://127.0.0.1:9002/minio/health/live
curl -fsS http://127.0.0.1:8050/docs > /dev/null
docker compose logs --since=10m --no-color puppeteer
```

Para cambios en Node:

```bash
node --check puppeteer-server.js
docker compose up -d --build puppeteer
```

Para cambios en Python, reconstruir `pdf-cropper` y probar `/docs` y `/process`
con un PDF de prueba no sensible.
