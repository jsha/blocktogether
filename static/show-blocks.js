/**
 * Handle events for /show-blocks/:slug and /my-blocks.
 */
$(function(){
  var author_uid = $('.all-blocks').data('author-uid');
  var user_uid = $('body').data('user-uid');

  // Prevent people from subscribing to their own block lists.
  if (author_uid === user_uid) {
    $('button.block-all').prop('disabled', true);
  }

  function errorHandler(jqXHR, textStatus, errorThrown) {
    alert('Error: ' + textStatus + " " + errorThrown);
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
        author_uid: author_uid,
        shared_blocks_key: $('.all-blocks').data('shared-blocks-key').toString()
      }),
      success: function(data, textStatus, jqXHR) {
        $('.block-all-processing').show();
        $('.block-all').hide();
        $('#blocked-users').text(data['block_count']);
      },
      error: errorHandler
    });
  }

  $('button').click(function(ev) {
    if ($('#log-on-form').length > 0) {
      alert('Please log on to do that.');
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
