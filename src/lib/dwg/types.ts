/** Types for parsed DWG drawing data */

export interface DwgPoint {
  x: number;
  y: number;
  z: number;
}

export interface DwgAttrib {
  tag: string;
  text: string;
  position: DwgPoint;
  textHeight: number;
  rotation: number;
  layer: string;
}

export interface DwgInsert {
  handle: string;
  blockName: string;
  insertionPoint: DwgPoint;
  xScale: number;
  yScale: number;
  zScale: number;
  rotation: number;
  layer: string;
  attribs: DwgAttrib[];
}

export interface DwgBlockDef {
  name: string;
  handle: string;
  basePoint: DwgPoint;
  description: string;
  entityCount: number;
  entityTypes: Record<string, number>;
  flags: number;
}

export interface DwgLayer {
  name: string;
  handle: string;
  colorIndex: number;
  color: string | null;
  isFrozen: boolean;
  isOff: boolean;
  isLocked: boolean;
}

export interface DwgDimension {
  handle: string;
  layer: string;
  type: string;
  /** Measurement value in drawing units */
  measurement: number;
  /** Text override if any */
  text: string;
  defPoint: DwgPoint;
  midPoint: DwgPoint;
}

export interface DwgTitleBlock {
  drawingNumber: string | null;
  title: string | null;
  subtitle: string | null;
  customer: string | null;
  company: string | null;
  drawnBy: string | null;
  checkedBy: string | null;
  date: string | null;
  revision: string | null;
  scale: string | null;
}

export interface DwgEntitySummary {
  totalEntities: number;
  typeCounts: Record<string, number>;
}

/** Extracted component from DWG block references */
export interface DwgComponent {
  id: string;
  blockName: string;
  label: string;
  nozzleId: string | null;
  position: DwgPoint;
  scale: { x: number; y: number; z: number };
  rotation: number;
  layer: string;
  attribs: Record<string, string>;
}

/** Full parsed result from a DWG file */
export interface DwgParseResult {
  layers: DwgLayer[];
  blocks: DwgBlockDef[];
  inserts: DwgInsert[];
  components: DwgComponent[];
  dimensions: DwgDimension[];
  titleBlock: DwgTitleBlock;
  entitySummary: DwgEntitySummary;
  svg: string;
}

/** A single sheet within a multi-sheet DWG project */
export interface DwgSheet {
  sheetNumber: number;
  label: string;       // e.g. "Elevation View", "Plan View"
  dwgUrl: string;
  dwgFilename: string;
  svgUrl: string;
  components: DwgComponent[];
  layers: DwgLayer[];
  metadata: DwgTitleBlock;
  /** Components matched across sheets share a correlationId */
  correlationMap?: Record<string, string>; // componentId → correlationId
  /** "GA" = resizable general arrangement; "PID" = non-resizable schematic. */
  sheetType?: import("./sheet-type").SheetType;
}

/** Lightweight project data stored in DB (no SVG, no raw geometry) */
export interface DwgProjectData {
  components: DwgComponent[];
  layers: DwgLayer[];
  metadata: DwgTitleBlock;
}
