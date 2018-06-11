/**
 * Handle events for /show-blocks/:slug and /my-blocks.
 */
$(function(){
  var author_uid = $('.all-blocks').data('author-uid').toString();
  var user_uid = $('body').data('user-uid').toString();
  var shared_blocks_key = $('.all-blocks').data('shared-blocks-key');

  // Prevent people from subscribing to their own block lists.
  if (author_uid === user_uid) {
    $('button.block-all').prop('disabled', true);
  }

  $('.search_by_screen_name').submit(function(e) {
    var sn = $('#screen_name')
    if (sn.css('display') == 'none') {
      sn.show();
      sn.focus();
      return false;
    }
    if (sn.val() == '') {
      return false;
    }
    return true;
  });

  function errorHandler(jqXHR, textStatus, errorThrown) {
    if (jqXHR && jqXHR.responseJSON && jqXHR.responseJSON.error) {
      var message = 'Error: ' + jqXHR.responseJSON.error;
    } else {
      var message = 'Error: ' + textStatus + " " + errorThrown;
    }
    // Note: using .text and not .html is important for XSS safety.
    $('#error-message').text(message);
    $('button').prop('disabled', false);
  }

  function doAction(type) {
    var checkedUids = $('.checkbox:checked').map(function (el) {
      // jQuery's .data() will make every attempt to convert to a
      // JavaScript object (https://api.jquery.com/data/), which means turning
      // uids into Numbers. Since uids are 64 bits, they can't be representing
      // in JavaScript and must remain as strings.
      // https://dev.twitter.com/docs/twitter-ids-json-and-snowflake
      // We have a spot of luck in that 'a value is only converted to a
      // number if doing so doesn't change the value's representation.'
      // So if uid's are small enough we get a number; otherwise a string.
      // Neither loses bits. We call toString to ensure we always have the
      // right type.
      return $(this).data('uid').toString();
    });
    $.ajax({
      type: 'POST',
      url: '/do-actions.json',
      contentType: 'application/json',
      dataType: 'json',
      data: JSON.stringify({
        csrf_token: document.body.getAttribute('data-csrf-token'),
        type: type,
        list: $.makeArray(checkedUids)
      }),
      success: function(data, textStatus, jqXHR) {
        if (type === 'unblock' || type === 'unblock-mute') {
          $('.unblock-processing').show();
        }
      },
      error: errorHandler
    });
  }

  function blockAll() {
    $.ajax({
      type: 'POST',
      url: '/block-all.json',
      contentType: 'application/json',
      dataType: 'json',
      data: JSON.stringify({
        csrf_token: document.body.getAttribute('data-csrf-token'),
        author_uid: author_uid,
        shared_blocks_key: shared_blocks_key.toString()
      }),
      success: function(data, textStatus, jqXHR) {
        $('.block-all-processing').show();
        $('.block-all').hide();
        $('#blocked-users').text(data['block_count']);
      },
      error: errorHandler
    });
  }

  // Log on and save this block list in the session for subscribing up
  // successful sign on.
  function logOnAndSubscribe() {
    // The user may hit 'Block All and Subscribe' multiple times (e.g. by
    // hitting escape after submitting, if the server is slow). If so, make
    // sure we don't add the hidden inputs multiple times.
    if ($('input[name=subscribe_on_signup_key]').length === 0) {
      $('<input>').attr({
        type: 'hidden',
        name: 'subscribe_on_signup_key',
        value: shared_blocks_key,
      }).appendTo('#log-on-form');
      $('<input>').attr({
        type: 'hidden',
        name: 'subscribe_on_signup_author_uid',
        value: author_uid,
      }).appendTo('#log-on-form');
    }
    $('#log-on-form').submit();
  }

  $('button').click(function(ev) {
    if ($('#log-on-form').length > 0) {
      logOnAndSubscribe();
    } else if ($(ev.target).hasClass('unblock')) {
      doAction('unblock');
    } else if ($(ev.target).hasClass('unblock-mute')) {
      doAction('unblock');
      doAction('mute');
    } else if ($(ev.target).hasClass('block-all')) {
      $(ev.target).prop('disabled', true);
      blockAll();
    } else {
      console.log(ev.target);
    }
  });
});
