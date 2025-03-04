(function () {
  let timeout = null;
  
  document.addEventListener("input", function (event) {
      let target = event.target;
      
      if (target.classList.contains("vAutocompleteInput")) {
          clearTimeout(timeout);
          timeout = setTimeout(() => {
              target.dispatchEvent(new Event("input", { bubbles: true }));
          }, 800);
      }
  });
})();
