// Dimension Modifier
// When a user changes a dimension value (via the popup editor), this module:
// 1. Computes the scale factor from old → new value
// 2. Moves/scales the linked geometry entities
// 3. Updates the dimension text
// 4. Returns a modified drawing with undo support

import type {
  ParsedDrawing,
  ParsedEntity,
  ParametricDimension,
  DimensionModification,
  CascadeSuggestion,
  Point2D,
} from "@/types/cad";
import type { ComponentGraph } from "@/types/component-recognition";
import { formatImperialDimension } from "./dimension-link";

/** Recompute bounding box from entities */
function recomputeBounds(entities: ParsedEntity[]): { min: Point2D; max: Point2D } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const e of entities) {
    if (e.vertices) {
      for (const v of e.vertices) {
        if (v.x < minX) minX = v.x;
        if (v.y < minY) minY = v.y;
        if (v.x > maxX) maxX = v.x;
        if (v.y > maxY) maxY = v.y;
      }
    }
    if (e.center) {
      const r = e.radius || 0;
      if (e.center.x - r < minX) minX = e.center.x - r;
      if (e.center.y - r < minY) minY = e.center.y - r;
      if (e.center.x + r > maxX) maxX = e.center.x + r;
      if (e.center.y + r > maxY) maxY = e.center.y + r;
    }
    if (e.insertionPoint) {
      if (e.insertionPoint.x < minX) minX = e.insertionPoint.x;
      if (e.insertionPoint.y < minY) minY = e.insertionPoint.y;
      if (e.insertionPoint.x > maxX) maxX = e.insertionPoint.x;
      if (e.insertionPoint.y > maxY) maxY = e.insertionPoint.y;
    }
  }
  if (!isFinite(minX)) return { min: { x: 0, y: 0 }, max: { x: 100, y: 100 } };
  return { min: { x: minX, y: minY }, max: { x: maxX, y: maxY } };
}

/**
 * Classify an entity as "rigid" (should translate without deformation) or "stretch" (should scale).
 * Rigid: small circles, arcs, closed polylines with ~1:1 aspect ratio (bolt holes, nozzle outlines).
 * Stretch: lines, open polylines, large shapes.
 */
function classifyEntity(entity: ParsedEntity, dimSpan: number): "rigid" | "stretch" {
  // Circles and arcs are always rigid (translate center, preserve radius)
  if (entity.type === "CIRCLE" || entity.type === "ARC") {
    // Only rigid if small relative to the dimension span
    const r = entity.radius || 0;
    if (r > 0 && r < dimSpan * 0.15) return "rigid";
    return "stretch";
  }

  // Closed polylines with roughly square aspect ratio and small area
  if ((entity.type === "LWPOLYLINE" || entity.type === "POLYLINE") && entity.closed && entity.vertices) {
    const pts = entity.vertices;
    if (pts.length < 3) return "stretch";
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of pts) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    const w = maxX - minX;
    const h = maxY - minY;
    if (w < 0.001 || h < 0.001) return "stretch";
    const aspect = Math.max(w, h) / Math.min(w, h);
    const area = w * h;
    const dimArea = dimSpan * dimSpan;
    // Near-square and small relative to dimension
    if (aspect < 2.0 && area < dimArea * 0.05) return "rigid";
  }

  return "stretch";
}

/**
 * Get the center point of an entity for rigid translation.
 */
function getCenterPoint(entity: ParsedEntity): Point2D {
  if (entity.center) return entity.center;
  if (entity.insertionPoint) return entity.insertionPoint;
  if (entity.vertices && entity.vertices.length > 0) {
    let sx = 0, sy = 0;
    for (const v of entity.vertices) { sx += v.x; sy += v.y; }
    return { x: sx / entity.vertices.length, y: sy / entity.vertices.length };
  }
  return { x: 0, y: 0 };
}

/**
 * Translate an entity by a delta without deforming it.
 */
