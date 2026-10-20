# Arquitectura

La aplicación se organiza en **capas**. Cada una tiene un trabajo y sólo habla con la de debajo:

```
  Página (src/pages)            lee el formulario, llama al servicio y pinta el resultado
     │
  Servicio (src/services)       el caso de uso: permiso → validación → cambios → actividad → resultado
     │
  Repositorio (src/repos)       el SQL, y nada más (consultas y sentencias para un batch)
     │
  D1 (SQLite) · R2 (archivos)

  Reglas puras (src/lib)        cálculos sin base de datos: estados, importes, IVA, fechas, validación…
                                (las usan los servicios y las páginas; se prueban sin nada más)
```

| Capa | Puede | No puede |
|---|---|---|
| **Página** | Leer la petición, llamar a servicios, decidir qué se enseña con `can()` (botones, secciones) | Escribir SQL ni importar repositorios |
| **Servicio** | Comprobar el permiso, validar, llamar a repositorios, juntar sus sentencias en un `db.batch` (una transacción), apuntar la actividad | Escribir SQL ni usar `env` de Cloudflare (recibe un contexto) |
| **Repositorio** | SQL de su tabla o área | Decidir permisos ni importar servicios |
| **Reglas puras** | Calcular, validar, dar formato | Tocar la base de datos |

Estas reglas las comprueba `tests/architecture.test.mjs` en cada `npm test`.

## El contexto y el resultado

Cada servicio recibe un **contexto** (`ctx`) con todo lo que necesita y nada de Cloudflare:

```js
{ db, bucket, user, actor: { user, ip }, now }   // now = hoy en Madrid, 'YYYY-MM-DD'
```

En las páginas lo crea `serviceContext(Astro)` (`src/services/context.js`); en las pruebas,
`contextFor(db, email)` (`tests/helpers/context.mjs`) con una base SQLite en memoria.

Y devuelve siempre un **resultado** (`src/services/result.js`), nunca lanza por un error del usuario:

```js
{ ok: true, value }
{ ok: false, code: 'forbidden' | 'not_found' | 'invalid' | 'conflict' | 'similar' | 'renewed', message, fields }
```

La página lo trata así (`failure()` hace lo común: sin permiso → vuelve con aviso; no existe → 404):

```js
const ctx = serviceContext(Astro);
const r = await contracts.update(ctx, supplierId, id, formToObject(form));
if (r.ok) return Astro.redirect(`${self}?ok=guardado`, 303);
const back = failure(Astro, r, self);
if (back) return back;
error = r.message;      // arriba del todo
errors = r.fields;      // debajo de cada campo
```

## Permisos: en tres sitios

1. **Middleware** (`src/middleware.js`): cada ruta necesita un permiso (`SECTIONS` en `src/lib/permissions.js`);
   una ruta que no esté en la lista queda cerrada.
2. **Servicio**: cada caso de uso vuelve a comprobar su permiso. Así está protegido aunque se llame desde otra
   página, una API o una tarea programada.
3. **Datos**: el servicio sólo devuelve lo que la persona puede ver. Por ejemplo, sin `proveedores.gasto`
   el directorio y la ficha llegan **sin importes ni condiciones económicas**: la página no puede enseñarlos
   aunque se equivoque. Lo mismo en Clientes: sin `clientes.economia` no llegan ni los datos fiscales, ni el fee,
   ni lo presupuestado; y sin `cobros`, tampoco lo facturado ni lo cobrado.

## Piezas comunes

| Pieza | Dónde | Para qué |
|---|---|---|
| **Selector de una lista** (cliente, proveedor…) | `src/components/EntityPicker.astro` (el campo) y `EntityPickerKit.astro` (la lista, la ventana de alta y el script; uno por tipo y página) | Elegir de la lista sin escribir a mano; si no está, «Dar de alta» con aviso de nombres parecidos. El alta va a `/<área>/alta`, que responde `{ ok, item }` o `{ ok: false, similar }`. Un tipo nuevo se añade en `KINDS` del kit. |
| **Nombres parecidos** | `src/lib/name-match.js` | Sin tildes, mayúsculas, forma jurídica (S.L., S.A.…) ni palabras de relleno (hotel, group, España…) |
| **Archivos** | `src/services/files.js` (guardar y borrar: R2 + tabla `files`), `src/repos/files.js` (su SQL) y `src/lib/files.js` (lo puro: tipos admitidos, comprobar los primeros bytes, nombres, enlaces) | Todos los documentos (facturas y proformas de proveedor, justificantes, PO, presupuestos, contratos). `storeFile` lanza `UploadError` si el archivo no vale; el servicio lo convierte en un error del campo. **Que no se pierdan si hay un error**: la página llama a `keepUploads(ctx, form, ['file', …])` antes de usar el formulario (recupera en el `FormData` los documentos de un intento anterior, como si se acabaran de elegir), luego `done()` si sale bien o `keep()` si hay error, y pasa lo que devuelve al campo (`<FileField kept={…}>`); el servicio no cambia. |
| **Historial de cambios** | tabla `change_log`, `src/repos/changes.js` y `src/lib/changes.js` (`diffFields`) | Qué cambió en una ficha (antes y después), quién y cuándo, con un resumen ya redactado (`Fee: 8 % → 10 %`). Lo usan los clientes; un área nueva sólo añade su `entity`. |
| **Tablas de listado** | `src/lib/tables.js` (cada tabla: columnas, cuáles se ven por defecto, cuáles piden permiso, por cuáles se ordena y sus filtros), `src/lib/table.js` (el motor: `tableState` lee la dirección y las preferencias, `pageInfo`, `hrefWith`, `orderBy` para el SQL, `sortRows` para lo que se ordena en memoria), los componentes `TableTools`, `SortTh` y `Pager`, y `src/services/prefs.js` + tabla `user_prefs` (las columnas y filas por página de cada persona, que se guardan en `/preferencias/tabla`) | Expedientes, Clientes, Proveedores, Contratos y Business Travel. El servicio de cada área recibe `q`, sus filtros, `order`/`dir` y `limit`/`offset` y devuelve `{ rows, total, sums }`: el total y las sumas son de todo lo filtrado. Sólo se ordena por columnas que el rol puede ver (el servicio vuelve al orden por defecto si no). Una tabla con `views` se ve también en tarjetas (Expedientes y Business Travel empiezan en tarjetas; Clientes y Proveedores, en tabla); la vista elegida va en las mismas preferencias. Las pestañas de la página van en el hueco `tabs` de `TableTools` y el resumen, dentro. En el móvil, una tabla con la clase `is-listing` se ve en tarjetas: cada celda lleva su `data-label`, y la fila, `data-href` para abrirse entera. |

