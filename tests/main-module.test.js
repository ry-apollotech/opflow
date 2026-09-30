import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isMainModule } from '../src/main-module.js';

test('isMainModule compares case-insensitively on win32 and case-sensitively elsewhere', () => {
  const url = 'file:///C:/repo/scripts/install.js';
  assert.equal(isMainModule('C:/repo/scripts/INSTALL.JS', url, 'win32'), true);
  assert.equal(isMainModule('C:/repo/scripts/INSTALL.JS', url, 'linux'), false);
  assert.equal(isMainModule('C:/repo/scripts/install.js', url, 'linux'), true);
  assert.equal(isMainModule(undefined, url, 'win32'), false);
});
