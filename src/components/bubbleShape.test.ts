import assert from 'node:assert/strict';
import { test } from 'node:test';
import { burstPoints, pointerShape } from './bubbleShape';

const box = { x: 0, y: 0, width: 200, height: 100 };

test('a burst has alternating spike tips and notches inside its 100 × 100 box', () => {
  const points = burstPoints();
  assert.equal(points.length % 2, 0);
  for (const { x, y } of points) assert.ok(x >= 0 && x <= 100 && y >= 0 && y <= 100);
  const radius = (p: { x: number; y: number }) => Math.hypot(p.x - 50, p.y - 50);
  assert.ok(radius(points[0]) > radius(points[1]));
});

test('a burst pointer starts inside the bounding box, where a plain one starts on it', () => {
  const tip = { x: 100, y: 200 };
  const plain = pointerShape(box, tip)!;
  const burst = pointerShape(box, tip, true)!;
  assert.equal(plain.edge.y, 100);
  assert.ok(burst.edge.y < plain.edge.y);
  assert.ok(burst.length > plain.length);
});
