$(function(){
  /* Specialized from MDN example of querystring reading. */
  function readPageNum() {
    return unescape(window.location.search.replace(
        /^(?:.*[&\?]page(?:\=([^&]*))?)?.*$/i, '$1'
    ));
  }
  function loadPage(pageNum) {
    window.location = window.location.origin +
                      window.location.pathname +
                      "?page=" + pageNum;
  }
  var currentPage = readPageNum() || 1,
      pages = $('ol.pagination > li.page');
  
  // Keep page number within bounds; disable prev/next buttons as needed.
  if (currentPage <= 1) {
    currentPage = 1;
    $('li.prev-page').addClass('disabled');
  }
  if (currentPage >= pages.length) {
    currentPage = pages.length;
    $('li.next-page').addClass('disabled');
  }
  // Display current page as active.
  $('ol.pagination > li.page').eq(currentPage - 1).addClass('active');
  
  // Assign behaviors to navigation components:
  $('.prev-page').click(function(ev) {
    ev.preventDefault();
    loadPage(currentPage - 1);
  });
  $('.next-page').click(function(ev) {
    ev.preventDefault();
    loadPage(currentPage + 1);
  });
  $('ol.pagination').on('click', 'li.page', function(ev) {
    ev.preventDefault();
    loadPage($(this).index());
  });
});
