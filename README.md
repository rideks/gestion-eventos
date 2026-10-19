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
| Cambios de última hora | Correos y versiones de Excel sueltas | **Versiones del presupuesto** (v1, v2…) con el archivo, el total y qué ha cambiado (+/− €); si a una versión le falta el documento, se sube después desde su fila del historial. Al subir una versión nueva, **Cobros se recalcula** con ella: las PO y las facturas se mantienen, lo que falta por facturar es el presupuesto vigente menos lo facturado o pedido, y avisa si hace falta otra PO por la diferencia, si las PO superan el presupuesto o si se ha facturado de más. **Notas** y **actividad** en cada expediente. |
| Facturas de proveedores | Se adjuntan por correo | Se suben al pago (PDF/foto desde el móvil) indicando si es **factura** o **proforma**. Un pago puede tener **varias facturas y proformas**, y una factura puede cubrir **varios pagos** (dos anticipos y una única factura; se comprueba que su total cuadra). La ficha de cada pago sigue el orden **① factura o proforma del proveedor → ② justificante y pago → ③ factura conforme**: la factura se da por **conforme** (verde, «Con factura») cuando el pago está hecho; mientras tanto queda «recibida» y en la bandeja sale en «Esperando el pago». La **campana** sólo avisa de las facturas que ya se pueden conformar (de pagos hechos). Las proformas no avisan a nadie. Administración puede borrar la factura o proforma vieja y dejar la nueva, pero una factura **conforme no se puede borrar**: se sube otra con un **comentario** de por qué, y vuelve a avisar. Las **previsiones** («el hotel exige 21.400 € antes del 29/01») se completan cuando llegan los documentos. Se pueden ir **añadiendo pagos** en cualquier momento, de uno en uno o **varios de golpe**; el importe se escribe **con IVA** y el sin IVA se calcula. |
| Pagos | Se controlan a mano | **Bandeja de pagos** de todos los expedientes por fecha límite (vencidos, próximos 7 días, este mes…) y botón **Pagado** con fecha y forma de pago (transferencia, tarjeta…). Desde Eventos sólo se marcan los pagos hechos **con tarjeta** («Pagado con tarjeta»); las transferencias y los demás los marca Administración. Para marcar pagado un pago **por transferencia** hay que subir antes el **justificante bancario**: si falta, sale un aviso. Un **pago hecho no se modifica** (ni importe, ni fecha, ni justificante, ni se borra); si hubo un error, Administración puede **«Deshacer pagado»**, que queda en la actividad. A un pago hecho se le pueden seguir subiendo facturas y proformas. Aviso de **pagos hechos sin factura**. |
| PO del cliente | Se reenvían a Tania por correo | Las sube **Administración** al expediente (Eventos las ve, pero no las sube ni las toca). Se ve si **faltan PO** para cubrir el presupuesto y cuánto de cada PO **queda sin facturar**. Al guardar la PO se elige **«Guardar PO y crear la factura»**, que lleva directamente a la factura con esa PO marcada y su saldo, o «Sólo guardar la PO». Una PO queda facturada cuando las facturas al cliente la cubren: el botón **Facturar** de la PO hace lo mismo más tarde. Si el resto no se va a facturar (el evento costó menos, el cliente la recortó…), se **cierra la PO** con un motivo y deja de contar como pendiente (se puede reabrir). |
| Facturas al cliente | Correo a Tania con las PO | Un expediente puede tener **una o varias facturas**, con o sin PO (una factura puede llevar varias PO y una PO puede facturarse en varias veces). La factura se hace **en la aplicación**, en su propia página: cliente con sus **datos fiscales** (NIF/CIF, dirección fiscal y email de facturación, que se rellenan solos si ya se le ha facturado), PO que cubre, concepto e importe por tipo de IVA. Eventos la **pide** (queda «Por emitir»); Administración la **emite** y recibe sola el **número siguiente**, correlativo y **único** (`G/000904/26/01`; formato y próximo número en Ajustes). Una factura emitida **no se modifica**: si tiene un error, se anula y se hace otra. Después se **envía al cliente**: de momento el envío es **simulado** (se enseña el correo tal y como saldría y queda apuntado a quién, cuándo y quién lo envió, pero no sale ningún correo). «Ver la factura» la enseña lista para imprimir o guardar en PDF (hasta tener la plantilla de contabilidad). Después, **Cobrada**. |
| Cierre | Excel de cierre hecho a mano | **Pestaña Cierre** con las dos tablas del Excel (proveedores \| cliente), total neto grupo, total grupo, beneficio y % sobre ventas, calculado solo. Comprobaciones antes de cerrar, **descarga para Excel** (mismo formato) e impresión/PDF. Al cerrar queda en sólo lectura. |

### Volumen de negocio con cada proveedor (cómo se calcula)

