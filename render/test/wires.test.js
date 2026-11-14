import assert from 'node:assert/strict';
import {test} from 'node:test';
import {pinPosition, wirePoints} from '../src/wires.js';

test('joins pins with an L when there are no moves', () => {
  assert.deepEqual(wirePoints([0, 0], [10, 20]), [[0, 0], [10, 0], [10, 20]]);
});

test('draws a straight wire between aligned pins', () => {
  assert.deepEqual(wirePoints([0, 5], [30, 5]), [[0, 5], [30, 5]]);
});

test('turns after a horizontal move', () => {
  assert.deepEqual(wirePoints([0, 0], [30, 20], ['h10']), [
    [0, 0],
    [10, 0],
    [10, 20],
    [30, 20],
  ]);
});

test('walks moves after * back from the target', () => {
  assert.deepEqual(
    wirePoints([0, 0], [100, 100], ['v10', '*', 'h-5', 'v20']),
    [[0, 0], [0, 10], [105, 10], [105, 80], [100, 80], [100, 100]],
  );
});

test('rejects unknown moves', () => {
  assert.throws(() => wirePoints([0, 0], [1, 1], ['x5']), /Unknown wire move/);
});

test('places pins of unrotated parts at left/top', () => {
  const size = {width: 40, height: 50};
  assert.deepEqual(pinPosition({left: 10, top: 20}, {x: 1, y: 2}, size), [
    11, 22,
  ]);
});

test('rotates pins around the part center', () => {
  // Pin at the bottom middle moves to the left middle after 90 degrees.
  assert.deepEqual(
    pinPosition({rotate: 90}, {x: 20, y: 50}, {width: 40, height: 50}),
    [-5, 25],
  );
});
