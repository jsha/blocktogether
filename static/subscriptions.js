/**
 * Handle events for /subscriptions
 */
$(function(){
  $('.unsubscribe').click(function(ev) {
    var item = $(ev.target).closest('.subscription-item');
    var WORKING = 'unsubscribe-working'
    item.addClass(WORKING);
    $.ajax({
      type: 'POST',
      url: '/unsubscribe.json',
      contentType: 'application/json',
      dataType: 'json',
      data: JSON.stringify({
        csrf_token: document.body.getAttribute('data-csrf-token'),
        author_uid: $(ev.target).data('author-uid'),
        subscriber_uid: $(ev.target).data('subscriber-uid')
      }),
      success: function(data, textStatus, jqXHR) {
        item.remove();
      },
      error: function(jqXHR, textStatus, errorThrown) {
        item.removeClass(WORKING);
        alert('Error: ' + textStatus + ',' + errorThrown);
      }
    });
  });
});
