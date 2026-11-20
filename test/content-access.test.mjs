import test from 'node:test';
import assert from 'node:assert/strict';
import { handleCatalog } from '../demo-catalog.mjs';

const postId = '70ca0000-0000-4000-8000-000000000001';
async function request(path, method, caller = null) {
  return handleCatalog({url:path, method}, {}, path,
    (_, status, body) => ({status, body}), caller, async () => ({}));
}

test('purchases and purchase status require authentication', async () => {
  for (const [path, method] of [
    [`/api/demo/test-purchase/${postId}`, 'POST'],
    [`/api/demo/purchase-status/${postId}`, 'GET'],
    ['/api/demo/purchases', 'GET']
  ]) {
    assert.equal((await request(path, method)).status, 401);
  }
});

test('administration rejects guests and regular users', async () => {
  for (const caller of [null, {id:postId, role:'USER'}]) {
    assert.equal((await request('/api/demo/admin', 'GET', caller)).status, 403);
    assert.equal((await request(`/api/demo/admin-post/${postId}`, 'PUT', caller)).status, 403);
  }
});
