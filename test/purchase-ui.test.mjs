import test from 'node:test';
import assert from 'node:assert/strict';
import { handlePurchase } from '../public/concept/purchase.js';

test('confirmed purchase refreshes the selected premium file', async () => {
  const previousWindow = globalThis.window;
  globalThis.window = {confirm:() => true};
  const control = {dataset:{action:'test-purchase',id:'post-id',next:'2000'}, nextElementSibling:{}, isConnected:true};
  const requests = [];
  let rendered;
  try {
    await handlePurchase({
      api:async () => { throw new Error('unexpected status query'); },
      json:async (...args) => { requests.push(args); return {status:'PAID'}; },
      notice:() => {}, render:async value => { rendered = value; },
      getSelectedMedia:() => ({selected:{id:'cover',premium:false},firstPremium:{id:'premium'}})
    }, control);
    assert.deepEqual(requests, [['test-purchase/post-id','POST',{price:2000}]]);
    assert.deepEqual(rendered, {selectedMediaId:'premium'});
    assert.equal(control.disabled,false);
  } finally { globalThis.window = previousWindow; }
});

test('checking a confirmed purchase does not create another order', async () => {
  const control = {dataset:{action:'check-purchase',id:'post-id'}, nextElementSibling:{}, isConnected:true};
  let requests = 0;
  await handlePurchase({
    api:async () => { requests++; return {status:'PAID'}; },
    json:async () => { throw new Error('unexpected purchase'); },
    notice:() => {}, render:async () => {},
    getSelectedMedia:() => ({selected:null,firstPremium:null})
  }, control);
  assert.equal(requests,1);
  assert.equal(control.disabled,false);
});
