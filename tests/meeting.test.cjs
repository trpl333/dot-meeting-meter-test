'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const meeting = require('../src/meeting.js');

const {
  DEFAULTS,
  validateAttendees,
  validateHourlyCost,
  validateDuration,
  formatUSD,
  formatElapsed,
  canStart,
  createMeter
} = meeting;

function harness(overrides) {
  let time = 0;
  const meter = createMeter(Object.assign({
    now: function () {
      return time;
    }
  }, overrides));
  return {
    meter: meter,
    at: function (ms) {
      time = ms;
    },
    advance: function (ms) {
      time += ms;
    }
  };
}

function applyKnown(meter) {
  assert.equal(meter.setAttendees(2).ok, true);
  assert.equal(meter.setHourlyCost(120).ok, true);
  assert.equal(meter.setDurationMinutes(30).ok, true);
}

test('initial defaults match the documented estimates', function () {
  const meter = createMeter({ now: function () { return 0; } });
  const state = meter.getState();
  assert.equal(DEFAULTS.attendees, 5);
  assert.equal(DEFAULTS.hourlyCost, 100);
  assert.equal(DEFAULTS.durationMinutes, 30);
  assert.equal(state.attendees, 5);
  assert.equal(state.hourlyCost, 100);
  assert.equal(state.durationMinutes, 30);
  assert.equal(state.status, 'idle');
  assert.equal(formatUSD(state.projectedTotal), '$250.00');
  assert.equal(formatUSD(state.costPerMinute), '$8.33');
  assert.equal(formatElapsed(state.elapsedMs), '00:00:00');
  assert.equal(formatUSD(state.liveCost), '$0.00');
});

test('known calculation: 2 attendees at $120 for 30 minutes', function () {
  const { meter } = harness();
  applyKnown(meter);
  const state = meter.getState();
  assert.equal(formatUSD(state.projectedTotal), '$120.00');
  assert.equal(formatUSD(state.costPerMinute), '$4.00');
});

test('active running time bills $4 per minute without interval counting', function () {
  const { meter, at } = harness();
  applyKnown(meter);
  meter.start();
  at(15000);
  let state = meter.getState();
  assert.equal(state.status, 'running');
  assert.equal(formatElapsed(state.elapsedMs), '00:00:15');
  assert.equal(formatUSD(state.liveCost), '$1.00');
  at(60000);
  state = meter.getState();
  assert.equal(formatElapsed(state.elapsedMs), '00:01:00');
  assert.equal(formatUSD(state.liveCost), '$4.00');
  assert.equal(meter.getState().liveCost, state.liveCost);
});

test('pause freezes outputs and resume excludes paused time', function () {
  const { meter, at } = harness();
  applyKnown(meter);
  meter.start();
  at(15000);
  meter.pause();
  const frozen = meter.getState();
  at(90000);
  const duringPause = meter.getState();
  assert.equal(duringPause.status, 'paused');
  assert.equal(duringPause.elapsedMs, frozen.elapsedMs);
  assert.equal(duringPause.liveCost, frozen.liveCost);
  assert.equal(formatUSD(duringPause.liveCost), '$1.00');
  meter.start();
  at(105000);
  const resumed = meter.getState();
  assert.equal(resumed.status, 'running');
  assert.equal(formatElapsed(resumed.elapsedMs), '00:00:30');
  assert.equal(formatUSD(resumed.liveCost), '$2.00');
});

test('reset from running or paused clears accrual and does not restart', function () {
  const { meter, at, advance } = harness();
  applyKnown(meter);

  meter.start();
  at(20000);
  const resetFromRunning = meter.reset();
  assert.equal(resetFromRunning.status, 'idle');
  assert.equal(formatElapsed(resetFromRunning.elapsedMs), '00:00:00');
  assert.equal(formatUSD(resetFromRunning.liveCost), '$0.00');
  assert.equal(resetFromRunning.attendees, 2);
  assert.equal(resetFromRunning.hourlyCost, 120);
  assert.equal(resetFromRunning.durationMinutes, 30);
  assert.equal(formatUSD(resetFromRunning.projectedTotal), '$120.00');
  advance(30000);
  assert.equal(formatUSD(meter.getState().liveCost), '$0.00');
  assert.equal(meter.getState().status, 'idle');

  meter.start();
  advance(10000);
  meter.pause();
  advance(10000);
  const resetFromPaused = meter.reset();
  assert.equal(resetFromPaused.status, 'idle');
  assert.equal(formatElapsed(resetFromPaused.elapsedMs), '00:00:00');
  assert.equal(formatUSD(resetFromPaused.liveCost), '$0.00');
  advance(20000);
  assert.equal(meter.getState().status, 'idle');
  assert.equal(formatUSD(meter.getState().liveCost), '$0.00');
  assert.equal(meter.getState().hourlyCost, 120);
});

