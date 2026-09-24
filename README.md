# NEXTWEBECCRM

CRM privado para el equipo comercial de NextWebEC. Guarda prospectos y su historial en una base SQLite administrada por el propio servidor. Cada vendedor accede a sus oportunidades y administración puede gestionar el equipo, reasignar prospectos, registrar cobros y pagar comisiones.

## Stack y arquitectura

- Interfaz: HTML, CSS y JavaScript sin compilación.
- Backend y API: Node.js 22 + Express 5.
- Base de datos: SQLite local con `better-sqlite3`, WAL y claves foráneas.
- Contraseñas: bcrypt con costo 12.
- Sesiones: cookie `HttpOnly`, `SameSite=Lax`, `Secure` en producción; sesiones guardadas en SQLite.
- Costos de software: las dependencias son open source. El software puede ejecutarse localmente o en infraestructura propia sin una tarifa mensual de aplicación o base de datos.

```text
Navegador → Express y API propia → SQLite en el mismo servidor
```

La aplicación no depende de Supabase, Firebase ni proveedores externos para autenticación, permisos, datos o sesiones. GitHub Pages es únicamente alojamiento estático y ya no publica este CRM.

## Requisitos

- Node.js 22.x (el proyecto fija la versión en `.nvmrc` y `.node-version`; `package.json` exige `>=22 <23`).
- npm.
- Para producción pública: una máquina o servidor con Node, almacenamiento persistente y HTTPS.

## Instalación local

Desde la carpeta del repositorio:

```sh
nvm install
nvm use
node --version
npm --version
npm install
cp .env.example .env
```

En `.env`, cambia `SESSION_SECRET` por un secreto propio de al menos 32 caracteres. Se puede generar con `openssl rand -hex 32`. La plantilla usa `NODE_ENV=development` para que la cookie funcione sobre HTTP local. Luego crea el esquema y la cuenta administradora:

```sh
npm run migrate
npm run create-admin
npm run dev
```

Abre `http://localhost:3000`. `npm start` ejecuta el servidor sin modo de desarrollo. La primera cuenta debe crearse con el comando interactivo `create-admin`; el repositorio no contiene credenciales iniciales.

`npm run build` valida la sintaxis del servidor y de los archivos JavaScript del navegador. La interfaz es JavaScript sin transpilación, por lo que no genera un directorio `dist/`. El comando `npm run start` escucha en `0.0.0.0` y sirve tanto la API como la interfaz; las migraciones SQLite pendientes se aplican antes de aceptar solicitudes. `GET /api/health` responde cuando SQLite está accesible.

## Variables de entorno

| Variable | Uso | Valor de ejemplo |
| --- | --- | --- |
| `NODE_ENV` | Entorno y seguridad de cookies | `development` local; `production` bajo HTTPS |
| `PORT` | Puerto HTTP del servidor | `3000` |
| `SESSION_SECRET` | Firma de sesiones, mínimo 32 caracteres en producción | Secreto generado localmente |
| `DATABASE_PATH` | Archivo de datos SQLite | `./data/nextwebec.db` |
| `TRUST_PROXY` | Confía en un proxy TLS frontal | `0`; cambiar a `1` solo si hay proxy confiable |
| `LOG_LEVEL` | Logging básico (`info` o `debug`) | `info` |

`.env`, bases de datos y backups están excluidos de Git.

## SQLite y migraciones

El servidor crea el directorio de datos y aplica migraciones pendientes al iniciar. El archivo predeterminado es `data/nextwebec.db`; los datos y las sesiones se guardan en ese mismo archivo. `npm run migrate` aplica las migraciones de `server/migrations/` y registra las aplicadas en `_migrations`. Foreign keys, WAL y un tiempo de espera de bloqueo de cinco segundos están habilitados.

## Cuentas y permisos

`npm run create-admin` solicita nombre, email y contraseña. Un administrador crea comerciales desde **Equipo**; pide una contraseña inicial de al menos 12 caracteres para cada cuenta y se la comparte por un canal privado. Los roles guardados son `admin` y `sales`. El alta pública está cerrada.

El rol se verifica en el servidor en cada solicitud. Un comercial consulta, actualiza y archiva solo las oportunidades que posee; solo administración puede reasignar o archivar, crear usuarios, administrar servicios, confirmar cobros y registrar pagos de comisión. Los IDs y contraseñas hash nunca se guardan en `localStorage`.

## Propiedad de prospectos y duplicados

El alta pasa por una transacción SQLite que bloquea la escritura, normaliza los datos, busca coincidencias y solo entonces crea el prospecto. El propietario actual, el propietario original y el creador inicial se fijan con el ID del usuario autenticado y la hora la genera el servidor. La API no acepta cambios a `original_owner_id`, `created_by` ni `created_at`. Cada cambio relevante guarda una instantánea antes/después en `lead_audit_log`; los cambios de etapa también quedan en `lead_status_history`.

La detección compara, en este orden, teléfono normalizado, email en minúsculas, dominio web sin protocolo ni `www`, y empresa normalizada con contacto cuando se proporcionó. Una coincidencia solo revela empresa, responsable actual, fecha, estado y motivo. Los vendedores no pueden abrir el registro de otra persona mediante la API.

