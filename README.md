# Pagos — SPEI

API NestJS para **generar CLABEs SPEI** con Mercado Pago (Orders API), recibir el **webhook** de acreditación y un **dashboard web** con grid para ver los SPEIs generados y su estado.

Funcionalidad portada de `D:\Servia\mercadopago-nest` (solo la parte SPEI; se omitieron tarjetas y Point Smart).

## Arranque

```bash
npm install
```

```bash
npm run start:dev
```

| Recurso | URL |
| --- | --- |
| Dashboard | http://localhost:3005/ |
| API | http://localhost:3005/api |
| Swagger | http://localhost:3005/api/docs |

## Base de datos

Misma conexión que `mercadopago-nest`: **MySQL `MercadoPagoBD`** (`216.238.84.5`), configurada en `.env`.

Este proyecto **no escribe en la tabla `Payments`** compartida, sino en su propia tabla **`SpeiPayments`** dentro de la misma BD. Motivo: `Payments` no guarda CLABE, banco ni fecha de expiración, que es justo lo que necesita el dashboard.

`synchronize` está en `false` (BD compartida). La tabla propia se crea sola al arrancar con un `CREATE TABLE IF NOT EXISTS` idempotente — ver `SpeiService.ensureSchema()` en [spei.service.ts](src/spei/spei.service.ts). No altera ninguna tabla existente.

## Endpoints

| Método | Ruta | Descripción |
| --- | --- | --- |
| `POST` | `/api/spei` | Genera la CLABE SPEI |
| `POST` | `/api/spei/webhook` | Webhook de Mercado Pago (evento **Pagos**) |
| `GET` | `/api/spei` | Grid: lista paginada con filtros |
| `GET` | `/api/spei/stats` | Tarjetas: totales por estado |
| `GET` | `/api/spei/:id` | Detalle desde la BD (OrderId o PaymentId) |
| `GET` | `/api/spei/mp/:id` | Consulta directa a Mercado Pago |
| `PUT` | `/api/spei/:id/refresh` | Re-sincroniza contra MP y actualiza la BD |
| `PUT` | `/api/spei/:id/simulate` | 🧪 Reproduce el webhook sin esperar a MP |

### Generar un SPEI

```bash
curl -X POST http://localhost:3005/api/spei -H "Content-Type: application/json" -d "{\"transaction_amount\":150.50,\"payer\":{\"email\":\"comprador@ejemplo.com\"},\"business_name\":\"MiProyecto\",\"description\":\"Pago de servicio\",\"external_reference\":\"orden-123\"}"
```

Respuesta: `clabe`, `referencia`, `banco`, `date_of_expiration`, `order_id`, `payment_id`.

### Filtros del grid

`GET /api/spei?status=pending&search=ORD01K&from=2026-07-01&to=2026-07-31&page=1&limit=25`

`status`: `all` · `pending` · `accredited` · `failed`

## Webhook

Configurar en el panel de Mercado Pago, evento **"Pagos"**, apuntando a:

```
https://tudominio.com/api/spei/webhook
```

- Acepta tanto el id de la **orden** (`ORD...`) como el id numérico del **pago**; resuelve a la orden cuando existe.
- **Concilia** el registro pendiente por `external_reference` + monto para no duplicar filas (MP entrega un id distinto al de creación).
- Devuelve **200** si el recurso no existe (404 en MP) y **500** ante fallos transitorios, para que MP reintente.
- Si `MP_WEBHOOK_FORWARD_URL` está configurada, reenvía el evento ya procesado una sola vez (bandera `Notified`).

## Notas de Mercado Pago

- SPEI usa **Orders API** (`/v1/orders`) y **no acepta credenciales `TEST-`**. Requiere `APP_USR`.
- Para probar en sandbox: credenciales `APP_USR` + comprador `@testuser.com` (`MP_TEST_BUYER_EMAIL`).
- MP devuelve `processing_error` de forma intermitente al emitir CLABEs. El servicio reintenta 3 veces y, si aun así falla, **reutiliza una CLABE pendiente** con la misma referencia y monto en vez de crear otra orden.

## Dashboard

`public/` — HTML/CSS/JS sin build ni dependencias, servido por Nest como estático.

Tarjetas (total, pendientes, acreditados, vencidos, tasa de conversión) clicables como filtro, búsqueda, rango de fechas, paginación, auto-refresh cada 30s, modal para generar SPEI y modal de detalle con la CLABE copiable.
