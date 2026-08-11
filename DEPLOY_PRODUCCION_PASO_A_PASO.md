# Despliegue en Produccion paso a paso

Este documento explica como actualizar el servicio OXXO en produccion sin
perder configuracion, ordenes ni vouchers.

La idea es simple:

1. Guardar una copia de lo que funciona.
2. Preparar la version nueva.
3. Mantener los secretos y volumenes actuales.
4. Reiniciar los contenedores con el codigo nuevo.
5. Probar cada parte antes de probar un pago real.

## 0. Que se va a actualizar

El servicio contiene estos contenedores:

| Contenedor | Funcion |
|---|---|
| `puppeteer-service` | Genera la imagen del voucher y aplica el patch SQL de pagos |
| `oxxo-db` | Guarda las ordenes OXXO |
| `minio-service` | Guarda las imagenes generadas |
| `pdf-cropper-service` | Procesa PDFs auxiliares |

La correccion importante para Stripe esta en Puppeteer:

```text
PATCH /payments/{payment_id}/method
```

Ese endpoint permite que el plugin cambie el metodo de pago de Stripe al UUID
de OXXO o transferencia bancaria.

## 1. Entrar al servidor

Abrir una terminal en el servidor donde corren los contenedores y entrar por SSH
si aplica:

```bash
ssh usuario@servidor-produccion
```

Ir a la carpeta actual del servicio:

```bash
cd /home/unms/app/vouchers-oxxopay-generator-service
```

Confirmar que estamos en la carpeta correcta:

```bash
pwd
docker compose ps
```

No continuar si la ruta no es la esperada o si aparecen contenedores de otro
proyecto.

## 2. Revisar que la red de UCRM exista

El servicio Puppeteer necesita conectarse a la base de datos UCRM. Para eso usa
la red Docker externa de UCRM.

Ejecutar:

```bash
docker network inspect app_internal
```

Debe devolver informacion de la red. Si aparece:

```text
network app_internal not found
```

detenerse. No crear una red nueva con otro nombre; primero hay que identificar
el nombre real de la red donde vive el PostgreSQL de UCRM.

También se puede revisar la red del contenedor PostgreSQL:

```bash
docker inspect unms-postgres --format '{{json .NetworkSettings.Networks}}'
```

El nombre encontrado debe coincidir con el valor `name` de `unms_internal` en
`docker-compose.yml`.

## 3. Respaldar la version actual

Crear una carpeta de respaldo con fecha:

```bash
BACKUP_DIR="/home/unms/backups/oxxo-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"
```

Guardar la carpeta actual, excluyendo datos pesados o repositorios internos:

```bash
rsync -a \
  --exclude='.git' \
  --exclude='node_modules' \
  --exclude='.env' \
  --exclude='*.jpg' \
  --exclude='*.jpeg' \
  --exclude='*.png' \
  /home/unms/app/vouchers-oxxopay-generator-service/ \
  "$BACKUP_DIR/files/"
```

Guardar el `.env` aparte. No mostrarlo en pantalla ni subirlo a Git:

```bash
cp /home/unms/app/vouchers-oxxopay-generator-service/.env "$BACKUP_DIR/.env"
chmod 600 "$BACKUP_DIR/.env"
```

Guardar la configuracion efectiva de Compose sin compartir su contenido:

```bash
docker compose config > "$BACKUP_DIR/compose-rendered.yml"
chmod 600 "$BACKUP_DIR/compose-rendered.yml"
```

Guardar los nombres de los volumenes:

```bash
docker volume ls | grep -E 'oxxo|minio'
```

No eliminar estos volumenes:

- `oxxo_db_data`
- `minio_data`

Guardar los logs recientes para comparar despues:

```bash
docker compose logs --since=2h --no-color > "$BACKUP_DIR/stack-before.log"
chmod 600 "$BACKUP_DIR/stack-before.log"
```

## 4. Revisar el `.env` actual

El `.env` productivo debe conservarse. No reemplazarlo completo con
`.env.example`.

Comprobar solamente los nombres de variables, sin imprimir valores:

```bash
awk -F= '/^[A-Za-z_][A-Za-z0-9_]*=/ {print $1}' .env | sort
```

