# Gestión de eventos · expedientes, pagos y facturación

Aplicación web interna para organizar los eventos (expedientes), ver el estado de los pagos a
proveedores y llevar la facturación a clientes. **Versión 1: centrada en la facturación.**

Mismo stack y misma base de estilos que `club-futsal`: **Astro 7** sobre **Cloudflare Workers**,
**D1** para los datos y **R2** para los documentos (facturas, PO, presupuestos). Todo en JavaScript.
Imagen corporativa de Seven Worlds: logo en `public/brand/` (el original y las versiones con fondo
transparente), y colores negro, blanco y amarillo `#FFCF00` definidos al principio de `src/styles/app.css`.

---

## El proceso, antes y ahora

| Paso | Antes | Ahora |
|---|---|---|
| 1. El cliente aprueba el presupuesto | — | — |
| 2. Pedir el expediente | Correo a Tania con los datos, el Excel y la previsión de pagos | **Nueva solicitud**: un formulario con todo (datos, contacto, presupuesto + total, previsión de pagos). Le aparece a Administración en su bandeja y en el contador del menú. |
| 3. Abrir el expediente | Tania lo crea a mano y le da número | Un botón: se propone el **siguiente número libre** (editable si debe coincidir con contabilidad). La previsión de pagos ya está dentro. |
| Cambios de última hora | Correos y versiones de Excel sueltas | **Versiones del presupuesto** (v1, v2…) con el archivo, el total y qué ha cambiado (+/− €). **Notas** y **actividad** en cada expediente. |
| Facturas de proveedores | Se adjuntan por correo | Se suben al expediente (PDF/foto desde el móvil). Las **previsiones** («el hotel exige 21.400 € antes del 29/01») se completan con su factura cuando llega. Lo no previsto se marca como tal. |
| Pagos | Se controlan a mano | **Bandeja de pagos** de todos los expedientes por fecha límite (vencidos, próximos 7 días, este mes…) y botón **Pagado** con fecha y forma de pago (transferencia, tarjeta…). Aviso de **pagos hechos sin factura**. |
| PO del cliente | Se reenvían a Tania por correo | Se suben al expediente. Se ve si **faltan PO** para cubrir el presupuesto y cuánto de cada PO **queda sin facturar**. |
| Facturas al cliente | Correo a Tania con las PO | **Pedir factura**: se marcan las PO que cubre (una factura puede llevar varias PO y una PO puede facturarse en varias veces) y el importe se rellena solo. Tania la ve en **Por emitir**, la hace en contabilidad y anota número, fecha y PDF. Después, **Cobrada**. |
| Cierre | Excel de cierre hecho a mano | **Pestaña Cierre** con las dos tablas del Excel (proveedores \| cliente), total neto grupo, total grupo, beneficio y % sobre ventas, calculado solo. Comprobaciones antes de cerrar, **descarga para Excel** (mismo formato) e impresión/PDF. Al cerrar queda en sólo lectura. |

### Quién hace qué

| | Gestión de eventos | Administración |
|---|:-:|:-:|
| Pedir expedientes, subir presupuestos, facturas de proveedor y PO | ✔ | ✔ |
| Registrar pagos (p. ej. con tarjeta) y pedir facturas al cliente | ✔ | ✔ |
| Dar número (abrir), cerrar, reabrir y cancelar expedientes | | ✔ |
| Emitir facturas al cliente, registrar cobros, anular | | ✔ |
| Usuarios | | ✔ |

Los permisos están en una tabla en `src/lib/app.js` (`ONLY`): cambiarlos es tocar una línea.

## Pantallas

- **Inicio**: lo que hay que mover hoy (solicitudes por abrir, pagos urgentes, facturas por emitir,
  cobros vencidos, expedientes celebrados por cerrar y actividad reciente).
- **Expedientes**: pestañas En curso · Por cerrar · Por abrir · Míos · Cerrados, y buscador.
- **Expediente**: Resumen (venta, coste, beneficio previsto, cobrado, próximos pasos, datos y actividad) ·
  Pagos · Cobros (PO y facturas) · Presupuesto (versiones) · Cierre.
