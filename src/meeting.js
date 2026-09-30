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
    return { ok: true, value: numeric };
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
    return { ok: true, value: numeric };
  }

  function validateHourlyCost(raw) {
    return validateNonNegative(raw, {
      blank: 'Enter the hourly cost.',
      nonnumeric: 'Enter a numeric hourly cost.',
      nonfinite: 'Enter a finite hourly cost.',
      negative: 'Hourly cost cannot be negative.'
    });
  }

  function validateDuration(raw) {
    return validateNonNegative(raw, {
      blank: 'Enter the planned duration.',
      nonnumeric: 'Enter a numeric duration in minutes.',
      nonfinite: 'Enter a finite duration.',
      negative: 'Duration cannot be negative.'
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

  function incrementDecimalString(digits) {
    var chars = digits.split('');
    var index = chars.length - 1;
    while (index >= 0) {
      if (chars[index] !== '9') {
        chars[index] = String(Number(chars[index]) + 1);
        return chars.join('');
      }
      chars[index] = '0';
      index -= 1;
    }
    return '1' + chars.join('');
  }

  function roundHalfUpCents(amount) {
    if (typeof amount !== 'number' || !isFinite(amount) || amount < 0) {
      return null;
    }
    if (amount === 0) {
      return 0;
    }
    var expanded = amount.toFixed(10);
    if (/e/i.test(expanded)) {
      return null;
    }
    var pieces = expanded.split('.');
    var fraction = pieces[1] || '';
    var centsDigits = pieces[0] + fraction.slice(0, 2).padEnd(2, '0');
    if (fraction.charAt(2) >= '5') {
      centsDigits = incrementDecimalString(centsDigits);
    }
    centsDigits = centsDigits.replace(/^0+/, '') || '0';
    if (exceedsSafeInteger(centsDigits)) {
      return null;
    }
    return Number(centsDigits);
  }

  function isDisplayableMoney(amount) {
    if (typeof amount !== 'number' || !isFinite(amount) || amount < 0) {
      return false;
    }
    return roundHalfUpCents(amount) != null;
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
    var cents = roundHalfUpCents(amount);
    if (cents == null) {
      return null;
    }
    if (cents <= 0) {
      return '$0.00';
    }
    return (cents / 100).toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  function resolveInputs(applied, drafts) {
    var fieldErrors = {
      attendees: null,
      hourly: null,
      duration: null
    };
    var next = {
      attendees: applied.attendees,
      hourlyCost: applied.hourlyCost,
      durationMinutes: applied.durationMinutes
    };
    if (!drafts.attendees.ok) {
      fieldErrors.attendees = drafts.attendees.error;
    } else {
      next.attendees = drafts.attendees.value;
    }
    if (!drafts.hourly.ok) {
      fieldErrors.hourly = drafts.hourly.error;
    } else {
      next.hourlyCost = drafts.hourly.value;
    }
    if (!drafts.duration.ok) {
      fieldErrors.duration = drafts.duration.error;
    } else {
      next.durationMinutes = drafts.duration.value;
    }

    var estimates = computeEstimates(next.attendees, next.hourlyCost, next.durationMinutes);
    if (!isSafeEstimate(estimates)) {
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

  function createMeter(options) {
    options = options || {};
    var now = typeof options.now === 'function' ? options.now : function () {
      return performance.now();
    };

    var attendees = DEFAULTS.attendees;
    var hourlyCost = DEFAULTS.hourlyCost;
    var durationMinutes = DEFAULTS.durationMinutes;
    var initial = computeEstimates(attendees, hourlyCost, durationMinutes);
    var costPerMinute = initial.costPerMinute;
    var projectedTotal = initial.projectedTotal;

    var status = 'idle';
    var elapsedBefore = 0;
    var accruedCost = 0;
    var segmentStart = null;
    var segmentRate = costPerMinute;
    var liveOverflow = false;

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
      var nextCost = accruedCost + segmentRate * delta / 60000;
      if (!isFinite(nextElapsed) || !isDisplayableMoney(nextCost)) {
        markOverflow(isFinite(nextElapsed) ? nextElapsed : elapsedBefore);
        return;
      }
      elapsedBefore = nextElapsed;
      accruedCost = nextCost;
      segmentStart = time;
    }

    function apply(nextAttendees, nextHourly, nextDuration, overflowError) {
      var estimates = computeEstimates(nextAttendees, nextHourly, nextDuration);
      if (!isSafeEstimate(estimates)) {
        return { ok: false, error: overflowError };
      }
      var nextRate = estimates.costPerMinute;
      if (nextRate !== costPerMinute) {
        accrue();
        segmentRate = nextRate;
      }
      attendees = nextAttendees;
      hourlyCost = nextHourly;
      durationMinutes = nextDuration;
      costPerMinute = nextRate;
      projectedTotal = estimates.projectedTotal;
      return { ok: true };
    }

    function snapshot() {
      var elapsedMs = elapsedBefore;
      var liveCost = accruedCost;
      if (!liveOverflow && status === 'running' && segmentStart != null) {
        var delta = now() - segmentStart;
        if (delta < 0) {
          delta = 0;
        }
        var runningElapsed = elapsedBefore + delta;
        var runningCost = accruedCost + segmentRate * delta / 60000;
        if (!isFinite(runningElapsed) || !isDisplayableMoney(runningCost)) {
          markOverflow(isFinite(runningElapsed) ? runningElapsed : elapsedBefore);
        } else {
          elapsedMs = runningElapsed;
          liveCost = runningCost;
        }
      }
      if (liveOverflow) {
        return {
          status: 'overflow',
          elapsedMs: elapsedBefore,
          liveCost: null,
          liveCostOverflow: true,
          costPerMinute: costPerMinute,
          projectedTotal: projectedTotal,
          attendees: attendees,
          hourlyCost: hourlyCost,
          durationMinutes: durationMinutes
        };
      }
      return {
        status: status,
        elapsedMs: elapsedMs,
        liveCost: liveCost,
        liveCostOverflow: false,
        costPerMinute: costPerMinute,
        projectedTotal: projectedTotal,
        attendees: attendees,
        hourlyCost: hourlyCost,
        durationMinutes: durationMinutes
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
        segmentStart = null;
        segmentRate = costPerMinute;
        liveOverflow = false;
        return snapshot();
      },
      applyInputs: function (values) {
        var parsedAttendees = validateAttendees(values.attendees);
        if (!parsedAttendees.ok) {
          return parsedAttendees;
        }
        var parsedHourly = validateHourlyCost(values.hourlyCost);
        if (!parsedHourly.ok) {
          return parsedHourly;
        }
        var parsedDuration = validateDuration(values.durationMinutes);
        if (!parsedDuration.ok) {
          return parsedDuration;
        }
        return apply(
          parsedAttendees.value,
          parsedHourly.value,
          parsedDuration.value,
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
    createMeter: createMeter
  };
});
