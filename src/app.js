(function () {
  'use strict';

  var TICK_MS = 250;

  function init() {
    var meter = MeetingMeter.createMeter({
      now: function () {
        return performance.now();
      }
    });

    var attendeesInput = document.getElementById('attendees');
    var hourlyInput = document.getElementById('hourly-cost');
    var durationInput = document.getElementById('duration');
    var attendeesError = document.getElementById('attendees-error');
    var hourlyError = document.getElementById('hourly-error');
    var durationError = document.getElementById('duration-error');
    var projectedEl = document.getElementById('projected-total');
    var rateEl = document.getElementById('cost-per-minute');
    var elapsedEl = document.getElementById('elapsed');
    var liveEl = document.getElementById('live-cost');
    var statusEl = document.getElementById('status');
    var statusDetailEl = document.getElementById('status-detail');
    var staleNote = document.getElementById('stale-note');
    var startNote = document.getElementById('start-note');
    var startButton = document.getElementById('start');
    var pauseButton = document.getElementById('pause');
    var resetButton = document.getElementById('reset');

    var defaults = MeetingMeter.DEFAULTS;
    attendeesInput.value = String(defaults.attendees);
    hourlyInput.value = defaults.hourlyCost.toFixed(2);
    durationInput.value = String(defaults.durationMinutes);

    var fields = {
      attendees: {
        input: attendeesInput,
        error: attendeesError,
        validate: MeetingMeter.validateAttendees,
        apply: function (value) {
          return meter.setAttendees(value);
        },
        valid: true
      },
      hourly: {
        input: hourlyInput,
        error: hourlyError,
        validate: MeetingMeter.validateHourlyCost,
        apply: function (value) {
          return meter.setHourlyCost(value);
        },
        valid: true
      },
      duration: {
        input: durationInput,
        error: durationError,
        validate: MeetingMeter.validateDuration,
        apply: function (value) {
          return meter.setDurationMinutes(value);
        },
        valid: true
      }
    };

    function showError(field, message) {
      field.valid = false;
      field.input.setAttribute('aria-invalid', 'true');
      field.error.hidden = false;
      field.error.textContent = message;
    }

    function clearError(field) {
      field.valid = true;
      field.input.setAttribute('aria-invalid', 'false');
      field.error.hidden = true;
      field.error.textContent = '';
    }

    function allValid() {
      return fields.attendees.valid && fields.hourly.valid && fields.duration.valid;
    }

    function commitField(field) {
      var parsed = field.validate(field.input.value);
      if (!parsed.ok) {
        showError(field, parsed.error);
        return;
      }
      var applied = field.apply(parsed.value);
      if (!applied.ok) {
        showError(field, applied.error);
        return;
      }
      clearError(field);
    }

    function render() {
      var state = meter.getState();
      projectedEl.textContent = MeetingMeter.formatUSD(state.projectedTotal);
      rateEl.textContent = MeetingMeter.formatUSD(state.costPerMinute);
      elapsedEl.textContent = MeetingMeter.formatElapsed(state.elapsedMs);
      liveEl.textContent = MeetingMeter.formatUSD(state.liveCost);

      var label = state.status === 'running' ? 'Running' : state.status === 'paused' ? 'Paused' : 'Idle';
      if (statusEl.textContent !== label) {
        statusEl.textContent = label;
      }
      statusEl.dataset.state = state.status;

      var detail = 'Ready to start.';
      if (state.status === 'running') {
        detail = 'Accruing live cost. The planned duration will not stop the timer.';
      } else if (state.status === 'paused') {
        detail = 'Frozen. Start continues from this elapsed time and cost.';
      }
      if (statusDetailEl.textContent !== detail) {
        statusDetailEl.textContent = detail;
      }

      var valid = allValid();
      staleNote.hidden = valid;
      startNote.hidden = valid;
      startButton.disabled = !MeetingMeter.canStart(state.status, valid);
    }

    Object.keys(fields).forEach(function (name) {
      fields[name].input.addEventListener('input', function () {
        commitField(fields[name]);
        render();
      });
    });

    startButton.addEventListener('click', function () {
      if (startButton.disabled) {
        return;
      }
      meter.start();
      render();
    });

    pauseButton.addEventListener('click', function () {
      meter.pause();
      render();
    });

    resetButton.addEventListener('click', function () {
      meter.reset();
      render();
    });

    document.addEventListener('visibilitychange', render);
    window.addEventListener('pageshow', render);

    window.setInterval(function () {
      if (meter.getState().status === 'running') {
        render();
      }
    }, TICK_MS);

    render();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