Debe contener como minimo:

```text
DB_HOST
DB_USER
DB_PASS
DB_NAME
UCRM_DB_HOST
UCRM_DB_USER
UCRM_DB_PASS
UCRM_DB_NAME
MINIO_ROOT_USER
MINIO_ROOT_PASSWORD
MINIO_BROWSER_REDIRECT_URL
MINIO_SERVER_URL
```

Si faltan las dos variables de URL de MinIO, agregarlas con los dominios reales
de produccion:

```env
MINIO_BROWSER_REDIRECT_URL=https://dominio-de-la-consola-minio
MINIO_SERVER_URL=https://dominio-publico-de-objetos
```

No usar `localhost` como URL publica.

## 5. Obtener la version nueva

Hay dos formas. Usar una copia del repositorio o copiar los archivos desde una
carpeta ya actualizada.

### Opcion A: actualizar desde GitHub

Guardar cualquier cambio local antes de continuar. Si la carpeta de produccion
no debe tener cambios propios, obtener el commit publicado:

```bash
git fetch Github main
git show --stat --oneline 7921352
```

No ejecutar `git reset --hard` en una carpeta productiva sin haber respaldado y
revisado antes los cambios locales.

### Opcion B: copiar desde otra carpeta

La copia debe excluir secretos, Git, dependencias instaladas y archivos de
prueba:

```bash
rsync -a \
  --delete \
  --exclude='.env' \
  --exclude='.git' \
  --exclude='node_modules' \
  --exclude='*.jpg' \
  --exclude='*.jpeg' \
  --exclude='*.png' \
  --exclude='copia-voucher generator' \
  /ruta/de/la/version-nueva/ \
  /home/unms/app/vouchers-oxxopay-generator-service/
```

La opcion `--delete` elimina archivos que ya no existen en el origen. Usarla
solo despues de comprobar que el origen es la carpeta correcta. Nunca ejecutar
este comando apuntando a `/` o a una ruta desconocida.

## 6. Restaurar el `.env` productivo

Si la copia de codigo reemplazo el archivo `.env`, restaurarlo desde el respaldo:

```bash
cp "$BACKUP_DIR/.env" /home/unms/app/vouchers-oxxopay-generator-service/.env
chmod 600 /home/unms/app/vouchers-oxxopay-generator-service/.env
```

Confirmar que existe sin mostrar su contenido:

```bash
test -f .env && test "$(stat -c '%a' .env)" = "600" && echo '.env correcto'
```

## 7. Validar Compose antes de apagar nada

Desde la carpeta del servicio:

```bash
cd /home/unms/app/vouchers-oxxopay-generator-service
docker compose config --quiet
```

Si falla, no reiniciar contenedores. Los errores mas comunes son:

- Variable faltante en `.env`.
- Red externa incorrecta.
- YAML mal indentado.
- Puerto host ocupado.

Revisar puertos:

```bash
ss -ltnp | grep -E ':(4100|8050|9002|9003)\b'
```

## 8. Actualizar los contenedores

Primero reconstruir y arrancar Puppeteer, que contiene el patch de pagos:

```bash
docker compose up -d --build puppeteer
```

Luego actualizar los servicios restantes:

```bash
docker compose up -d --build db minio pdf-cropper
```

No usar:

```bash
docker compose down -v
```

Ese comando puede eliminar los volumenes de PostgreSQL y MinIO.

Verificar estado:

```bash
docker compose ps
```

Los servicios deben aparecer como `Up`. Si alguno reinicia continuamente,
detener el despliegue y leer sus logs.

## 9. Verificar cada servicio

### PostgreSQL OXXO

```bash
docker exec oxxo-db sh -c 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
```

Debe responder `accepting connections`.

### MinIO

```bash
curl -i --max-time 10 http://127.0.0.1:9002/minio/health/live
```

Debe devolver `HTTP/1.1 200`.

### Puppeteer

Consultar una orden existente:

```bash
curl -i --max-time 10 http://127.0.0.1:4100/orders/1
```