function translateEntity(entity: ParsedEntity, delta: Point2D): void {
  if (entity.vertices) {
    entity.vertices = entity.vertices.map(v => ({ x: v.x + delta.x, y: v.y + delta.y }));
  }
  if (entity.center) {
    entity.center = { x: entity.center.x + delta.x, y: entity.center.y + delta.y };
  }
  if (entity.insertionPoint) {
    entity.insertionPoint = { x: entity.insertionPoint.x + delta.x, y: entity.insertionPoint.y + delta.y };
  }
  if (entity.defPoint1) {
    entity.defPoint1 = { x: entity.defPoint1.x + delta.x, y: entity.defPoint1.y + delta.y };
  }
  if (entity.defPoint2) {
    entity.defPoint2 = { x: entity.defPoint2.x + delta.x, y: entity.defPoint2.y + delta.y };
  }
  if (entity.textPosition) {
    entity.textPosition = { x: entity.textPosition.x + delta.x, y: entity.textPosition.y + delta.y };
  }
  // radius, startAngle, endAngle stay the same — that's the point of rigid translation
}

/**
 * Get all geometric points from an entity.
 */
function getEntityPoints(entity: ParsedEntity): Point2D[] {
  const points: Point2D[] = [];
  if (entity.vertices) {
    for (const v of entity.vertices) {
      if (isFinite(v.x) && isFinite(v.y)) points.push(v);
    }
  }
  if (entity.center && isFinite(entity.center.x) && isFinite(entity.center.y)) {
    points.push(entity.center);
  }
  if (entity.insertionPoint && isFinite(entity.insertionPoint.x) && isFinite(entity.insertionPoint.y)) {
    points.push(entity.insertionPoint);
  }
  return points;
}

/**
 * Gather entities within a spatial column around a dimension's measurement span.
 * Used when geometryHandles are sparse (typical for PDF-extracted drawings).
 * Returns handles of non-text geometry entities whose ALL points fall within the column.
 */
function gatherSpatialColumn(
  dim: ParametricDimension,
  allEntities: ParsedEntity[],
  knownGeoEntities: ParsedEntity[],
  excludeHandles: Set<string>
): Set<string> {
  const [anchor0, anchor1] = dim.anchorPoints;

  const dx = anchor1.x - anchor0.x;
  const dy = anchor1.y - anchor0.y;
  const dimLen = Math.sqrt(dx * dx + dy * dy);
  if (dimLen < 0.001) return new Set();

  const axisX = dx / dimLen;
  const axisY = dy / dimLen;
  const perpX = -axisY;
  const perpY = axisX;

  // Determine perpendicular extent from known geometry handles
  let minPerp = Infinity, maxPerp = -Infinity;

  for (const e of knownGeoEntities) {
    for (const p of getEntityPoints(e)) {
      const relX = p.x - anchor0.x;
      const relY = p.y - anchor0.y;
      const perpProj = relX * perpX + relY * perpY;
      if (perpProj < minPerp) minPerp = perpProj;
      if (perpProj > maxPerp) maxPerp = perpProj;
    }
  }

  if (!isFinite(minPerp)) return new Set();

  // If perpendicular range is too narrow (e.g. single line),
  // expand to a reasonable default based on dimension length
  const perpRange = maxPerp - minPerp;
  if (perpRange < dimLen * 0.3) {
    const center = (minPerp + maxPerp) / 2;
    const halfWidth = dimLen * 0.25;
    minPerp = center - halfWidth;
    maxPerp = center + halfWidth;
  }

  // Add margin around the column
  const perpMargin = Math.max(maxPerp - minPerp, 10) * 0.3;
  minPerp -= perpMargin;
  maxPerp += perpMargin;

  // Along axis: extend beyond anchors
  const axisMargin = dimLen * 0.15;
  const minAxis = -axisMargin;
  const maxAxis = dimLen + axisMargin;

  const result = new Set<string>();
  const skipTypes = new Set(["TEXT", "MTEXT"]);

  for (const entity of allEntities) {
    if (skipTypes.has(entity.type)) continue;
    if (excludeHandles.has(entity.handle)) continue;

    const points = getEntityPoints(entity);
    if (points.length === 0) continue;

    // Include entity only if ALL its points fall within the column
    let allInColumn = true;
    for (const p of points) {
      const relX = p.x - anchor0.x;
      const relY = p.y - anchor0.y;
      const axisProj = relX * axisX + relY * axisY;
      const perpProj = relX * perpX + relY * perpY;

      if (axisProj < minAxis || axisProj > maxAxis ||
          perpProj < minPerp || perpProj > maxPerp) {
        allInColumn = false;
        break;
      }
    }

    if (allInColumn) {
      result.add(entity.handle);
    }
  }

  return result;
}

