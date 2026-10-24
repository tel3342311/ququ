import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { prepareEnvironment } = require('../../scripts/run-tauri.cjs');

test('adding Cargo preserves the Windows Path key and executable search directories', () => {
  const result = prepareEnvironment({Path:'C:/node;C:/Windows/System32'}, 'C:/cargo', ';');
  assert.equal(result.Path, 'C:/cargo;C:/node;C:/Windows/System32');
  assert.equal(Object.hasOwn(result,'PATH'), false);
});
