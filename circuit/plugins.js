/**
 * @file Loads the part plugins that a diagram names. No Node imports, so a
 * browser can use this file. See "Part plugins" in docs/circuit-format.md.
 */

import {PARTS} from './parts.js';

/**
 * Imports each module in the diagram's `esp-spice.parts` list.
 * @param {{'esp-spice'?: {parts?: string[]}}} diagram
 * @param {string | URL} diagramUrl Plugin paths are relative to it.
 * @return {Promise<Record<string, import('./parts.js').PartModel>>} Part
 *     type to model.
 */
export async function loadPlugins(diagram, diagramUrl) {
  /** @type {Record<string, import('./parts.js').PartModel>} */
  const types = {};
  for (const path of diagram['esp-spice']?.parts ?? []) {
    // Only files next to the diagram, so a diagram cannot load code from
    // other places.
    if (/^\/|^[a-z][a-z\d+.-]*:|\\|(^|\/)\.\.(\/|$)/i.test(path)) {
      throw new Error(
        `part plugin "${path}": use a relative path in the diagram's folder`,
      );
    }
    const {default: plugin} = await import(new URL(path, diagramUrl).href);
    for (const [type, model] of Object.entries(plugin ?? {})) {
      if (Object.hasOwn(PARTS, type) || Object.hasOwn(types, type)) {
        throw new Error(`part plugin "${path}": "${type}" is already a type`);
      }
      types[type] = model;
    }
  }
  return types;
}
