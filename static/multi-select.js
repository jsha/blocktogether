$(function() {
  // BUG: On back button navigation, the state of the checkboxes is remembered,
  // but the enabled / disabled state of the buttons doesn't correctly match.
  function disableButtons() {
    $('button.needs-selection').each(function(i, el) {
      $(el).prop('disabled', true);
    });
  }
  function enableButtons() {
    $('button.needs-selection').each(function(i, el) {
      $(el).prop('disabled', false);
    });
  }
  $('#check-all').click(function(ev) {
    $('.checkbox').each(function(i, el) {
      el.checked = ev.target.checked;
    });
    if (ev.target.checked) {
      enableButtons();
    } else {
      disableButtons();
    }
  });
  $('.checkbox').click(function(ev) {
    if (ev.target.checked) {
      enableButtons();
    } else {
      var allDisabled = true
      $('.checkbox').each(function(i, el) {
        if (el.checked) {
          allDisabled = false;
        }
      });
      if (allDisabled) {
        disableButtons();
        $('#check-all').checked = false;
      }
    }
  });
  // When any part of the row is clicked, other than a link, treat it the same
  // as clicking the checkbox.
  $('tr').click(function(ev) {
    if (ev.target.tagName != 'A' &&
        ev.target.tagName != 'INPUT') {
      $(ev.target).closest('tr').find('.checkbox').each(function(i, el) {
        $(el).click();
      });
    }
  });
});
