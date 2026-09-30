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
    var liveOverflowNote = document.getElementById('live-overflow');
    var livePanel = document.querySelector('.live');
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
        valid: true
      },
      hourly: {
        input: hourlyInput,
        error: hourlyError,
        valid: true
      },
      duration: {
        input: durationInput,
        error: durationError,
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

    function revalidateAll() {
      var applied = meter.getState();
      var result = MeetingMeter.resolveInputs(applied, {
        attendees: MeetingMeter.validateAttendees(fields.attendees.input.value),
        hourly: MeetingMeter.validateHourlyCost(fields.hourly.input.value),
        duration: MeetingMeter.validateDuration(fields.duration.input.value)
      });
      if (result.apply) {
        meter.applyInputs(result.values);
      }
      ['attendees', 'hourly', 'duration'].forEach(function (name) {
        var message = result.fieldErrors[name];
        if (message) {
          showError(fields[name], message);
        } else {
          clearError(fields[name]);
        }
      });
    }

    function isMeterState(value) {
      return !!value && typeof value.status === 'string' && typeof value.liveCostOverflow === 'boolean';
    }

    function render(state) {
      if (!isMeterState(state)) {
        state = meter.getState();
      }
      var view = MeetingMeter.describeLiveView(state, allValid());
      projectedEl.textContent = view.projectedText;
      rateEl.textContent = view.rateText;
      elapsedEl.textContent = view.elapsedText;
      liveEl.textContent = view.liveText;
      liveOverflowNote.hidden = !view.overflowVisible;
      livePanel.dataset.overflow = view.overflowVisible ? 'true' : 'false';
      if (statusEl.textContent !== view.label) {
        statusEl.textContent = view.label;
      }
      statusEl.dataset.state = view.status;
      if (statusDetailEl.textContent !== view.detail) {
        statusDetailEl.textContent = view.detail;
      }

      var valid = allValid();
      staleNote.hidden = valid;
      startNote.hidden = valid;
      startButton.disabled = view.startDisabled;
    }

    Object.keys(fields).forEach(function (name) {
      fields[name].input.addEventListener('input', function () {
        revalidateAll();
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

    window.setInterval(MeetingMeter.createDisplayTick(meter, render), TICK_MS);

    render();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
