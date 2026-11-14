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
  const folder = new URL('./', diagramUrl).href;
  for (const path of diagram['esp-spice']?.parts ?? []) {
    // Check the resolved URL, so that "%2e%2e" cannot leave the folder.
    const url = new URL(path, diagramUrl).href;
    if (!url.startsWith(folder)) {
      throw new Error(
        `part plugin "${path}": use a relative path in the diagram's folder`,
      );
    }
    const {default: plugin} = await import(url);
    for (const [type, model] of Object.entries(plugin ?? {})) {
      if (Object.hasOwn(PARTS, type) || Object.hasOwn(types, type)) {
        throw new Error(`part plugin "${path}": "${type}" is already a type`);
      }
      // render/ makes the type a custom element name.
      if (!/^[a-z][a-z\d._]*-[a-z\d._-]*$/.test(type)) {
        throw new Error(
          `part plugin "${path}": "${type}" must be lower case, with a "-"`,
        );
      }
      types[type] = model;
    }
  }
  return types;
}
