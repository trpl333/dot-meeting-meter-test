'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const meeting = require('../src/meeting.js');

const {
  DEFAULTS,
  validateAttendees,
  validateHourlyCost,
  validateDuration,
  formatUSD,
  formatElapsed,
  canStart,
  resolveInputs,
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

test('live cost overflow is explicit and does not cap the displayed amount', function () {
  const { meter, at } = harness();
  assert.equal(meter.setAttendees(1).ok, true);
  assert.equal(meter.setHourlyCost(1e12).ok, true);
  assert.equal(meter.setDurationMinutes(30).ok, true);
  const safe = meter.getState();
  assert.equal(safe.liveCostOverflow, false);
  assert.ok(formatUSD(safe.projectedTotal).startsWith('$'));
  assert.notEqual(formatUSD(1e16), '$90,071,992,547,409.91');
  assert.equal(formatUSD(1e16), null);

  meter.start();
  at(60000);
  const running = meter.getState();
  assert.equal(running.status, 'running');
  assert.equal(running.liveCostOverflow, false);
  assert.ok(formatUSD(running.liveCost).startsWith('$'));

  at(1e15);
  const overflowed = meter.getState();
  assert.equal(overflowed.liveCostOverflow, true);
  assert.equal(overflowed.status, 'overflow');
  assert.equal(overflowed.liveCost, null);
  const frozenElapsed = overflowed.elapsedMs;
  at(1e15 + 60000);
  meter.start();
  meter.pause();
  const held = meter.getState();
  assert.equal(held.status, 'overflow');
  assert.equal(held.liveCost, null);
  assert.equal(held.elapsedMs, frozenElapsed);
  assert.equal(canStart('overflow', true), false);

  const cleared = meter.reset();
  assert.equal(cleared.status, 'idle');
  assert.equal(cleared.liveCostOverflow, false);
  assert.equal(formatUSD(cleared.liveCost), '$0.00');
  assert.equal(formatElapsed(cleared.elapsedMs), '00:00:00');
  assert.equal(cleared.hourlyCost, 1e12);
});

test('dependent inputs are revalidated together and accrued cost is preserved', function () {
  const applied = { attendees: 5, hourlyCost: 100, durationMinutes: 30 };
  const rejected = resolveInputs(applied, {
    attendees: validateAttendees('5'),
    hourly: validateHourlyCost('3e13'),
    duration: validateDuration('30')
  });
  assert.equal(rejected.apply, false);
  assert.match(rejected.fieldErrors.hourly, /too large/i);
  assert.equal(rejected.fieldErrors.attendees, null);
  assert.equal(rejected.values.hourlyCost, 100);

  const stillTooMany = resolveInputs(applied, {
    attendees: validateAttendees('4'),
    hourly: validateHourlyCost('3e13'),
    duration: validateDuration('30')
  });
  assert.equal(stillTooMany.apply, false);

  const accepted = resolveInputs(applied, {
    attendees: validateAttendees('1'),
    hourly: validateHourlyCost('3e13'),
    duration: validateDuration('30')
  });
  assert.equal(accepted.apply, true);
  assert.equal(accepted.fieldErrors.hourly, null);
  assert.equal(accepted.fieldErrors.attendees, null);
  assert.equal(accepted.values.attendees, 1);
  assert.equal(accepted.values.hourlyCost, 3e13);

  const durationRejected = resolveInputs(applied, {
    attendees: validateAttendees('5'),
    hourly: validateHourlyCost('100'),
    duration: validateDuration('1e16')
  });
  assert.equal(durationRejected.apply, false);
  assert.match(durationRejected.fieldErrors.duration, /too large/i);
  const durationRecovered = resolveInputs(applied, {
    attendees: validateAttendees('5'),
    hourly: validateHourlyCost('0'),
    duration: validateDuration('1e16')
  });
  assert.equal(durationRecovered.apply, true);
  assert.equal(durationRecovered.values.hourlyCost, 0);
  assert.equal(durationRecovered.values.durationMinutes, 1e16);
  assert.equal(durationRecovered.fieldErrors.duration, null);

  const blankKept = resolveInputs(applied, {
    attendees: validateAttendees('8'),
    hourly: validateHourlyCost(''),
    duration: validateDuration('45')
  });
  assert.equal(blankKept.apply, true);
  assert.equal(blankKept.values.attendees, 8);
  assert.equal(blankKept.values.hourlyCost, 100);
  assert.equal(blankKept.values.durationMinutes, 45);
  assert.match(blankKept.fieldErrors.hourly, /hourly/i);

  const { meter, at } = harness();
  meter.start();
  at(60000);
  assert.equal(meter.setHourlyCost('3e13').ok, false);
  const before = meter.getState();
  assert.equal(before.hourlyCost, 100);
  assert.equal(before.liveCostOverflow, false);
  at(90000);
  const switched = meter.applyInputs(accepted.values);
  assert.equal(switched.ok, true);
  const atSwitch = meter.getState();
  assert.equal(atSwitch.attendees, 1);
  assert.equal(atSwitch.hourlyCost, 3e13);
  assert.ok(Math.abs(atSwitch.liveCost - 12.5) < 1e-6);
  assert.equal(formatUSD(atSwitch.projectedTotal), '$15,000,000,000,000.00');
  assert.equal(formatUSD(atSwitch.costPerMinute), '$500,000,000,000.00');
  at(150000);
  const later = meter.getState();
  assert.ok(Math.abs(later.liveCost - (12.5 + 3e13 / 60)) < 1);
  assert.equal(later.status, 'running');
});

test('displayed currency rounds half cents up without changing internal precision', function () {
  const { meter } = harness();
  assert.equal(meter.setAttendees(1).ok, true);
  assert.equal(meter.setHourlyCost(20.15).ok, true);
  assert.equal(meter.setDurationMinutes(30).ok, true);
  const state = meter.getState();
  // 20.15 × 30 / 60 = 10.075 exactly, which half-up rounds to $10.08.
  assert.ok(Math.abs(state.projectedTotal - 10.075) < 1e-9);
  assert.notEqual(state.projectedTotal, 10.08);
  assert.equal(state.projectedUSD, '$10.08');
  assert.equal(state.costPerMinuteUSD, '$0.34');
  // The binary value of the literal 10.075 is slightly under that decimal,
  // so one half-up of the float is $10.07. Display uses the decimal inputs.
  assert.equal(formatUSD(state.projectedTotal), '$10.07');
  assert.equal(formatUSD(10.075), '$10.07');
  assert.equal(formatUSD(10.074), '$10.07');
  assert.equal(formatUSD(1.005), '$1.00');
  assert.equal(formatUSD(1.015), '$1.01');
  assert.equal(formatUSD(1.004), '$1.00');
  assert.equal(formatUSD(2.675), '$2.67');
  assert.equal(formatUSD(0.005), '$0.01');
});

test('extreme numeric text keeps integer and sign meaning', function () {
  const fractional = validateAttendees('1.0000000000000001');
  assert.equal(fractional.ok, false);
  assert.match(fractional.error, /fractional/i);
  assert.equal(validateAttendees('1.0000000000000001e1').ok, false);
  assert.equal(validateAttendees('5.0').ok, true);
  assert.equal(validateAttendees('5.0').value, 5);
  assert.equal(validateAttendees('1.5e1').ok, true);
  assert.equal(validateAttendees('1.5e1').value, 15);

  const negativeHourly = validateHourlyCost('-1e-999');
  assert.equal(negativeHourly.ok, false);
  assert.match(negativeHourly.error, /negative/i);
  const negativeDuration = validateDuration('-1e-999');
  assert.equal(negativeDuration.ok, false);
  assert.match(negativeDuration.error, /negative/i);
  assert.equal(validateAttendees('-1e-999').ok, false);
  assert.equal(validateHourlyCost('-0').ok, true);
  assert.equal(validateHourlyCost('-0').value, 0);
  assert.equal(validateDuration('-0.0').ok, true);
  assert.equal(validateDuration('-0.0').value, 0);

  const { meter } = harness();
  assert.equal(meter.setAttendees('1.0000000000000001').ok, false);
  assert.equal(meter.getState().attendees, 5);
  assert.equal(meter.setHourlyCost('-1e-999').ok, false);
  assert.equal(meter.getState().hourlyCost, 100);
});

function independentProjectedUSD(attendeesText, hourlyText, minutesText) {
  function parse(text) {
    const raw = String(text).trim();
    const body = raw[0] === '+' || raw[0] === '-' ? raw.slice(1) : raw;
    const match = body.match(/^(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/);
    const digits = ((match[1] || '') + (match[2] || '')).replace(/^0+/, '') || '0';
    const exp = (match[3] ? Number(match[3]) : 0) - (match[2] || '').length;
    return { coeff: BigInt(digits), exp: exp };
  }
  const attendees = parse(attendeesText);
  const hourly = parse(hourlyText);
  const minutes = parse(minutesText);
  const product = {
    coeff: attendees.coeff * hourly.coeff * minutes.coeff,
    exp: attendees.exp + hourly.exp + minutes.exp
  };
  let numerator = product.coeff;
  let denominator = 60n;
  const centScale = product.exp + 2;
  if (centScale >= 0) {
    numerator *= 10n ** BigInt(centScale);
  } else {
    denominator *= 10n ** BigInt(-centScale);
  }
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  const cents = remainder * 2n >= denominator ? quotient + 1n : quotient;
  const text = cents.toString().padStart(3, '0');
  return '$' + text.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + text.slice(-2);
}

function projectedDisplay(attendees, hourly, minutes) {
  const { meter } = harness();
  assert.equal(meter.setAttendees(attendees).ok, true, String(attendees));
  assert.equal(meter.setHourlyCost(hourly).ok, true, String(hourly));
  assert.equal(meter.setDurationMinutes(minutes).ok, true, String(minutes));
  return meter.getState();
}

test('decimal inputs half-up to cents once, including the reported one-cent cases', function () {
  const cases = [
    ['1', '20.14999999992', '30', '$10.07'],
    ['1', '2097152.01', '30', '$1,048,576.01'],
    ['10001', '100.13', '30', '$500,700.07'],
    ['1', '20.15', '30', '$10.08'],
    ['1', '2.015e1', '30', '$10.08'],
    ['1', '20.14', '30', '$10.07'],
    ['1', '20.16', '30', '$10.08'],
    ['1', '0.008', '30', '$0.00'],
    ['1', '0.01', '30', '$0.01'],
    ['1', '0.012', '30', '$0.01']
  ];
  cases.forEach(function (entry) {
    const expected = entry[3];
    assert.equal(independentProjectedUSD(entry[0], entry[1], entry[2]), expected, entry.join(' '));
    const state = projectedDisplay(entry[0], entry[1], entry[2]);
    assert.equal(state.projectedUSD, expected, entry.join(' '));
  });

  const justUnder = projectedDisplay('1', '20.14999999992', '30');
  assert.equal(justUnder.projectedUSD, '$10.07');
  assert.notEqual(formatUSD(justUnder.projectedTotal), '$10.08');

  const powerOfTwoBoundary = projectedDisplay('1', '2097152.01', '30');
  assert.equal(powerOfTwoBoundary.projectedUSD, '$1,048,576.01');
  assert.equal(formatUSD(powerOfTwoBoundary.projectedTotal), '$1,048,576.00');

  const groupBoundary = projectedDisplay('10001', '100.13', '30');
  assert.equal(groupBoundary.projectedUSD, '$500,700.07');
  assert.equal(formatUSD(groupBoundary.projectedTotal), '$500,700.06');

  const kept = projectedDisplay(1, 20.15, 30);
  assert.equal(kept.projectedUSD, '$10.08');
  assert.equal(kept.costPerMinuteUSD, '$0.34');
  assert.equal(formatUSD(kept.projectedTotal), '$10.07');
});

function armHighRate(meter) {
  assert.equal(meter.setAttendees(1).ok, true);
  assert.equal(meter.setHourlyCost('9e13').ok, true);
  assert.equal(meter.setDurationMinutes(30).ok, true);
}

test('pause then resume paints overflow on the first timer callback', function () {
  let time = 0;
  const now = function () { return time; };
  const fixed = createMeter({ now: now });
  const buggy = createMeter({ now: now });
  armHighRate(fixed);
  armHighRate(buggy);
  fixed.start();
  buggy.start();
  time = 3602800;

  const fixedViews = [];
  const fixedTick = meeting.createDisplayTick(fixed, function (state) {
    fixedViews.push(meeting.describeLiveView(state, true));
  });
  const buggyViews = [];
  let followTimer = false;
  function buggyTick() {
    const state = buggy.getState();
    if (state.status === 'running') {
      followTimer = true;
      buggyViews.push(state.status);
    } else if (followTimer) {
      followTimer = false;
      buggyViews.push(state.status);
    }
  }

  fixedTick();
  buggyTick();
  assert.equal(fixedViews[fixedViews.length - 1].label, 'Running');
  assert.equal(fixedViews[fixedViews.length - 1].liveText, '$90,070,000,000,000.00');
  assert.equal(fixedViews[fixedViews.length - 1].overflowVisible, false);
  assert.equal(fixedViews[fixedViews.length - 1].startDisabled, true);

  fixed.pause();
  buggy.pause();
  fixedTick();
  buggyTick();
  assert.equal(fixedViews[fixedViews.length - 1].label, 'Paused');
  assert.equal(fixedViews[fixedViews.length - 1].overflowVisible, false);
  assert.equal(buggyViews[buggyViews.length - 1], 'paused');
  assert.equal(followTimer, false);

  fixed.start();
  buggy.start();
  time = 3603050;
  fixedTick();
  buggyTick();
  const first = fixedViews[fixedViews.length - 1];
  assert.equal(first.status, 'overflow');
  assert.equal(first.label, 'Stopped');
  assert.equal(first.liveText, 'Too large');
  assert.equal(first.overflowVisible, true);
  assert.equal(first.startDisabled, true);
  assert.match(first.detail, /Reset to start over/);
  assert.equal(buggy.getState().status, 'overflow');
  assert.notEqual(buggyViews[buggyViews.length - 1], 'overflow');

  const elapsed = fixed.getState().elapsedMs;
  time = 3603050 + 5000;
  fixedTick();
  assert.equal(fixedViews[fixedViews.length - 1].status, 'overflow');
  assert.equal(fixedViews[fixedViews.length - 1].liveText, 'Too large');
  assert.equal(fixed.getState().elapsedMs, elapsed);
  assert.notEqual(first.liveText, '$90,071,992,547,409.91');

  const cleared = fixed.reset();
  const resetView = meeting.describeLiveView(cleared, true);
  assert.equal(resetView.status, 'idle');
  assert.equal(resetView.label, 'Idle');
  assert.equal(resetView.liveText, '$0.00');
  assert.equal(resetView.overflowVisible, false);
  assert.equal(resetView.startDisabled, false);
  assert.equal(cleared.attendees, 1);
  assert.equal(cleared.hourlyCost, 9e13);
  assert.equal(cleared.durationMinutes, 30);
});

test('the first callback after start paints an immediate overflow', function () {
  const { meter, at } = harness();
  armHighRate(meter);
  const views = [];
  const tick = meeting.createDisplayTick(meter, function (state) {
    views.push(meeting.describeLiveView(state, true));
  });
  meter.start();
  at(3603050);
  tick();
  assert.equal(views.length, 1);
  assert.equal(views[0].label, 'Stopped');
  assert.equal(views[0].liveText, 'Too large');
  assert.equal(views[0].overflowVisible, true);
  assert.equal(views[0].startDisabled, true);
  const elapsed = meter.getState().elapsedMs;
  at(3603050 + 8000);
  tick();
  assert.equal(views.length, 2);
  assert.equal(views[1].label, 'Stopped');
  assert.equal(views[1].liveText, 'Too large');
  assert.equal(meter.getState().elapsedMs, elapsed);
  assert.equal(meter.getState().status, 'overflow');
});

test('a later running callback paints the overflow transition', function () {
  const { meter, at } = harness();
  armHighRate(meter);
  const views = [];
  const tick = meeting.createDisplayTick(meter, function (state) {
    views.push(meeting.describeLiveView(state, true));
  });
  meter.start();
  at(3602800);
  tick();
  assert.equal(views[0].label, 'Running');
  assert.equal(views[0].liveText, '$90,070,000,000,000.00');
  assert.equal(views[0].overflowVisible, false);
  at(3603050);
  tick();
  assert.equal(views[1].label, 'Stopped');
  assert.equal(views[1].liveText, 'Too large');
  assert.equal(views[1].overflowVisible, true);
  assert.equal(views[1].startDisabled, true);
});

test('resume without extra time stays running until the next callback crosses the limit', function () {
  const { meter, at } = harness();
  armHighRate(meter);
  const views = [];
  const tick = meeting.createDisplayTick(meter, function (state) {
    views.push(meeting.describeLiveView(state, true));
  });
  meter.start();
  at(3602800);
  meter.pause();
  tick();
  assert.equal(views[views.length - 1].label, 'Paused');
  assert.equal(views[views.length - 1].liveText, '$90,070,000,000,000.00');
  meter.start();
  tick();
  assert.equal(views[views.length - 1].label, 'Running');
  assert.equal(views[views.length - 1].overflowVisible, false);
  assert.equal(views[views.length - 1].liveText, '$90,070,000,000,000.00');
  at(3603050);
  tick();
  assert.equal(views[views.length - 1].label, 'Stopped');
  assert.equal(views[views.length - 1].liveText, 'Too large');
  assert.equal(views[views.length - 1].startDisabled, true);
  const cleared = meter.reset();
  assert.equal(cleared.status, 'idle');
  assert.equal(cleared.attendees, 1);
  assert.equal(cleared.hourlyCost, 9e13);
  assert.equal(cleared.durationMinutes, 30);
  assert.equal(meeting.describeLiveView(cleared, true).liveText, '$0.00');
  assert.equal(meeting.describeLiveView(cleared, true).overflowVisible, false);
  assert.equal(meeting.describeLiveView(cleared, true).startDisabled, false);
});

test('the page tick always paints the state returned by getState', function () {
  const source = fs.readFileSync(path.join(__dirname, '../src/app.js'), 'utf8');
  assert.match(source, /createDisplayTick\s*\(\s*meter\s*,\s*render\s*\)/);
  assert.doesNotMatch(source, /followTimer/);
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

function applySmallHourly(meter, attendees, hourly, minutes) {
  assert.equal(meter.setHourlyCost(hourly).ok, true, String(hourly));
  assert.equal(meter.setDurationMinutes(minutes).ok, true, String(minutes));
  assert.equal(meter.setAttendees(attendees).ok, true, String(attendees));
  return meter.getState();
}

function applyLargeHourly(meter, hourly, minutes) {
  assert.equal(meter.setAttendees('1').ok, true);
  assert.equal(meter.setHourlyCost(hourly).ok, true, String(hourly));
  assert.equal(meter.setDurationMinutes(minutes).ok, true, String(minutes));
  return meter.getState();
}

test('small nonzero decimals stay exact through projected, live, and segment costs', function () {
  const source = fs.readFileSync(path.join(__dirname, '../src/meeting.js'), 'utf8');
  assert.doesNotMatch(source, /digits\.length \+ 8/);

  // 1e12 × 1e-10 / 60 = 5/3 per minute; × 30 minutes = $50.00. Display of 5/3 is $1.67.
  const caseA = applySmallHourly(harness().meter, '1000000000000', '0.0000000001', '30');
  assert.equal(caseA.costPerMinuteUSD, '$1.67');
  assert.equal(caseA.projectedUSD, '$50.00');
  assert.notEqual(caseA.projectedUSD, '$0.00');

  const scientificA = applySmallHourly(harness().meter, '1e12', '1e-10', '3e1');
  assert.equal(scientificA.costPerMinuteUSD, '$1.67');
  assert.equal(scientificA.projectedUSD, '$50.00');

  const { meter: liveMeter, at } = harness();
  applySmallHourly(liveMeter, '1000000000000', '1e-10', '30');
  liveMeter.start();
  at(3600000);
  const caseB = liveMeter.getState();
  assert.equal(caseB.status, 'running');
  assert.equal(formatElapsed(caseB.elapsedMs), '01:00:00');
  assert.equal(caseB.liveCostUSD, '$100.00');
  assert.notEqual(caseB.liveCostUSD, '$0.00');

  // 6e13 / 60 × 1e-10 = $100.00.
  const caseC = applyLargeHourly(harness().meter, '60000000000000', '0.0000000001');
  assert.equal(caseC.projectedUSD, '$100.00');
  const caseCScientific = applyLargeHourly(harness().meter, '6e13', '1e-10');
  assert.equal(caseCScientific.projectedUSD, '$100.00');
  assert.equal(caseCScientific.costPerMinuteUSD, '$1,000,000,000,000.00');

  // 1e12 × 1e-9 / 60 = 50/3 → $16.67; × 30 = $500.00.
  const billionth = applySmallHourly(harness().meter, '1e12', '1e-9', '30');
  assert.equal(billionth.costPerMinuteUSD, '$16.67');
  assert.equal(billionth.projectedUSD, '$500.00');
  // 1e12 × 1e-12 / 60 = 1/60 → $0.02; × 30 = $0.50.
  const trillionth = applySmallHourly(harness().meter, '1e12', '1e-12', '30');
  assert.equal(trillionth.costPerMinuteUSD, '$0.02');
  assert.equal(trillionth.projectedUSD, '$0.50');

  // 6e13 / 60 × 1e-12 = $1.00; × 1e-9 = $1,000.00.
  assert.equal(applyLargeHourly(harness().meter, '6e13', '1e-12').projectedUSD, '$1.00');
  assert.equal(applyLargeHourly(harness().meter, '6e13', '1e-9').projectedUSD, '$1,000.00');

  const { meter: segments, at: atSegment } = harness();
  applySmallHourly(segments, '1e12', '1e-10', '30');
  segments.start();
  atSegment(20000);
  assert.equal(segments.setHourlyCost('3e-10').ok, true);
  assert.equal(segments.getState().liveCostUSD, '$0.56');
  atSegment(40000);
  assert.equal(segments.setHourlyCost('2e-10').ok, true);
  assert.equal(segments.getState().liveCostUSD, '$2.22');
  atSegment(60000);
  const combined = segments.getState();
  assert.equal(formatElapsed(combined.elapsedMs), '00:01:00');
  assert.equal(combined.liveCostUSD, '$3.33');
  assert.equal(combined.costPerMinuteUSD, '$3.33');

  const { meter: switched, at: atSwitch } = harness();
  applySmallHourly(switched, '1e12', '1e-10', '30');
  switched.start();
  atSwitch(30000);
  assert.equal(switched.setHourlyCost('2e-10').ok, true);
  assert.equal(switched.getState().liveCostUSD, '$0.83');
  atSwitch(60000);
  assert.equal(switched.getState().liveCostUSD, '$2.50');

  const { meter: paused, at: atPause } = harness();
  applySmallHourly(paused, '1e12', '0.0000000001', '30');
  paused.start();
  atPause(30000);
  paused.pause();
  assert.equal(paused.setHourlyCost('2e-10').ok, true);
  atPause(90000);
  assert.equal(paused.getState().liveCostUSD, '$0.83');
  assert.equal(paused.getState().status, 'paused');
  paused.start();
  atPause(120000);
  assert.equal(paused.getState().liveCostUSD, '$2.50');
  assert.equal(formatElapsed(paused.getState().elapsedMs), '00:01:00');
});

test('exponent bounds reject unsupported scales instead of treating them as zero', function () {
  const inside = validateHourlyCost('1e-10000');
  assert.equal(inside.ok, true);
  assert.equal(inside.decimal.num, 1n);
  assert.equal(inside.decimal.den, 10n ** 10000n);

  const underflow = validateHourlyCost('1e-400');
  assert.equal(underflow.ok, true);
  assert.equal(underflow.decimal.num, 1n);
  assert.equal(underflow.decimal.den, 10n ** 400n);
  assert.equal(validateDuration('1e-12').ok, true);
  assert.notEqual(validateDuration('1e-12').decimal.num, 0n);

  const below = validateHourlyCost('1e-10001');
  assert.equal(below.ok, false);
  assert.match(below.error, /supported range/i);
  const durationBelow = validateDuration('1e-10001');
  assert.equal(durationBelow.ok, false);
  assert.match(durationBelow.error, /supported range/i);

  const above = validateHourlyCost('1e+10001');
  assert.equal(above.ok, false);
  assert.match(above.error, /finite|supported range/i);
  const durationAbove = validateDuration('1e+10000');
  assert.equal(durationAbove.ok, false);

  const { meter } = harness();
  applySmallHourly(meter, '1e12', '1e-10', '30');
  assert.equal(meter.setHourlyCost('1e-10001').ok, false);
  assert.equal(meter.setDurationMinutes('1e-10001').ok, false);
  assert.equal(meter.setHourlyCost('1e+10001').ok, false);
  const kept = meter.getState();
  assert.equal(kept.projectedUSD, '$50.00');
  assert.equal(kept.costPerMinuteUSD, '$1.67');
  assert.notEqual(kept.projectedUSD, '$0.00');

  assert.equal(validateHourlyCost('-1e-999').ok, false);
  assert.match(validateHourlyCost('-1e-999').error, /negative/i);
  assert.equal(validateHourlyCost('-1e-10001').ok, false);
  assert.match(validateHourlyCost('-1e-10001').error, /negative/i);
  assert.equal(validateHourlyCost('0e-10001').ok, true);
  assert.equal(validateHourlyCost('0e-10001').value, 0);
});
