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
- Apariencia: tamaño de letra (85 % a 130 %), color de letras, fondo y acento, con paletas listas, vista previa en vivo y aviso si el contraste es bajo.
- Ajustes: nombre del sitio, email de contacto, email del vendedor para avisos, costo de envío, envío gratis desde cierto monto e instrucciones de pago.

**Mails automáticos**
- Cuando alguien confirma una compra, el comprador recibe la confirmación con el detalle y las instrucciones de pago, y el vendedor recibe un aviso con los datos del comprador.
- Cada pedido muestra en el panel si los mails salieron bien, y tiene un botón para reenviarlos.
- En Ajustes hay un botón para mandar un mail de prueba.

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

Para probar los mails sin configurar nada, arrancá con `MAIL_LOG=1 npm start` (en Windows PowerShell: `$env:MAIL_LOG=1; npm start`). Los mails no se envían: se imprimen en la consola.

## Configurar los mails (Brevo)

El plan gratis de Render **bloquea el envío por SMTP** (puertos 25, 465 y 587), así que Gmail por SMTP no funciona ahí. Por eso el sitio envía con la API de Brevo, que va por HTTPS. El plan gratis de Brevo alcanza para una tienda chica.

1. Creá una cuenta en [brevo.com](https://www.brevo.com).
2. **Remitente:** en *Senders, domains & dedicated IPs → Senders*, agregá el email desde el que van a salir los mails y confirmalo con el código que te llega.
   - Funciona con un Gmail, pero los mails tienen más chances de caer en spam. Si tenés dominio propio, verificalo en *Domains* y usá una dirección de ese dominio.
3. **Clave de API:** en *SMTP & API → API Keys*, creá una clave y copiala (se muestra una sola vez).
4. En Render, en las variables de entorno del Web Service, agregá:

| Variable | Valor |
|---|---|
| `BREVO_API_KEY` | la clave del paso 3 |
| `MAIL_FROM` | el remitente verificado del paso 2 |
| `MAIL_FROM_NAME` | (opcional) el nombre que ve el destinatario, por ejemplo el del autor |
| `SITE_URL` | (opcional) la dirección pública, por ejemplo `https://sitio-autor-xxxx.onrender.com`, para los enlaces de los mails |

5. Guardá. Render reinicia el servicio solo.
6. En el sitio, entrá al panel → **Ajustes**, cargá el **Email del vendedor** (donde querés recibir los avisos), guardá y tocá **Enviar mail de prueba**.

Si un mail falla, el pedido se registra igual y el error aparece en la tarjeta del pedido.

**Alternativa SMTP** (solo en tu PC o en un plan pago de Render): en lugar de `BREVO_API_KEY`, definí `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` y `MAIL_FROM`. Con Gmail: host `smtp.gmail.com`, puerto `465` y una *contraseña de aplicación* de tu cuenta de Google, no tu contraseña normal.

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
     - `BREVO_API_KEY`, `MAIL_FROM` y las demás de la sección de mails
4. Deploy. Con `DATABASE_URL` definida el servidor usa PostgreSQL automáticamente y crea las tablas solo.

## Estructura

```
server.js      API (Express): cuentas, libros, pedidos, contenido y administración
db.js          SQLite en local, PostgreSQL si existe DATABASE_URL (con migraciones)
mailer.js      envío de mails (Brevo, SMTP o consola) y plantillas de los mails
seed.js        contenido de ejemplo inicial
public/
  index.html   estructura de la página
  styles.css   diseño (tema claro y oscuro automático)
  theme.js     cálculo de colores de la apariencia (lo usan el navegador y el servidor)
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
| PUT | `/api/admin/content/:key` | `settings`, `author`, `socials`, `recommendations`, `appearance` |
| POST / PUT / DELETE | `/api/admin/books[/:id]` | Libros |
| GET / PUT | `/api/admin/orders[/:id]` | Pedidos y estados |
| POST | `/api/admin/orders/:id/resend` | Reenviar los mails de un pedido |
| POST | `/api/admin/test-email` | Mail de prueba |
| GET / POST / PUT / DELETE | `/api/admin/users[/:id]` | Usuarios y roles |
