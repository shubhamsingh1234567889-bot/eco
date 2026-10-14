'use strict';

/**
 * Business mode: India carbon-market information and a savings plan that turns
 * a business's logged activity into annual tonnes saved, rupees saved and the
 * potential value of carbon credits.
 *
 * IMPORTANT: every rupee figure below is an ILLUSTRATIVE ASSUMPTION for
 * awareness and planning, not a quote or a guarantee. Edit the constants to
 * match your own bills and local prices.
 */

const { lookup, round } = require('./emissions');

/* ------------------------------------------------------------------ *
 * Assumptions (all in INR unless stated)
 * ------------------------------------------------------------------ */

const DEFAULT_TARIFF = 8; // INR per kWh, commercial electricity (varies by state)
const DEFAULT_CREDIT_PRICE = 900; // INR per tCO2e, roughly USD 10, early-market view

const ASSUMPTIONS = {
  solarCostPerKwh: 4, // INR per kWh, levelised cost of captive rooftop solar (excludes upfront capex)
  lpgPricePerKg: 90, // INR per kg
  fuelCostPerKm: { car_petrol: 9, car_diesel: 7, motorbike: 2.5 }, // INR per km
  evCostPerKm: 1.5, // INR per km
  flightCostPerKm: 6, // INR per km
};

const PRICE_SCENARIOS = [
  { key: 'early', label: 'Early market (about $10/t)', inrPerTonne: 900 },
  { key: '2030', label: '2030 projection (consultancy)', inrPerTonne: 3900 },
];

/* ------------------------------------------------------------------ *
 * Sectors and how the Indian CCTS treats them
 *   obligated          -> final emission-intensity targets notified
 *   obligated_pending  -> listed under CCTS, final targets not yet seen
 *   voluntary          -> not obligated; can only join the voluntary route
 * ------------------------------------------------------------------ */

const SECTORS = [
  { key: 'aluminium', label: 'Aluminium', route: 'obligated' },
  { key: 'cement', label: 'Cement', route: 'obligated' },
  { key: 'chlor_alkali', label: 'Chlor-alkali', route: 'obligated' },
  { key: 'pulp_paper', label: 'Pulp and paper', route: 'obligated' },
  { key: 'petroleum_refining', label: 'Petroleum refining', route: 'obligated' },
  { key: 'petrochemicals', label: 'Petrochemicals', route: 'obligated' },
  { key: 'textiles', label: 'Textiles', route: 'obligated' },
  { key: 'iron_steel', label: 'Iron and steel', route: 'obligated_pending' },
  { key: 'fertilizer', label: 'Fertilizer', route: 'obligated_pending' },
  { key: 'other', label: 'Other industry (retail, services, food, logistics, farming)', route: 'voluntary' },
];

const sectorByKey = (key) => SECTORS.find((s) => s.key === key) || null;

/* ------------------------------------------------------------------ *
 * India carbon-market explainer (static content for the UI)
 * ------------------------------------------------------------------ */