export interface ModifyDimensionParams {
  /** The dimension to modify */
  dimensionId: string;
  /** New value in inches (mutually exclusive with scaleFactor) */
  newValue?: number;
  /** Scale factor as percentage, e.g. 110 = 110% (mutually exclusive with newValue) */
  scalePercent?: number;
  /** If true, scale uniformly (maintain proportions). If false/undefined, scale only along the dimension axis. */
  proportional?: boolean;
  /** Which anchor to use as pivot. "auto" infers from geometry (default). */
  pivotSide?: "auto" | "anchor0" | "anchor1";
  /** Component graph for smarter entity selection */
  componentGraph?: ComponentGraph;
}

/**
 * Infer smart pivot from dimension orientation.
 * For vertical dims: pivot at lower anchor (min Y).
 * For horizontal dims: pivot at left anchor (min X).
 */
function inferSmartPivot(
  anchor0: Point2D,
  anchor1: Point2D,
  axis: Point2D
): Point2D {
  const isVertical = Math.abs(axis.y) > Math.abs(axis.x);
  if (isVertical) {
    // Pivot at the lower anchor (ground stays fixed)
    return anchor0.y < anchor1.y ? anchor0 : anchor1;
  } else {
    // Pivot at the left anchor
    return anchor0.x < anchor1.x ? anchor0 : anchor1;
  }
}

/**
 * Apply a dimension change to the drawing.
 * Returns a new drawing (immutable) and modification metadata.
 */
