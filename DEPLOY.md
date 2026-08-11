# Runbook de despliegue y diagnostico OXXO Pay

Este servicio genera la vista previa de los vouchers OXXO para el plugin
`siip-whatsapp-notifications`. El stack tiene cuatro contenedores:

| Servicio | Contenedor | Puerto host | Puerto interno | Funcion |
|---|---|---:|---:|---|
| `puppeteer` | `puppeteer-service` | 4100 | 4000 | Crea ordenes, navega al voucher Stripe y genera JPEG |
| `db` | `oxxo-db` | ninguno | 5432 | Guarda ordenes y estado del voucher |
| `minio` | `minio-service` | 9002, 9003 | 9000, 9001 | Guarda y publica las imagenes |
| `pdf-cropper` | `pdf-cropper-service` | 8050 | 8000 | Procesa PDFs cuando el flujo legacy lo requiere |

## 1. Flujo completo

### Flujo asincrono actual

```text
Plugin/UCRM
  -> POST http://PUPPETEER_HOST:4100/orders
  -> puppeteer inserta la orden en PostgreSQL
  -> Plugin responde al cliente con order_id y status=generation
  -> POST /orders/{id}/generate
  -> Chromium abre la URL hosted_voucher_url de Stripe
  -> puppeteer devuelve image/jpeg
  -> Plugin sube la imagen a MinIO mediante S3
  -> POST /orders/{id}/complete
  -> Plugin consulta la URL publica desde el estado de la orden
```

### Dependencias de red

- `puppeteer` debe resolver y conectarse a `db` por la red `unms_internal`.
- `puppeteer` debe conectarse a la base de datos UCRM usando `UCRM_DB_HOST`.
- `puppeteer` debe tener salida DNS/HTTPS hacia la URL hospedada por Stripe.
- El plugin debe alcanzar `PUPPETEER_HOST:4100`.
- El plugin debe alcanzar el endpoint interno de MinIO configurado en UCRM.
- WhatsApp/Callbell y el navegador del cliente deben alcanzar `MINIO_SERVER_URL`.
- `pdf-cropper` solo necesita la red `unms_internal`.

El nombre `minio-service` solo funciona desde contenedores que comparten una red
Docker con este stack. El plugin puede usar ese nombre si vive en la misma red;
si no, debe usar la IP o hostname del servidor y el puerto publicado `9002`.

## 2. Archivos y secretos

En producción deben existir, sin subirlos a Git:

- `.env`, creado a partir de `.env.example`.
- La configuracion del plugin UCRM, administrada desde UCRM.

`.env` esta excluido por `.gitignore`. Nunca reemplazarlo con valores del ejemplo
ni pegar sus valores en tickets, logs o commits. El archivo `.env.example` solo
contiene nombres y valores placeholder.

Variables requeridas:

```env
DB_HOST=db
DB_USER=oxxo_user
DB_PASS=<secreto-de-la-base-local>
DB_NAME=oxxo_vouchers

UCRM_DB_HOST=<hostname-real-de-la-base-UCRM>
UCRM_DB_USER=<usuario-real-UCRM>
UCRM_DB_PASS=<contrasena-real-UCRM>
UCRM_DB_NAME=<base-real-UCRM>

MINIO_ROOT_USER=<usuario-MinIO>
MINIO_ROOT_PASSWORD=<contrasena-MinIO>
MINIO_BROWSER_REDIRECT_URL=https://minio.example.com
MINIO_SERVER_URL=https://aws.example.com
```

`UCRM_DB_PASS` debe coincidir con la credencial del PostgreSQL de UCRM. No se
debe inventar ni confundir con `DB_PASS`, que corresponde a la base local OXXO.

`MINIO_BROWSER_REDIRECT_URL` es la URL de la consola administrativa. No es la
URL que se entrega al cliente.

`MINIO_SERVER_URL` es la URL publica del API/objetos y debe coincidir con el
dominio configurado en `minioPublicUrl` del plugin.

## 3. Preparacion del servidor

Ejecutar como usuario con permisos Docker:

```bash
cd /home/unms/app/vouchers-oxxopay-generator-service
cp .env.example .env
chmod 600 .env
```

Completar `.env` con valores de produccion y comprobar que la red externa de
UCRM existe:

