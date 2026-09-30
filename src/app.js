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

    function showMoney(element, amount) {
      var text = MeetingMeter.formatUSD(amount);
      element.textContent = text == null ? 'Too large' : text;
    }

    function render() {
      var state = meter.getState();
      showMoney(projectedEl, state.projectedTotal);
      showMoney(rateEl, state.costPerMinute);
      elapsedEl.textContent = MeetingMeter.formatElapsed(state.elapsedMs);
      if (state.liveCostOverflow) {
        liveEl.textContent = 'Too large';
        liveOverflowNote.hidden = false;
        livePanel.dataset.overflow = 'true';
      } else {
        showMoney(liveEl, state.liveCost);
        liveOverflowNote.hidden = true;
        livePanel.dataset.overflow = 'false';
      }

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
      if (statusEl.textContent !== label) {
        statusEl.textContent = label;
      }
      statusEl.dataset.state = state.status;
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

    var followTimer = false;
    window.setInterval(function () {
      var status = meter.getState().status;
      if (status === 'running') {
        followTimer = true;
        render();
      } else if (followTimer) {
        followTimer = false;
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
