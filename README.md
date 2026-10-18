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
| Facturas de proveedores | Se adjuntan por correo | Se suben al pago (PDF/foto desde el móvil) indicando si es **factura** o **proforma**. Un pago puede tener **varias facturas y proformas**, y una factura puede cubrir **varios pagos** (dos anticipos y una única factura; se comprueba que su total cuadra). El orden de cada pago es **① justificante → ② pagado → ③ factura conforme**: la factura se da por **conforme** (verde, «Con factura») cuando el pago está hecho; mientras tanto queda «recibida» y en la bandeja sale en «Esperando el pago». La **campana** sólo avisa de las facturas que ya se pueden conformar (de pagos hechos). Las proformas no avisan a nadie. Administración puede borrar la factura o proforma vieja y dejar la nueva, pero una factura **conforme no se puede borrar**: se sube otra con un **comentario** de por qué, y vuelve a avisar. Las **previsiones** («el hotel exige 21.400 € antes del 29/01») se completan cuando llegan los documentos. Se pueden ir **añadiendo pagos** en cualquier momento, de uno en uno o **varios de golpe**; el importe se escribe **con IVA** y el sin IVA se calcula. |
| Pagos | Se controlan a mano | **Bandeja de pagos** de todos los expedientes por fecha límite (vencidos, próximos 7 días, este mes…) y botón **Pagado** con fecha y forma de pago (transferencia, tarjeta…). Para marcar pagado un pago **por transferencia** hay que subir antes el **justificante bancario**: si falta, sale un aviso. Un **pago hecho no se modifica** (ni importe, ni fecha, ni justificante, ni se borra); si hubo un error, Administración puede **«Deshacer pagado»**, que queda en la actividad. A un pago hecho se le pueden seguir subiendo facturas y proformas. Aviso de **pagos hechos sin factura**. |
| PO del cliente | Se reenvían a Tania por correo | Se suben al expediente. Se ve si **faltan PO** para cubrir el presupuesto y cuánto de cada PO **queda sin facturar**. Una PO queda facturada cuando las facturas al cliente la cubren: el botón **Facturar** de la PO abre la factura con esa PO marcada y su saldo. Si el resto no se va a facturar (el evento costó menos, el cliente la recortó…), se **cierra la PO** con un motivo y deja de contar como pendiente (se puede reabrir). |
| Facturas al cliente | Correo a Tania con las PO | **Pedir factura**: se marcan las PO que cubre (una factura puede llevar varias PO y una PO puede facturarse en varias veces) y el importe se rellena solo. Tania la ve en **Por emitir**, la hace en contabilidad y anota número, fecha y PDF. Después, **Cobrada**. |
| Cierre | Excel de cierre hecho a mano | **Pestaña Cierre** con las dos tablas del Excel (proveedores \| cliente), total neto grupo, total grupo, beneficio y % sobre ventas, calculado solo. Comprobaciones antes de cerrar, **descarga para Excel** (mismo formato) e impresión/PDF. Al cerrar queda en sólo lectura. |

### Quién hace qué

| | Gestión de eventos | Administración |
|---|:-:|:-:|
| Pedir expedientes, subir presupuestos, facturas de proveedor y PO | ✔ | ✔ |
| Registrar pagos (p. ej. con tarjeta) y pedir facturas al cliente | ✔ | ✔ |
| Dar número (abrir), cerrar, reabrir y cancelar expedientes | | ✔ |
| Revisar y dar por buenas las facturas de proveedor (con el pago ya hecho) | | ✔ |
| «Deshacer pagado» para corregir un pago hecho | | ✔ |
| Borrar facturas o proformas de proveedor de otras personas (nunca una factura conforme) | | ✔ |
| Emitir facturas al cliente, registrar cobros, anular | | ✔ |
| Usuarios y Ajustes (tipos de IVA, numeración) | | ✔ |

Los permisos están en una tabla en `src/lib/app.js` (`ONLY`): cambiarlos es tocar una línea.

## Pantallas

- **Inicio**: lo que hay que mover hoy (solicitudes por abrir, pagos urgentes, facturas por emitir,
  cobros vencidos, expedientes celebrados por cerrar y actividad reciente). A Eventos le sale arriba **«Te toca»**:
  las facturas que reclamar a proveedores (pagos ya hechos sin factura) y las que pedir al cliente (PO sin facturar)
  de sus expedientes.
- **Buscar** (cabecera): expedientes, proveedores, nº de factura o proforma, facturas al cliente y PO. Un número de
  expediente exacto (`1287`) abre directamente el expediente.
