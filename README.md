# Sitio de autor con tienda de libros

Sitio para un escritor o escritora con biografía, libros a la venta, lecturas recomendadas y redes. Todo el contenido se edita desde la misma página: al pie hay un acceso de administración, y los lectores pueden crear una cuenta para comprar.

## Qué incluye

**Para visitantes y compradores**
- Portada con el libro destacado, estante con todos los libros (precio, stock, sinopsis y ficha técnica).
- Biografía con foto, datos breves y cita.
- Lecturas recomendadas y redes sociales.
- Carrito, creación de cuenta, checkout con envío o retiro, e historial de pedidos en "Mi cuenta".
- Pago con **Mercado Pago** (tarjeta, débito o dinero en cuenta) o por transferencia. Si un pago falla, se puede reintentar desde "Mi cuenta".
- **Comentarios** públicos: cualquier usuario registrado puede comentar (en general o sobre un libro), borrar los suyos y denunciar los de otros.
- **¿Olvidaste tu contraseña o tu email?**: llega un mail con el usuario (email de la cuenta) y un link para crear una contraseña nueva. El link sirve una sola vez y vence en una hora. Después del cambio llega un aviso de seguridad.

**Para el administrador** (login al pie de la página)
- Editar autor, foto, biografía y datos.
- Crear, editar, ocultar, destacar y borrar libros; subir tapas o usar tapas tipográficas de color.
- Editar lecturas recomendadas y redes (con orden).
- Ver pedidos y cambiar su estado (pendiente, pagado, enviado, entregado, cancelado). Cancelar devuelve el stock.
- Moderar comentarios: editar (queda marcado "Editado por moderación"), ocultar, aprobar, borrar y ver denuncias. Opcional: revisar cada comentario antes de publicarlo.
- Ver usuarios, crear cuentas, dar o quitar el rol de administrador y enviarle a cualquier usuario el link para crear una contraseña nueva.
- Apariencia: tamaño de letra (85 % a 130 %), color de letras, fondo y acento, con paletas listas, vista previa en vivo y aviso si el contraste es bajo.
- Ajustes: nombre del sitio, email de contacto, email del vendedor para avisos, costo de envío, envío gratis desde cierto monto e instrucciones de pago.

**Mails automáticos**
- Cuando alguien confirma una compra, el comprador recibe la confirmación con el detalle y las instrucciones de pago, y el vendedor recibe un aviso con los datos del comprador.
- Cada pedido muestra en el panel si los mails salieron bien, y tiene un botón para reenviarlos.
- En Ajustes hay un botón para mandar un mail de prueba.

> Con **Mercado Pago**, el pedido pasa a "pagado" solo cuando Mercado Pago confirma el pago. Con **transferencia**, el comprador ve tus instrucciones de pago y vos marcás el pedido como pagado desde el panel.

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

## Configurar Mercado Pago

El sitio usa **Checkout Pro**: el comprador confirma el pedido, va a la página de Mercado Pago, paga y vuelve al sitio. El pago se verifica siempre consultando la API de Mercado Pago con tu Access Token, así que nadie puede marcar un pedido como pagado modificando la URL.

