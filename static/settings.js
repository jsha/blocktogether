$(document).ready(function(){
    $(":checkbox").change(function(ev) {
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
            // Ideally we'd insert the new URL in the page. For now just reload
            // the page to see the URL.
            if (ev.target.id === 'share_blocks') {
              document.location.reload();
            }
          },
          error: function(jqXHR, textStatus, errorThrown) {
            alert('Error: ' + textStatus + errorThrown);
          }
        });
    });
});