Siempre **sin IVA**, sólo con **expedientes no cancelados** y a partir de las líneas de pago (nada se apunta a
mano, así que no se desactualiza). Cada línea cuenta una vez: los importes de las facturas del proveedor no se
suman (una factura puede cubrir varios pagos).

| Indicador | Qué suma |
|---|---|
| Contratado | Las líneas de coste del proveedor (importe positivo), previstas o ya facturadas |
| Con factura | La parte de lo contratado cuyas líneas tienen al menos una **factura** (no proforma) |
| Pagado / Pendiente de pago | La parte de lo contratado ya pagada / por pagar |
| Abonos y comisiones | Las líneas en negativo (abonos, comisiones del hotel, devoluciones), aparte |
| En el año | Lo contratado en eventos de ese año (fecha de inicio del expediente) |
| Expedientes / media | En cuántos expedientes aparece y lo contratado de media por expediente |

### Contratos con proveedores (estados y avisos)

Cada proveedor puede tener **varios contratos o acuerdos**, vigentes e históricos, con sus fechas (firma, inicio,
fin), tarifas, descuentos, condiciones de pago y de crédito, otros acuerdos, comentarios y el documento firmado.
El estado **no se apunta**: se calcula cada día por fechas.

| Estado | Cuándo |
|---|---|
| Vigente | En vigor (con fecha de fin o indefinido) |
| Próximo a caducar | Faltan menos días que los del **aviso de ese contrato** (cada uno tiene el suyo; vacío = sin aviso) |
| Pendiente de renovación | Marcado a mano: hay que negociar la renovación |
| Caducado | Terminó y no se ha renovado ni se ha decidido no renovarlo |
| Renovado / Finalizado | Historial: terminó y tiene su renovación / se decidió no renovarlo |
| Aún no vigente | Firmado, pero empieza más adelante |

Próximo a caducar, pendiente de renovación y caducado **requieren atención**: salen en el
inicio, con un contador en «Proveedores» del menú y en «Contratos». **Renovar** crea un contrato nuevo con las
condiciones del anterior ya escritas y el anterior se conserva tal cual; **modificar** un contrato deja en su
historial qué cambió (antes y después), quién y cuándo. El **contrato aplicado** a cada expediente es el que estaba
en vigor en la fecha del evento, así que cambiar las condiciones actuales no reescribe los expedientes pasados.

### Clientes: relación económica (cómo se calcula)

Cada cliente tiene su **ficha** (nombre comercial, datos fiscales, contacto, acuerdo de pago, fee, inicio de la
relación y comentarios) y **otras entidades** a las que se le factura (p. ej. los concesionarios de BMW, cada uno con
su NIF). Las cifras **no se apuntan**: se calculan desde sus expedientes **no cancelados**.

| Indicador | Qué suma | IVA |
|---|---|---|
| Presupuestado | La versión vigente del presupuesto de cada expediente: el volumen contratado | Sin IVA |
| Facturado | Facturas al cliente emitidas o cobradas | Sin IVA |
| Cobrado | Facturas cobradas: lo que ha entrado en el banco | Con IVA |
| Pendiente de cobro | Facturas emitidas que aún no se han cobrado | Con IVA |
| En el año / por año | Lo presupuestado en eventos de ese año (fecha de inicio), con el cambio respecto al anterior | Sin IVA |
| Fee aplicado de media | El fee de sus expedientes, ponderado por el presupuesto de cada uno | — |
| Antigüedad | Desde el **inicio de la relación** si se sabe; si no, desde su primer evento registrado | — |

Lo facturado no es beneficio y lo pendiente todavía no se ha cobrado: se enseñan por separado, con su IVA indicado.

**El fee** (comisión o margen pactado, en %) es el **vigente** del cliente y **se copia en cada expediente nuevo**.
Cambiarlo en la ficha no cambia el de los expedientes ya pedidos (cada uno conserva el que se le aplicó, y se puede
ajustar en «Editar datos» del expediente). Cada cambio del fee, del acuerdo de pago o de los datos fiscales queda en el
**historial de la ficha**: antes y después, quién y cuándo (`Fee: 8 % → 10 %`).

### Business Travel: reservas, servicios y PVP (cómo se calcula)

Reservas de viajes de empresa, **aparte de los expedientes** (no los usan ni los cambian). Cada reserva es de un
cliente de la ficha de Clientes y recibe una referencia única y correlativa (`BT-2026-0001`) que no se reutiliza
aunque se borre una reserva vacía. Tiene sus **pasajeros** (con tratamiento Dr./Dra., email y teléfono) y sus
**servicios** en cuatro bloques, cada uno con las filas que haga falta:

