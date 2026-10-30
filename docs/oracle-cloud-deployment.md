# Publicar NEXTWEBECCRM en Oracle Cloud

Esta guía despliega una sola instancia del CRM con SQLite persistente y HTTPS automático. La aplicación no publica el puerto 3000; Caddy es el único servicio expuesto por los puertos 80 y 443.

## 1. Crear la instancia

En la región principal de Oracle Cloud, crea una instancia de Compute:

- Imagen: Ubuntu 24.04 LTS.
- Shape recomendado: `VM.Standard.A1.Flex`, 2 OCPU y 12 GB de memoria, marcado Always Free eligible cuando esté disponible.
- Disco de arranque: al menos 50 GB.
- Red: subred pública con dirección IPv4 pública.
- SSH: agrega tu clave pública; no uses contraseña.

Reserva una IP pública y asígnala a la VNIC principal para que el DNS no cambie.

En la lista de seguridad o NSG permite entrada TCP:

- Puerto 22 solo desde la IP pública del administrador.
- Puertos 80 y 443 desde `0.0.0.0/0`.

No abras el puerto 3000.

## 2. Configurar DNS

Crea un registro `A`:

```text
crm.thenextwebec.com -> IP_PUBLICA_RESERVADA
```

Espera a que el registro responda con la IP antes de iniciar Caddy.

## 3. Preparar Ubuntu

Conéctate por SSH y actualiza el sistema:

```sh
sudo apt-get update
sudo apt-get upgrade -y
sudo apt-get install -y ca-certificates curl git ufw
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"
```

Cierra la sesión SSH y vuelve a entrar para aplicar el grupo `docker`. Luego activa el firewall del servidor:

```sh
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 443/udp
sudo ufw --force enable
```

## 4. Instalar el CRM

```sh
git clone https://github.com/infooxbarec-star/NEXTWEBECCRM.git
cd NEXTWEBECCRM
cp .env.production.example .env.production
openssl rand -hex 32
nano .env.production
mkdir -p backups
chmod 700 backups
docker compose --env-file .env.production -f compose.production.yml up --build -d
```

Copia el resultado de `openssl rand -hex 32` en `SESSION_SECRET`. Confirma también `CRM_DOMAIN` y `ACME_EMAIL`. No publiques ni copies el archivo `.env.production` al repositorio.

Verifica el estado:

```sh
docker compose --env-file .env.production -f compose.production.yml ps
docker compose --env-file .env.production -f compose.production.yml logs --tail=100 caddy crm
curl -fsS "https://${CRM_DOMAIN}/api/health"
```

## 5. Crear el primer administrador

```sh
docker compose --env-file .env.production -f compose.production.yml exec crm npm run create-admin
```

Después inicia sesión en `https://crm.thenextwebec.com`. Desde **Equipo**, el administrador crea las cuentas de los ejecutivos de venta.

## 6. Respaldos y actualización

Crea un respaldo local antes de actualizar:

```sh
docker compose --env-file .env.production -f compose.production.yml exec -T crm npm run backup
```

Descarga o sincroniza los archivos de `backups/` hacia otro lugar; una copia guardada solo en la misma VM no protege ante la pérdida de la instancia.

Para actualizar desde GitHub:

```sh
git pull --ff-only
docker compose --env-file .env.production -f compose.production.yml up --build -d
docker image prune -f
```

## 7. Comprobación final

- La URL redirige a HTTPS y presenta un certificado válido.
- `/api/health` responde correctamente.
- El puerto 3000 no es accesible desde Internet.
- El administrador puede iniciar sesión.
- Un usuario de ventas solo ve sus propias oportunidades.
- Existe un respaldo descargado fuera de Oracle Cloud.
