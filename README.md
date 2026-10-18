# Sitio de autor con tienda de libros

Sitio para un escritor o escritora con biografía, libros a la venta, lecturas recomendadas y redes. Todo el contenido se edita desde la misma página: al pie hay un acceso de administración, y los lectores pueden crear una cuenta para comprar.

## Qué incluye

**Para visitantes y compradores**
- Portada con el libro destacado, estante con todos los libros (precio, stock, sinopsis y ficha técnica).
- Biografía con foto, datos breves y cita.
- Lecturas recomendadas y redes sociales.
- Carrito, creación de cuenta, checkout con envío o retiro, e historial de pedidos en "Mi cuenta".

**Para el administrador** (login al pie de la página)
- Editar autor, foto, biografía y datos.
- Crear, editar, ocultar, destacar y borrar libros; subir tapas o usar tapas tipográficas de color.
- Editar lecturas recomendadas y redes (con orden).
- Ver pedidos y cambiar su estado (pendiente, pagado, enviado, entregado, cancelado). Cancelar devuelve el stock.
- Ver usuarios, crear cuentas y dar o quitar el rol de administrador.
- Ajustes: nombre del sitio, email de contacto, costo de envío, envío gratis desde cierto monto e instrucciones de pago.

> El sitio **no cobra en línea**: el comprador confirma el pedido y ve tus instrucciones de pago (alias, CBU o link de Mercado Pago). Vos marcás el pedido como pagado desde el panel.

## Correrlo en tu computadora

Necesitás Node.js 22.13 o más nuevo.

```bash
npm install
npm start
```

Abrí http://localhost:3000. La primera vez se carga contenido de ejemplo y se crea la cuenta de administración:

- Email: `admin@sitio.local`
- Contraseña: `admin12345`

Cambiala apenas entres (Mi cuenta → Contraseña). Mientras siga la inicial, el panel muestra un aviso.

En local los datos se guardan en `data/sitio.db` (SQLite). Para empezar de cero, borrá esa carpeta.

## Publicarlo en Render

Render borra el disco en cada deploy, así que en producción se usa PostgreSQL.

1. Subí la carpeta a un repositorio de GitHub.
2. En Render: **New → PostgreSQL**. Copiá la *Internal Database URL*.
3. **New → Web Service**, conectá el repositorio y configurá:
   - Build command: `npm install`
   - Start command: `npm start`
   - Variables de entorno:
     - `DATABASE_URL` = la URL de la base del paso 2
     - `ADMIN_EMAIL` = tu email de administración
     - `ADMIN_PASSWORD` = una contraseña segura (se usa solo al crear la primera cuenta admin)
     - `NODE_VERSION` = `22.13.0` (o más nuevo)
4. Deploy. Con `DATABASE_URL` definida el servidor usa PostgreSQL automáticamente y crea las tablas solo.

## Estructura

```
server.js      API (Express): cuentas, libros, pedidos, contenido y administración
db.js          SQLite en local, PostgreSQL si existe DATABASE_URL
seed.js        contenido de ejemplo inicial
public/
  index.html   estructura de la página
  styles.css   diseño (tema claro y oscuro automático)
  app.js       página pública, carrito, cuentas y panel de administración
```

## Seguridad

- Contraseñas con `scrypt` y sal aleatoria; sesiones en cookie `HttpOnly` y `SameSite=Lax`, guardadas como hash.
- Las escrituras de la API solo aceptan JSON del mismo origen (protección CSRF).
- Límite de intentos de login por IP, cabeceras de seguridad y Content-Security-Policy.
- Precios y stock se calculan en el servidor; el navegador no puede cambiar lo que paga.
- Las rutas `/api/admin/*` exigen rol de administrador.

## API

| Método | Ruta | Uso |
|---|---|---|
| GET | `/api/site` | Contenido público (y libros ocultos si sos admin) |
| POST | `/api/auth/register` · `/login` · `/logout` | Cuentas |
| GET / PUT | `/api/me`, `/api/me/password`, `/api/me/orders` | Datos y pedidos propios |
| POST | `/api/orders` | Crear pedido |
| PUT | `/api/admin/content/:key` | `settings`, `author`, `socials`, `recommendations` |
| POST / PUT / DELETE | `/api/admin/books[/:id]` | Libros |
| GET / PUT | `/api/admin/orders[/:id]` | Pedidos y estados |
| GET / POST / PUT / DELETE | `/api/admin/users[/:id]` | Usuarios y roles |