const INDIA_MARKET = {
  asOf: 'Information gathered in October 2026 from public sources. Rules and dates change, so confirm with the Bureau of Energy Efficiency (beeindia.gov.in) before acting.',
  headline: "India's Carbon Credit Trading Scheme (CCTS)",
  blocks: [
    {
      title: 'What it is',
      body:
        'A national carbon market created by the 2022 amendment to the Energy Conservation Act. The scheme was notified in June 2023 and is run by the Bureau of Energy Efficiency (BEE). One Carbon Credit Certificate (CCC) equals 1 tonne of CO2 equivalent.',
    },
    {
      title: 'Who must take part',
      body:
        'Large industrial units in aluminium, cement, chlor-alkali, pulp and paper, petroleum refining, petrochemicals and textiles have binding targets. Iron and steel and fertilizer are also listed under the scheme. The targets are emission intensity targets: tonnes of CO2e per unit of product, measured against an FY2024 baseline, so they allow for growth in output.',
    },
    {
      title: 'How a company earns credits',
      body:
        'A covered unit that beats its intensity target receives CCCs from BEE and can sell them on the power exchanges. A unit that misses its target must buy and surrender certificates for the shortfall. If it does not, it faces an environmental compensation charge reported to be twice the average CCC trading price for the year.',
    },
    {
      title: 'If you are not a covered company',
      body:
        'You have no obligation, but a separate voluntary route lets non-covered entities register emission-reduction or removal projects to earn credits. This route is still being developed, and projects need registration and independent verification. For a small business the realistic route is often to cut your own costs first, or to join a larger project run by an aggregator.',
    },
    {
      title: 'Why reducing emissions can raise income',
      body:
        'Most of the money comes from lower energy and fuel bills, which start immediately. Credits are an extra: they exist only for verified reductions that are registered under the scheme. Large buyers and exporters are also asking suppliers for emissions data, so a lower footprint can help you win and keep customers. Exporters to the EU should also watch the EU Carbon Border Adjustment Mechanism (CBAM).',
    },
    {
      title: 'What the price might be',
      body:
        'Trading was expected to begin around mid-2026, and early industry views put credits near USD 10 per tonne (roughly Rs 900). One consultancy projects Indian prices could reach about Rs 3,900 to 4,000 per tonne by 2030. These are projections, not guarantees.',
    },
  ],
  sources: [
    { title: 'ICAP: Indian Carbon Credit Trading Scheme', url: 'https://icapcarbonaction.com/en/ets/indian-carbon-credit-trading-scheme' },
    { title: 'ICAP: India notifies emission intensity targets for nine sectors', url: 'https://icapcarbonaction.com/en/news/india-notifies-emission-intensity-targets-nine-sectors-under-carbon-credit-trading-scheme' },
    { title: 'Quantum Commodity Intelligence: CCTS prices could rise to $44/t by 2030', url: 'https://www.qcintel.com/carbon/article/india-s-ccts-prices-could-rise-to-44-t-by-2030-consultancy-57346.html' },
    { title: 'Bureau of Energy Efficiency', url: 'https://beeindia.gov.in' },
  ],
};

/* ------------------------------------------------------------------ *
 * Savings plan
 * ------------------------------------------------------------------ */

function sumQty(activities, category, type) {
  return activities
    .filter((a) => a.category === category && a.type === type)
    .reduce((s, a) => s + a.quantity, 0);
}

/**
 * @param {object[]} activities  activities from the look-back window
 * @param {object}   opts
 * @param {number}   opts.windowDays   length of the look-back window
 * @param {number}   [opts.tariff]     INR per kWh
 * @param {number}   [opts.creditPrice] INR per tCO2e
 */