```bash
docker network inspect unms_internal
```

Si la red no existe, no crear una red con otro nombre. Primero identificar el
nombre real usado por UCRM y actualizar la configuracion de despliegue de forma
coordinada.

Validar la interpolacion sin publicar la salida en un ticket:

```bash
docker compose config --quiet
```

Comprobar puertos antes de iniciar:

```bash
ss -ltnp | grep -E ':(4100|8050|9002|9003)\b'
```

Si un puerto ya esta ocupado, cambiar el puerto host en `docker-compose.yml` y
actualizar la configuracion del plugin o del proxy. No cambiar los puertos
internos 4000, 8000, 9000 o 9001.

## 4. Despliegue y actualizacion

Primera instalacion o cambio de imagen:

```bash
docker compose up -d --build
```

Reinicio sin reconstruir imagen:

```bash
docker compose restart puppeteer minio pdf-cropper db
```

Despues de modificar `puppeteer-server.js`, hacer como minimo:

```bash
docker compose up -d --build puppeteer
```

Verificar estado y arranque:

```bash
docker compose ps
docker compose logs --since=5m --no-color puppeteer
docker compose logs --since=5m --no-color minio
docker compose logs --since=5m --no-color pdf-cropper
docker compose logs --since=5m --no-color db
```

Los cuatro servicios deben aparecer `Up`. Un contenedor reiniciando continuamente
requiere revisar sus logs antes de volver a ejecutar `up`.

## 5. Configuracion del plugin UCRM

En la configuracion de `siip-whatsapp-notifications` verificar:

| Clave | Valor esperado |
|---|---|
| `ipPuppeteer` | Host/IP alcanzable desde UCRM hacia el servidor Docker |
| `portPuppeteer` | Puerto host del servicio, normalmente `4100` |
| `minioEndpoint` | `http://minio-service:9000` si UCRM comparte `unms_internal`; de lo contrario `http://HOST:9002` |
| `minioAccessKey` | Igual a `MINIO_ROOT_USER` |
| `minioSecretKey` | Igual a `MINIO_ROOT_PASSWORD` |
| `minioBucket` | Normalmente `vouchers-oxxo` |
| `minioPublicUrl` | Igual a `MINIO_SERVER_URL`, sin slash final |
| `ipMicroservice` | Solo si se usa el flujo de PDF Cropper |
| `portMicroservice` | Normalmente `8000` dentro de `unms_internal` |

El bucket debe existir. El endpoint S3 interno y la URL publica cumplen funciones
distintas: el primero sirve para subir; el segundo se entrega a WhatsApp/UCRM.

## 6. Pruebas de salud

### MinIO

```bash
curl -fsS http://127.0.0.1:9002/minio/health/live
```

Debe devolver HTTP `200`. La consola administrativa esta en el puerto `9003`.

### PostgreSQL local

```bash
docker exec oxxo-db sh -c 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
```

Si las variables no estan exportadas en la shell, usar los valores de `.env`
solo localmente o comprobar el estado mediante los logs del contenedor. No
poner credenciales en el comando de un ticket.

### Puppeteer API

Consultar una orden existente:

```bash
curl -fsS http://127.0.0.1:4100/orders/<order_id>
```

La respuesta debe ser JSON. Para probar Chromium sin crear una orden real, usar
un entorno de pruebas y una URL accesible desde el contenedor. No usar URLs de
produccion para pruebas destructivas.

### PDF Cropper

```bash
curl -fsS http://127.0.0.1:8050/docs > /dev/null
```

Para el endpoint de procesamiento se requiere un PDF y los campos multipart
definidos en `pdf-cropper/main.py`; no confundir este servicio con Puppeteer.

## 7. Diagnostico rapido por sintoma

### El plugin no crea la orden

1. Revisar `ipPuppeteer` y `portPuppeteer` en UCRM.
2. Desde el host probar `curl http://127.0.0.1:4100/orders/<id>`.
3. Desde el contenedor o red de UCRM probar conectividad al host Docker.
4. Revisar logs de `puppeteer` y confirmar que `db` esta `Up`.
5. Si aparece `Failed to initialize database`, revisar `DB_HOST`, usuario,
   password y que la red `unms_internal` este disponible.

### La orden existe pero la vista previa queda en `pending` o `failed`

