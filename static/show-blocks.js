$(function(){
  function doAction(type) {
    var checkedUids = $('.checkbox:checked').map(function (el) {
      return $(this).data('uid');
    });
    if (type == 'block') {
      $.ajax({
        type: 'POST',
        url: '/do-blocks.json',
        contentType: "application/json",
        dataType: "json",
        data: JSON.stringify({
          list: $.makeArray(checkedUids)
        }),
        success: function(data, textStatus, jqXHR) {
          $('.block-all-processing').show();
          $('.block-all').hide();
        },
        error: function(jqXHR, textStatus, errorThrown) {
          alert('Error: ' + textStatus + errorThrown);
        }
      });
    } else {
      alert('action ' + type + ' not yet supported');
    }
  }
  $('button').click(function(ev) {
    if ($('.logon').length > 0) {
      alert('Please log on to do that.');
    } else if ($(ev.target).hasClass('unblock')) {
      doAction('unblock')
    } else if ($(ev.target).hasClass('unblock-mute')) {
      doAction('unblock-mute')
    } else if ($(ev.target).hasClass('block')) {
      doAction('unblock-mute')
    } else {
      console.log(ev.target);
    }
  });
});