export function modifyDimension(
  drawing: ParsedDrawing,
  dimensions: ParametricDimension[],
  params: ModifyDimensionParams
): { drawing: ParsedDrawing; modification: DimensionModification; dimensions: ParametricDimension[] } {
  const dim = dimensions.find((d) => d.id === params.dimensionId);
  if (!dim) throw new Error(`Dimension ${params.dimensionId} not found`);

  // Calculate the new value and scale factor
  let newValue: number;
  let scaleFactor: number;

  if (params.newValue !== undefined) {
    newValue = params.newValue;
    if (dim.value === 0 || !isFinite(dim.value)) {
      throw new Error("Cannot scale: current dimension value is zero or invalid");
    }
    scaleFactor = newValue / dim.value;
  } else if (params.scalePercent !== undefined) {
    scaleFactor = params.scalePercent / 100;
    newValue = dim.value * scaleFactor;
  } else {
    throw new Error("Must provide either newValue or scalePercent");
  }

  if (!isFinite(scaleFactor) || scaleFactor <= 0) {
    throw new Error(`Invalid scale factor: ${scaleFactor}`);
  }
  if (Math.abs(scaleFactor - 1) < 0.0001) {
    // No change needed
    return {
      drawing,
      modification: {
        dimensionId: dim.id,
        oldValue: dim.value,
        newValue: dim.value,
        affectedEntities: [],
        scaleFactor: 1,
      },
      dimensions,
    };
  }

  // Deep clone the entities array
  const newEntities = drawing.entities.map((e) => ({ ...e }));

  // Collect handles of entities to transform
  const geoHandleSet = new Set(dim.geometryHandles);
  const annoHandleSet = new Set(dim.annotationHandles);
  const textHandle = dim.textHandle;
  const affectedHandles: string[] = [];

  // Enrich geometry handles using component graph if available
  // This ensures we grab the FULL component (e.g., entire stack, not just bottom half)
  if (params.componentGraph) {
    const comp = params.componentGraph.components.find(c => c.dimensionIds.includes(dim.id));
    if (comp) {
      // Add all entities within the component's bounding box
      const bb = comp.boundingBox;
      for (const e of drawing.entities) {
        if (e.type === "TEXT" || e.type === "MTEXT") continue;
        if (geoHandleSet.has(e.handle)) continue;
        const pts = getEntityPoints(e);
        if (pts.length === 0) continue;
        const allInBox = pts.every(p =>
          p.x >= bb.minX - 1 && p.x <= bb.maxX + 1 &&
          p.y >= bb.minY - 1 && p.y <= bb.maxY + 1
        );
        if (allInBox) geoHandleSet.add(e.handle);
      }
      console.log(`[modifyDimension] Component-aware: ${comp.label} → ${geoHandleSet.size} entities`);
    }
  }

  // When geometry handles are sparse (< 5, typical for PDF-extracted drawings),
  // gather more entities by finding all geometry in a spatial column around the dimension
  if (geoHandleSet.size < 5) {
    const knownGeo = drawing.entities.filter(e => geoHandleSet.has(e.handle));
    const excludeHandles = new Set([textHandle, ...dim.annotationHandles]);
    const spatialHandles = gatherSpatialColumn(dim, drawing.entities, knownGeo, excludeHandles);
    for (const h of spatialHandles) {
      geoHandleSet.add(h);
    }
    geoHandleSet.delete(textHandle);
    console.log(
      `[modifyDimension] Spatial gathering: ${dim.geometryHandles.length} → ${geoHandleSet.size} geometry entities`
    );
  }

  // Determine the anchor/pivot point and transform axis
  const [anchor0, anchor1] = dim.anchorPoints;
  let pivot: Point2D;
  let axis: Point2D; // unit vector along dimension direction

  // Calculate axis direction
  const dx = anchor1.x - anchor0.x;
  const dy = anchor1.y - anchor0.y;
  const len = Math.sqrt(dx * dx + dy * dy);

  if (len < 0.001) {
    // Degenerate — just use horizontal
    axis = { x: 1, y: 0 };
    pivot = anchor0;
  } else {
    axis = { x: dx / len, y: dy / len };

    // Determine pivot based on pivotSide parameter or expandDirection
    const pivotSide = params.pivotSide || "auto";
    if (pivotSide === "anchor0") {
      pivot = anchor0;
    } else if (pivotSide === "anchor1") {
      pivot = anchor1;
    } else if (pivotSide === "auto") {
      // Smart pivot: infer from dimension orientation
      pivot = inferSmartPivot(anchor0, anchor1, axis);
    } else if (dim.expandDirection === "both") {
      pivot = { x: (anchor0.x + anchor1.x) / 2, y: (anchor0.y + anchor1.y) / 2 };
    } else if (dim.expandDirection === "start") {
      pivot = anchor1;
    } else {
      pivot = anchor0;
    }
  }

  // Choose scaling strategy
  const useUniform = params.proportional === true;
  const scaleEntity = useUniform
    ? (e: ParsedEntity) => scaleEntityUniform(e, pivot, scaleFactor)
    : (e: ParsedEntity) => scaleEntityAlongAxis(e, pivot, axis, scaleFactor);
  const scalePoint = useUniform
    ? (p: Point2D) => scalePointUniform(p, pivot, scaleFactor)
    : (p: Point2D) => scalePointAlongAxis(p, pivot, axis, scaleFactor);

  // Classify entities and apply appropriate transform
  const rigidHandles: string[] = [];
  const dimSpan = len; // dimension span for size thresholds

  for (const entity of newEntities) {
    if (geoHandleSet.has(entity.handle)) {
      if (!useUniform && classifyEntity(entity, dimSpan) === "rigid") {
        // Rigid: translate without deformation
        const center = getCenterPoint(entity);
        const centerAfter = scalePointAlongAxis(center, pivot, axis, scaleFactor);
        const delta = { x: centerAfter.x - center.x, y: centerAfter.y - center.y };
        translateEntity(entity, delta);
        rigidHandles.push(entity.handle);
      } else {
        scaleEntity(entity);
      }
      affectedHandles.push(entity.handle);
    }
  }

  // Move annotation entities (extension lines, arrows)
  for (const entity of newEntities) {
    if (annoHandleSet.has(entity.handle)) {
      scaleEntity(entity);
      affectedHandles.push(entity.handle);
    }
  }

  // Update the dimension text
  for (const entity of newEntities) {
    if (entity.handle === textHandle) {
      entity.text = formatImperialDimension(newValue);
      if (entity.insertionPoint) {
        entity.insertionPoint = scalePoint(entity.insertionPoint);
      }
      affectedHandles.push(entity.handle);
    }
  }

  // Update the dimension's stored value and anchor points
  const newDimensions = dimensions.map((d) => {
    if (d.id !== dim.id) return d;
    return {
      ...d,
      value: newValue,
      displayText: formatImperialDimension(newValue),
      anchorPoints: [
        scalePoint(d.anchorPoints[0]),
        scalePoint(d.anchorPoints[1]),
      ] as [Point2D, Point2D],
    };
  });

  // Recalculate bounds from modified entities
  const newDrawing: ParsedDrawing = {
    ...drawing,
    entities: newEntities,
    bounds: recomputeBounds(newEntities),
  };

  // Compute the displacement vector and moving anchor for cascade analysis
  const valueDelta = newValue - dim.value;
  const displacement: Point2D = { x: axis.x * valueDelta, y: axis.y * valueDelta };
  // The "moving anchor" is the non-pivot end (before the resize)
  const movingAnchorBefore: Point2D =
    (pivot.x === dim.anchorPoints[0].x && pivot.y === dim.anchorPoints[0].y)
      ? dim.anchorPoints[1]
      : dim.anchorPoints[0];

  const modification: DimensionModification = {
    dimensionId: dim.id,
    oldValue: dim.value,
    newValue,
    affectedEntities: affectedHandles,
    rigidEntities: rigidHandles.length > 0 ? rigidHandles : undefined,
    scaleFactor,
    pivot,
    axis,
    displacement,
    movingAnchorBefore,
  };

  return { drawing: newDrawing, modification, dimensions: newDimensions };
}

