// @ts-check
// Resultado común de los servicios (casos de uso).
//
// Un servicio no lanza por un problema del usuario: devuelve
//   { ok: true, value }                                   si ha ido bien
//   { ok: false, code, message, fields, ...extra }        si no
// code:
//   'forbidden'  sin permiso (la página vuelve con «No tienes permiso»)
//   'not_found'  no existe (o no es de ese proveedor, expediente…)
//   'invalid'    datos del formulario; fields = { campo: mensaje } para enseñarlo junto al campo
//   'conflict'   no se puede por el estado de los datos (ya existe, está en uso, ya renovado…)
//   'similar'    hay nombres parecidos y hay que confirmar (extra.similar)
// Los fallos de programación o de la base de datos sí se lanzan (los recoge la página de error).

/** @typedef {import('./types').FailCode} FailCode @typedef {import('./types').Fail} Fail */

/**
 * @template T
 * @param {T} value
 * @returns {import('./types').Ok<T>}
 */
export const done = (value) => ({ ok: true, value });

/**
 * @param {FailCode} code
 * @param {string} message
 * @param {Record<string, unknown>} [extra] p. ej. { fields: { campo: mensaje } } o { similar: [...] }
 * @returns {Fail}
 */
export const fail = (code, message, extra = {}) => ({ ok: false, code, message, fields: {}, ...extra });

/** @param {string} [message] @returns {Fail} */
export const forbidden = (message = 'No tienes permiso para eso.') => fail('forbidden', message);

/** @returns {Fail} */
export const notFound = () => fail('not_found', 'No encontrado.');

/**
 * A partir de un validate() fallido (src/lib/validate.js)
 * @param {{ message: string, errors?: Record<string, string> }} parsed
 * @returns {Fail}
 */
export const invalid = (parsed) => fail('invalid', parsed.message, { fields: parsed.errors ?? {} });