- **Expedientes**: pestañas En curso · Por cerrar · Por abrir · Míos · Cerrados, y buscador.
- **Expediente**: Resumen (venta, coste, beneficio previsto, cobrado, próximos pasos, datos y actividad) ·
  Pagos · Cobros (PO y facturas) · Presupuesto (versiones) · Cierre. Cada próximo paso lleva a donde se resuelve:
  si es de una sola cosa (un pago vencido, una factura por emitir…), directamente a su ficha.
- **Navegación**: arriba, las **migas de pan** dicen dónde estás (`Expedientes › EXP 1287 › Pagos › Hotel…`) y cada
  paso es un enlace; en el móvil sólo sale el anterior («← Pagos»). Si se ha entrado desde una bandeja (Inicio, Pagos,
  Facturas por revisar, Cobros, una búsqueda), sale **«Volver a …»** para regresar a ella; si se vino de la lista de
  expedientes, la miga «Expedientes» vuelve con sus filtros y su búsqueda.
- **Pagos** y **Cobros**: bandejas de trabajo con todos los expedientes, con **buscador** en todas las pestañas:
  pendientes, **facturas de proveedor por revisar** y el **historial** de lo pagado y lo cobrado por meses.
  Para pagar por transferencia se adjunta el **justificante en la misma fila** (o desde el aviso, si falta) y queda
  pagado de una vez, sin entrar en la ficha.
- Cada pago, PO y factura tiene su **ficha** (botón «Ver»): de qué era, su documento, el desglose de IVA y
  cuándo se pagó o cobró. En la ficha de una PO: las facturas que la cubren, «Facturar», «Cerrar PO» y «Reabrir». En la ficha de un pago:
  los **pasos 1 · 2 · 3** (justificante, pagado, factura conforme) con lo que falta en cada uno, «Justificante · Pago»
  (subir el justificante y marcarlo pagado; «Deshacer pagado» para Administración), sus facturas y proformas (subir otra, elegir una ya
  subida si cubre varios pagos, revisarla con su número, borrar las que no estén conformes), «Otro pago a este proveedor» y borrar.
- Las sugerencias de proveedores y clientes salen al escribir (no al entrar en el campo) y el navegador no propone lo
  escrito otras veces: al entrar en un campo sólo se ve su ejemplo.
- Todo lo que borra o quita algo pide **confirmación** en una ventana propia de la aplicación.
- **Ajustes** (Administración): los **tipos de IVA** que salen en todos los desplegables (añadir, quitar,
  marcar el de por defecto; admite decimales y otros impuestos como el IGIC) y el primer número de expediente.
- **Usuarios** (invitación por enlace, sin registro abierto) y **Mi cuenta**.

Importes: se pueden escribir como en el Excel (`21.400`, `1.983,47`, `-232,55`). Cada importe tiene **una línea
por tipo de IVA** (p. ej. alojamiento al 10 % y servicios al 21 %): en cada línea se escribe el importe sin IVA o
con IVA y el otro se calcula; si se escriben los dos (copiados de la factura) se respetan. Los abonos y comisiones
van en negativo. Internamente todo se guarda en céntimos y el tipo en puntos básicos (21 % → 2100) para que el
cierre cuadre al céntimo. El desglose de cada importe se guarda junto a él, así que quitar un tipo de la lista no
cambia nada de lo ya guardado.

## Desarrollo local

Requisitos: Node 22.12 o superior.

```bash
cd gestion-eventos
npm install
cp .dev.vars.example .dev.vars   # claves de PRUEBA de Turnstile
npm run db:migrate               # crea las tablas en la D1 local (y aplica las migraciones nuevas)
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

## Base de datos y rendimiento

- Cada pantalla pide a D1 lo que necesita **a la vez** (en paralelo o en un `batch`), no una consulta detrás de otra;
  los contadores del menú se piden en el middleware mientras se cargan los datos de la página.
- Las consultas van por **índices** (expediente, estado y fecha de los pagos, facturas y PO, documentos de cada pago).
  Los historiales «Pagados» y «Cobradas» se leen ya ordenados por fecha y se paran en los últimos 300 (migración 0006).
- Las bandejas sólo recorren lo que está en marcha (p. ej. «PO sin facturar» sólo mira los expedientes abiertos), así
  que no se hacen más lentas con los años de histórico.
- El resumen de documentos de cada pago (facturas, proformas, pendientes de revisar) se calcula en la misma consulta
  de la lista, sin una consulta por fila.
- Las sugerencias de proveedores y clientes (autocompletar) se guardan 5 minutos en memoria.
- Para revisar los planes de las consultas: `EXPLAIN QUERY PLAN` sobre la base local (`.wrangler/state/v3/d1/…`).

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
  lib/              money (importes), vat (tipos de IVA y desglose), finance (estados, totales, cierre), data (consultas),
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
