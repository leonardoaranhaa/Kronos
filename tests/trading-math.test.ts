import test from 'node:test';
import assert from 'node:assert/strict';
import { createAccount, markToMarket, rebalance } from '../server/trading-math';

const costs = { feeRate: 0.001, slippageRate: 0, positionFraction: 1 };

test('a round trip at the same price loses both fees and nothing more', () => {
  const opened = rebalance(createAccount(10_000), 'long', 100, costs);
  const qty = opened.account.qty;
  const expectedQty = 10_000 / (100 * 1.001);
  assert.ok(Math.abs(qty - expectedQty) < 1e-9);
  const openFee = opened.fills[0].fee;
  assert.ok(Math.abs(openFee - expectedQty * 100 * 0.001) < 1e-9);

  const closed = rebalance(opened.account, 'flat', 100, costs);
  const closeFee = closed.fills[0].fee;
  const endCash = closed.account.cash;
  assert.ok(Math.abs((10_000 - endCash) - (openFee + closeFee)) < 1e-6);
  assert.ok(endCash < 10_000);
  assert.equal(closed.account.qty, 0);
  assert.equal(closed.account.closedTrades, 1);
  assert.equal(closed.account.losses, 1);
  assert.ok(closed.account.realizedPnl < 0);
});

test('slippage moves the buy fill up and the sell fill down', () => {
  const withSlip = { feeRate: 0, slippageRate: 0.0005, positionFraction: 1 };
  const opened = rebalance(createAccount(10_000), 'long', 100, withSlip);
  assert.equal(opened.fills[0].fillPrice, 100.05);
  const closed = rebalance(opened.account, 'flat', 100, withSlip);
  assert.equal(closed.fills[0].fillPrice, 99.95);
  assert.ok(markToMarket(closed.account, 100) < 10_000);
});

test('repeating the same target does not pay another fee', () => {
  const opened = rebalance(createAccount(10_000), 'long', 100, costs);
  const again = rebalance(opened.account, 'long', 101, costs);
  assert.equal(again.fills.length, 0);
  assert.equal(again.account.feesPaid, opened.account.feesPaid);
});

test('a simulated short round trip at the same price also pays both fees', () => {
  const opened = rebalance(createAccount(10_000), 'short', 100, costs);
  assert.ok(opened.account.qty < 0);
  const closed = rebalance(opened.account, 'flat', 100, costs);
  assert.ok(closed.account.cash < 10_000);
  assert.equal(closed.account.qty, 0);
});