## Pipeline, actividad, cobros y comisiones

La interfaz conserva dashboard, pipeline, oportunidades, seguimientos, notas y actividades. Al registrar una oportunidad como ganada, administración define el valor final. Los cobros parciales actualizan el total recibido y el saldo dentro de una transacción. Cada cobro genera una comisión acumulada del 40% de lo recaudado. Administración confirma pagos parciales o completos de comisión; un comercial solo puede consultar la comisión de sus ventas.

## Backups y restauración

El backup de terminal crea un archivo nuevo y nunca reemplaza uno previo:

```sh
npm run backup
```

Por defecto se guarda en `backups/nextwebec-<fecha>.db`. Un administrador también puede descargar una copia desde **Configuración → Descargar respaldo SQLite**. Guarda las copias fuera de la máquina que aloja el CRM.

Para restaurar, detén el servidor, conserva una copia del archivo actual, copia el backup a la ruta de `DATABASE_PATH` y vuelve a iniciar el servidor. Por ejemplo, con los valores predeterminados:

```sh
cp data/nextwebec.db data/nextwebec.before-restore.db
cp backups/nextwebec-FECHA.db data/nextwebec.db
npm start
```

No copies un backup sobre una base que está en uso.

## Docker

Prepara `.env` como se describe arriba y ejecuta:

```sh
docker compose up --build -d
docker compose exec crm npm run create-admin
```

Compose conserva la base en un volumen llamado `nextwebec_data`, publica el puerto 3000 y revisa `/api/health`. Las copias quedan en `./backups`. Docker y el servidor que lo ejecuta deben estar en una máquina con disco persistente. Para producción, configura `NODE_ENV=production` y `TRUST_PROXY=1` si Caddy termina TLS en el mismo host antes de iniciar Compose. No publiques el puerto del contenedor directamente en Internet sin HTTPS.

## Deployment y enlace público

El repositorio queda portable como una sola aplicación Node + SQLite. GitHub Pages no ejecuta el backend y los servicios gratuitos con filesystem efímero no sirven para datos persistentes. Por ejemplo, Render confirma que los archivos SQLite del plan gratuito se pierden al reiniciar, dormir o volver a desplegar; por eso no se usa para datos reales. Oracle Cloud publica recursos Always Free de cómputo, aunque la disponibilidad depende de la región y hay que crear una cuenta y aprovisionar el servidor.

Para publicar sin una tarifa mensual de software, hace falta disponer de una máquina propia o aprovisionar una VM Always Free que ofrezca disco persistente. Allí instala Docker, copia el proyecto, configura `.env`, inicia Compose y termina TLS con un proxy HTTPS como Caddy. El dominio público requiere que esa máquina tenga una dirección accesible y que el usuario administre DNS. No hay una URL pública configurada actualmente.

Para `crm.thenextwebec.com`, crea en el DNS del dominio un registro `A` para `crm` hacia la IP pública de la máquina, y un registro `AAAA` si se usa IPv6. Si se usa un proxy externo del hosting, sigue el destino que este indique. Configura Caddy para `crm.thenextwebec.com` y reenvía el tráfico al puerto local 3000; Caddy solicita y renueva HTTPS automáticamente.

## Seguridad y salud del servidor

- `/api/health` confirma que Express y SQLite responden sin revelar ruta ni datos.
- Helmet establece cabeceras de seguridad y la interfaz se sirve desde el mismo origen.
- Sesiones opacas en cookie `HttpOnly`, `SameSite=Lax`, expiran a las 12 horas y usan `Secure` en producción.
- Contraseñas hasheadas con bcrypt; no se devuelven en API ni se incluyen en registros.
- El inicio de sesión tiene límite de intentos. Las consultas y mutaciones usan listas explícitas de tablas y campos.
- No registrar cookies, contraseñas ni contenido de solicitudes. `LOG_LEVEL=debug` solo registra mensajes de error, nunca cuerpos.

## Tablas

`users`, `sessions`, `services`, `leads`, `activities`, `sales`, `payments`, `commissions`, `lead_status_history`, `lead_audit_log` y `_migrations`.

## Troubleshooting

- **No puedo iniciar sesión:** revisa email, contraseña y que la cuenta esté activa. El primer administrador se crea con `npm run create-admin`.
- **SQLite está ocupado:** espera a que termine la otra escritura y comprueba que solo haya una instancia Node utilizando el archivo.
- **La cookie no funciona detrás de TLS:** establece `TRUST_PROXY=1` solo cuando la app esté detrás de un proxy confiable que reenvíe `X-Forwarded-Proto`.
- **Restauré una copia:** detén el proceso antes de reemplazar la base; al iniciar se aplicarán migraciones nuevas.
- **GitHub Pages muestra una pantalla vieja:** Pages ya no es el destino del CRM backend; ejecuta `npm start` en el servidor configurado.
- **Node no coincide con la versión requerida:** ejecuta `nvm install` y `nvm use` en la carpeta del proyecto, o configura tu gestor de versiones para leer `.node-version`.
