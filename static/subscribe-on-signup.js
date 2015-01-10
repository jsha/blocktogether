/**
 * When loaded, submit a POST to /block-all.json with a special parameter
 * indicating the shared_blocks_key should be taken from the session and
 * deleted when done. After successful POST, show a success message and
 * present the settings UI.
 */
$(function(){
  // jQuery will try to convert author-uid to a number if it can be done with no
  // loss of precision (i.e. it is less than 53 bits). Coerce to a string for
  // consistency. This is important because it governs the type of the field as
  // read by the backend.
  var author_uid = $('.block-all-submitting').data('author-uid').toString();
  $.ajax({
    type: 'POST',
    url: '/block-all.json',
    contentType: 'application/json',
    dataType: 'json',
    data: JSON.stringify({
      csrf_token: document.body.getAttribute('data-csrf-token'),
      author_uid: author_uid,
      subscribe_on_signup: true
    }),
    success: function(data, textStatus, jqXHR) {
      $('.block-all-processing').show();
      $('.block-all-submitting').hide();
      $('#blocked-users').text(data['block_count']);
    },
    error: function(jqXHR, textStatus, errorThrown) {
      $('.block-all-submitting').hide();
      if (jqXHR && jqXHR.responseJSON && jqXHR.responseJSON.error) {
        var message = 'Error: ' + jqXHR.responseJSON.error;
      } else {
        var message = 'Error: ' + textStatus + " " + errorThrown;
      }
      // Note: using .text and not .html is important for XSS safety.
      $('#error-message').text(message);
    }
  });
});


