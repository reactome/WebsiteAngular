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
 *
 * And it defines window.Reactome.Diagram, the old diagram widget's interface
 * (contracts/legacy-widget-api.md), so a site written for that widget switches
 * by changing only its script's address. Defined here, synchronously, because
 * such sites poll for `Reactome` and call create() the moment it appears.
 */
(function () {
  defineLegacyWidget();

  // Included twice: harmless. Told by the module script the first copy added,
  // rather than by a global of ours on the partner's window.
  if (document.querySelector('script[data-reactome-diagram]')) return;

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
  module.setAttribute('data-reactome-diagram', '');
  module.src = base + 'main.js';
  document.head.appendChild(module);
})();

/**
 * window.Reactome.Diagram: create() and the old widget's methods and handlers,
 * over a <reactome-diagram>. Kept apart from the loading above so that a
 * second copy of this script, which loads nothing, still finds it defined.
 */
function defineLegacyWidget() {
  var Reactome = (window.Reactome = window.Reactome || {});
  if (Reactome.Diagram) return;

  function px(value) {
    return typeof value === 'number' ? value + 'px' : value;
  }

  /** The old widget's object for an entity, from the element's event detail. */
  function entity(detail) {
    return detail && detail.id
      ? { stId: detail.id, displayName: detail.name, schemaClass: detail.schemaClass }
      : null;
  }

  function create(options) {
    options = options || {};
    var holder = document.getElementById(options.placeHolder);
    if (!holder) {
      throw new Error('Reactome.Diagram.create: no element with id "' + options.placeHolder + '"');
    }
    // options.proxyPrefix is accepted and ignored: Reactome's services allow
    // cross-origin reads, so no proxy is needed any more.
    var diagram = document.createElement('reactome-diagram');
    if (options.width) diagram.style.width = px(options.width);
    if (options.height) diagram.style.height = px(options.height);
    holder.appendChild(diagram);

    // Calls made before the element is defined wait for it, and are applied in
    // the order made: applying the attribute ones at once would let them
    // overtake a queued method -- a flag set after a reset, reset after it.
    var ready = false;
    var queue = [];
    function call(apply) {
      if (ready) apply();
      else queue.push(apply);
    }
    window.customElements.whenDefined('reactome-diagram').then(function () {
      ready = true;
      while (queue.length) queue.shift()();
    });

    function set(name, value) {
      return function () {
        diagram.setAttribute(name, value);
      };
    }
    function method(name, argument) {
      return function () {
        if (argument === undefined) diagram[name]();
        else diagram[name](argument);
      };
    }
    function on(type, adapt) {
      return function (handler) {
        diagram.addEventListener(type, function (event) {
          var args = adapt(event.detail);
          if (args) handler.apply(null, args);
        });
      };
    }

    return {
      loadDiagram: function (stId) {
        call(set('pathway', stId));
      },
      selectItem: function (stId) {
        call(set('select', stId));
      },
      resetSelection: function () {
        call(method('resetSelection'));
      },
      flagItems: function (term) {
        call(set('flag', term));
      },
      resetFlaggedItems: function () {
        call(method('resetFlag'));
      },
      highlightItem: function (stId) {
        call(method('highlight', stId));
      },
      resetHighlight: function () {
        call(method('resetHighlight'));
      },
      setAnalysisToken: function (token, resultFilter) {
        var resource =
          (typeof resultFilter === 'string'
            ? resultFilter
            : resultFilter && resultFilter.resource) || 'TOTAL';
        // The resource first, so the overlay is asked for once, filtered.
        call(set('analysis-resource', resource));
        call(set('analysis-token', token));
      },
      resetAnalysis: function () {
        call(method('resetAnalysis'));
      },
      resize: function (width, height) {
        diagram.style.width = px(width);
        diagram.style.height = px(height);
      },
      onDiagramLoaded: on('diagramloaded', function (detail) {
        return [detail.pathway];
      }),
      onObjectSelected: on('entityselected', function (detail) {
        return [entity(detail)];
      }),
      onObjectHovered: on('entityhovered', function (detail) {
        return [entity(detail)];
      }),
      onFlagsReset: on('flagcleared', function () {
        return [];
      }),
      onAnalysisReset: on('analysiscleared', function () {
        return [];
      }),
      onCanvasNotSupported: on('diagramerror', function (detail) {
        return detail && detail.reason === 'unsupported' ? [] : null;
      }),
    };
  }

  Reactome.Diagram = { create: create };
}