test('repeated start, pause, and reset do not stack timers or jump', function () {
  const { meter, at } = harness();
  applyKnown(meter);
  meter.start();
  meter.start();
  at(1000);
  meter.start();
  at(60000);
  meter.start();
  let state = meter.getState();
  assert.equal(state.elapsedMs, 60000);
  assert.equal(formatUSD(state.liveCost), '$4.00');

  meter.pause();
  const paused = meter.getState();
  meter.pause();
  meter.pause();
  at(120000);
  assert.equal(meter.getState().elapsedMs, paused.elapsedMs);
  assert.equal(meter.getState().liveCost, paused.liveCost);

  meter.reset();
  meter.reset();
  meter.pause();
  meter.reset();
  at(180000);
  state = meter.getState();
  assert.equal(state.status, 'idle');
  assert.equal(state.elapsedMs, 0);
  assert.equal(state.liveCost, 0);
  assert.equal(formatUSD(state.liveCost), '$0.00');
});

test('valid edits update estimates and duration does not change the live rate', function () {
  const { meter, at } = harness();
  applyKnown(meter);
  meter.start();
  at(15000);
  const before = meter.getState();
  assert.equal(meter.setDurationMinutes(90).ok, true);
  const after = meter.getState();
  assert.equal(formatUSD(after.projectedTotal), '$360.00');
  assert.equal(after.costPerMinute, before.costPerMinute);
  assert.equal(after.liveCost, before.liveCost);
  assert.equal(after.elapsedMs, before.elapsedMs);
  assert.equal(formatUSD(after.costPerMinute), '$4.00');

  assert.equal(meter.setAttendees(4).ok, true);
  const doubled = meter.getState();
  assert.equal(formatUSD(doubled.costPerMinute), '$8.00');
  assert.equal(formatUSD(doubled.projectedTotal), '$720.00');
});

test('rate changes accrue the old rate first and pause holds the accrued cost', function () {
  const { meter, at } = harness();
  applyKnown(meter);
  meter.start();
  at(30000);
  assert.equal(meter.setHourlyCost(60).ok, true);
  let state = meter.getState();
  assert.equal(formatUSD(state.costPerMinute), '$2.00');
  assert.equal(formatUSD(state.liveCost), '$2.00');
  assert.equal(formatElapsed(state.elapsedMs), '00:00:30');
  at(60000);
  state = meter.getState();
  assert.equal(formatElapsed(state.elapsedMs), '00:01:00');
  assert.equal(formatUSD(state.liveCost), '$3.00');

  const pausedCase = harness();
  applyKnown(pausedCase.meter);
  pausedCase.meter.start();
  pausedCase.at(30000);
  pausedCase.meter.pause();
  assert.equal(pausedCase.meter.setHourlyCost(60).ok, true);
  pausedCase.at(90000);
  state = pausedCase.meter.getState();
  assert.equal(formatUSD(state.liveCost), '$2.00');
  assert.equal(formatElapsed(state.elapsedMs), '00:00:30');
  assert.equal(formatUSD(state.costPerMinute), '$2.00');
  pausedCase.meter.start();
  pausedCase.at(120000);
  state = pausedCase.meter.getState();
  assert.equal(formatElapsed(state.elapsedMs), '00:01:00');
  assert.equal(formatUSD(state.liveCost), '$3.00');
});

test('invalid drafts keep the last valid calculation', function () {
  const cases = [
    [validateAttendees, ''],
    [validateAttendees, '   '],
    [validateAttendees, 'abc'],
    [validateAttendees, '1.5'],
    [validateAttendees, '-2'],
    [validateAttendees, '0'],
    [validateAttendees, 'Infinity'],
    [validateAttendees, 'NaN'],
    [validateAttendees, '1e309'],
    [validateHourlyCost, ''],
    [validateHourlyCost, 'nope'],
    [validateHourlyCost, '-1'],
    [validateHourlyCost, 'Infinity'],
    [validateHourlyCost, '1e309'],
    [validateDuration, ''],
    [validateDuration, 'soon'],
    [validateDuration, '-5'],
    [validateDuration, 'NaN']
  ];
  cases.forEach(function (entry) {
    const result = entry[0](entry[1]);
    assert.equal(result.ok, false, entry[1]);
    assert.equal(typeof result.error, 'string');
    assert.ok(result.error.length > 0);
  });

  const { meter } = harness();
  const before = meter.getState();
  assert.equal(validateAttendees('2.5').ok, false);
  assert.equal(meter.setAttendees(2.5).ok, false);
  assert.equal(meter.setHourlyCost(Number.POSITIVE_INFINITY).ok, false);
  assert.equal(meter.setDurationMinutes(-1).ok, false);
  const after = meter.getState();
  assert.equal(after.projectedTotal, before.projectedTotal);
  assert.equal(after.costPerMinute, before.costPerMinute);
  assert.equal(after.attendees, 5);
  assert.equal(formatUSD(after.projectedTotal), '$250.00');
  assert.ok(!formatUSD(after.projectedTotal).includes('NaN'));
  assert.ok(!formatUSD(after.liveCost).includes('Infinity'));
});