| Bloque | Lo que se apunta |
|---|---|
| Transporte | Proveedor (Ryanair, Iryo…), trayecto, ida y vuelta, localizador, fecha de emisión, pasajeros |
| Alojamiento | Proveedor (Restel, Booking, Hoteles NH…), establecimiento, check-in y check-out, nº de reserva, huéspedes |
| Inscripción | Inscripción o evento, fechas, nº de inscripción y su asistente (uno) |
| Otros | Descripción, proveedor y pasajeros si los hay |

Los proveedores salen del directorio de Proveedores (con los tipos Aerolínea, Tren, Central de reservas e
Inscripciones y congresos); si no está, se da de alta desde el mismo selector.

Importes de cada servicio (en céntimos; nada se redondea dos veces):

| Importe | Cómo |
|---|---|
| Sin IVA / con IVA | Se escribe uno y el otro se calcula con el % de IVA: con IVA = sin IVA × (1 + IVA). Si se escriben los dos (copiados de la factura del proveedor), se respetan. Se propone el 10 % en transporte y alojamiento y el 21 % en inscripciones |
| Fee oculto | Lo que se cobra además del servicio. Sólo lo ven y lo cambian quienes tienen «Ver y cambiar el fee interno»; nunca sale en los documentos del cliente |
| PVP | Con IVA + fee |

El resumen de la reserva (total sin IVA, con IVA, fees y PVP) suma sus servicios: un hotel con dos huéspedes es
un servicio con un importe, así que los pasajeros no duplican nada. Una reserva **cancelada** queda de sólo
lectura (se puede reabrir); cada cambio queda en su historial.

Estado de una reserva (como los expedientes):

| Estado | Cuándo |
|---|---|
| En curso | Abierta y el viaje no ha terminado (o aún no tiene servicios: «Sin servicios»); «De viaje» mientras dura |
| Viaje hecho · por cerrar | Ya pasó la fecha de su último servicio y nadie la ha cerrado |
| Cerrada | Alguien con «Cerrar y reabrir reservas» la cerró. Sólo lectura; se puede reabrir |
| Cancelada | Se canceló. Sólo lectura; se puede reabrir |

Para **cerrar** una reserva, en su ficha («Antes de cerrar») tienen que estar en verde: tiene servicios, el viaje ha
terminado, cada servicio tiene sus pasajeros y los servicios de transporte, alojamiento e inscripción tienen su
localizador o número de reserva (en «Otros», p. ej. un taxi, no siempre lo hay). Cuando haya albaranes y facturas de
Business Travel, pedirá además que esté facturada.

### Quién hace qué (roles y permisos)

Cada persona tiene **un rol** y cada rol, una lista de **permisos** (lista blanca: lo que no tiene marcado, no
lo puede hacer). Se gestionan desde **Usuarios y permisos** (sólo el rol Técnico): invitar a personas, cambiarles
el rol, crear roles nuevos (en blanco o copiando otro) y marcar sus permisos. Los cambios valen al momento y
quedan registrados. Siempre tiene que quedar al menos una persona activa que pueda gestionar usuarios.

Reparto inicial:

| Permiso | Jefes | Administración | Tesorería | Eventos | Técnico |
|---|:-:|:-:|:-:|:-:|:-:|
| Ver y trabajar en los expedientes (pedirlos, presupuesto, pagos previstos, documentos, notas) | ✔ | ✔ | ✔ | ✔ | |
| Abrir expedientes (darles número) | ✔ | ✔ | | | |
| Cerrar, reabrir y cancelar expedientes | ✔ | ✔ | | | |
| Borrar lo que han subido otras personas (nunca una factura conforme) | ✔ | ✔ | | | |
| Bandeja de pagos y marcar pagado **con tarjeta** | ✔ | ✔ | ✔ | ✔ | |
| Marcar pagado por transferencia u otro medio · justificante bancario · «Deshacer pagado» | ✔ | ✔ | ✔ | | |
| Dar por conformes las facturas de proveedor (con el pago ya hecho) | ✔ | ✔ | ✔ | | |
| Ver **Cobros** (bandeja, pestaña del expediente, facturas al cliente, PO y sus documentos) | ✔ | ✔ | ✔ | | |
| Emitir, enviar, cobrar y anular facturas al cliente | ✔ | ✔ | ✔ | | |
| Subir, editar y cerrar las **PO** del cliente | ✔ | ✔ | ✔ | | |
| Ver el directorio y las fichas de **proveedores** (contacto, tipo, comentarios, historial de expedientes) | ✔ | ✔ | ✔ | ✔ | |
| **Dar de alta** proveedores nuevos (con aviso de los que tienen un nombre parecido) | ✔ | ✔ | ✔ | ✔ | |
| Editar, fusionar y borrar proveedores (y sus tipos) | ✔ | ✔ | ✔ | | |
| Ver las condiciones económicas y el gasto con cada proveedor | ✔ | ✔ | ✔ | | |
| Ver los **contratos** de los proveedores (caducidades, condiciones, historial y documento) | ✔ | ✔ | ✔ | | |
| Crear, renovar, modificar y borrar contratos; marcar la renovación | ✔ | ✔ | ✔ | | |
| Ver el directorio y las fichas de **clientes** (contacto, expedientes, proveedores con los que se ha trabajado) | ✔ | ✔ | ✔ | ✔ | |
| **Dar de alta** clientes nuevos (también desde la solicitud, con aviso de los que tienen un nombre parecido) | ✔ | ✔ | ✔ | ✔ | |
| Editar, fusionar y borrar clientes | ✔ | ✔ | ✔ | | |
| Ver y cambiar los **datos fiscales, el fee, el acuerdo de pago y lo presupuestado** de cada cliente (y sus entidades) | ✔ | ✔ | ✔ | | |
| Ver y gestionar las reservas de **Business Travel** (pasajeros, servicios, importes y PVP) | ✔ | ✔ | ✔ | ✔ | |
| Ver y cambiar el **fee interno** de los viajes | ✔ | ✔ | ✔ | | |
| **Cerrar y reabrir** reservas de Business Travel | ✔ | ✔ | | | |
| Ajustes (tipos de IVA, numeración) | ✔ | ✔ | | | |
| Usuarios, roles y permisos | | | | | ✔ |