Que la orden no exista no significa que el servicio este caido; lo importante
es recibir una respuesta HTTP JSON y no un error de conexion.

### PDF Cropper

Si el puerto host esta publicado:

```bash
curl -i --max-time 10 http://127.0.0.1:8050/docs
```

Si no esta publicado, probar desde dentro del contenedor:

```bash
docker exec pdf-cropper-service \
  python -c "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8000/docs').status)"
```

## 10. Probar el endpoint del patch sin un pago real

El endpoint necesita un `payment_id` real y un `methodId` valido. No probarlo
contra un pago productivo si no se desea modificarlo.

Consultar primero las rutas disponibles:

```bash
curl -i -X OPTIONS http://127.0.0.1:4100/payments/ID/method
```

La prueba controlada, usando un pago de prueba, es:

```bash
curl -i -X PATCH \
  http://127.0.0.1:4100/payments/ID_DE_PRUEBA/method \
  -H 'Content-Type: application/json' \
  -d '{"methodId":"UUID_DEL_METODO_DE_PRUEBA"}'
```

Resultados esperados:

- `200`: el método fue actualizado.
- `400`: falta `methodId`.
- `404`: no existe el pago.
- `500`: revisar conexion de Puppeteer a PostgreSQL UCRM, tabla `ucrm.payment` y credenciales.

## 11. Probar Stripe OXXO y transferencia

### OXXO

1. Crear una referencia OXXO desde el portal o bot.
2. Confirmar que se cree una orden en `GET /orders/{id}`.
3. Confirmar que Puppeteer genere una imagen JPEG.
4. Confirmar que MinIO reciba la imagen.
5. Confirmar en UCRM que `method_id` sea el UUID de OXXO Pay.
6. Confirmar que el atributo `tipoPagoStripe` sea `OXXO Pay`.

### Transferencia bancaria

1. Crear o aplicar una transferencia Stripe de prueba.
2. Esperar el evento que crea el pago en UCRM.
3. Revisar el log del plugin buscando `Payment Method ID patched successfully`.
4. Confirmar en UCRM que `method_id` sea el UUID de transferencia bancaria.
5. Confirmar que `tipoPagoStripe` sea `Transferencia Bancaria`.

Durante una prueba se puede observar el log del plugin, pero revisar y limpiar
cualquier dato sensible antes de compartirlo:

```bash
tail -f /ruta/de/datos-del-plugin/plugin.log
```

## 12. Si algo falla

Guardar logs sin compartirlos inmediatamente:

```bash
docker compose logs --since=30m --no-color > "$BACKUP_DIR/stack-after.log"
```

Errores comunes:

| Error | Causa probable | Accion |
|---|---|---|
| `404` en `/payments/.../method` | Se desplego la carpeta vieja | Verificar `puppeteer-server.js` nuevo y reconstruir |
| `Database error` | UCRM DB inaccesible o credencial incorrecta | Revisar `UCRM_DB_*` y la red |
| `Target.createBrowserContext timed out` | Chromium saturado o falta de recursos | Revisar logs, RAM y reiniciar Puppeteer |
| `ERR_NAME_NOT_RESOLVED` | DNS del contenedor no resuelve Stripe | Revisar DNS y salida HTTPS |
| `AccessDenied` en MinIO | Credenciales/bucket incorrectos | Comparar `.env` con la configuracion del plugin |
| `connection refused` en 8050 | PDF Cropper no publica el puerto | Probar internamente o recrear con Compose |

## 13. Checklist final

- [ ] Se respaldo la carpeta productiva.
- [ ] Se respaldo `.env`.
- [ ] Se conservaron `oxxo_db_data` y `minio_data`.
- [ ] La red `app_internal` existe.
- [ ] `docker compose config --quiet` paso correctamente.
- [ ] Los cuatro contenedores estan activos.
- [ ] MinIO devuelve HTTP 200.
- [ ] Puppeteer devuelve JSON.
- [ ] El endpoint `/payments/{id}/method` responde.
- [ ] Se probo OXXO.
- [ ] Se probo transferencia.
- [ ] El metodo final y `tipoPagoStripe` son correctos.
- [ ] No se subieron secretos ni logs sensibles.
