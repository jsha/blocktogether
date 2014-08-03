$(function(){
  $('.block-all').click(function(ev) {
    var uids = $('.blocked-user').map(function (el) {
      return $(this).data('uid');
    });
    $.ajax({
      type: 'POST',
      url: '/do-blocks.json',
      contentType: "application/json",
      dataType: "json",
      data: JSON.stringify({
        list: $.makeArray(uids)
      }),
      success: function(data, textStatus, jqXHR) {
        $('.block-all-processing').show();
        $('.block-all').hide();
      },
      error: function(jqXHR, textStatus, errorThrown) {
        alert('Error: ' + textStatus + errorThrown);
      }
    });
  });
});