1. Consultar `GET /orders/<id>` y observar `status`.
2. Buscar `Error generating voucher` en los logs de Puppeteer.
3. Si aparece `Target.createBrowserContext timed out`, revisar memoria/CPU y
   que el contenedor tenga una instancia Chromium funcional. El servicio usa
   un timeout de protocolo amplio, pero no corrige falta de recursos.
4. Si aparece `ERR_NAME_NOT_RESOLVED`, probar DNS dentro del contenedor:

```bash
docker exec puppeteer-service getent hosts <dominio-de-stripe>
```

5. Si el dominio no resuelve, revisar DNS del host, firewall y los resolvers
   definidos en `docker-compose.yml`. No asumir que `8.8.8.8` es accesible en
   todas las redes de produccion.
6. Si aparece timeout de navegacion, comprobar salida HTTPS y la URL
   `hosted_voucher_url` recibida desde Stripe.

### La imagen se genera pero no aparece en WhatsApp

1. Confirmar que la respuesta de `/orders/<id>/generate` sea `image/jpeg`.
2. Buscar `Archivo subido exitosamente a MinIO` en el log del plugin.
3. Revisar `minioEndpoint`, credenciales y nombre del bucket.
4. Confirmar que `minioPublicUrl` sea resoluble desde el telefono/navegador.
5. Probar la URL publica del objeto con un voucher de prueba, sin exponerla en
   logs publicos.
6. Si S3 devuelve `AccessDenied`, verificar politicas del bucket y credenciales.

### MinIO esta `Up` pero las subidas fallan

`Up` solo indica que el proceso esta activo. Ejecutar el health check, revisar
logs y validar tres rutas distintas: plugin -> endpoint S3, navegador -> URL
publica y Nginx Proxy Manager -> MinIO host.

### El PDF Cropper falla

1. Confirmar `pdf-cropper-service` y `/docs`.
2. Revisar que el plugin use `http://pdf-cropper-service:8000` cuando comparte
   `unms_internal`.
3. Revisar el formato multipart y que el PDF sea valido.
4. Consultar los logs del contenedor para errores de `pdf2image` o fuentes.

## 8. Nginx Proxy Manager

Crear dos hosts proxy, ambos hacia la IP del servidor Docker:

| Dominio | Puerto destino | Uso |
|---|---:|---|
| Dominio de `MINIO_BROWSER_REDIRECT_URL` | 9003 | Consola administrativa |
| Dominio de `MINIO_SERVER_URL` | 9002 | API y objetos publicos |

Usar esquema HTTP entre Nginx y Docker y HTTPS hacia el cliente. El certificado
debe cubrir el dominio publico. No publicar `4100`, `8050` ni la base PostgreSQL
en Internet salvo una necesidad operativa temporal y controlada.

## 9. Recuperacion y mantenimiento

Reiniciar solo el servicio afectado:

```bash
docker compose restart puppeteer
docker compose restart minio
docker compose restart pdf-cropper
docker compose restart db
```

Reconstruir solo cuando cambie codigo o Dockerfile. No borrar los volumenes
`oxxo_db_data` ni `minio_data`: contienen ordenes y vouchers. `docker compose down`
no elimina volumenes por defecto, pero `docker compose down -v` si los elimina y
no debe ejecutarse en produccion sin respaldo y autorizacion.

Antes de mantenimiento:

```bash
docker compose ps
docker volume ls | grep -E 'oxxo|minio'
docker compose logs --since=1h --no-color > /tmp/oxxo-stack-before-maintenance.log
```

No incluir ese log en commits ni compartirlo sin revisar datos sensibles.

## 10. Checklist de cierre

- `.env` existe localmente, tiene permisos restringidos y no aparece en `git status`.
- `docker compose config --quiet` no reporta errores.
- Los cuatro contenedores estan `Up`.
- MinIO devuelve HTTP `200` en `/minio/health/live`.
- Puppeteer responde JSON en `/orders/<id>`.
- PDF Cropper responde en `/docs` si el flujo lo utiliza.
- El plugin apunta al endpoint interno correcto y a la URL publica correcta.
- Se creo una orden de prueba y se verifico el flujo generate -> upload -> complete.
- No se publicaron credenciales, URLs firmadas ni datos de clientes en logs o commits.