function businessPlan(activities, opts) {
  const windowDays = opts.windowDays || 30;
  const tariff = opts.tariff || DEFAULT_TARIFF;
  const creditPrice = opts.creditPrice || DEFAULT_CREDIT_PRICE;
  const scale = 365 / windowDays; // window -> year
  const f = (cat, type) => lookup(cat, type).factor;

  const annualKg = activities.reduce((s, a) => s + a.emission, 0) * scale;
  const hasData = activities.length > 0;

  // yearly quantities
  const kwh = sumQty(activities, 'energy', 'electricity_kwh') * scale;
  const lpg = sumQty(activities, 'energy', 'lpg_kg') * scale;
  const flightKm = sumQty(activities, 'transport', 'flight_short') * scale;
  const landfill = sumQty(activities, 'waste', 'general_waste_kg') * scale;

  const actions = [];
  const add = (a) => {
    const kg = Math.max(0, a.kg);
    const cost = Math.max(0, a.cost);
    if (kg <= 0 && cost <= 0) return;
    actions.push({
      id: a.id,
      category: a.category,
      title: a.title,
      detail: a.detail,
      annualKgSaved: round(kg),
      annualTonnesSaved: round(kg / 1000, 3),
      annualCostSavingINR: Math.round(cost),
      creditValueINR: Math.round((kg / 1000) * creditPrice),
    });
  };

  // 1. Efficiency first (15% less electricity)
  const effKwh = kwh * 0.15;
  add({
    id: 'efficiency',
    category: 'energy',
    title: 'Energy audit: LED lighting, efficient AC and motors (-15% electricity)',
    detail: `You use about ${Math.round(kwh).toLocaleString('en-IN')} kWh a year. Efficient equipment and better scheduling usually pay back fast.`,
    kg: effKwh * f('energy', 'electricity_kwh'),
    cost: effKwh * tariff,
  });

  // 2. Rooftop solar for 30% of what is left after efficiency
  const solarKwh = (kwh - effKwh) * 0.3;
  add({
    id: 'solar',
    category: 'energy',
    title: 'Rooftop or open-access solar for 30% of your power',
    detail: 'Cuts grid emissions and your tariff. Savings shown ignore the upfront installation cost, so get a quote and compare the payback.',
    kg: solarKwh * f('energy', 'electricity_kwh'),
    cost: solarKwh * Math.max(0, tariff - ASSUMPTIONS.solarCostPerKwh),
  });

  // 3. Switch half of petrol/diesel car km to electric
  for (const type of ['car_petrol', 'car_diesel']) {
    const km = sumQty(activities, 'transport', type) * scale;
    if (km <= 0) continue;
    const shift = km * 0.5;
    add({
      id: `ev_${type}`,
      category: 'transport',
      title: `Move half of ${type === 'car_petrol' ? 'petrol' : 'diesel'} fleet kilometres to electric vehicles`,
      detail: `About ${Math.round(km).toLocaleString('en-IN')} km a year on ${type === 'car_petrol' ? 'petrol' : 'diesel'} cars. Check EV subsidies and charging access for your fleet.`,
      kg: shift * (f('transport', type) - f('transport', 'car_electric')),
      cost: shift * (ASSUMPTIONS.fuelCostPerKm[type] - ASSUMPTIONS.evCostPerKm),
    });
  }

  // 4. Flights -> video calls / train
  if (flightKm > 0) {
    const shift = flightKm * 0.3;
    add({
      id: 'flights',
      category: 'transport',
      title: 'Replace 30% of flights with video meetings or train travel',
      detail: `About ${Math.round(flightKm).toLocaleString('en-IN')} km of flying a year. Fewer trips also saves staff time.`,
      kg: shift * (f('transport', 'flight_short') - f('transport', 'metro_train')),
      cost: shift * ASSUMPTIONS.flightCostPerKm,
    });
  }

  // 5. LPG
  if (lpg > 0) {
    const saved = lpg * 0.1;
    add({
      id: 'lpg',
      category: 'energy',
      title: 'Cut LPG use by 10% (maintenance, heat recovery, better burners)',
      detail: `About ${Math.round(lpg).toLocaleString('en-IN')} kg of LPG a year.`,
      kg: saved * f('energy', 'lpg_kg'),
      cost: saved * ASSUMPTIONS.lpgPricePerKg,
    });
  }

  // 6. Waste
  if (landfill > 0) {
    const diverted = landfill * 0.5;
    add({
      id: 'waste',
      category: 'waste',
      title: 'Segregate and recycle half of your landfill waste',
      detail: 'Also lowers disposal charges and can earn scrap income. Those extra rupees are not counted here.',
      kg: diverted * (f('waste', 'general_waste_kg') - f('waste', 'recycled_kg')),
      cost: 0,
    });
  }

  actions.sort((a, b) => b.annualCostSavingINR + b.creditValueINR - (a.annualCostSavingINR + a.creditValueINR));

  const totals = actions.reduce(
    (t, a) => {
      t.tonnesSaved += a.annualTonnesSaved;
      t.costSavingINR += a.annualCostSavingINR;
      t.creditValueINR += a.creditValueINR;
      return t;
    },
    { tonnesSaved: 0, costSavingINR: 0, creditValueINR: 0 }
  );
  totals.tonnesSaved = round(totals.tonnesSaved, 3);
  totals.totalBenefitINR = totals.costSavingINR + totals.creditValueINR;

  return {
    hasData,
    windowDays,
    tariff,
    creditPrice,
    annualEmissionTonnes: round(annualKg / 1000, 2),
    percentReducible: annualKg > 0 ? round((totals.tonnesSaved * 1000 / annualKg) * 100, 1) : 0,
    actions,
    totals,
    assumptions: { ...ASSUMPTIONS, tariff, creditPrice },
  };
}

module.exports = {
  DEFAULT_TARIFF,
  DEFAULT_CREDIT_PRICE,
  ASSUMPTIONS,
  PRICE_SCENARIOS,
  SECTORS,
  INDIA_MARKET,
  sectorByKey,
  businessPlan,
};
