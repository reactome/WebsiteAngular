/*
 * Reactome pathway diagram: the script partners include.
 *
 *   <script src="https://reactome.org/embed/diagram/v1/reactome-diagram.js"></script>
 *   <reactome-diagram pathway="R-HSA-69620"></reactome-diagram>
 *
 * Hand-written and classic on purpose. The diagram itself is an ES module build
 * (main.js and its chunks) -- Angular's builder always splits, so it cannot be
 * loaded by a plain <script> tag, which is what partners already have. This
 * loads it for them, from wherever this file was loaded from.
 *
 * It also puts the fonts in the page: a shadow root ignores @font-face, so the
 * diagram's typeface and icon fonts have to be registered on the document.
 */
(function () {
  if (window.__reactomeDiagramLoader) return; // included twice: harmless
  window.__reactomeDiagramLoader = true;

  var script = document.currentScript;
  var base = script && script.src ? script.src.replace(/[^/]*$/, '') : '';

  var fonts = [
    'https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500&display=swap',
    'https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200',
    'https://fonts.googleapis.com/icon?family=Material+Icons',
  ];
  for (var i = 0; i < fonts.length; i++) {
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = fonts[i];
    document.head.appendChild(link);
  }

  var module = document.createElement('script');
  module.type = 'module';
  module.crossOrigin = 'anonymous';
  module.src = base + 'main.js';
  document.head.appendChild(module);
})();