- **Sin «Ver los cobros»** no se ve ninguna factura al cliente: tampoco en el **Cierre** ni en su **CSV**, que
  enseñan sólo el total de ventas y el beneficio (Eventos lo ve, porque es quien cuida que sea bueno).
- En la ficha del cliente, **lo facturado, lo cobrado y lo pendiente** piden los dos permisos: el económico de
  clientes y el de cobros.
- **Dónde se comprueba:**
  - en el **servidor**, en tres capas: la sección (`src/middleware.js` con `sectionPermission()`: una ruta que no
    esté en la lista queda cerrada), cada acción (`can()`) y las consultas;
  - en la interfaz sólo se esconde lo que no se puede usar.
- **Dónde está cada cosa:** el catálogo de permisos y de qué depende cada uno, en `src/lib/permissions.js`; quién
  tiene cada uno, en la base de datos (`roles`, `role_permissions`).

## Pantallas

- **Inicio**: lo que hay que mover hoy (solicitudes por abrir, pagos urgentes, facturas por emitir,
  cobros vencidos, expedientes en marcha, celebrados por cerrar y actividad reciente), con los totales arriba
  (expedientes en curso, pagos en 7 días, pendiente de cobro y por facturar). A Eventos le sale arriba **«Te toca»**:
  las facturas que reclamar a proveedores (pagos ya hechos sin factura) de sus expedientes.
- **Buscar** (cabecera): expedientes, clientes (también por NIF o por una de sus entidades), proveedores, nº de
  factura o proforma, facturas al cliente y PO. Un número de
  expediente exacto (`1287`) abre directamente el expediente.
- **Expedientes**: pestañas En curso (primero las solicitudes por abrir, marcadas «Por abrir») · Por cerrar · Míos ·
  Cerrados · Cancelados · Todos, y buscador.
- **Expediente**: Resumen (venta, coste, beneficio al cerrar, cobrado, próximos pasos, datos y actividad) ·
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
- **Resumen del expediente**: «Presupuesto» (el vigente; igual en la pestaña Presupuesto) y «Coste», iguales para los
  dos perfiles; Administración ve además «Cobrado». El **beneficio** no se calcula mientras el expediente está en marcha (los costes y las ventas aún cambian):
  sale en **Cierre** y, una vez cerrado, también en el resumen y en la lista de expedientes. En la pestaña Cobros,
  «Con el presupuesto vigente» resume cómo queda tras un cambio de versión, con «Crear factura por lo que falta» (el
  importe ya repartido con los tipos de IVA del presupuesto) y «Subir PO por la diferencia».
- **Cierre**: las comprobaciones de «Antes de cerrar» sólo salen en verde cuando está hecho de verdad: costes apuntados
  y pagados, todo el presupuesto facturado (o avisa si se ha facturado de más), emitido y cobrado, y las PO facturadas
  (si las hay). Un expediente recién creado no sale «todo terminado».
- **Cobros** (sólo Administración; Eventos no ve ni el menú ni la pestaña) es un embudo: **1. Por facturar** (cada expediente desde que se crea: su presupuesto menos lo ya
  facturado o pedido, con «Crear factura» y «Facturar PO» si tiene PO con
  saldo) → **2. Por emitir** (facturas pedidas o en borrador) → **3. Por cobrar** (emitidas; las vencidas, primero).
  Lo cobrado, en «Cobradas».