/**
 * Scale a point along a specific axis relative to a pivot.
 */
function scalePointAlongAxis(
  point: Point2D,
  pivot: Point2D,
  axis: Point2D,
  scale: number
): Point2D {
  // Vector from pivot to point
  const vx = point.x - pivot.x;
  const vy = point.y - pivot.y;

  // Project onto axis
  const proj = vx * axis.x + vy * axis.y;

  // Scale only the component along the axis
  const newProj = proj * scale;
  const diff = newProj - proj;

  return {
    x: point.x + diff * axis.x,
    y: point.y + diff * axis.y,
  };
}

/**
 * Scale a point uniformly (both axes) relative to a pivot.
 */
function scalePointUniform(
  point: Point2D,
  pivot: Point2D,
  scale: number
): Point2D {
  return {
    x: pivot.x + (point.x - pivot.x) * scale,
    y: pivot.y + (point.y - pivot.y) * scale,
  };
}

/**
 * Scale an entity's geometry uniformly (both axes) relative to a pivot.
 */
function scaleEntityUniform(
  entity: ParsedEntity,
  pivot: Point2D,
  scale: number
): void {
  if (entity.vertices) {
    entity.vertices = entity.vertices.map((v) => scalePointUniform(v, pivot, scale));
  }
  if (entity.center) {
    entity.center = scalePointUniform(entity.center, pivot, scale);
  }
  if (entity.radius) {
    entity.radius *= scale;
  }
  if (entity.insertionPoint) {
    entity.insertionPoint = scalePointUniform(entity.insertionPoint, pivot, scale);
  }
  if (entity.defPoint1) {
    entity.defPoint1 = scalePointUniform(entity.defPoint1, pivot, scale);
  }
  if (entity.defPoint2) {
    entity.defPoint2 = scalePointUniform(entity.defPoint2, pivot, scale);
  }
  if (entity.textPosition) {
    entity.textPosition = scalePointUniform(entity.textPosition, pivot, scale);
  }
}

/**
 * Preview a dimension change without committing.
 * Returns only the affected entities in their new positions (deep-cloned).
 */
export function previewDimension(
  drawing: ParsedDrawing,
  dimensions: ParametricDimension[],
  params: ModifyDimensionParams
): { previewEntities: ParsedEntity[]; affectedHandles: string[] } | null {
  try {
    const result = modifyDimension(drawing, dimensions, params);
    const affectedSet = new Set(result.modification.affectedEntities);
    const previewEntities = result.drawing.entities.filter(e => affectedSet.has(e.handle));
    return {
      previewEntities,
      affectedHandles: result.modification.affectedEntities,
    };
  } catch {
    return null;
  }
}

/**
 * Scale an entity's geometry along a specific axis.
 */
