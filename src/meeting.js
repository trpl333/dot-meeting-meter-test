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
  var NUMERIC = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

  var DEFAULTS = {
    attendees: 5,
    hourlyCost: 100,
    durationMinutes: 30
  };

  function parseNumeric(raw) {
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
    var value = Number(text);
    if (!isFinite(value)) {
      return { ok: false, reason: 'nonfinite' };
    }
    return { ok: true, value: value };
  }

  function validateAttendees(raw) {
    var parsed = parseNumeric(raw);
    if (!parsed.ok) {
      if (parsed.reason === 'blank') {
        return { ok: false, error: 'Enter the number of attendees.' };
      }
      if (parsed.reason === 'nonfinite') {
        return { ok: false, error: 'Enter a finite number of attendees.' };
      }
      return { ok: false, error: 'Enter a numeric attendee count.' };
    }
    if (parsed.value < 0) {
      return { ok: false, error: 'Attendee count cannot be negative.' };
    }
    if (!Number.isInteger(parsed.value)) {
      return { ok: false, error: 'Fractional attendee counts are not allowed.' };
    }
    if (parsed.value < 1) {
      return { ok: false, error: 'Enter at least 1 attendee.' };
    }
    if (!Number.isSafeInteger(parsed.value)) {
      return { ok: false, error: 'That attendee count is too large to calculate exactly.' };
    }
    return { ok: true, value: parsed.value };
  }

  function validateHourlyCost(raw) {
    var parsed = parseNumeric(raw);
    if (!parsed.ok) {
      if (parsed.reason === 'blank') {
        return { ok: false, error: 'Enter the hourly cost.' };
      }
      if (parsed.reason === 'nonfinite') {
        return { ok: false, error: 'Enter a finite hourly cost.' };
      }
      return { ok: false, error: 'Enter a numeric hourly cost.' };
    }
    if (parsed.value < 0) {
      return { ok: false, error: 'Hourly cost cannot be negative.' };
    }
    return { ok: true, value: parsed.value };
  }

  function validateDuration(raw) {
    var parsed = parseNumeric(raw);
    if (!parsed.ok) {
      if (parsed.reason === 'blank') {
        return { ok: false, error: 'Enter the planned duration.' };
      }
      if (parsed.reason === 'nonfinite') {
        return { ok: false, error: 'Enter a finite duration.' };
      }
      return { ok: false, error: 'Enter a numeric duration in minutes.' };
    }
    if (parsed.value < 0) {
      return { ok: false, error: 'Duration cannot be negative.' };
    }
    return { ok: true, value: parsed.value };
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

  function isDisplayableMoney(amount) {
    if (typeof amount !== 'number' || !isFinite(amount) || amount < 0) {
      return false;
    }
    var cents = Math.round(amount * 100);
    return isFinite(cents) && cents <= MAX_SAFE_CENTS;
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
    var cents = Math.round(amount * 100);
    if (!isFinite(cents) || cents < 0) {
      return '$0.00';
    }
    if (cents > MAX_SAFE_CENTS) {
      cents = MAX_SAFE_CENTS;
    }
    var dollars = cents / 100;
    return dollars.toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
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
    return inputsValid === true && status !== 'running';
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

    function accrue() {
      if (status !== 'running' || segmentStart == null) {
        return;
      }
      var time = now();
      var delta = time - segmentStart;
      if (delta < 0) {
        delta = 0;
      }
      var nextElapsed = elapsedBefore + delta;
      var nextCost = accruedCost + segmentRate * delta / 60000;
      elapsedBefore = nextElapsed;
      if (isFinite(nextCost) && nextCost >= 0) {
        accruedCost = nextCost;
      }
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
      if (status === 'running' && segmentStart != null) {
        var delta = now() - segmentStart;
        if (delta < 0) {
          delta = 0;
        }
        elapsedMs += delta;
        var runningCost = accruedCost + segmentRate * delta / 60000;
        if (isFinite(runningCost) && runningCost >= 0) {
          liveCost = runningCost;
        }
      }
      return {
        status: status,
        elapsedMs: elapsedMs,
        liveCost: liveCost,
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
        if (status === 'running') {
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
        return snapshot();
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
    createMeter: createMeter
  };
});