- Cada pago, PO y factura tiene su **ficha** (botón «Ver»): de qué era, su documento, el desglose de IVA y
  cuándo se pagó o cobró. En la ficha de una PO: las facturas que la cubren, «Facturar», «Cerrar PO» y «Reabrir». En la ficha de un pago:
  arriba, sus datos con **«Modificar pago»** (se edita ahí mismo), «Otro pago a este proveedor» y «Borrar pago»; los **pasos
  1 · 2 · 3** (factura o proforma, justificante y pago, conforme) con lo que falta en cada uno; **1. Facturas y proformas**
  (subir otra, elegir una ya subida si cubre varios pagos, revisarla con su número, borrar las que no estén conformes) y
  debajo **2. Justificante y pago** (Administración sube el justificante y lo marca pagado, o «Deshacer pagado»; Eventos
  sólo «Pagado con tarjeta»).
- El **proveedor de un pago se elige de la lista** de proveedores dados de alta (en el alta del pago, al modificarlo,
  en «varios pagos previstos» y en la previsión de la Nueva solicitud): al escribir se buscan por nombre, nombre
  anterior, tipo o ciudad, sin acentos ni mayúsculas, y cada uno sale con su tipo y su ciudad. Un nombre que no está
  **no se guarda** (ni en el navegador ni en el servidor). Si es nuevo, «**Dar de alta «…»**» abre una ventana
  (nombre, tipo y ciudad) que antes **avisa de los que tienen un nombre parecido** («Barcelo Valladolid S.L.» →
  «Hotel Barceló Valladolid»: acentos, «Hotel», «S.L.», erratas o una palabra de más o de menos): se elige
  «Es este» o se confirma «No, es otro: darlo de alta». Los proveedores en «No contratar» salen en la lista pero no
  se pueden elegir para un pago nuevo.
- Las sugerencias de clientes salen al escribir (no al entrar en el campo) y el navegador no propone lo
  escrito otras veces: al entrar en un campo sólo se ve su ejemplo.
- Todo lo que borra o quita algo pide **confirmación** en una ventana propia de la aplicación.
- **Ajustes** (Administración): los **tipos de IVA** que salen en todos los desplegables (añadir, quitar,
  marcar el de por defecto; admite decimales y otros impuestos como el IGIC), el primer número de expediente y
  **Facturas al cliente**: formato del número (`G/{n}/{yy}/01`: `{n}` el número con 6 cifras, `{yy}` o `{yyyy}` el año;
  si lleva el año, cada año empieza en 1), el **próximo número** (para seguir la numeración que ya lleváis; no deja
  poner uno ya usado) y los datos de la empresa que salen en la factura (razón social, CIF, dirección, IBAN, email).
- **Tablas** (Clientes, Proveedores, Contratos y Business Travel), todas iguales:
  - el buscador y los filtros en una línea; debajo, el resumen (cuántas hay y sus totales) con «Columnas» a la derecha;
  - se pulsa en cualquier parte de la fila para abrir la ficha; la flecha del orden sólo sale en la columna ordenada
    (en las demás, al pasar por encima);
  - en el **móvil**, cada fila es una tarjeta con cada dato y su nombre (sin tener que desplazar la tabla de lado);
  - **por páginas** (25, 50 o 100 filas), con «26–50 de 143 clientes» y las páginas debajo;
  - un **buscador** por las propiedades de cada tabla (se dicen en el propio campo) y un **filtro por columna**
    (ciudad, tipo, estado, cliente, mes…) que se aplica al cambiarlo; «Quitar filtros» vuelve a todo;
  - se **ordena pulsando la cabecera** (otra vez, al revés); si se ordena por una columna oculta, se ve mientras tanto;
  - **«Columnas»**: cada persona elige qué columnas ve (hay más de las que salen por defecto: NIF, email, teléfono,
    contacto, alta, tipo…) y cuántas filas por página; se guarda para esa persona (también en otro ordenador) y
    «Las de siempre» lo deja como estaba. Las columnas que piden un permiso (fee, importes, NIF) no se ofrecen a
    quien no lo tiene, ni aunque se pidan a mano;
  - los **totales** de encima son de todo lo filtrado, no sólo de la página; la búsqueda, el orden y la página van
    en la dirección, así que se puede enviar el enlace a una búsqueda.
- **Business Travel**: como Expedientes, en pestañas **En curso · Por cerrar · Mías · Cerradas · Canceladas · Todas**
  (con el número de las que están en curso, por cerrar y las tuyas), con buscador (referencia, cliente, pasajero,
  proveedor o localizador), cliente y mes. Se ven en **tarjetas** (nº de reserva, descripción, cliente, fechas,
  pasajeros, servicios, quién la creó, su estado, si le falta algún localizador y el PVP) o, con «Tabla», como tabla
  con columnas a elegir; cada persona elige y se recuerda. «Por cerrar» va por número de reserva, de la más antigua a
  la más reciente. «Nueva reserva»: el cliente y una descripción; en su **ficha** se
  añaden los pasajeros (si ya viajaron con ese cliente, se eligen y se rellenan sus datos) y los servicios de cada
  bloque, con el resumen económico arriba y el historial abajo. La ficha del cliente enseña sus reservas.
