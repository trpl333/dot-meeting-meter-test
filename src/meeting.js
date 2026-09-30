(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.MeetingMeter = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var MAX_SAFE_CENTS = 9007199254740991;
  var MAX_SAFE_CENTS_TEXT = String(MAX_SAFE_CENTS);
  // Absolute power-of-ten scale we will build exactly. Beyond this, validation rejects the entry.
  var MAX_DECIMAL_SCALE = 10000;
  var NUMERIC = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

  var DEFAULTS = {
    attendees: 5,
    hourlyCost: 100,
    durationMinutes: 30
  };

  function inspectNumericText(raw) {
    if (raw == null) {
      return { ok: false, reason: 'blank' };
    }
    var text = String(raw).trim();
    if (text === '') {
      return { ok: false, reason: 'blank' };
    }
    if (!NUMERIC.test(text)) {
      return { ok: false, reason: 'nonnumeric' };
    }
    var negative = text.charAt(0) === '-';
    var unsigned = text.charAt(0) === '+' || negative ? text.slice(1) : text;
    var match = unsigned.match(/^(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/);
    var intPart = match[1];
    var fracPart = match[2] || '';
    var exponent = 0;
    if (match[3] != null && match[3] !== '+' && match[3] !== '-') {
      var expDigits = match[3].replace(/^[+-]/, '').replace(/^0+/, '') || '0';
      if (expDigits.length > 15) {
        exponent = match[3].charAt(0) === '-' ? -Infinity : Infinity;
      } else {
        exponent = Number(match[3]);
      }
    }
    return {
      ok: true,
      text: text,
      negative: negative,
      trueZero: !/[1-9]/.test(intPart + fracPart),
      intPart: intPart,
      fracPart: fracPart,
      exponent: exponent
    };
  }

  function isTextualInteger(parts) {
    if (parts.trueZero) {
      return true;
    }
    if (parts.exponent === -Infinity) {
      return false;
    }
    if (parts.exponent === Infinity) {
      return true;
    }
    var scale = parts.fracPart.length - parts.exponent;
    if (scale <= 0) {
      return true;
    }
    var digits = parts.intPart + parts.fracPart;
    if (scale >= digits.length) {
      return false;
    }
    return !/[1-9]/.test(digits.slice(digits.length - scale));
  }

  function integerDigitString(parts) {
    if (parts.trueZero || !isFinite(parts.exponent)) {
      return parts.trueZero ? '0' : '999999999999999999999';
    }
    var digits = (parts.intPart + parts.fracPart).replace(/^0+/, '') || '0';
    var scale = parts.fracPart.length - parts.exponent;
    if (scale <= 0) {
      while (scale < 0 && digits.length <= 20) {
        digits += '0';
        scale += 1;
      }
      return digits;
    }
    return digits.slice(0, digits.length - scale).replace(/^0+/, '') || '0';
  }

  function exceedsSafeInteger(digits) {
    var value = digits.replace(/^0+/, '') || '0';
    if (value.length > MAX_SAFE_CENTS_TEXT.length) {
      return true;
    }
    if (value.length < MAX_SAFE_CENTS_TEXT.length) {
      return false;
    }
    return value > MAX_SAFE_CENTS_TEXT;
  }

  var MAX_SAFE_CENTS_BIGINT = 9007199254740991n;

  function gcd(left, right) {
    var a = left < 0n ? -left : left;
    var b = right < 0n ? -right : right;
    while (b !== 0n) {
      var next = a % b;
      a = b;
      b = next;
    }
    return a;
  }

  function ratio(numerator, denominator) {
    if (denominator < 0n) {
      numerator = -numerator;
      denominator = -denominator;
    }
    if (numerator === 0n) {
      return { num: 0n, den: 1n };
    }
    var divisor = gcd(numerator, denominator);
    return { num: numerator / divisor, den: denominator / divisor };
  }

  function multiply(left, right) {
    return ratio(left.num * right.num, left.den * right.den);
  }

  function divide(left, right) {
    return ratio(left.num * right.den, left.den * right.num);
  }

  function add(left, right) {
    return ratio(left.num * right.den + right.num * left.den, left.den * right.den);
  }

  function pow10(exponent) {
    var result = 1n;
    var base = 10n;
    var remaining = BigInt(exponent);
    while (remaining > 0n) {
      if (remaining & 1n) {
        result *= base;
      }
      base *= base;
      remaining >>= 1n;
    }
    return result;
  }

  // Entered decimal text is the source of truth. Binary floats are only a display fallback.
  function rationalFromParts(parts) {
    if (!parts || !parts.ok) {
      return null;
    }
    if (parts.trueZero) {
      return ratio(0n, 1n);
    }
    if (parts.exponent === Infinity || parts.exponent === -Infinity) {
      return null;
    }
    var digits = (parts.intPart + parts.fracPart).replace(/^0+/, '') || '0';
    if (digits === '0') {
      return ratio(0n, 1n);
    }
    var scale = parts.exponent - parts.fracPart.length;
    if (scale > MAX_DECIMAL_SCALE || scale < -MAX_DECIMAL_SCALE) {
      return null;
    }
    var coefficient = BigInt(digits);
    if (scale >= 0) {
      return ratio(coefficient * pow10(scale), 1n);
    }
    return ratio(coefficient, pow10(-scale));
  }

  function rationalFromNumber(value) {
    if (typeof value !== 'number' || !isFinite(value)) {
      return null;
    }
    if (value === 0) {
      return ratio(0n, 1n);
    }
    var buffer = new ArrayBuffer(8);
    var view = new DataView(buffer);
    view.setFloat64(0, value, false);
    var bits = view.getBigUint64(0, false);
    var exponent = (bits >> 52n) & 0x7ffn;
    var fraction = bits & 0xfffffffffffffn;
    if (exponent === 0x7ffn) {
      return null;
    }
    var numerator;
    var denominator;
    if (exponent === 0n) {
      numerator = fraction;
      denominator = 1n << 1074n;
    } else {
      numerator = (1n << 52n) | fraction;
      var power = exponent - 1023n - 52n;
      if (power >= 0n) {
        numerator <<= power;
        denominator = 1n;
      } else {
        denominator = 1n << -power;
      }
    }
    if ((bits >> 63n) === 1n) {
      numerator = -numerator;
    }
    return ratio(numerator, denominator);
  }

  function decimalFromApplied(appliedDecimal, numeric) {
    if (appliedDecimal && typeof appliedDecimal.num === 'bigint' && typeof appliedDecimal.den === 'bigint' && appliedDecimal.den > 0n) {
      return appliedDecimal;
    }
    var parsed = inspectNumericText(numeric);
    if (!parsed.ok) {
      return ratio(0n, 1n);
    }
    return rationalFromParts(parsed) || ratio(0n, 1n);
  }

  function finishDecimal(parts, numeric, tooLarge) {
    var decimal = rationalFromParts(parts);
    if (!decimal) {
      return { ok: false, error: tooLarge };
    }
    return { ok: true, value: numeric, decimal: decimal };
  }

  function validateAttendees(raw) {
    var parsed = inspectNumericText(raw);
    if (!parsed.ok) {
      if (parsed.reason === 'blank') {
        return { ok: false, error: 'Enter the number of attendees.' };
      }
      return { ok: false, error: 'Enter a numeric attendee count.' };
    }
    if (parsed.negative && !parsed.trueZero) {
      return { ok: false, error: 'Attendee count cannot be negative.' };
    }
    if (!isTextualInteger(parsed)) {
      return { ok: false, error: 'Fractional attendee counts are not allowed.' };
    }
    var numeric = Number(parsed.text);
    if (!isFinite(numeric)) {
      return { ok: false, error: 'Enter a finite number of attendees.' };
    }
    if (parsed.trueZero || numeric < 1) {
      return { ok: false, error: 'Enter at least 1 attendee.' };
    }
    if (exceedsSafeInteger(integerDigitString(parsed)) || !Number.isSafeInteger(numeric)) {
      return { ok: false, error: 'That attendee count is too large to calculate exactly.' };
    }
    return finishDecimal(parsed, numeric, 'That attendee count is outside the supported range.');
  }

  function validateNonNegative(raw, messages) {
    var parsed = inspectNumericText(raw);
    if (!parsed.ok) {
      if (parsed.reason === 'blank') {
        return { ok: false, error: messages.blank };
      }
      return { ok: false, error: messages.nonnumeric };
    }
    if (parsed.negative && !parsed.trueZero) {
      return { ok: false, error: messages.negative };
    }
    var numeric = Number(parsed.text);
    if (!isFinite(numeric)) {
      return { ok: false, error: messages.nonfinite };
    }
    if (parsed.trueZero) {
      numeric = 0;
    }
    if (numeric < 0) {
      return { ok: false, error: messages.negative };
    }
    return finishDecimal(parsed, numeric, messages.range);
  }

  function validateHourlyCost(raw) {
    return validateNonNegative(raw, {
      blank: 'Enter the hourly cost.',
      nonnumeric: 'Enter a numeric hourly cost.',
      nonfinite: 'Enter a finite hourly cost.',
      negative: 'Hourly cost cannot be negative.',
      range: 'This hourly cost is outside the supported range.'
    });
  }

  function validateDuration(raw) {
    return validateNonNegative(raw, {
      blank: 'Enter the planned duration.',
      nonnumeric: 'Enter a numeric duration in minutes.',
      nonfinite: 'Enter a finite duration.',
      negative: 'Duration cannot be negative.',
      range: 'This duration is outside the supported range.'
    });
  }

  function computeEstimates(attendeeCount, hourlyCostPerAttendee, plannedDurationMinutes) {
    var hourlyTotal = attendeeCount * hourlyCostPerAttendee;
    var costPerMinute = hourlyTotal / 60;
    var projectedTotal = costPerMinute * plannedDurationMinutes;
    return {
      hourlyTotal: hourlyTotal,
      costPerMinute: costPerMinute,
      projectedTotal: projectedTotal
    };
  }

  function rationalEstimates(attendeeCount, hourlyCost, durationMinutes) {
    var hourlyTotal = multiply(attendeeCount, hourlyCost);
    var perMinute = divide(hourlyTotal, ratio(60n, 1n));
    return {
      hourlyTotal: hourlyTotal,
      costPerMinute: perMinute,
      projectedTotal: multiply(perMinute, durationMinutes)
    };
  }

  // Half-up once, from the exact rational. There is no earlier rounded expansion.
  function halfUpCents(amount) {
    if (!amount || amount.den <= 0n || amount.num < 0n) {
      return null;
    }
    if (amount.num === 0n) {
      return 0n;
    }
    var scaled = amount.num * 100n;
    var cents = scaled / amount.den;
    var remainder = scaled % amount.den;
    if (remainder * 2n >= amount.den) {
      cents += 1n;
    }
    if (cents > MAX_SAFE_CENTS_BIGINT) {
      return null;
    }
    return cents;
  }

  function formatCents(cents) {
    if (cents == null) {
      return null;
    }
    if (cents <= 0n) {
      return '$0.00';
    }
    var text = cents.toString();
    var whole = '0';
    var fraction = text;
    if (text.length > 2) {
      whole = text.slice(0, -2);
      fraction = text.slice(-2);
    } else if (text.length === 2) {
      fraction = text;
    } else {
      fraction = '0' + text;
    }
    whole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return '$' + whole + '.' + fraction;
  }

  function isDisplayableRational(amount) {
    return halfUpCents(amount) != null;
  }

  function isSafeRationalEstimate(estimates) {
    return isDisplayableRational(estimates.hourlyTotal) &&
      isDisplayableRational(estimates.costPerMinute) &&
      isDisplayableRational(estimates.projectedTotal);
  }

  function isDisplayableMoney(amount) {
    if (typeof amount !== 'number' || !isFinite(amount) || amount < 0) {
      return false;
    }
    return isDisplayableRational(rationalFromNumber(amount));
  }

  function isSafeEstimate(estimates) {
    return isDisplayableMoney(estimates.hourlyTotal) &&
      isDisplayableMoney(estimates.costPerMinute) &&
      isDisplayableMoney(estimates.projectedTotal);
  }

  function formatUSD(amount) {
    if (typeof amount !== 'number' || !isFinite(amount) || amount <= 0) {
      return '$0.00';
    }
    var rational = rationalFromNumber(amount);
    if (!rational || rational.num < 0n) {
      return '$0.00';
    }
    return formatCents(halfUpCents(rational));
  }

  function resolveInputs(applied, drafts) {
    var fieldErrors = {
      attendees: null,
      hourly: null,
      duration: null
    };
    var next = {
      attendees: drafts.attendees.ok ? drafts.attendees.value : applied.attendees,
      hourlyCost: drafts.hourly.ok ? drafts.hourly.value : applied.hourlyCost,
      durationMinutes: drafts.duration.ok ? drafts.duration.value : applied.durationMinutes,
      attendeesDecimal: drafts.attendees.ok ? drafts.attendees.decimal : decimalFromApplied(applied.attendeesDecimal, applied.attendees),
      hourlyDecimal: drafts.hourly.ok ? drafts.hourly.decimal : decimalFromApplied(applied.hourlyDecimal, applied.hourlyCost),
      durationDecimal: drafts.duration.ok ? drafts.duration.decimal : decimalFromApplied(applied.durationDecimal, applied.durationMinutes)
    };
    if (!drafts.attendees.ok) {
      fieldErrors.attendees = drafts.attendees.error;
    }
    if (!drafts.hourly.ok) {
      fieldErrors.hourly = drafts.hourly.error;
    }
    if (!drafts.duration.ok) {
      fieldErrors.duration = drafts.duration.error;
    }

    var estimates = rationalEstimates(next.attendeesDecimal, next.hourlyDecimal, next.durationDecimal);
    if (!isSafeRationalEstimate(estimates)) {
      var overflow = {
        attendees: 'This attendee count makes the meeting cost too large to calculate.',
        hourly: 'This hourly cost makes the meeting cost too large to calculate.',
        duration: 'This duration makes the meeting cost too large to calculate.'
      };
      var attributed = false;
      if (drafts.attendees.ok && next.attendees !== applied.attendees) {
        fieldErrors.attendees = overflow.attendees;
        attributed = true;
      }
      if (drafts.hourly.ok && next.hourlyCost !== applied.hourlyCost) {
        fieldErrors.hourly = overflow.hourly;
        attributed = true;
      }
      if (drafts.duration.ok && next.durationMinutes !== applied.durationMinutes) {
        fieldErrors.duration = overflow.duration;
        attributed = true;
      }
      if (!attributed) {
        if (drafts.attendees.ok) fieldErrors.attendees = overflow.attendees;
        if (drafts.hourly.ok) fieldErrors.hourly = overflow.hourly;
        if (drafts.duration.ok) fieldErrors.duration = overflow.duration;
      }
      return {
        apply: false,
        values: {
          attendees: applied.attendees,
          hourlyCost: applied.hourlyCost,
          durationMinutes: applied.durationMinutes
        },
        fieldErrors: fieldErrors
      };
    }

    return {
      apply: true,
      values: next,
      fieldErrors: fieldErrors
    };
  }

  function formatElapsed(ms) {
    if (typeof ms !== 'number' || !isFinite(ms) || ms < 0) {
      ms = 0;
    }
    var totalSeconds = Math.floor(ms / 1000);
    var hours = Math.floor(totalSeconds / 3600);
    var minutes = Math.floor((totalSeconds % 3600) / 60);
    var seconds = totalSeconds % 60;
    return [hours, minutes, seconds].map(function (part) {
      return String(part).padStart(2, '0');
    }).join(':');
  }

  function canStart(status, inputsValid) {
    return inputsValid === true && status !== 'running' && status !== 'overflow';
  }

  function describeLiveView(state, inputsValid) {
    var label = 'Idle';
    var detail = 'Ready to start.';
    if (state.status === 'running') {
      label = 'Running';
      detail = 'Accruing live cost. The planned duration will not stop the timer.';
    } else if (state.status === 'paused') {
      label = 'Paused';
      detail = 'Frozen. Start continues from this elapsed time and cost.';
    } else if (state.status === 'overflow') {
      label = 'Stopped';
      detail = 'Live cost is too large to display. Reset to start over.';
    }
    return {
      status: state.status,
      label: label,
      detail: detail,
      projectedText: state.projectedUSD == null ? 'Too large' : state.projectedUSD,
      rateText: state.costPerMinuteUSD == null ? 'Too large' : state.costPerMinuteUSD,
      elapsedText: formatElapsed(state.elapsedMs),
      liveText: state.liveCostOverflow ? 'Too large' : (state.liveCostUSD == null ? 'Too large' : state.liveCostUSD),
      overflowVisible: state.liveCostOverflow === true,
      startDisabled: !canStart(state.status, inputsValid)
    };
  }

  function createDisplayTick(meter, paint) {
    return function () {
      paint(meter.getState());
    };
  }

  function takenDecimal(raw, explicit, validate) {
    var parsed = validate(raw);
    if (!parsed.ok) {
      return parsed;
    }
    if (explicit && typeof explicit.num === 'bigint' && typeof explicit.den === 'bigint' && explicit.den > 0n) {
      return { ok: true, value: parsed.value, decimal: explicit };
    }
    return parsed;
  }

  function createMeter(options) {
    options = options || {};
    var now = typeof options.now === 'function' ? options.now : function () {
      return performance.now();
    };

    var attendees = DEFAULTS.attendees;
    var hourlyCost = DEFAULTS.hourlyCost;
    var durationMinutes = DEFAULTS.durationMinutes;
    var attendeesR = ratio(BigInt(attendees), 1n);
    var hourlyR = ratio(BigInt(hourlyCost), 1n);
    var durationR = ratio(BigInt(durationMinutes), 1n);
    var initial = computeEstimates(attendees, hourlyCost, durationMinutes);
    var initialRational = rationalEstimates(attendeesR, hourlyR, durationR);
    var costPerMinute = initial.costPerMinute;
    var projectedTotal = initial.projectedTotal;
    var rateR = initialRational.costPerMinute;
    var projectedR = initialRational.projectedTotal;

    var status = 'idle';
    var elapsedBefore = 0;
    var accruedCost = 0;
    var accruedR = ratio(0n, 1n);
    var segmentStart = null;
    var segmentRate = costPerMinute;
    var segmentRateR = rateR;
    var liveOverflow = false;

    function costForDelta(rateRational, deltaMs) {
      var deltaRational = rationalFromNumber(deltaMs);
      if (!deltaRational) {
        return null;
      }
      return divide(multiply(rateRational, deltaRational), ratio(60000n, 1n));
    }

    function markOverflow(elapsedMs) {
      if (liveOverflow) {
        return;
      }
      if (isFinite(elapsedMs) && elapsedMs >= 0) {
        elapsedBefore = elapsedMs;
      }
      liveOverflow = true;
      status = 'overflow';
      segmentStart = null;
    }

    function accrue() {
      if (status !== 'running' || segmentStart == null || liveOverflow) {
        return;
      }
      var time = now();
      var delta = time - segmentStart;
      if (delta < 0) {
        delta = 0;
      }
      var nextElapsed = elapsedBefore + delta;
      var added = costForDelta(segmentRateR, delta);
      var nextRational = added == null ? null : add(accruedR, added);
      var nextCost = accruedCost + segmentRate * delta / 60000;
      if (!isFinite(nextElapsed) || !isFinite(nextCost) || nextRational == null || halfUpCents(nextRational) == null) {
        markOverflow(isFinite(nextElapsed) ? nextElapsed : elapsedBefore);
        return;
      }
      elapsedBefore = nextElapsed;
      accruedCost = nextCost;
      accruedR = nextRational;
      segmentStart = time;
    }

    function apply(nextAttendees, nextHourly, nextDuration, nextAttendeesR, nextHourlyR, nextDurationR, overflowError) {
      var estimates = computeEstimates(nextAttendees, nextHourly, nextDuration);
      var rational = rationalEstimates(nextAttendeesR, nextHourlyR, nextDurationR);
      if (!isSafeRationalEstimate(rational)) {
        return { ok: false, error: overflowError };
      }
      var nextRate = estimates.costPerMinute;
      var nextRateR = rational.costPerMinute;
      if (nextRate !== costPerMinute || nextRateR.num !== rateR.num || nextRateR.den !== rateR.den) {
        accrue();
        segmentRate = nextRate;
        segmentRateR = nextRateR;
      }
      attendees = nextAttendees;
      hourlyCost = nextHourly;
      durationMinutes = nextDuration;
      attendeesR = nextAttendeesR;
      hourlyR = nextHourlyR;
      durationR = nextDurationR;
      costPerMinute = nextRate;
      rateR = nextRateR;
      projectedTotal = estimates.projectedTotal;
      projectedR = rational.projectedTotal;
      return { ok: true };
    }

    function snapshot() {
      var elapsedMs = elapsedBefore;
      var liveCost = accruedCost;
      var liveR = accruedR;
      if (!liveOverflow && status === 'running' && segmentStart != null) {
        var delta = now() - segmentStart;
        if (delta < 0) {
          delta = 0;
        }
        var runningElapsed = elapsedBefore + delta;
        var added = costForDelta(segmentRateR, delta);
        var runningRational = added == null ? null : add(accruedR, added);
        var runningCost = accruedCost + segmentRate * delta / 60000;
        if (!isFinite(runningElapsed) || !isFinite(runningCost) || runningRational == null || halfUpCents(runningRational) == null) {
          markOverflow(isFinite(runningElapsed) ? runningElapsed : elapsedBefore);
        } else {
          elapsedMs = runningElapsed;
          liveCost = runningCost;
          liveR = runningRational;
        }
      }
      var overflow = liveOverflow;
      var liveCents = overflow ? null : halfUpCents(liveR);
      return {
        status: overflow ? 'overflow' : status,
        elapsedMs: overflow ? elapsedBefore : elapsedMs,
        liveCost: overflow ? null : liveCost,
        liveCostOverflow: overflow,
        liveCostUSD: overflow ? null : formatCents(liveCents),
        costPerMinute: costPerMinute,
        costPerMinuteUSD: formatCents(halfUpCents(rateR)),
        projectedTotal: projectedTotal,
        projectedUSD: formatCents(halfUpCents(projectedR)),
        attendees: attendees,
        hourlyCost: hourlyCost,
        durationMinutes: durationMinutes,
        attendeesDecimal: attendeesR,
        hourlyDecimal: hourlyR,
        durationDecimal: durationR
      };
    }

    return {
      getState: snapshot,
      start: function () {
        if (status === 'running' || liveOverflow) {
          return snapshot();
        }
        status = 'running';
        segmentStart = now();
        segmentRate = costPerMinute;
        segmentRateR = rateR;
        return snapshot();
      },
      pause: function () {
        if (status !== 'running') {
          return snapshot();
        }
        accrue();
        if (liveOverflow) {
          return snapshot();
        }
        status = 'paused';
        segmentStart = null;
        return snapshot();
      },
      reset: function () {
        status = 'idle';
        elapsedBefore = 0;
        accruedCost = 0;
        accruedR = ratio(0n, 1n);
        segmentStart = null;
        segmentRate = costPerMinute;
        segmentRateR = rateR;
        liveOverflow = false;
        return snapshot();
      },
      applyInputs: function (values) {
        var parsedAttendees = takenDecimal(values.attendees, values.attendeesDecimal, validateAttendees);
        if (!parsedAttendees.ok) {
          return parsedAttendees;
        }
        var parsedHourly = takenDecimal(values.hourlyCost, values.hourlyDecimal, validateHourlyCost);
        if (!parsedHourly.ok) {
          return parsedHourly;
        }
        var parsedDuration = takenDecimal(values.durationMinutes, values.durationDecimal, validateDuration);
        if (!parsedDuration.ok) {
          return parsedDuration;
        }
        return apply(
          parsedAttendees.value,
          parsedHourly.value,
          parsedDuration.value,
          parsedAttendees.decimal,
          parsedHourly.decimal,
          parsedDuration.decimal,
          'This meeting cost is too large to calculate.'
        );
      },
      setAttendees: function (value) {
        var parsed = validateAttendees(value);
        if (!parsed.ok) {
          return parsed;
        }
        return apply(
          parsed.value,
          hourlyCost,
          durationMinutes,
          parsed.decimal,
          hourlyR,
          durationR,
          'This attendee count makes the meeting cost too large to calculate.'
        );
      },
      setHourlyCost: function (value) {
        var parsed = validateHourlyCost(value);
        if (!parsed.ok) {
          return parsed;
        }
        return apply(
          attendees,
          parsed.value,
          durationMinutes,
          attendeesR,
          parsed.decimal,
          durationR,
          'This hourly cost makes the meeting cost too large to calculate.'
        );
      },
      setDurationMinutes: function (value) {
        var parsed = validateDuration(value);
        if (!parsed.ok) {
          return parsed;
        }
        return apply(
          attendees,
          hourlyCost,
          parsed.value,
          attendeesR,
          hourlyR,
          parsed.decimal,
          'This duration makes the meeting cost too large to calculate.'
        );
      }
    };
  }

  return {
    DEFAULTS: DEFAULTS,
    validateAttendees: validateAttendees,
    validateHourlyCost: validateHourlyCost,
    validateDuration: validateDuration,
    computeEstimates: computeEstimates,
    isSafeEstimate: isSafeEstimate,
    formatUSD: formatUSD,
    formatElapsed: formatElapsed,
    canStart: canStart,
    resolveInputs: resolveInputs,
    describeLiveView: describeLiveView,
    createDisplayTick: createDisplayTick,
    createMeter: createMeter
  };
});