## Pruebas

| Qué | Dónde | Cómo |
|---|---|---|
| Reglas puras | `tests/*.test.mjs` | `npm test` |
| Servicios (permisos, validación, cambios en la base) | `tests/services.*.test.mjs` | `npm test`: base SQLite en memoria con todas las migraciones y los datos de ejemplo (`tests/helpers/d1.mjs`, necesita Node 22.13 o superior) |
| Reglas de la arquitectura | `tests/architecture.test.mjs` | `npm test` |
| Tipos (servicios y repositorios) | `tsconfig.check.json` | `npm run typecheck` |
| Todo lo anterior | | `npm run check` |
| Pantallas en el navegador, por rol | Playwright | (de momento, fuera del repositorio) |

El CI (`.github/workflows/comprobaciones.yml`) pasa las pruebas, los tipos y la compilación en cada cambio.

## Cómo añadir un área nueva

Así se hizo Clientes (v24), y así se hará la siguiente (p. ej. Incidencias):

1. **Migración** aditiva en `migrations/` (nunca reconstruir una tabla con referencias).
2. **Permisos** en `src/lib/permissions.js` (catálogo, dependencias y `SECTIONS` de las rutas) y su reparto en la migración.
3. **Reglas puras** en `src/lib/clients.js` (estados, cálculos) con su prueba (`tests/clients.test.mjs`).
4. **Repositorio** `src/repos/clients.js`: todo el SQL.
5. **Servicio** `src/services/clients.js`: un caso de uso por acción, cada uno con su permiso; al leer, sólo los
   datos permitidos.
6. **Pruebas del servicio** `tests/services.clients.test.mjs`: cada rol, cada error y lo que queda en la base.
7. **Páginas** en `src/pages/clientes/`: sólo servicios. Se añade la carpeta a `LAYERED` en
   `tests/architecture.test.mjs`, que lo comprueba desde entonces.
8. Si tiene un listado: su tabla en `src/lib/tables.js`, el `list` del repositorio con `LIMIT`/`OFFSET`, el total y las
   sumas en el mismo `batch` y `orderBy` con su lista de columnas, y la página con `TableTools`, `SortTh` y `Pager`
   (como `src/pages/clientes/index.astro`).

## Lo que aún no está en capas

**Business Travel** nació ya en capas (`src/services/travel.js`, `src/repos/travel.js`, `src/lib/travel.js`) y no
depende de los expedientes. Las numeraciones nuevas (referencias de reserva y, más adelante, albaranes y facturas de
Business Travel) usan `src/repos/counters.js`: un contador que se incrementa en una sola sentencia, así que nunca
sale el mismo número aunque dos personas guarden a la vez.

Los **números de expediente** también salen de un contador (`src/repos/expedientes.js`: `nextNumberStmt` y `NUMBER`), en el
mismo `db.batch` que el alta: el contador sube y el INSERT usa ese valor dentro de la misma transacción. El contador nunca
baja del mayor número usado ni del primer número de Ajustes, porque Administración puede cambiar un número a mano.

Ya están en capas Proveedores, Contratos, Clientes, la **lista de Expedientes** (`src/services/expedientes.js`,
`src/repos/expedientes.js`: pestañas, filtros, orden, páginas y sumas en una sola ida a la base) y **Pagos** (la pestaña Pagos del expediente, la ficha de cada
pago con sus facturas, proformas y justificante, y la bandeja `/pagos`; `src/services/payments.js`). Las
**liquidaciones de gastos** son pagos de tipo `liquidacion` (`payments.kind`): el mismo servicio, la misma ficha y el
mismo reembolso; lo que cambia lo decide `isLiquidation` (`src/lib/finance.js`), que las deja fuera de los avisos de
factura sin tocar el cálculo del coste. El resto
(cobros, facturas al cliente, la ficha y el cierre de los expedientes, Inicio, usuarios, ajustes) todavía hace SQL en las páginas o en `src/lib`: está
en las listas `LEGACY_*` de `tests/architecture.test.mjs`, que **sólo pueden encoger**. Orden propuesto:
cobros (facturas al cliente y PO) → ficha y cierre de expedientes → usuarios y ajustes. Cada paso, sin cambios para quien usa la
aplicación y con sus pruebas de servicio.

Mientras tanto, dos puentes (se quitan al pasar Expedientes a capas):
- `src/services/payments.js` usa `loadFinance` de `src/lib/data.js` para los importes del expediente.
- `src/lib/data.js` re-exporta las consultas de las bandejas de pagos (`src/repos/payments.js`,
  `src/repos/supplier-docs.js`) para el Inicio, y `src/lib/vat.js` la de los tipos de IVA (`src/repos/rates.js`).
