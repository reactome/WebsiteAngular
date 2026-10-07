import { NodeSingular } from 'cytoscape';
import { Interactor } from '../model/interactor.model';

export interface Position {
  x: number;
  y: number;
}

export interface Segment {
  from: Position;
  to: Position;
}

class InteractorsLayout {
  /**
   * A ceiling, not a design.
   *
   * This was 18, which quietly dropped 28 of KLF15's 46 interactors and 55 of
   * BHLHE40's 73. Nothing about the layout required it: LayoutParameter.calculate
   * distributes n round four edges and derives the ring's width and height from
   * n, so it already grows to fit. Drawn at 46 the ring is 1532x894 in a diagram
   * 3459 wide, and every name is legible.
   *
   * 100 is high enough that almost nothing is cut, and low enough that an
   * interactor with thousands of partners cannot produce a ring nobody can read.
   * When it does bite, the control says "n of m shown" rather than leaving the
   * badge's number unexplained.
   */
  public static MAX_INTERACTORS = 100;
  public static BOX_WIDTH = 45;
  public static BOX_HEIGHT = 20;
  public static SEPARATION = Math.round(this.BOX_HEIGHT * 1.5);
  public static MIN_HEIGHT = 2 * (2 * this.BOX_HEIGHT + this.SEPARATION);
  public static MIN_WIDTH = 2 * (2 * this.BOX_WIDTH + this.SEPARATION);

  constructor() {}

  public static getNumberOfInteractorsToDraw(interactors: Interactor[]) {
    if (interactors == null) return 0;
    return Math.min(interactors.length, InteractorsLayout.MAX_INTERACTORS);
  }

  public getSegmentOrigin(
    edgeIndex: number,
    center: Position,
    width: number,
    height: number
  ): Position {
    edgeIndex = edgeIndex % 4;
    return {
      x: center.x + (width / 2) * (edgeIndex === 1 || edgeIndex === 2 ? 1 : -1),
      y: center.y + (height / 2) * (edgeIndex > 1 ? 1 : -1),
    };
  }

  public getCentre(minX: number, maxX: number, minY: number, maxY: number): Position {
    return {
      x: minX + (maxX - minX) / 2.0,
      y: minY + (maxY - minY) / 2.0,
    };
  }

  public interpolateInLayout(segment: Segment, pos: number, totalPositions: number): Position {
    const r = pos / totalPositions;
    return {
      x: segment.from.x + r * (segment.to.x - segment.from.x),
      y: segment.from.y + r * (segment.to.y - segment.from.y),
    };
  }

  public getPosition(targetNode: NodeSingular, interactorIndex: number, numberToDraw: number) {
    const centerPosition: { x: number; y: number } = targetNode.data('entity').position();
    const lp = LayoutParameter.calculate(numberToDraw);

    let edgeNodes = lp.nodeOnTop;
    let nodeCount = 0;
    let prevNodeCount = 0;
    let edgeIndex;
    const nodePerEdges = [lp.nodeOnTop, lp.nodeOnRight, lp.nodeOnBottom, lp.nodeOnLeft];

    for (edgeIndex = 0; edgeIndex < nodePerEdges.length; edgeIndex++) {
      edgeNodes = nodePerEdges[edgeIndex];
      prevNodeCount = nodeCount;
      nodeCount += edgeNodes - 1;
      if (interactorIndex < nodeCount) {
        break;
      }
    }

    const edgePos = interactorIndex - prevNodeCount;
    const pos = this.interpolateInLayout(
      // new Segment(
      {
        from: this.getSegmentOrigin(edgeIndex, centerPosition, lp.width, lp.height),
        to: this.getSegmentOrigin(edgeIndex + 1, centerPosition, lp.width, lp.height),
      },
      //  ),
      edgePos,
      edgeNodes - 1
    );

    const minX = pos.x - InteractorsLayout.BOX_WIDTH;
    const maxX = pos.x + InteractorsLayout.BOX_WIDTH;
    const minY = pos.y - InteractorsLayout.BOX_HEIGHT;
    const maxY = pos.y + InteractorsLayout.BOX_HEIGHT;

    return this.getCentre(minX, maxX, minY, maxY);
  }
}

class LayoutParameter {
  constructor(
    public nodeOnLeft: number,
    public nodeOnRight: number,
    public nodeOnTop: number,
    public nodeOnBottom: number,
    public width: number,
    public height: number
  ) {}

  static calculate(n: number): LayoutParameter {
    const rationalNodePerEdge = n / 4 + 1;
    const baseNodePerEdge = Math.floor(rationalNodePerEdge);
    const remaining = Math.round((rationalNodePerEdge - baseNodePerEdge) * 4);

    const nodeOnLeft = baseNodePerEdge + (remaining > 0 ? 1 : 0);
    const nodeOnRight = baseNodePerEdge + (remaining > 1 ? 1 : 0);
    const nodeOnTop = baseNodePerEdge + (remaining > 2 ? 1 : 0);
    const nodeOnBottom = baseNodePerEdge;

    const height = Math.max(
      (2 * InteractorsLayout.BOX_HEIGHT + InteractorsLayout.SEPARATION) * (nodeOnLeft - 1),
      InteractorsLayout.MIN_HEIGHT
    );
    const width = Math.max(
      (2 * InteractorsLayout.BOX_WIDTH + InteractorsLayout.SEPARATION) * (nodeOnTop - 1),
      InteractorsLayout.MIN_WIDTH
    );

    return new LayoutParameter(nodeOnLeft, nodeOnRight, nodeOnTop, nodeOnBottom, width, height);
  }
}

export default InteractorsLayout;