function scaleEntityAlongAxis(
  entity: ParsedEntity,
  pivot: Point2D,
  axis: Point2D,
  scale: number
): void {
  // Scale vertices
  if (entity.vertices) {
    entity.vertices = entity.vertices.map((v) =>
      scalePointAlongAxis(v, pivot, axis, scale)
    );
  }

  // Scale center point
  if (entity.center) {
    entity.center = scalePointAlongAxis(entity.center, pivot, axis, scale);
  }

  // Scale radius if the axis aligns with the dimension
  // (for diameter/radial dimensions)
  if (entity.radius) {
    entity.radius *= scale;
  }

  // Scale insertion point (for text/blocks)
  if (entity.insertionPoint) {
    entity.insertionPoint = scalePointAlongAxis(
      entity.insertionPoint,
      pivot,
      axis,
      scale
    );
  }

  // Scale definition points
  if (entity.defPoint1) {
    entity.defPoint1 = scalePointAlongAxis(entity.defPoint1, pivot, axis, scale);
  }
  if (entity.defPoint2) {
    entity.defPoint2 = scalePointAlongAxis(entity.defPoint2, pivot, axis, scale);
  }
  if (entity.textPosition) {
    entity.textPosition = scalePointAlongAxis(
      entity.textPosition,
      pivot,
      axis,
      scale
    );
  }
}

/**
 * Analyze cascade effects after a primary dimension resize.
 * Finds adjacent dimensions that should shift or resize.
 */
export function analyzeCascade(
  modification: DimensionModification,
  modifiedDim: ParametricDimension,
  allDimensions: ParametricDimension[],
): CascadeSuggestion[] {
  const { pivot, axis, displacement, movingAnchorBefore } = modification;
  if (!pivot || !axis || !displacement || !movingAnchorBefore) return [];

  const displMag = Math.sqrt(displacement.x * displacement.x + displacement.y * displacement.y);
  if (displMag < 0.001) return [];

  // The dimension span (original value) defines our proximity threshold
  const dimSpan = modification.oldValue;
  const maxDist = dimSpan * 2; // Only consider dims within 2x the span

  const suggestions: CascadeSuggestion[] = [];

  for (const dim of allDimensions) {
    if (dim.id === modifiedDim.id) continue;
    // Skip low-confidence dimensions (junk/title block text)
    if (dim.confidence < 0.15) continue;

    // Compute the midpoint and both anchors of this candidate dimension
    const mid = {
      x: (dim.anchorPoints[0].x + dim.anchorPoints[1].x) / 2,
      y: (dim.anchorPoints[0].y + dim.anchorPoints[1].y) / 2,
    };

    // Distance from midpoint to the moving anchor — skip if too far
    const dx = mid.x - movingAnchorBefore.x;
    const dy = mid.y - movingAnchorBefore.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > maxDist) continue;

    // Project both anchors onto the axis relative to the moving anchor
    const proj0 = (dim.anchorPoints[0].x - movingAnchorBefore.x) * axis.x
                 + (dim.anchorPoints[0].y - movingAnchorBefore.y) * axis.y;
    const proj1 = (dim.anchorPoints[1].x - movingAnchorBefore.x) * axis.x
                 + (dim.anchorPoints[1].y - movingAnchorBefore.y) * axis.y;

    // Small tolerance for "near boundary"
    const tol = dimSpan * 0.05;

    const a0Beyond = proj0 > tol;
    const a1Beyond = proj1 > tol;
    const a0Before = proj0 < -tol;
    const a1Before = proj1 < -tol;

    if (a0Beyond && a1Beyond) {
      // Both anchors beyond shift boundary → high confidence shift
      suggestions.push({
        dimensionId: dim.id,
        displayText: dim.displayText,
        action: "shift",
        displacement,
        reason: `Shift ${formatDisplacement(displacement)} (beyond resize boundary)`,
        confidence: "high",
      });
    } else if ((a0Beyond && !a1Before) || (a1Beyond && !a0Before)) {
      // One anchor beyond, other near boundary → medium confidence shift
      suggestions.push({
        dimensionId: dim.id,
        displayText: dim.displayText,
        action: "shift",
        displacement,
        reason: `Likely needs shift ${formatDisplacement(displacement)} (partially beyond boundary)`,
        confidence: "medium",
      });
    } else if ((a0Beyond && a1Before) || (a1Beyond && a0Before)) {
      // Anchors straddle the boundary → this dimension might need resizing
      const dimAxis = {
        x: dim.anchorPoints[1].x - dim.anchorPoints[0].x,
        y: dim.anchorPoints[1].y - dim.anchorPoints[0].y,
      };
      const dimLen = Math.sqrt(dimAxis.x * dimAxis.x + dimAxis.y * dimAxis.y);
      if (dimLen < 0.001) continue;

      // Project displacement onto this dimension's axis to estimate value change
      const projOnDim = (displacement.x * dimAxis.x + displacement.y * dimAxis.y) / dimLen;
      const suggestedNewValue = dim.value + Math.abs(projOnDim);

      suggestions.push({
        dimensionId: dim.id,
        displayText: dim.displayText,
        action: "resize",
        suggestedNewValue,
        reason: `May need resize to ${formatImperialDimension(suggestedNewValue)} (straddles boundary)`,
        confidence: "low",
      });
    }
    // else: both before boundary → skip (unaffected)
  }

  // Sort: high confidence first, then medium, then low
  const order = { high: 0, medium: 1, low: 2 };
  suggestions.sort((a, b) => order[a.confidence] - order[b.confidence]);

  return suggestions;
}

