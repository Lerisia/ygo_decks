(function($) {
  $(document).ready(function() {
      console.log("Fix Autocomplete Script Loaded");  // Debugging log

      var searchBox = $(".related-widget-wrapper select[data-autocomplete-light-function='select2']");

      if (searchBox.length > 0) {
          searchBox.select2({
              minimumInputLength: 2,  // Require at least 2 characters before searching
              delay: 500  // Prevent unnecessary UI updates
          });

          // Prevent "Searching..." from appearing after initial load
          searchBox.on("select2:open", function() {
              console.log("Select2 opened - Removing Searching message");
              $(".select2-results__option.loading-results").remove();
          });

          // Disable AJAX requests when pressing arrow keys or moving mouse
          searchBox.on("keydown", function(e) {
              console.log("Key pressed - Preventing new search:", e.key);
              e.stopImmediatePropagation();  // Stop event from triggering AJAX request
              e.preventDefault();  // Prevent the default behavior
          });

          searchBox.on("mouseup", function(e) {
              console.log("Mouse click detected - Preventing new search request");
              e.stopImmediatePropagation();
              e.preventDefault();
          });

          searchBox.on("mouseenter", function() {
              console.log("Mouse entered - Preventing new search request");
              searchBox.select2("close");  // Close dropdown to prevent extra requests
          });

          // Completely block the default behavior of Select2's auto AJAX request when the field is focused
          searchBox.on("select2:opening", function(e) {
              console.log("Blocking Select2 reopening due to input focus");
              e.preventDefault();
          });
      }
  });
})(django.jQuery);