- **Clientes**: directorio con buscador (nombre, nombre fiscal, NIF, ciudad, un nombre anterior o una de sus
  entidades), filtros de estado, tipo (empresa o persona) y ciudad; con permiso económico, el fee y lo presupuestado de cada uno (y, con cobros, lo facturado y lo
  pendiente de cobro). **Ficha** de cada cliente: datos, antigüedad, personas de contacto de sus expedientes,
  condiciones y datos fiscales, **relación económica** (ver arriba), sus expedientes (previstos, en curso,
  terminados y cancelados), los **hoteles y proveedores** con los que se ha trabajado para él, por año y por ciudad,
  sus **entidades de facturación** y el **historial** de condiciones y datos. En la **solicitud** y al editar un
  expediente, el cliente **se elige de la lista** (no se escribe a mano); si es nuevo, «Dar de alta» con aviso de
  los parecidos. Si aun así hay repetidos, se **fusionan** (expedientes, entidades e historial pasan al bueno y el
  nombre queda como anterior). Un cliente con expedientes no se borra: se marca como inactivo.
- **Proveedores**: directorio con buscador (nombre, ciudad, contacto o un nombre anterior) y filtros por tipo,
  estado y ciudad. **Ficha** de cada proveedor: tipo
  (ampliable), estado (activo, inactivo, no contratar), contacto, dirección, capacidad, condiciones económicas y de
  crédito, comentarios internos, nombres anteriores, cuándo y quién lo dio de alta, el **historial de expedientes** (cliente, ciudad, fechas,
  servicios) y el **volumen de negocio** (ver abajo), por año (con el cambio respecto al anterior), por cliente y
  por ciudad. Un proveedor se da de alta con «Nuevo proveedor» o desde el selector de un pago, siempre con el aviso
  de nombres parecidos; si aun así hay repetidos, se **fusionan** (pagos y documentos pasan al bueno y el nombre
  queda como anterior, así que también se encuentra por él). Desde la pestaña Pagos de cada expediente y desde la ficha de pago se llega a la ficha del proveedor.
- **Contratos** (con permiso de contratos): en la ficha del proveedor, arriba y destacados, los contratos en vigor
  con la **fecha de caducidad, los días que faltan, el estado** y los términos principales (tarifas, descuentos,
  pago, crédito), «Renovar» si requieren atención y los anteriores aparte; en el historial de expedientes, el
  **contrato aplicado** a cada uno. Cada contrato tiene su página (caducidad, aviso, condiciones, documento,
  renovaciones, expedientes en los que se aplicó, historial de cambios, «Pendiente de renovación» / «No se renueva»).
  **Proveedores → Contratos**: todas las caducidades, primero lo que requiere atención, en pestañas (requieren
  atención, en vigor, aún no vigentes, historial, todos) con buscador y filtro de tipo de proveedor.
- **Usuarios y permisos** (sólo Técnico): personas (invitación por enlace, sin registro abierto; rol; activar o
  desactivar), roles (crear, permisos por áreas, quién tiene cada uno, tabla de quién puede hacer qué) y el
  registro de cambios. **Mi cuenta** para todos.

Importes: se pueden escribir como en el Excel (`21.400`, `1.983,47`, `-232,55`). Cada importe tiene **una línea
por tipo de IVA** (p. ej. alojamiento al 10 % y servicios al 21 %): en cada línea se escribe el importe sin IVA o
con IVA y el otro se calcula; si se escriben los dos (copiados de la factura) se respetan. Los abonos y comisiones
van en negativo. Internamente todo se guarda en céntimos y el tipo en puntos básicos (21 % → 2100) para que el
cierre cuadre al céntimo. El desglose de cada importe se guarda junto a él, así que quitar un tipo de la lista no
cambia nada de lo ya guardado.

## Desarrollo local

Requisitos: Node 22.13 o superior (las pruebas de servicios usan `node:sqlite`).

```bash
cd gestion-eventos
npm install
cp .dev.vars.example .dev.vars   # claves de PRUEBA de Turnstile
npm run db:migrate               # crea las tablas en la D1 local (y aplica las migraciones nuevas)
npm run db:demo                  # (opcional) datos de ejemplo: EXP 1287 BMW, ELECNOR, ROCHE y la solicitud de GLENMARK
npm run dev                      # http://localhost:4321
```

