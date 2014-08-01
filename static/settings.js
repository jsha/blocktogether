$(document).ready(function(){
    $(":checkbox").change(function() {
        console.log('Got change');
        $.ajax({
          type: 'POST',
          url: '/settings.json',
          contentType: "application/json",
          dataType: "json",
          data: JSON.stringify({
            block_new_accounts: $('#block_new_accounts').prop('checked'),
            share_blocks: $('#share_blocks').prop('checked')
          }),
          success: function(data, textStatus, jqXHR) {
            $('.saved').show();
          },
          error: function(jqXHR, textStatus, errorThrown) {
            alert('Error: ' + textStatus + errorThrown);
          }
        });
    });
});
