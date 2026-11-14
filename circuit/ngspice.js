/**
 * @file Binding for the ngspice shared library (libngspice). Node only.
 */

import koffi from 'koffi';

/** Paths to try when NGSPICE_LIBRARY is not set. */
const LIBRARY_PATHS = {
  darwin: [
    '/opt/homebrew/lib/libngspice.dylib',
    '/usr/local/lib/libngspice.dylib',
    'libngspice.dylib',
  ],
  win32: ['ngspice.dll'],
};

/**
 * @typedef {object} Ngspice
 * @property {(command: string) => void} command Runs an ngspice command.
 * @property {(netlist: string) => void} load Loads a circuit.
 * @property {(name: string, from?: number) => number[] | null} vector
 *     Data of a vector in the current plot from index `from`, or null. A
 *     negative `from` counts from the end.
 * @property {(name: string) => number} length Points in a vector, or 0.
 * @property {(time: number) => void} stopAt Clamps the time step so the
 *     simulation lands exactly on `time`.
 * @property {string[]} log Output lines of the last command.
 */

/** @type {Ngspice | undefined} */
let instance;

/**
 * Loads libngspice once. Ngspice has global state, so there is only one.
 * @return {Ngspice}
 */
export function ngspice() {
  if (instance) return instance;

  const lib = loadLibrary();
  const SendChar = koffi.proto('int SendChar(const char*, int, void*)');
  const SendStat = koffi.proto('int SendStat(const char*, int, void*)');
  const ControlledExit = koffi.proto(
    'int ControlledExit(int, bool, bool, int, void*)',
  );
  const BGThreadRunning = koffi.proto('int BGThreadRunning(bool, int, void*)');
  const GetSyncData = koffi.proto(
    'int GetSyncData(double, double*, double, int, int, int, void*)',
  );
  const VectorInfo = koffi.struct('vector_info', {
    v_name: 'char*',
    v_type: 'int',
    v_flags: 'short',
    v_realdata: 'double*',
    v_compdata: 'void*',
    v_length: 'int',
  });
  const init = lib.func(
    'int ngSpice_Init(SendChar*, SendStat*, ' +
      'ControlledExit*, void*, void*, BGThreadRunning*, void*)',
  );
  const initSync = lib.func(
    'int ngSpice_Init_Sync(void*, void*, GetSyncData*, int*, void*)',
  );
  const command = lib.func('int ngSpice_Command(const char*)');
  const circ = lib.func('int ngSpice_Circ(const char**)');
  const vecInfo = lib.func('vector_info* ngGet_Vec_Info(const char*)');

  /** @type {string[]} */
  const log = [];
  let exited = false;
  let stopTime = Infinity;
  // Do not clamp steps that are shorter than this, in seconds, so that
  // rounding never asks ngspice for a step that is too small.
  const EPSILON = 1e-12;

  // Keep the callbacks in variables, so they are not garbage collected.
  const callbacks = [
    koffi.register((/** @type {string} */ text) => {
      log.push(text);
      return 0;
    }, koffi.pointer(SendChar)),
    koffi.register(() => 0, koffi.pointer(SendStat)),
    koffi.register(() => {
      exited = true;
      return 0;
    }, koffi.pointer(ControlledExit)),
    koffi.register(() => 0, koffi.pointer(BGThreadRunning)),
    koffi.register(
      (
        /** @type {number} */ time,
        /** @type {unknown} */ delta,
        /** @type {number} */ oldDelta,
        /** @type {number} */ redo,
        /** @type {number} */ id,
        /** @type {number} */ location,
      ) => {
        if (location !== 0) return 0;
        const rest = stopTime - time;
        if (rest > EPSILON && koffi.decode(delta, 'double') > rest) {
          koffi.encode(delta, 'double', rest);
        }
        return 0;
      },
      koffi.pointer(GetSyncData),
    ),
  ];
  init(
    callbacks[0],
    callbacks[1],
    callbacks[2],
    null,
    null,
    callbacks[3],
    null,
  );
  initSync(null, null, callbacks[4], [0], null);

  /** @param {string} what */
  const check = (what) => {
    const errors = log.filter((line) => /^stderr (Error|.*error)/i.test(line));
    if (exited || errors.length) {
      exited = false;
      throw new Error(`ngspice: ${what} failed:\n${errors.join('\n')}`);
    }
  };

  /** @param {string} name */
  const vectorInfo = (name) => {
    const pointer = vecInfo(name);
    return pointer ? koffi.decode(pointer, VectorInfo) : null;
  };

  instance = {
    log,
    command(text) {
      log.length = 0;
      command(text);
      check(text);
    },
    load(netlist) {
      log.length = 0;
      circ([...netlist.split('\n'), null]);
      check('loading the circuit');
    },
    vector(name, from = 0) {
      const info = vectorInfo(name);
      if (!info?.v_realdata) return null;
      const length = info.v_length;
      const start = Math.min(
        Math.max(0, from < 0 ? length + from : from),
        length,
      );
      return koffi.decode(info.v_realdata, start * 8, 'double', length - start);
    },
    length: (name) => vectorInfo(name)?.v_length ?? 0,
    stopAt(time) {
      stopTime = time;
    },
  };
  return instance;
}

/** @return {ReturnType<typeof koffi.load>} */
function loadLibrary() {
  const env = process.env.NGSPICE_LIBRARY;
  const paths = env
    ? [env]
    : (LIBRARY_PATHS[/** @type {'darwin' | 'win32'} */ (process.platform)] ?? [
        'libngspice.so.0',
        'libngspice.so',
      ]);
  for (const path of paths) {
    try {
      return koffi.load(path);
    } catch {
      // Try the next path.
    }
  }
  throw new Error(
    `cannot load libngspice (tried ${paths.join(', ')}). ` +
      'Install it (apt install libngspice0, or brew install libngspice), ' +
      'or set NGSPICE_LIBRARY to its path.',
  );
}