1. Entrá a [Mercado Pago Developers](https://www.mercadopago.com.ar/developers) con tu cuenta y creá una **aplicación** (tipo de pago: pagos online, producto: Checkout Pro).
2. En la aplicación, abrí **Credenciales**:
   - Para probar: copiá el **Access Token de prueba** y usá las tarjetas de prueba de la documentación de Mercado Pago (no se cobra nada).
   - Para cobrar de verdad: activá las credenciales de producción y copiá ese **Access Token**.
3. En Render → tu Web Service → **Environment**, agregá `MP_ACCESS_TOKEN` con ese token y guardá con deploy.
4. En el panel → **Ajustes** vas a ver si está en modo prueba o producción. En el checkout aparece la opción "Mercado Pago".

Detalles:
- Mercado Pago **no acepta `localhost`** para volver al sitio ni para avisar pagos. Probalo en Render (https). En tu PC podés simular todo el circuito con `MP_MOCK=1 npm start`: aparece una pantalla falsa con "Aprobar pago" y "Rechazar pago".
- El sitio recibe avisos automáticos en `/api/mp/webhook`, así un pago que se acredita más tarde (por ejemplo, en efectivo) igual marca el pedido como pagado.
- Al acreditarse el pago llega un mail al comprador ("Pago recibido") y otro a vos ("Pago acreditado").
- Si un pago se aprueba para un pedido que ya cancelaste, el pedido no cambia y queda un aviso en los logs: tenés que devolver el dinero desde Mercado Pago.
- Los pedidos sin pagar reservan el stock. Si no se pagan, cancelalos desde el panel y el stock vuelve.

## Comentarios

- Se ven en la sección **Comentarios** de la portada. Para comentar hay que tener cuenta (la misma de compras).
- Límite: un comentario cada 30 segundos y 20 por día por usuario, de hasta 1000 caracteres.
- En **Ajustes → Comentarios** podés cerrarlos, activar la **revisión previa** (no se publican hasta que los aprobás, y te llega un mail por cada uno) y escribir las **normas** que se muestran junto al formulario.
- En **Panel → Comentarios** filtrás por denunciados, pendientes u ocultos. Como admin también ves los botones de moderación directamente en la página.

## Recuperar contraseñas

Las contraseñas se guardan con `scrypt` (un hash de un solo sentido): **nadie puede leerlas, ni siquiera el administrador**, así que el sitio nunca las envía por mail. En su lugar manda:

- el **usuario** de la cuenta (su email), para quien no recuerda con cuál se registró;
- un **link de un solo uso** que vence en 60 minutos, para crear una contraseña nueva. Al usarlo se cierran todas las sesiones abiertas de esa cuenta.

La respuesta del formulario es la misma exista o no la cuenta, para no revelar qué emails están registrados. Hay un límite de 3 pedidos por hora por email.

Necesita los mails configurados (ver arriba). Si no lo están, el formulario le indica al usuario que escriba al email de contacto.

**Si el administrador pierde su contraseña y los mails no funcionan:**

1. En Render, agregá la variable `ADMIN_RESET_PASSWORD` con una contraseña nueva (8 caracteres o más).
2. Esperá que se reinicie y entrá con tu `ADMIN_EMAIL` y esa contraseña.
3. **Borrá la variable** y guardá. Si la dejás, la contraseña se vuelve a pisar en cada reinicio.

## Estructura

```
server.js      API (Express): cuentas, libros, pedidos, contenido y administración
db.js          SQLite en local, PostgreSQL si existe DATABASE_URL (con migraciones)
mailer.js      envío de mails (Brevo, SMTP o consola) y plantillas de los mails
payments.js    Mercado Pago (Checkout Pro) por API REST, con modo simulado
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
| POST | `/api/auth/forgot` | Pedir el mail de recuperación |
| GET / POST | `/api/auth/reset` | Validar el link y guardar la contraseña nueva |
| GET / PUT | `/api/me`, `/api/me/password`, `/api/me/orders` | Datos y pedidos propios |
| POST | `/api/orders` | Crear pedido (con `payment: "mercadopago"` devuelve el link de pago) |
| POST | `/api/orders/:id/pay` | Pagar o reintentar con Mercado Pago un pedido pendiente propio |
| POST | `/api/mp/confirm` · `/api/mp/webhook` | Verificar pagos con la API de Mercado Pago |
| GET / POST / DELETE | `/api/comments[/:id]` | Ver, publicar y borrar comentarios |
| POST | `/api/comments/:id/report` | Denunciar un comentario |
| PUT | `/api/admin/comments/:id` | Editar, ocultar, aprobar o quitar denuncias |
| PUT | `/api/admin/content/:key` | `settings`, `author`, `socials`, `recommendations`, `appearance` |
| POST / PUT / DELETE | `/api/admin/books[/:id]` | Libros |
| GET / PUT | `/api/admin/orders[/:id]` | Pedidos y estados |
| POST | `/api/admin/orders/:id/resend` | Reenviar los mails de un pedido |
| POST | `/api/admin/test-email` | Mail de prueba |
| GET / POST / PUT / DELETE | `/api/admin/users[/:id]` | Usuarios y roles |
| POST | `/api/admin/users/:id/send-reset` | Enviarle a un usuario el link de contraseña |
