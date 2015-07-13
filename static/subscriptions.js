/**
 * Handle events for /subscriptions
 */
$(function(){
  $('.unsubscribe').click(function(ev) {
    var item = $(ev.target).closest('.subscription-item');
    var WORKING = 'unsubscribe-working'
    item.addClass(WORKING);
    var authorUid = $(ev.target).data('author-uid')
    var subscriberUid = $(ev.target).data('subscriber-uid')
    // Note: jQuery's .data() will try to turn an int-like data field into
    // an int, but only if it can be represented exactly in JavaScript. So
    // we're safe: we won't turn a uid into a different uid. However, coerce
    // the fields to strings so we get consistent results on the other end.
    if (authorUid) {
      authorUid = authorUid.toString();
    } else if (subscriberUid) {
      subscriberUid = subscriberUid.toString();
    }
    $.ajax({
      type: 'POST',
      url: '/unsubscribe.json',
      contentType: 'application/json',
      dataType: 'json',
      data: JSON.stringify({
        csrf_token: document.body.getAttribute('data-csrf-token'),
        author_uid: authorUid,
        subscriber_uid: subscriberUid
      }),
      success: function(data, textStatus, jqXHR) {
        item.remove();
      },
      error: function(jqXHR, textStatus, errorThrown) {
        if (jqXHR && jqXHR.responseJSON && jqXHR.responseJSON.error) {
          var message = 'Error: ' + jqXHR.responseJSON.error;
        } else {
          var message = 'Error: ' + textStatus + " " + errorThrown;
        }
        item.removeClass(WORKING);
        alert(message);
      }
    });
  });
});
