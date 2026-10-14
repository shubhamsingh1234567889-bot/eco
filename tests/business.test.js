'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { businessPlan, sectorByKey, SECTORS, DEFAULT_CREDIT_PRICE } = require('../src/business');
const { calcEmission } = require('../src/emissions');

const act = (category, type, quantity) => ({
  category,
  type,
  quantity,
  emission: calcEmission(category, type, quantity),
});

test('sectors: seven have final targets, two pending, one voluntary', () => {
  const count = (r) => SECTORS.filter((s) => s.route === r).length;
  assert.equal(count('obligated'), 7);
  assert.equal(count('obligated_pending'), 2);
  assert.equal(count('voluntary'), 1);
  assert.equal(sectorByKey('cement').label, 'Cement');
  assert.equal(sectorByKey('nope'), null);
});

test('empty data returns an empty plan without errors', () => {
  const plan = businessPlan([], { windowDays: 30 });
  assert.equal(plan.hasData, false);
  assert.equal(plan.actions.length, 0);
  assert.equal(plan.totals.totalBenefitINR, 0);
  assert.equal(plan.annualEmissionTonnes, 0);
});

test('electricity: efficiency then solar, annualised from a 30 day window', () => {
  // 1000 kWh in 30 days -> 12,166.67 kWh a year
  const plan = businessPlan([act('energy', 'electricity_kwh', 1000)], { windowDays: 30, tariff: 10, creditPrice: 1000 });
  const kwh = 1000 * (365 / 30);
  const eff = plan.actions.find((a) => a.id === 'efficiency');
  const solar = plan.actions.find((a) => a.id === 'solar');

  // efficiency: 15% of kWh
  assert.equal(eff.annualCostSavingINR, Math.round(kwh * 0.15 * 10));
  assert.ok(Math.abs(eff.annualKgSaved - kwh * 0.15 * 0.82) < 0.01);

  // solar applies to the kWh remaining after efficiency, saving (tariff - 4) per kWh
  const solarKwh = kwh * 0.85 * 0.3;
  assert.equal(solar.annualCostSavingINR, Math.round(solarKwh * (10 - 4)));

  // credit value = tonnes * price
  // (kg is rounded to 2 decimals in the output, so allow Rs 1 of rounding)
  assert.ok(Math.abs(eff.creditValueINR - (eff.annualKgSaved / 1000) * 1000) <= 1);
});

test('totals equal the sum of the actions and the headline adds cost savings and credits', () => {
  const plan = businessPlan(
    [
      act('energy', 'electricity_kwh', 800),
      act('transport', 'car_petrol', 500),
      act('transport', 'flight_short', 300),
      act('energy', 'lpg_kg', 40),
      act('waste', 'general_waste_kg', 60),
    ],
    { windowDays: 30 }
  );
  const sumCost = plan.actions.reduce((s, a) => s + a.annualCostSavingINR, 0);
  const sumCredit = plan.actions.reduce((s, a) => s + a.creditValueINR, 0);
  assert.equal(plan.totals.costSavingINR, sumCost);
  assert.equal(plan.totals.creditValueINR, sumCredit);
  assert.equal(plan.totals.totalBenefitINR, sumCost + sumCredit);
  assert.equal(plan.creditPrice, DEFAULT_CREDIT_PRICE);
  assert.ok(plan.actions.length >= 5);
  assert.ok(plan.percentReducible > 0 && plan.percentReducible < 100);

  // sorted by total benefit, largest first
  for (let i = 1; i < plan.actions.length; i++) {
    const prev = plan.actions[i - 1].annualCostSavingINR + plan.actions[i - 1].creditValueINR;
    const cur = plan.actions[i].annualCostSavingINR + plan.actions[i].creditValueINR;
    assert.ok(prev >= cur);
  }
});

test('EV switch uses the right fuel assumption and only appears with car travel', () => {
  const none = businessPlan([act('energy', 'electricity_kwh', 100)], { windowDays: 30 });
  assert.equal(none.actions.some((a) => a.id.startsWith('ev_')), false);

  const plan = businessPlan([act('transport', 'car_diesel', 300)], { windowDays: 30 });
  const ev = plan.actions.find((a) => a.id === 'ev_car_diesel');
  const shift = 300 * (365 / 30) * 0.5;
  assert.equal(ev.annualCostSavingINR, Math.round(shift * (7 - 1.5)));
  assert.ok(Math.abs(ev.annualKgSaved - shift * (0.171 - 0.053)) < 0.01);
});

test('higher credit price raises credit value but not cost savings', () => {
  const data = [act('energy', 'electricity_kwh', 900)];
  const low = businessPlan(data, { windowDays: 30, creditPrice: 900 });
  const high = businessPlan(data, { windowDays: 30, creditPrice: 3900 });
  assert.equal(low.totals.costSavingINR, high.totals.costSavingINR);
  assert.ok(high.totals.creditValueINR > low.totals.creditValueINR * 4);
});
