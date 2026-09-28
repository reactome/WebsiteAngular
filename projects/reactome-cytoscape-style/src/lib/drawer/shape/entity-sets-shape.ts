import { extract } from '../../properties-utils';
import { DrawerProvider } from '../types';

export const entitySet: DrawerProvider = (
  properties,
  { width, height, drug, disease, interactor, lossOfFunction }
) => {
  const select = extract(properties.global.selectNode);
  const hover = extract(properties.global.hoverNode);
  const flag = extract(properties.global.flag);

  const t = extract(properties.global.thickness);
  let r = extract(properties.entitySet.radius);

  if (2 * r > height / 2 - t) {
    r = height / 4 - t / 2;
  }

  width += 2 * r;

  const fill = !interactor
    ? !drug
      ? extract(properties.entitySet.fill)
      : extract(properties.entitySet.drug)
    : extract(properties.interactor.fill);
  const stroke = !disease
    ? extract(properties.entitySet.stroke)
    : extract(properties.global.negativeContrast);

  const r2 = r * 2;
  const t2 = t * 2;
  const v = height / 2 - r2 - t; // Vertical
  const stateHeight = height / 2 + t;
  const bracesOffset = r2 + t2;

  // A set is drawn as its braces: the stretch of outline between them is
  // masked out. A loss-of-function set dashes that stretch, top and bottom,
  // as complexes, genes and proteins dash their outlines. The dashes are
  // fitted to it -- a whole number of them, as long as the gaps, starting
  // and ending on a dash -- so neither end stops on a stub.
  const hidingLength = width - 2 * bracesOffset;
  // At least two, so a narrow set still reads as dashed rather than closed.
  const dashNumber = Math.max(2, Math.round((hidingLength / t2 + 1) / 2));
  const dashLength = hidingLength / (2 * dashNumber - 1);
  const lossOfFunctionDashes =
    lossOfFunction && hidingLength > 0
      ? `<path d="M ${bracesOffset} ${t} H ${width - bracesOffset} M ${bracesOffset} ${height - t} H ${width - bracesOffset}" fill="none" stroke="${stroke}" stroke-width="${t2}" stroke-dasharray="${dashLength}" clip-path="url(#inside)"/>`
      : '';

  const defs = `<defs>
   <path id="curly" d="
       M ${r2 + t} ${t}
       H ${width - r2 - t}
       a ${r} ${r} 0 0 1 ${r} ${r}

       v ${v}
       a ${r} ${r} 0 0 0 ${r} ${r}
       a ${r} ${r} 0 0 0 -${r} ${r}
       v ${v}

       a ${r} ${r} 0 0 1 -${r} ${r}
       H ${r2 + t}
       a ${r} ${r} 0 0 1 -${r} -${r}

       v -${v}
       a ${r} ${r} 0 0 0 -${r} -${r}
       a ${r} ${r} 0 0 0 ${r} -${r}
       v -${v}

       a ${r} ${r} 0 0 1 ${r} -${r}
       Z
       "/>
   <clipPath id="inside">
     <use href="#curly"/>
   </clipPath>
 </defs>`;
  return {
    background: {
      'background-image': `
       ${defs}
       <use href="#curly" fill="${fill}" stroke="${fill}" stroke-width="${t2}" stroke-linejoin="round"/>
       `,
      'background-position-x': -r,
      'background-width': width + 2 * r,
      'background-clip': 'none',
      'bounds-expansion': 2 * t,
    },
    hover: {
      'background-image': `
       <path stroke="${hover}" stroke-width="${t2}" fill="none" stroke-linejoin="round" d="
         M ${r + t} ${stateHeight + r}
         a ${r} ${r} 0 0 0 -${r} -${r}
         a ${r} ${r} 0 0 0 ${r} -${r}
         v -${v}
         a ${r} ${r + t} 0 0 1 ${r} -${r + t}
         H ${width - r2 - t}
         a ${r} ${r + t} 0 0 1 ${r} ${r + t}
         v ${v}
         a ${r} ${r} 0 0 0 ${r} ${r}
         a ${r} ${r} 0 0 0 -${r} ${r}
       "/>`,
      'background-position-x': -r,
      'background-width': width + 2 * r,

      'background-clip': 'none',
      'bounds-expansion': 2 * t,

      'background-position-y': -t,
      'background-height': stateHeight,
    },
    select: {
      'background-image': `
       <path stroke="${select}" stroke-width="${t2}" fill="none" stroke-linejoin="round" d="
         M ${r + t} ${-r}
         a ${r} ${r} 0 0 1 -${r} ${r}
         a ${r} ${r} 0 0 1 ${r} ${r}
         v ${v}
         a ${r} ${r + t} 0 0 0 ${r} ${r + t}
         H ${width - r2 - t}
         a ${r} ${r + t} 0 0 0 ${r} -${r + t}
         v -${v}
         a ${r} ${r} 0 0 1 ${r} -${r}
         a ${r} ${r} 0 0 1 -${r} -${r}
       "/>`,
      'background-position-x': -r,
      'background-width': width + 2 * r,

      'background-clip': 'none',
      'bounds-expansion': 2 * t,

      'background-position-y': height / 2,
      'background-height': stateHeight,
    },
    flag: {
      'background-image': `
<rect width="${width}" height="${height + 2 * t}" rx="${r + 3 * t}" ry="${r + t2}" fill="${flag}"/>
`,
      'background-position-x': -2 * t,
      'background-position-y': -t,
      'bounds-expansion': 2 * t,
      'background-clip': 'none',
      'background-image-containment': 'over',
      'background-width': width,
      'background-height': height + 2 * t,
    },
    decorators: [
      {
        'background-image': `
       ${defs}
       <mask id="myMask">
         <rect fill="white" x="0" y="0" width="${width}" height="${height}"/>
         <rect fill="black" x="${bracesOffset}" y="${0}" width="${width - 2 * bracesOffset}" height="${height}"/>
       </mask>
       <use href="#curly" fill="none" stroke="${stroke}" stroke-width="${t2}" clip-path="url(#inside)" mask="url(#myMask)"/>
       ${lossOfFunctionDashes}
`,
        'background-position-x': -r,
        'bounds-expansion': r,
        'background-clip': 'none',
        'background-width': width + 2 * r,
      },
    ],
    analysis: {
      'background-image': `<rect x="${r * 1.5}" y="${t}" width="${width - 2 * r * 1.5}" rx="${r}" height="${height - t2}" class="gradient"/>`,
      'background-position-x': -r,
      'background-width': width + 2 * r,
      'background-clip': 'none',
      'bounds-expansion': 2 * t,
      requireGradient: true,
    },
    // analysis: {
    //   'background-image': `${defs}${gradient}
    //   <use href="#curly" fill="url(#gradient)" clip-path="url(#inside)"/>
    //   <mask id="myMask">
    //      <rect fill="white" x="0" y="0" width="${width}" height="${height}"/>
    //      <rect fill="black" x="${bracesOffset}" y="${0}" width="${width - 2 * bracesOffset}" height="${height}"/>
    //    </mask>
    //    <use href="#curly" fill="none" stroke="${stroke}" stroke-width="${t2}" clip-path="url(#inside)" mask="url(#myMask)"/>`,
    //   "background-position-x": -r,
    //   "bounds-expansion": r,
    //   "background-clip": "none",
    //   "background-width": width + 2 * r,
    // }
  };
};