test('overflowing totals are rejected and the last valid values remain', function () {
  const { meter } = harness();
  const before = meter.getState();
  assert.equal(meter.setHourlyCost(1e16).ok, false);
  assert.equal(meter.setAttendees(1e16).ok, false);
  assert.equal(validateAttendees('10000000000000000').ok, false);
  assert.equal(meter.setDurationMinutes(1e16).ok, false);
  const after = meter.getState();
  assert.equal(after.hourlyCost, before.hourlyCost);
  assert.equal(after.attendees, before.attendees);
  assert.equal(after.durationMinutes, before.durationMinutes);
  assert.equal(formatUSD(after.projectedTotal), '$250.00');
});

test('zero hourly cost and zero duration are valid', function () {
  const { meter, at } = harness();
  assert.equal(meter.setHourlyCost(0).ok, true);
  let state = meter.getState();
  assert.equal(formatUSD(state.projectedTotal), '$0.00');
  assert.equal(formatUSD(state.costPerMinute), '$0.00');
  meter.start();
  at(60000);
  state = meter.getState();
  assert.equal(state.status, 'running');
  assert.equal(formatUSD(state.liveCost), '$0.00');
  meter.reset();

  assert.equal(meter.setHourlyCost(120).ok, true);
  assert.equal(meter.setAttendees(2).ok, true);
  assert.equal(meter.setDurationMinutes(0).ok, true);
  state = meter.getState();
  assert.equal(formatUSD(state.projectedTotal), '$0.00');
  assert.equal(formatUSD(state.costPerMinute), '$4.00');
  meter.start();
  at(75000);
  state = meter.getState();
  assert.equal(state.status, 'running');
  assert.equal(formatElapsed(state.elapsedMs), '00:00:15');
  assert.equal(formatUSD(state.liveCost), '$1.00');
});

test('the timer keeps running after the planned duration', function () {
  const { meter, at } = harness();
  applyKnown(meter);
  assert.equal(meter.setDurationMinutes(0.25).ok, true);
  assert.equal(formatUSD(meter.getState().projectedTotal), '$1.00');
  meter.start();
  at(60000);
  const state = meter.getState();
  assert.equal(state.status, 'running');
  assert.equal(formatElapsed(state.elapsedMs), '00:01:00');
  assert.equal(formatUSD(state.liveCost), '$4.00');
});

test('a jumped monotonic clock preserves elapsed time and cost', function () {
  const { meter, at } = harness();
  applyKnown(meter);
  meter.start();
  at(0);
  meter.start();
  at(120000);
  const state = meter.getState();
  assert.equal(formatElapsed(state.elapsedMs), '00:02:00');
  assert.equal(formatUSD(state.liveCost), '$8.00');
});

test('currency formatting uses dollars, separators, and two decimals', function () {
  assert.equal(formatUSD(0), '$0.00');
  assert.equal(formatUSD(4), '$4.00');
  assert.equal(formatUSD(8.333333333333334), '$8.33');
  assert.equal(formatUSD(120), '$120.00');
  assert.equal(formatUSD(1000), '$1,000.00');
  assert.equal(formatUSD(1234567.891), '$1,234,567.89');
  assert.equal(formatUSD(-0), '$0.00');
  assert.equal(formatUSD(Number.NaN), '$0.00');
  assert.equal(formatUSD(Number.POSITIVE_INFINITY), '$0.00');
  assert.equal(formatElapsed(0), '00:00:00');
  assert.equal(formatElapsed(3661000), '01:01:01');
});

test('start and resume stay disabled until every field is valid', function () {
  assert.equal(canStart('idle', true), true);
  assert.equal(canStart('paused', true), true);
  assert.equal(canStart('running', true), false);
  assert.equal(canStart('idle', false), false);
  assert.equal(canStart('paused', false), false);
  assert.equal(canStart('running', false), false);
});

test('fractional duration is allowed and attendee fractions are not', function () {
  assert.equal(validateDuration('30.5').ok, true);
  assert.equal(validateDuration('30.5').value, 30.5);
  assert.equal(validateAttendees('5.0').ok, true);
  assert.equal(validateAttendees('5.0').value, 5);
  assert.equal(validateAttendees('5.5').ok, false);
  const { meter } = harness();
  assert.equal(meter.setDurationMinutes(30.5).ok, true);
  assert.equal(formatUSD(meter.getState().projectedTotal), '$254.17');
  assert.equal(formatUSD(meter.getState().costPerMinute), '$8.33');
});