- **Pagos** y **Cobros**: bandejas de trabajo con todos los expedientes.
- **Usuarios** (invitación por enlace, sin registro abierto) y **Mi cuenta**.

Importes: se pueden escribir como en el Excel (`21.400`, `1.983,47`, `-232,55`). Al escribir el importe
sin IVA se calcula el total (y al revés); con **varios tipos de IVA** se escriben los dos. Los abonos y
comisiones van en negativo. Internamente todo se guarda en céntimos para que el cierre cuadre al céntimo.

## Desarrollo local

Requisitos: Node 22.12 o superior.

```bash
cd gestion-eventos
npm install
cp .dev.vars.example .dev.vars   # claves de PRUEBA de Turnstile
npm run db:migrate               # crea las tablas en la D1 local
npm run db:demo                  # (opcional) datos de ejemplo: EXP 1287 BMW, ELECNOR, ROCHE y la solicitud de GLENMARK
npm run dev                      # http://localhost:4321
```

Con los datos de ejemplo se entra con `tania@example.com` (Administración) o `marta@example.com`
(Eventos), contraseña `demo-gestion-2026`. Sin datos de ejemplo, crea tu cuenta con
`npm run invite -- --local` (imprime el enlace de alta).

`npm test` prueba la lectura de importes, el IVA, los totales del cierre, los estados y la validación.

## Puesta en producción (Cloudflare)

```bash
npx wrangler d1 create gestion-eventos-db         # copia el database_id en wrangler.jsonc
npx wrangler r2 bucket create gestion-eventos-docs
npx wrangler secret put TURNSTILE_SECRET_KEY      # y la clave pública en "vars" de wrangler.jsonc
npm run deploy                                    # compila, aplica migraciones y publica
npm run invite -- --url https://TU-DOMINIO        # enlace para crear la primera cuenta (Administración)
```

El primer número de expediente sale de la tabla `settings` (`first_number`, 1001 por defecto);
después siempre se propone el mayor + 1.

## Seguridad

La misma base que el panel de club-futsal: contraseñas PBKDF2, sesiones en D1 con caducidad,
alta sólo por invitación, Turnstile y límite de intentos en el acceso, CSRF (Fetch Metadata + Origin),
CSP estricta con hashes y límite de escrituras por usuario. Además: **toda la aplicación exige sesión**
y los documentos nunca tienen URL pública (se sirven desde `/archivos/…` con sesión, sin caché y en
un sandbox). Se comprueba el tipo real de cada archivo por sus primeros bytes.

## Estructura

```
src/
  middleware.js     CSRF, sesión obligatoria y cabeceras
  worker.js         Entrada del Worker + limpieza diaria
  lib/              money (importes e IVA), finance (estados, totales, cierre), data (consultas),
                    validate (formularios), files (R2), actions (pagar/cobrar), auth, security…
  layouts/App.astro Menú lateral (ordenador) y barra inferior (móvil)
  components/       Cabecera y pestañas del expediente, filas de pagos/PO/facturas, formularios
  pages/            Inicio, expedientes, bandejas de pagos y cobros, usuarios, cuenta, acceso
migrations/         Esquema de D1
scripts/            invite.mjs (primera cuenta) y demo.sql (datos de ejemplo, sólo local)
tests/              npm test
```

## Ideas para las próximas versiones

- Avisos por **email** (solicitud nueva, factura pedida, pago que vence) además de la bandeja.
- **Proveedores y clientes** como fichas (CIF, datos bancarios, condiciones de pago) en vez de texto libre.
- Leer el **Excel del presupuesto** para proponer el total y las líneas automáticamente.
- Exportación a **.xlsx** con formato y fórmulas, y conexión con el programa de contabilidad.
- Previsión de **tesorería** por semanas (entradas y salidas de todos los expedientes).
