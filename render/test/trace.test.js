import assert from 'node:assert/strict';
import {test} from 'node:test';
import {stateAt, traceEnd} from '../src/trace.js';

const trace = {
  parts: {
    led1: [{t: 0, value: false}, {t: 0.5, value: true, brightness: 0.5}, {t: 1, brightness: 1}],
  },
};

test('holds each property until a later key frame', () => {
  assert.deepEqual(stateAt(trace, 0.25), {led1: {value: false}});
  assert.deepEqual(stateAt(trace, 0.5), {led1: {value: true, brightness: 0.5}});
  assert.deepEqual(stateAt(trace, 9), {led1: {value: true, brightness: 1}});
});

test('gives no properties before the first key frame', () => {
  assert.deepEqual(stateAt(trace, -1), {led1: {}});
});

test('uses end when set, else the last key frame', () => {
  assert.equal(traceEnd(trace), 1);
  assert.equal(traceEnd({...trace, end: 3}), 3);
  assert.equal(traceEnd({parts: {}}), 0);
});