Con los datos de ejemplo hay una cuenta por rol, todas con la contraseña `demo-gestion-2026`:
`tania@example.com` (Administración), `marta@example.com` (Eventos), `direccion@example.com` (Jefes),
`tesoreria@example.com` (Tesorería) y `tecnico@example.com` (Técnico). Sin datos de ejemplo, crea tu cuenta con
`npm run invite -- --local` (imprime el enlace de alta de una cuenta Técnico, que después invita a los demás;
`--role eventos`, `--role jefes`… para otro rol).

`npm test` prueba la lectura de importes, el IVA, los totales del cierre, los estados, la validación y los permisos
(lista blanca, dependencias entre permisos, secciones cerradas por defecto y que siempre quede quien gestione usuarios);
también las **tablas** (columnas por permiso, orden, páginas, enlaces) y los **servicios** de Proveedores, Contratos, Clientes,
Pagos, Business Travel y las tablas de listado (páginas, totales, filtros, columnas de cada persona) contra una base SQLite en memoria con las migraciones y los
datos de ejemplo (permisos de cada rol, datos que se devuelven, cambios en la base; necesita Node 22.13 o superior)
y las **reglas de la arquitectura**. `npm run typecheck` comprueba los tipos de servicios y repositorios y
`npm run check` hace las dos cosas. Cómo está organizado el código: [ARQUITECTURA.md](ARQUITECTURA.md).

## Puesta en producción (Cloudflare)

```bash
npx wrangler d1 create gestion-eventos-db         # copia el database_id en wrangler.jsonc
npx wrangler r2 bucket create gestion-eventos-docs
npx wrangler secret put TURNSTILE_SECRET_KEY      # y la clave pública en "vars" de wrangler.jsonc
npm run deploy                                    # compila, aplica migraciones y publica
npm run invite -- --url https://TU-DOMINIO        # enlace para crear la primera cuenta (Técnico)
```

**Antes de cada migración en producción**, guarda una copia: `npx wrangler d1 export DB --remote --output copia.sql`.

**Cerrar reservas de Business Travel (migración 0014)**: sólo añade dos columnas a `bt_bookings` (`closed_at` y
`closed_by`: cerrada es una reserva abierta con fecha de cierre, así no se reconstruye la tabla) y el permiso
«Cerrar y reabrir reservas» para los roles que cierran expedientes y ven Business Travel (Jefes y Administración).

**Columnas de las tablas (migración 0013)**: sólo añade la tabla `user_prefs` (las columnas y filas por página que
elige cada persona). Si se borra a alguien, se borran sus preferencias.

**Business Travel (migración 0012)**: sólo añade tablas (`bt_bookings`, `bt_passengers`, `bt_lines`,
`bt_line_passengers` y `counters` para las numeraciones), el tipo (empresa o persona) y el tratamiento de los
clientes, cuatro tipos de proveedor y los permisos de Business Travel. El historial común (`change_log`) se rehace
igual para admitir las reservas (no tiene nada que apunte a él). No toca los expedientes.

**Clientes (migración 0011)**: sólo añade tablas (`clients`, sus nombres anteriores, sus entidades y el historial
común `change_log`) y dos columnas a `expedientes` (`client_id` y `fee_bp`); no se borra ni se recrea nada.
- Cada nombre de empresa ya usado en los expedientes pasa a ser un cliente (sin distinguir mayúsculas ni espacios
  sobrantes) y los expedientes quedan enlazados con él.
- Los datos fiscales de la última factura emitida a su nombre pasan a la ficha; los de las demás entidades a las
  que se ha facturado (por NIF), a sus entidades.
- No se inventa ningún fee: queda vacío hasta que se apunte en la ficha.
- Si un mismo cliente se escribió de dos formas distintas (`BMW Iberica` y `BMW Ibérica`), saldrán dos clientes:
  se fusionan desde la ficha («¿Está repetido?»).
- Ver, dar de alta y editar clientes y sus condiciones se reparte como en la tabla de permisos.

**Contratos (migración 0010)**: sólo añade tablas (`supplier_contracts` y su historial) y los permisos de contratos
para Jefes, Administración y Tesorería. Los documentos de los contratos se guardan en R2 en `prov/<proveedor>/`.

**Al pasar a roles y permisos (migración 0008)** no se pierde nada:
- las cuentas de Administración pasan al rol Administración y las de Eventos, al rol Eventos;
- la tabla de usuarios no se recrea, así que se conservan responsables, autores, actividad y sesiones.

Como nadie tiene todavía el rol Técnico, nadie puede gestionar usuarios hasta crear esa cuenta:
`npm run invite -- --url https://TU-DOMINIO` (por defecto, rol Técnico). Desde ella se asignan los Jefes y la
Tesorería en «Usuarios y permisos».

El primer número de expediente sale de la tabla `settings` (`first_number`, 1001 por defecto);
después siempre se propone el mayor + 1.