/** Format a displacement vector as a human-readable string */
function formatDisplacement(d: Point2D): string {
  const mag = Math.sqrt(d.x * d.x + d.y * d.y);
  const dir = Math.abs(d.y) > Math.abs(d.x)
    ? (d.y > 0 ? "up" : "down")
    : (d.x > 0 ? "right" : "left");
  return `${dir} ${formatImperialDimension(mag)}`;
}

/**
 * Shift a dimension and its associated geometry by a displacement vector.
 * The dimension VALUE doesn't change — only its POSITION shifts.
 */
export function shiftDimension(
  drawing: ParsedDrawing,
  dimensions: ParametricDimension[],
  dimensionId: string,
  displacement: Point2D,
): { drawing: ParsedDrawing; modification: DimensionModification; dimensions: ParametricDimension[] } {
  const dim = dimensions.find(d => d.id === dimensionId);
  if (!dim) throw new Error(`Dimension ${dimensionId} not found`);

  // Deep clone the entities array
  const newEntities = drawing.entities.map(e => ({ ...e }));
  const affectedHandles: string[] = [];

  // Collect all handles associated with this dimension
  const handleSet = new Set<string>();
  for (const h of dim.geometryHandles) handleSet.add(h);
  for (const h of dim.annotationHandles) handleSet.add(h);
  handleSet.add(dim.textHandle);

  // When geometry handles are sparse, also gather nearby entities via spatial column
  if (handleSet.size < 10) {
    const knownGeo = drawing.entities.filter(e => dim.geometryHandles.includes(e.handle));
    const excludeHandles = new Set([dim.textHandle, ...dim.annotationHandles]);
    const spatialHandles = gatherSpatialColumn(dim, drawing.entities, knownGeo, excludeHandles);
    for (const h of spatialHandles) handleSet.add(h);
  }

  // Translate all associated entities
  for (const entity of newEntities) {
    if (handleSet.has(entity.handle)) {
      translateEntity(entity, displacement);
      affectedHandles.push(entity.handle);
    }
  }

  // Update the dimension's anchor points
  const newDimensions = dimensions.map(d => {
    if (d.id !== dim.id) return d;
    return {
      ...d,
      anchorPoints: [
        { x: d.anchorPoints[0].x + displacement.x, y: d.anchorPoints[0].y + displacement.y },
        { x: d.anchorPoints[1].x + displacement.x, y: d.anchorPoints[1].y + displacement.y },
      ] as [Point2D, Point2D],
    };
  });

  const newDrawing: ParsedDrawing = { ...drawing, entities: newEntities, bounds: recomputeBounds(newEntities) };

  const modification: DimensionModification = {
    dimensionId: dim.id,
    oldValue: dim.value,
    newValue: dim.value, // value doesn't change for shifts
    affectedEntities: affectedHandles,
    scaleFactor: 1,
  };

  return { drawing: newDrawing, modification, dimensions: newDimensions };
}
