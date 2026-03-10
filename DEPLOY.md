# Guía de Despliegue a Producción - Servicio OxxoPay

Este documento detalla los pasos críticos para migrar el servicio de generación de vouchers OxxoPay al entorno de producción, integrándose con la arquitectura de **Nginx Proxy Manager Externo**.

## 1. Transferencia de Archivos

Debes copiar la carpeta completa `vouchers-oxxopay-generator-service` al servidor de producción en `/home/unms/app/`.

**Contenido requerido:**

- `docker-compose.yml` (Versión final con soporte de red `public_net` y puertos expuestos).
- `Dockerfile` y código fuente (`puppeteer-server.js`, `generate_screenshot.js`, etc.).
- Carpeta `pdf-cropper/` completa.
- Archivo `.env` (que configuraremos en el siguiente paso).

## 2. Configuración de Credenciales (.env)

En el servidor de producción, edita el archivo `.env` dentro de la carpeta del servicio.

**CRÍTICO:**

1.  **MinIO / OxxoDB Local:** Puedes mantener las credenciales por defecto o cambiarlas. Como es una instalación nueva, los contenedores se inicializarán con lo que pongas aquí.
2.  **Conexión a UCRM (`UCRM_DB_PASS`):** Esta contraseña **NO** se puede inventar. Debes usar la contraseña real de la base de datos de tu UCRM en producción.
    - _¿Dónde encontrarla?_ Revisa `/home/unms/app/docker-compose.yml` en producción y busca la variable `UCRM_POSTGRES_PASSWORD` o `POSTGRES_PASSWORD` del servicio `postgres`. Copia ese valor exacto.

```env
# Ejemplo .env Producción
DB_HOST=db
DB_USER=oxxo_user
DB_PASS=tu_password_nuevo_o_default
DB_NAME=oxxo_vouchers

# DATOS REALES DE PRODUCCIÓN (¡Verificar!)
UCRM_DB_HOST=unms-postgres
UCRM_DB_USER=ucrm
UCRM_DB_PASS=<<PEGAR_AQUI_LA_CLAVE_REAL_DE_PRODUCCION>>
UCRM_DB_NAME=ucrm

MINIO_ROOT_USER=minioadmin
MINIO_ROOT_PASSWORD=minioadmin
```

## 3. Despliegue de Contenedores

Ejecuta el siguiente comando para construir e iniciar los servicios:

```bash
cd /home/unms/app/vouchers-oxxopay-generator-service
docker compose up -d --build
```

### Verificación de Puertos

El `docker-compose.yml` expondrá los siguientes puertos en el host de producción:

- **9002** -> MinIO API (S3)
- **9003** -> MinIO Console (Web Admin)
- **4100** -> Puppeteer API (Uso interno/debug)
- **8050** -> PDF Cropper (Uso interno)

_Nota: Estos puertos han sido verificados y no entran en conflicto con los puertos estándar de UNMS (80, 443, 8081, 2055, etc.) ni con Portainer (9001)._

## 4. Configuración de Nginx Proxy Manager (Externo)

Dado que utilizas un Nginx externo para gestionar los certificados y dominios, configura los Host Proxy de la siguiente manera:

### Host 1: Consola Administrativa

- **Dominio:** `minio-venus.siip.mx` (o tu dominio de producción equivalente)
- **Destino (IP Interna):** IP del servidor de producción.
- **Puerto de Destino:** **9003**
- **Esquema:** HTTP
- _Función:_ Acceso visual al panel de administración de MinIO.

### Host 2: API de Archivos (Público)

- **Dominio:** `aws-venus.siip.mx` (o tu dominio de producción equivalente)
- **Destino (IP Interna):** IP del servidor de producción.
- **Puerto de Destino:** **9002**
- **Esquema:** HTTP
- _Función:_ Servir los comprobantes (.jpg) públicamente y recibir subidas desde el plugin.

**Importante:** No es necesario modificar el `unms-nginx` interno ni aplicar parches de `ucrm-locations.tpl`, ya que el tráfico entra directo por los puertos expuestos hacia tu Nginx externo.

## 5. Actualización del Plugin en UCRM

Finalmente, configura el plugin `siip-whatsapp-notifications` en UCRM:

1.  **Minio Endpoint:** `http://minio-service:9000` (Uso interno entre contenedores).
2.  **Minio Public URL:** `https://aws-venus.siip.mx` (Tu dominio público configurado en el paso 4).
3.  **PDF Cropper Host:** `http://pdf-cropper-service:8000`