Antes de emitir la primera factura real, en **Ajustes → Facturas al cliente**: el **próximo número** (el
siguiente al último que hicisteis en contabilidad este año) y los **datos de la empresa** (razón social, CIF,
dirección e IBAN). Mientras falten, en la factura sale «pendiente».

Número de factura: se asigna **al emitir** (no al pedirla), así no quedan huecos por borradores que no se emiten.
El contador se guarda por año en `settings` (`invoice_next:2026`) y además la base de datos tiene un **índice único**
sobre el número: aunque dos personas emitan a la vez, nunca salen dos facturas con el mismo número (la segunda
coge el siguiente).

## Base de datos y rendimiento

- Cada pantalla pide a D1 lo que necesita **a la vez** (en paralelo o en un `batch`), no una consulta detrás de otra;
  los contadores del menú se piden en el middleware mientras se cargan los datos de la página.
- Las consultas van por **índices** (expediente, estado y fecha de los pagos, facturas y PO, documentos de cada pago).
  Los historiales «Pagados» y «Cobradas» se leen ya ordenados por fecha y se paran en los últimos 300 (migración 0006).
- Las bandejas sólo recorren lo que está en marcha (p. ej. «PO sin facturar» sólo mira los expedientes abiertos), así
  que no se hacen más lentas con los años de histórico.
- El resumen de documentos de cada pago (facturas, proformas, pendientes de revisar) se calcula en la misma consulta
  de la lista, sin una consulta por fila.
- Las sugerencias de «facturar a» de las PO se guardan 5 minutos en memoria; las listas de clientes y de proveedores de los selectores se leen siempre de la base de datos (un alta se ve al momento).
- Las tablas de listado piden a la base **sólo su página** (`LIMIT`/`OFFSET`) y, en la misma ida (`batch`), el total y
  las sumas de todo lo filtrado; el orden sale de una lista cerrada de columnas (nunca del texto de la dirección) y
  lleva un desempate fijo para que al pasar de página no se repitan ni se salten filas. Los contratos, cuyo estado
  depende de la fecha de hoy, se filtran y ordenan en el servidor (son cientos como mucho).
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
  services/         Casos de uso (permiso → validación → cambios → actividad): suppliers, contracts, clients, payments,
                    travel (Business Travel), prefs (columnas de cada persona) y files (guardar y borrar documentos);
                    result y context
  repos/            El SQL de cada área: suppliers, contracts, clients, payments, supplier-docs (facturas y proformas
                    de proveedor), files, rates (tipos de IVA), expedientes (su cabecera), travel (reservas de Business
                    Travel), counters (numeraciones), prefs (preferencias de cada persona) y changes (historial común)
  lib/              Reglas puras: table y tables (tablas de listado: columnas, orden, filtros y páginas), money (importes), vat (IVA), finance (estados, totales, cierre), contracts (estado por fechas),
                    suppliers (volumen de negocio), clients (relación económica, antigüedad), changes (qué cambió),
                    travel (servicios de viaje, importes y PVP), name-match (nombres parecidos), supplier (reglas de las facturas de proveedor), files (comprobar
                    archivos), validate (formularios), permissions… y lo que aún no está en capas: data (consultas),
                    actions (cobrar), invoicing (nº de factura y envío), auth…
  layouts/App.astro Menú lateral (ordenador) y barra inferior (móvil)
  components/       Cabecera y pestañas del expediente, filas de pagos/PO/facturas, formularios, selector de cliente o proveedor
                    (EntityPicker) y las piezas de las tablas (TableTools: buscador, filtros y «Columnas»; SortTh; Pager)
  pages/            Inicio, expedientes, bandejas de pagos y cobros, clientes, proveedores y contratos, usuarios, cuenta, acceso
migrations/         Esquema de D1
scripts/            invite.mjs (primera cuenta) y demo.sql (datos de ejemplo, sólo local)
tests/              npm test (helpers/: base D1 en memoria y contexto de servicio para las pruebas)
```

Las capas y sus reglas (qué puede hacer cada una, cómo se prueban y cómo añadir un área nueva) están en
[ARQUITECTURA.md](ARQUITECTURA.md).

## Ideas para las próximas versiones

- **Envío real** de las facturas al cliente por email (ahora es simulado) y **plantilla** de la factura de contabilidad.
- Avisos por **email** (solicitud nueva, factura pedida, pago que vence) además de la bandeja.
- Al hacer una factura al cliente, **elegir la entidad** (el propio cliente o una de sus entidades) en vez de escribir los datos fiscales.
- Leer el **Excel del presupuesto** para proponer el total y las líneas automáticamente.
- Exportación a **.xlsx** con formato y fórmulas, y conexión con el programa de contabilidad.
- Previsión de **tesorería** por semanas (entradas y salidas de todos los expedientes).
