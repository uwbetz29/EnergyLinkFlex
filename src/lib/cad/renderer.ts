// Three.js rendering engine for DXF drawings
// Renders pre-flattened entities (INSERT references already expanded by parser)

import * as THREE from "three";
import type {
  ParsedDrawing,
  ParsedEntity,
  CADComponent,
  Point2D,
} from "@/types/cad";
import type { RecognizedComponent } from "@/types/component-recognition";

// Color map for AI-recognized component types
const COMPONENT_TYPE_COLORS: Record<string, string> = {
  stack: "#2563EB",
  silencer: "#16A34A",
  "gas-path": "#EA580C",
  "di-duct": "#9333EA",
  "ta-duct": "#CA8A04",
  "dist-grid-duct": "#0D9488",
  "scr-duct": "#0891B2",
  "inside-liner": "#DC2626",
  nozzle: "#DB2777",
  platform: "#6B7280",
  ladder: "#78716C",
  unknown: "#9CA3AF",
};

// DXF ACI color index to hex (common colors)
const DXF_COLORS: Record<number, string> = {
  0: "#000000", // BYBLOCK
  1: "#FF0000",
  2: "#FFFF00",
  3: "#00FF00",
  4: "#00FFFF",
  5: "#0000FF",
  6: "#FF00FF",
  7: "#222222", // White → dark for light bg
  8: "#808080",
  9: "#C0C0C0",
  10: "#FF0000", 11: "#FF7F7F", 12: "#CC0000",
  20: "#FFAA00", 30: "#FF7F00", 40: "#FF5500",
  50: "#FFFF00", 60: "#BFBF00",
  70: "#00FF00", 80: "#00BF00",
  90: "#00FFFF", 100: "#00BFBF",
  110: "#0000FF", 120: "#0000BF",
  130: "#FF00FF", 140: "#BF00BF",
  150: "#FF007F", 160: "#BF005F",
  170: "#7F0000", 180: "#7F3F00",
  190: "#7F7F00", 200: "#3F7F00",
  210: "#007F00", 220: "#007F3F",
  230: "#007F7F", 240: "#003F7F",
  250: "#333333", 251: "#464646", 252: "#585858",
  253: "#6B6B6B", 254: "#808080", 255: "#EBEBEB",
};

function dxfColorToHex(colorIndex: number | undefined): string {
  if (colorIndex === undefined || colorIndex === null) return "#333333";
  if (colorIndex === 7) return "#222222"; // White in DXF → dark on light bg
  if (colorIndex < 0) return "#333333"; // Negative = layer frozen
  return DXF_COLORS[colorIndex] || "#333333";
}

export class CADRenderer {
  private scene: THREE.Scene;
  private camera: THREE.OrthographicCamera;
  private renderer: THREE.WebGLRenderer;
  private raycaster: THREE.Raycaster;
  private mouse: THREE.Vector2;
  private entityMap: Map<string, THREE.Object3D> = new Map();
  private componentGroups: Map<string, THREE.Group> = new Map();
  private drawing: ParsedDrawing | null = null;
  private previewGroup: THREE.Group | null = null;
  private componentOverlayGroup: THREE.Group | null = null;
  private diffOverlayGroup: THREE.Group | null = null;
  private dimmedHandles: Set<string> = new Set();
  private containerEl: HTMLElement | null = null;
  private isPanning = false;
  private hasPanned = false;
  private panStart: Point2D = { x: 0, y: 0 };
  private cameraStart: Point2D = { x: 0, y: 0 };
  private minimapCanvas: HTMLCanvasElement | null = null;
  private viewChangeCallbacks: Array<() => void> = [];

  constructor() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color("#FFFFFF");

    this.camera = new THREE.OrthographicCamera(-100, 100, 100, -100, -1000, 1000);
    this.camera.position.z = 100;

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.raycaster = new THREE.Raycaster();
    this.raycaster.params.Line = { threshold: 2 };
    this.mouse = new THREE.Vector2();
  }

  mount(container: HTMLElement): void {
    this.containerEl = container;
    const { width, height } = container.getBoundingClientRect();
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(this.renderer.domElement);

    this.renderer.domElement.addEventListener("wheel", this.onWheel);
    this.renderer.domElement.addEventListener("mousedown", this.onMouseDown);
    this.renderer.domElement.addEventListener("mousemove", this.onMouseMove);
    window.addEventListener("mouseup", this.onMouseUp);
    this.renderer.domElement.addEventListener("mouseleave", this.onMouseUp);
    window.addEventListener("resize", this.onResize);
    this.onResize();
  }

  unmount(): void {
    if (this.containerEl) {
      this.renderer.domElement.removeEventListener("wheel", this.onWheel);
      this.renderer.domElement.removeEventListener("mousedown", this.onMouseDown);
      this.renderer.domElement.removeEventListener("mousemove", this.onMouseMove);
      window.removeEventListener("mouseup", this.onMouseUp);
      this.renderer.domElement.removeEventListener("mouseleave", this.onMouseUp);
      window.removeEventListener("resize", this.onResize);
      this.containerEl.removeChild(this.renderer.domElement);
      this.containerEl = null;
    }
    this.renderer.dispose();
  }

  loadDrawing(drawing: ParsedDrawing): void {
    this.drawing = drawing;
    this.clearScene();

    // Build layer lookup for visibility and BYLAYER color resolution
    const layerMap = new Map<string, { color: number; visible: boolean; frozen: boolean }>();
    for (const layer of drawing.layers) {
      layerMap.set(layer.name, layer);
    }

    // Render all entities
    for (const entity of drawing.entities) {
      // Skip entities on frozen layers
      const layerInfo = layerMap.get(entity.layer);
      if (layerInfo?.frozen) continue;

      // Resolve color: prefer direct hex (PDF), then DXF index, then layer
      let resolvedColor: string;
      if (entity.colorHex) {
        resolvedColor = entity.colorHex;
      } else if (entity.color === undefined || entity.color === 256) {
        resolvedColor = dxfColorToHex(layerInfo?.color);
      } else {
        resolvedColor = dxfColorToHex(entity.color);
      }

      const obj = this.createObject(entity, resolvedColor);
      if (obj) {
        obj.userData = { handle: entity.handle, layer: entity.layer, type: entity.type };
        this.scene.add(obj);
        this.entityMap.set(entity.handle, obj);
      }
    }

    // Create component overlay groups
    for (const component of drawing.components) {
      const group = new THREE.Group();
      group.userData = { componentId: component.id, componentName: component.name };
      this.componentGroups.set(component.id, group);

      const bb = component.boundingBox;
      const geometry = new THREE.BufferGeometry();
      const vertices = new Float32Array([
        bb.min.x, bb.min.y, 0,
        bb.max.x, bb.min.y, 0,
        bb.max.x, bb.max.y, 0,
        bb.min.x, bb.max.y, 0,
        bb.min.x, bb.min.y, 0,
      ]);
      geometry.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
      const line = new THREE.Line(
        geometry,
        new THREE.LineBasicMaterial({ color: component.color, transparent: true, opacity: 0 })
      );
      line.userData = { componentId: component.id, isOverlay: true };
      group.add(line);
      this.scene.add(group);
    }

    this.fitToView();
    this.render();
  }

  /**
   * Re-render the drawing with updated entities but keep the camera position.
   * Used after dimension changes so the view doesn't snap back to full extent.
   */
  updateDrawing(drawing: ParsedDrawing): void {
    // Save camera state
    const cam = this.camera;
    const savedLeft = cam.left;
    const savedRight = cam.right;
    const savedTop = cam.top;
    const savedBottom = cam.bottom;
    const savedX = cam.position.x;
    const savedY = cam.position.y;

    // Full rebuild (clears scene, re-adds entities + components)
    this.drawing = drawing;
    this.clearScene();

    const layerMap = new Map<string, { color: number; visible: boolean; frozen: boolean }>();
    for (const layer of drawing.layers) {
      layerMap.set(layer.name, layer);
    }

    for (const entity of drawing.entities) {
      const layerInfo = layerMap.get(entity.layer);
      if (layerInfo?.frozen) continue;

      let resolvedColor: string;
      if (entity.color === undefined || entity.color === 256) {
        resolvedColor = dxfColorToHex(layerInfo?.color);
      } else {
        resolvedColor = dxfColorToHex(entity.color);
      }

      const obj = this.createObject(entity, resolvedColor);
      if (obj) {
        obj.userData = { handle: entity.handle, layer: entity.layer, type: entity.type };
        this.scene.add(obj);
        this.entityMap.set(entity.handle, obj);
      }
    }

    for (const component of drawing.components) {
      const group = new THREE.Group();
      group.userData = { componentId: component.id, componentName: component.name };
      this.componentGroups.set(component.id, group);

      const bb = component.boundingBox;
      const geometry = new THREE.BufferGeometry();
      const vertices = new Float32Array([
        bb.min.x, bb.min.y, 0,
        bb.max.x, bb.min.y, 0,
        bb.max.x, bb.max.y, 0,
        bb.min.x, bb.max.y, 0,
        bb.min.x, bb.min.y, 0,
      ]);
      geometry.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
      const line = new THREE.Line(
        geometry,
        new THREE.LineBasicMaterial({ color: component.color, transparent: true, opacity: 0 })
      );
      line.userData = { componentId: component.id, isOverlay: true };
      group.add(line);
      this.scene.add(group);
    }

    // Restore camera state (no fitToView)
    cam.left = savedLeft;
    cam.right = savedRight;
    cam.top = savedTop;
    cam.bottom = savedBottom;
    cam.position.x = savedX;
    cam.position.y = savedY;
    cam.updateProjectionMatrix();
    this.render();
  }

  private createObject(entity: ParsedEntity, resolvedColor?: string): THREE.Object3D | null {
    const color = resolvedColor || dxfColorToHex(entity.color);

    switch (entity.type) {
      case "LINE":
        return this.createLine(entity, color);
      case "LWPOLYLINE":
      case "POLYLINE":
        return this.createPolyline(entity, color);
      case "CIRCLE":
        return this.createCircle(entity, color);
      case "ARC":
        return this.createArc(entity, color);
      case "ELLIPSE":
        return this.createEllipse(entity, color);
      case "SPLINE":
        return this.createSpline(entity, color);
      case "TEXT":
      case "MTEXT":
        return this.createText(entity, color);
      case "SOLID":
      case "3DFACE":
        return this.createSolid(entity, color);
      case "LEADER":
        return this.createLine(entity, color);
      case "DIMENSION":
        return this.createDimensionFallback(entity, color);
      case "POINT":
        return this.createPoint(entity, color);
      case "TRACE":
        return this.createSolid(entity, color);
      default:
        return null;
    }
  }

  private createLine(entity: ParsedEntity, color: string): THREE.Line | null {
    if (!entity.vertices || entity.vertices.length < 2) return null;
    const geometry = new THREE.BufferGeometry();
    const verts = new Float32Array(entity.vertices.flatMap((v) => [v.x, v.y, 0]));
    geometry.setAttribute("position", new THREE.BufferAttribute(verts, 3));
    return new THREE.Line(geometry, new THREE.LineBasicMaterial({ color }));
  }

  private createPolyline(entity: ParsedEntity, color: string): THREE.Object3D | null {
    if (!entity.vertices || entity.vertices.length < 2) return null;

    // If there are bulges, we need to handle curved segments
    if (entity.bulges && entity.bulges.some((b) => b !== 0)) {
      return this.createBulgePolyline(entity, color);
    }

    const pts = [...entity.vertices];
    if (entity.closed && pts.length > 2) {
      pts.push(pts[0]); // Close the polyline
    }

    const geometry = new THREE.BufferGeometry();
    const verts = new Float32Array(pts.flatMap((v) => [v.x, v.y, 0]));
    geometry.setAttribute("position", new THREE.BufferAttribute(verts, 3));
    return new THREE.Line(geometry, new THREE.LineBasicMaterial({ color }));
  }

  private createBulgePolyline(entity: ParsedEntity, color: string): THREE.Line | null {
    if (!entity.vertices || !entity.bulges) return null;

    const allPoints: number[] = [];
    const verts = entity.vertices;
    const bulges = entity.bulges;
    const len = entity.closed ? verts.length : verts.length - 1;

    for (let i = 0; i < len; i++) {
      const p1 = verts[i];
      const p2 = verts[(i + 1) % verts.length];
      const bulge = bulges[i] || 0;

      if (Math.abs(bulge) < 1e-6) {
        // Straight segment
        allPoints.push(p1.x, p1.y, 0);
      } else {
        // Arc segment defined by bulge
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        const s = d / 2;
        const r = Math.abs(s * (1 + bulge * bulge) / (2 * bulge));
        const a = Math.atan2(dy, dx);
        const midX = (p1.x + p2.x) / 2;
        const midY = (p1.y + p2.y) / 2;
        const sagitta = bulge * s;
        const cx = midX - sagitta * Math.sin(a);
        const cy = midY + sagitta * Math.cos(a);

        const startAngle = Math.atan2(p1.y - cy, p1.x - cx);
        const endAngle = Math.atan2(p2.y - cy, p2.x - cx);
        let sweep = endAngle - startAngle;
        if (bulge > 0 && sweep < 0) sweep += 2 * Math.PI;
        if (bulge < 0 && sweep > 0) sweep -= 2 * Math.PI;

        const segments = Math.max(8, Math.floor(Math.abs(sweep) * 16));
        for (let j = 0; j <= segments; j++) {
          const angle = startAngle + (j / segments) * sweep;
          allPoints.push(
            cx + r * Math.cos(angle),
            cy + r * Math.sin(angle),
            0
          );
        }
      }
    }

    // Add the last point if not closed
    if (!entity.closed && verts.length > 0) {
      const last = verts[verts.length - 1];
      allPoints.push(last.x, last.y, 0);
    }

    if (allPoints.length < 6) return null;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(allPoints), 3));
    return new THREE.Line(geometry, new THREE.LineBasicMaterial({ color }));
  }

  private createCircle(entity: ParsedEntity, color: string): THREE.Line | null {
    if (!entity.center || !entity.radius) return null;
    const segments = 64;
    const geometry = new THREE.BufferGeometry();
    const verts = new Float32Array((segments + 1) * 3);
    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      verts[i * 3] = entity.center.x + Math.cos(angle) * entity.radius;
      verts[i * 3 + 1] = entity.center.y + Math.sin(angle) * entity.radius;
      verts[i * 3 + 2] = 0;
    }
    geometry.setAttribute("position", new THREE.BufferAttribute(verts, 3));
    return new THREE.Line(geometry, new THREE.LineBasicMaterial({ color }));
  }

  private createArc(entity: ParsedEntity, color: string): THREE.Line | null {
    if (!entity.center || !entity.radius) return null;
    const startAngle = ((entity.startAngle || 0) * Math.PI) / 180;
    const endAngle = ((entity.endAngle || 360) * Math.PI) / 180;
    let angleDiff = endAngle - startAngle;
    if (angleDiff < 0) angleDiff += Math.PI * 2;
    if (angleDiff > Math.PI * 2) angleDiff -= Math.PI * 2;

    const segments = Math.max(16, Math.floor(angleDiff * 32));
    const geometry = new THREE.BufferGeometry();
    const verts = new Float32Array((segments + 1) * 3);
    for (let i = 0; i <= segments; i++) {
      const angle = startAngle + (i / segments) * angleDiff;
      verts[i * 3] = entity.center.x + Math.cos(angle) * entity.radius;
      verts[i * 3 + 1] = entity.center.y + Math.sin(angle) * entity.radius;
      verts[i * 3 + 2] = 0;
    }
    geometry.setAttribute("position", new THREE.BufferAttribute(verts, 3));
    return new THREE.Line(geometry, new THREE.LineBasicMaterial({ color }));
  }

  private createEllipse(entity: ParsedEntity, color: string): THREE.Line | null {
    if (!entity.center || !entity.majorAxisEnd) return null;

    const cx = entity.center.x;
    const cy = entity.center.y;
    const mx = entity.majorAxisEnd.x;
    const my = entity.majorAxisEnd.y;
    const ratio = entity.axisRatio ?? 1;

    const majorLen = Math.sqrt(mx * mx + my * my);
    const minorLen = majorLen * ratio;
    const rotation = Math.atan2(my, mx);

    // startAngle/endAngle for ellipses are in radians (eccentric anomaly)
    const sa = entity.startAngle ?? 0;
    const ea = entity.endAngle ?? Math.PI * 2;
    let sweep = ea - sa;
    if (sweep < 0) sweep += Math.PI * 2;

    const segments = 64;
    const geometry = new THREE.BufferGeometry();
    const verts = new Float32Array((segments + 1) * 3);

    for (let i = 0; i <= segments; i++) {
      const t = sa + (i / segments) * sweep;
      const lx = majorLen * Math.cos(t);
      const ly = minorLen * Math.sin(t);
      // Rotate to the ellipse's axis
      verts[i * 3] = cx + lx * Math.cos(rotation) - ly * Math.sin(rotation);
      verts[i * 3 + 1] = cy + lx * Math.sin(rotation) + ly * Math.cos(rotation);
      verts[i * 3 + 2] = 0;
    }

    geometry.setAttribute("position", new THREE.BufferAttribute(verts, 3));
    return new THREE.Line(geometry, new THREE.LineBasicMaterial({ color }));
  }

  private createSpline(entity: ParsedEntity, color: string): THREE.Line | null {
    if (!entity.vertices || entity.vertices.length < 2) return null;

    // For fit points or low-degree splines, interpolate with Catmull-Rom
    const pts = entity.vertices;
    if (pts.length <= 3) {
      // Not enough points to interpolate, just connect them
      const geometry = new THREE.BufferGeometry();
      const verts = new Float32Array(pts.flatMap((v) => [v.x, v.y, 0]));
      geometry.setAttribute("position", new THREE.BufferAttribute(verts, 3));
      return new THREE.Line(geometry, new THREE.LineBasicMaterial({ color }));
    }

    // Use Catmull-Rom interpolation for smooth curves
    const curve = new THREE.CatmullRomCurve3(
      pts.map((p) => new THREE.Vector3(p.x, p.y, 0)),
      false
    );
    const points = curve.getPoints(pts.length * 8);
    const geometry = new THREE.BufferGeometry();
    const verts = new Float32Array(points.flatMap((p) => [p.x, p.y, p.z]));
    geometry.setAttribute("position", new THREE.BufferAttribute(verts, 3));
    return new THREE.Line(geometry, new THREE.LineBasicMaterial({ color }));
  }

  private createText(entity: ParsedEntity, _color: string): THREE.Sprite | null {
    if (!entity.text || !entity.insertionPoint) return null;

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    // Use text height from entity to determine font size
    const textHeight = entity.textHeight || 0.1;
    const displayText = entity.text.replace(/\n/g, " ");

    // Create canvas sized for the text
    const pixelsPerUnit = 100; // Higher = more detail
    const fontSize = Math.max(12, Math.round(textHeight * pixelsPerUnit));
    ctx.font = `${fontSize}px sans-serif`;
    const metrics = ctx.measureText(displayText);

    canvas.width = Math.min(4096, Math.ceil(metrics.width) + 4);
    canvas.height = Math.ceil(fontSize * 1.3);

    // Re-set font after resize
    ctx.font = `${fontSize}px sans-serif`;
    ctx.fillStyle = "#333333";
    ctx.textBaseline = "bottom";
    ctx.fillText(displayText, 2, canvas.height - 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;

    const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
    const sprite = new THREE.Sprite(material);
    sprite.position.set(entity.insertionPoint.x, entity.insertionPoint.y, 1);

    // Scale sprite to match world units
    const worldWidth = (canvas.width / pixelsPerUnit) * (textHeight / (fontSize / pixelsPerUnit));
    const worldHeight = (canvas.height / pixelsPerUnit) * (textHeight / (fontSize / pixelsPerUnit));
    sprite.scale.set(worldWidth, worldHeight, 1);

    // Offset so text is anchored at bottom-left (not center)
    sprite.center.set(0, 0);

    return sprite;
  }

  private createSolid(entity: ParsedEntity, color: string): THREE.Line | null {
    if (!entity.vertices || entity.vertices.length < 3) return null;

    // SOLID entities have a specific vertex order: 1, 2, 4, 3 (swapped last two)
    const pts = [...entity.vertices];
    if (pts.length === 4) {
      // Swap to get correct rendering order
      const temp = pts[2];
      pts[2] = pts[3];
      pts[3] = temp;
    }
    pts.push(pts[0]); // Close

    const geometry = new THREE.BufferGeometry();
    const verts = new Float32Array(pts.flatMap((v) => [v.x, v.y, 0]));
    geometry.setAttribute("position", new THREE.BufferAttribute(verts, 3));
    return new THREE.Line(geometry, new THREE.LineBasicMaterial({ color }));
  }

  private createDimensionFallback(entity: ParsedEntity, color: string): THREE.Object3D | null {
    // The main dimension visuals come from the expanded block in the parser.
    // This fallback draws a line between definition point and text position
    // if the block wasn't found or expanded.
    const points: Point2D[] = [];
    if (entity.defPoint1) points.push(entity.defPoint1);
    if (entity.textPosition) points.push(entity.textPosition);
    if (points.length < 2) return null;

    const geometry = new THREE.BufferGeometry();
    const verts = new Float32Array(points.flatMap((v) => [v.x, v.y, 0]));
    geometry.setAttribute("position", new THREE.BufferAttribute(verts, 3));
    return new THREE.Line(
      geometry,
      new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.5 })
    );
  }

  private createPoint(entity: ParsedEntity, color: string): THREE.Object3D | null {
    if (!entity.vertices || entity.vertices.length < 1) return null;
    const p = entity.vertices[0];
    // Render as a small cross marker
    const s = 0.5;
    const geometry = new THREE.BufferGeometry();
    const verts = new Float32Array([
      p.x - s, p.y, 0, p.x + s, p.y, 0,
      p.x, p.y - s, 0, p.x, p.y + s, 0,
    ]);
    geometry.setAttribute("position", new THREE.BufferAttribute(verts, 3));
    return new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color }));
  }

  /** Resolve an entity's display color, handling BYLAYER (256) and direct hex */
  private resolveEntityColor(entity: ParsedEntity): string {
    if (entity.colorHex) return entity.colorHex;
    if (entity.color === undefined || entity.color === 256) {
      const layer = this.drawing?.layers.find((l) => l.name === entity.layer);
      return dxfColorToHex(layer?.color);
    }
    return dxfColorToHex(entity.color);
  }

  fitToView(): void {
    if (!this.drawing || !this.containerEl) return;
    const { bounds } = this.drawing;
    const { width, height } = this.containerEl.getBoundingClientRect();

    const drawingWidth = bounds.max.x - bounds.min.x;
    const drawingHeight = bounds.max.y - bounds.min.y;
    const centerX = (bounds.min.x + bounds.max.x) / 2;
    const centerY = (bounds.min.y + bounds.max.y) / 2;

    const aspect = width / height;
    const padding = 1.05;

    let viewWidth, viewHeight;
    if (drawingWidth / drawingHeight > aspect) {
      viewWidth = (drawingWidth * padding) / 2;
      viewHeight = viewWidth / aspect;
    } else {
      viewHeight = (drawingHeight * padding) / 2;
      viewWidth = viewHeight * aspect;
    }

    this.camera.left = centerX - viewWidth;
    this.camera.right = centerX + viewWidth;
    this.camera.top = centerY + viewHeight;
    this.camera.bottom = centerY - viewHeight;
    this.camera.updateProjectionMatrix();
    this.render();
  }

  highlightComponent(componentId: string | null, color?: string): void {
    const highlightColor = color || "#93C90F";

    for (const [id, group] of this.componentGroups) {
      group.traverse((child) => {
        if (child instanceof THREE.Line && child.userData.isOverlay) {
          const mat = child.material as THREE.LineBasicMaterial;
          if (id === componentId) {
            mat.opacity = 0.8;
            mat.color.set(highlightColor);
          } else {
            mat.opacity = 0;
          }
        }
      });
    }

    if (this.drawing) {
      const component = this.drawing.components.find((c) => c.id === componentId);
      const handles = new Set(component?.entityHandles || []);

      for (const [handle, obj] of this.entityMap) {
        obj.traverse((child) => {
          if (child instanceof THREE.Line) {
            const mat = child.material as THREE.LineBasicMaterial;
            if (componentId && handles.has(handle)) {
              mat.color.set(highlightColor);
            } else {
              const ent = this.drawing?.entities.find((e) => e.handle === handle);
              const entityColor = ent ? this.resolveEntityColor(ent) : "#333333";
              mat.color.set(entityColor);
            }
          }
        });
      }
    }
    this.render();
  }

  getComponentAtPoint(screenX: number, screenY: number): string | null {
    if (!this.containerEl || !this.drawing) return null;

    const rect = this.containerEl.getBoundingClientRect();
    this.mouse.x = ((screenX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((screenY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);
    const intersects = this.raycaster.intersectObjects(this.scene.children, true);

    for (const intersect of intersects) {
      const handle = intersect.object.userData?.handle;
      if (handle) {
        for (const component of this.drawing.components) {
          if (component.entityHandles.includes(handle)) {
            return component.id;
          }
        }
      }
    }

    return null;
  }

  screenToWorld(screenX: number, screenY: number): Point2D {
    if (!this.containerEl) return { x: 0, y: 0 };
    const rect = this.containerEl.getBoundingClientRect();
    const ndcX = ((screenX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((screenY - rect.top) / rect.height) * 2 + 1;

    return {
      x: ((ndcX + 1) / 2) * (this.camera.right - this.camera.left) + this.camera.left,
      y: ((ndcY + 1) / 2) * (this.camera.top - this.camera.bottom) + this.camera.bottom,
    };
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  private clearScene(): void {
    while (this.scene.children.length > 0) {
      const obj = this.scene.children[0];
      this.scene.remove(obj);
      if (obj instanceof THREE.Mesh || obj instanceof THREE.Line) {
        obj.geometry?.dispose();
      }
    }
    this.entityMap.clear();
    this.componentGroups.clear();
    this.componentOverlayGroup = null;
    this.diffOverlayGroup = null;
  }

  // --- Event handlers ---

  private onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const zoomFactor = event.deltaY > 0 ? 1.1 : 0.9;

    // Zoom toward cursor position
    if (this.containerEl) {
      const rect = this.containerEl.getBoundingClientRect();
      const mouseX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      const mouseY = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      const worldX = ((mouseX + 1) / 2) * (this.camera.right - this.camera.left) + this.camera.left;
      const worldY = ((mouseY + 1) / 2) * (this.camera.top - this.camera.bottom) + this.camera.bottom;

      const newLeft = worldX + (this.camera.left - worldX) * zoomFactor;
      const newRight = worldX + (this.camera.right - worldX) * zoomFactor;
      const newTop = worldY + (this.camera.top - worldY) * zoomFactor;
      const newBottom = worldY + (this.camera.bottom - worldY) * zoomFactor;

      this.camera.left = newLeft;
      this.camera.right = newRight;
      this.camera.top = newTop;
      this.camera.bottom = newBottom;
    } else {
      const centerX = (this.camera.left + this.camera.right) / 2;
      const centerY = (this.camera.top + this.camera.bottom) / 2;
      const halfWidth = (this.camera.right - this.camera.left) / 2;
      const halfHeight = (this.camera.top - this.camera.bottom) / 2;
      this.camera.left = centerX - halfWidth * zoomFactor;
      this.camera.right = centerX + halfWidth * zoomFactor;
      this.camera.top = centerY + halfHeight * zoomFactor;
      this.camera.bottom = centerY - halfHeight * zoomFactor;
    }

    this.camera.updateProjectionMatrix();
    this.render();
    this.notifyViewChange();
  };

  private onMouseDown = (event: MouseEvent): void => {
    // Left click or middle click starts panning
    if (event.button === 0 || event.button === 1) {
      this.isPanning = true;
      this.hasPanned = false;
      this.panStart = { x: event.clientX, y: event.clientY };
      this.cameraStart = {
        x: (this.camera.left + this.camera.right) / 2,
        y: (this.camera.top + this.camera.bottom) / 2,
      };
    }
  };

  private onMouseMove = (event: MouseEvent): void => {
    if (this.isPanning && this.containerEl) {
      const dx = event.clientX - this.panStart.x;
      const dy = event.clientY - this.panStart.y;

      // Only start panning after a small threshold to allow clicks
      if (!this.hasPanned && Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
      this.hasPanned = true;
      this.renderer.domElement.style.cursor = "grabbing";

      const rect = this.containerEl.getBoundingClientRect();
      const worldWidth = this.camera.right - this.camera.left;
      const worldHeight = this.camera.top - this.camera.bottom;

      const worldDx = (-dx / rect.width) * worldWidth;
      const worldDy = (dy / rect.height) * worldHeight;

      const halfWidth = worldWidth / 2;
      const halfHeight = worldHeight / 2;
      const newCenterX = this.cameraStart.x + worldDx;
      const newCenterY = this.cameraStart.y + worldDy;

      this.camera.left = newCenterX - halfWidth;
      this.camera.right = newCenterX + halfWidth;
      this.camera.top = newCenterY + halfHeight;
      this.camera.bottom = newCenterY - halfHeight;
      this.camera.updateProjectionMatrix();
      this.render();
      this.notifyViewChange();
    }
  };

  private onMouseUp = (): void => {
    this.isPanning = false;
    this.renderer.domElement.style.cursor = "default";
  };

  /** Returns true if the user just finished a drag (not a click) */
  didPan(): boolean {
    return this.hasPanned;
  }

  private onResize = (): void => {
    if (!this.containerEl) return;
    const { width, height } = this.containerEl.getBoundingClientRect();
    this.renderer.setSize(width, height);
    if (this.drawing) {
      this.fitToView();
    }
    this.render();
    this.notifyViewChange();
  };

  // --- Minimap support ---

  onViewChange(callback: () => void): void {
    this.viewChangeCallbacks.push(callback);
  }

  removeViewChangeCallback(callback: () => void): void {
    this.viewChangeCallbacks = this.viewChangeCallbacks.filter((cb) => cb !== callback);
  }

  private notifyViewChange(): void {
    for (const cb of this.viewChangeCallbacks) cb();
  }

  /** Returns the current viewport rect in world coordinates */
  getViewport(): { left: number; right: number; top: number; bottom: number } {
    return {
      left: this.camera.left,
      right: this.camera.right,
      top: this.camera.top,
      bottom: this.camera.bottom,
    };
  }

  /** Pan the camera to center on a world-coordinate point */
  panTo(worldX: number, worldY: number): void {
    const halfW = (this.camera.right - this.camera.left) / 2;
    const halfH = (this.camera.top - this.camera.bottom) / 2;
    this.camera.left = worldX - halfW;
    this.camera.right = worldX + halfW;
    this.camera.top = worldY + halfH;
    this.camera.bottom = worldY - halfH;
    this.camera.updateProjectionMatrix();
    this.render();
    this.notifyViewChange();
  }

  /** Render a thumbnail of the full drawing onto a minimap canvas */
  renderMinimap(canvas: HTMLCanvasElement): void {
    if (!this.drawing) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { bounds } = this.drawing;
    const dw = bounds.max.x - bounds.min.x;
    const dh = bounds.max.y - bounds.min.y;
    if (dw === 0 || dh === 0) return;

    const cw = canvas.width;
    const ch = canvas.height;
    const padding = 0.05;

    // Compute scale to fit drawing into canvas
    const scaleX = cw / (dw * (1 + padding * 2));
    const scaleY = ch / (dh * (1 + padding * 2));
    const scale = Math.min(scaleX, scaleY);

    const offsetX = (cw - dw * scale) / 2 - bounds.min.x * scale;
    const offsetY = (ch - dh * scale) / 2 + bounds.max.y * scale; // Y flipped

    ctx.clearRect(0, 0, cw, ch);

    // Draw background
    ctx.fillStyle = "#F8F8F8";
    ctx.fillRect(0, 0, cw, ch);

    // Draw entities (simplified — lines only for performance)
    ctx.strokeStyle = "#999";
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    for (const entity of this.drawing.entities) {
      if (entity.vertices && entity.vertices.length >= 2) {
        const v0 = entity.vertices[0];
        ctx.moveTo(v0.x * scale + offsetX, -v0.y * scale + offsetY);
        for (let i = 1; i < entity.vertices.length; i++) {
          const v = entity.vertices[i];
          ctx.lineTo(v.x * scale + offsetX, -v.y * scale + offsetY);
        }
      } else if (entity.center && entity.radius) {
        const cx = entity.center.x * scale + offsetX;
        const cy = -entity.center.y * scale + offsetY;
        const r = entity.radius * scale;
        ctx.moveTo(cx + r, cy);
        ctx.arc(cx, cy, Math.max(0.5, r), 0, Math.PI * 2);
      }
    }
    ctx.stroke();

    // Draw viewport rectangle
    const vp = this.getViewport();
    const vpX = vp.left * scale + offsetX;
    const vpY = -vp.top * scale + offsetY;
    const vpW = (vp.right - vp.left) * scale;
    const vpH = (vp.top - vp.bottom) * scale;

    ctx.strokeStyle = "#3B82F6";
    ctx.lineWidth = 2;
    ctx.strokeRect(vpX, vpY, vpW, vpH);
    ctx.fillStyle = "rgba(59, 130, 246, 0.08)";
    ctx.fillRect(vpX, vpY, vpW, vpH);
  }

  /**
   * Flash a set of entities with a highlight color, then restore original colors.
   * Provides visual feedback after a dimension edit.
   */
  flashEntities(handles: string[], color = "#FF6600", durationMs = 1500): void {
    const originals = new Map<string, THREE.Color>();

    for (const handle of handles) {
      const obj = this.entityMap.get(handle);
      if (!obj) continue;
      obj.traverse((child) => {
        if (child instanceof THREE.Line) {
          const mat = child.material as THREE.LineBasicMaterial;
          if (!originals.has(handle)) {
            originals.set(handle, mat.color.clone());
          }
          mat.color.set(color);
        }
      });
    }

    this.render();

    // Restore after delay
    setTimeout(() => {
      for (const handle of handles) {
        const obj = this.entityMap.get(handle);
        const orig = originals.get(handle);
        if (!obj || !orig) continue;
        obj.traverse((child) => {
          if (child instanceof THREE.Line) {
            const mat = child.material as THREE.LineBasicMaterial;
            // Restore to actual entity color (not just saved, since updateDrawing may have rebuilt)
            const ent = this.drawing?.entities.find((e) => e.handle === handle);
            if (ent) {
              mat.color.set(this.resolveEntityColor(ent));
            } else {
              mat.color.copy(orig);
            }
          }
        });
      }
      this.render();
    }, durationMs);
  }

  /**
   * Show a ghost preview of where entities will move after a dimension change.
   * Dims originals to 30% opacity and adds green preview copies.
   */
  showPreview(previewEntities: ParsedEntity[], affectedHandles: string[]): void {
    this.clearPreview();

    const group = new THREE.Group();
    group.userData = { isPreview: true };

    // Dim original entities
    for (const handle of affectedHandles) {
      const obj = this.entityMap.get(handle);
      if (!obj) continue;
      obj.traverse((child) => {
        if (child instanceof THREE.Line || child instanceof THREE.LineSegments) {
          const mat = child.material as THREE.LineBasicMaterial;
          mat.transparent = true;
          mat.opacity = 0.25;
        } else if (child instanceof THREE.Sprite) {
          const mat = child.material as THREE.SpriteMaterial;
          mat.opacity = 0.25;
        }
      });
      this.dimmedHandles.add(handle);
    }

    // Create preview objects
    const previewColor = "#93C90F";
    for (const entity of previewEntities) {
      if (!affectedHandles.includes(entity.handle)) continue;
      const obj = this.createObject(entity, previewColor);
      if (obj) {
        obj.traverse((child) => {
          if (child instanceof THREE.Line || child instanceof THREE.LineSegments) {
            const mat = child.material as THREE.LineBasicMaterial;
            mat.transparent = true;
            mat.opacity = 0.5;
          }
        });
        group.add(obj);
      }
    }

    this.previewGroup = group;
    this.scene.add(group);
    this.render();
  }

  /**
   * Clear preview overlay and restore original entity opacity.
   */
  clearPreview(): void {
    // Remove preview group
    if (this.previewGroup) {
      this.scene.remove(this.previewGroup);
      this.previewGroup.traverse((child) => {
        if (child instanceof THREE.Line || child instanceof THREE.LineSegments) {
          child.geometry?.dispose();
        }
      });
      this.previewGroup = null;
    }

    // Restore dimmed entities
    for (const handle of this.dimmedHandles) {
      const obj = this.entityMap.get(handle);
      if (!obj) continue;
      obj.traverse((child) => {
        if (child instanceof THREE.Line || child instanceof THREE.LineSegments) {
          const mat = child.material as THREE.LineBasicMaterial;
          mat.opacity = 1;
          mat.transparent = false;
        } else if (child instanceof THREE.Sprite) {
          const mat = child.material as THREE.SpriteMaterial;
          mat.opacity = 1;
        }
      });
    }
    this.dimmedHandles.clear();

    if (this.drawing) this.render();
  }

  /** Convert world coordinates to screen pixel coordinates */
  worldToScreen(worldX: number, worldY: number): Point2D | null {
    if (!this.containerEl) return null;
    const rect = this.containerEl.getBoundingClientRect();
    const ndcX =
      ((worldX - this.camera.left) / (this.camera.right - this.camera.left)) * 2 - 1;
    const ndcY =
      ((worldY - this.camera.bottom) / (this.camera.top - this.camera.bottom)) * 2 - 1;
    return {
      x: ((ndcX + 1) / 2) * rect.width,
      y: ((1 - ndcY) / 2) * rect.height,
    };
  }

  // --- Component Bounding Box Overlay (Feature 1) ---

  showComponentBoxes(components: RecognizedComponent[]): void {
    this.clearComponentBoxes();

    const group = new THREE.Group();
    group.userData = { isComponentOverlay: true };

    for (const comp of components) {
      const bb = comp.boundingBox;
      const color = COMPONENT_TYPE_COLORS[comp.type] || COMPONENT_TYPE_COLORS.unknown;

      // Outline rectangle (z=2 to float above entities)
      const rectGeo = new THREE.BufferGeometry();
      const verts = new Float32Array([
        bb.minX, bb.minY, 2, bb.maxX, bb.minY, 2,
        bb.maxX, bb.maxY, 2, bb.minX, bb.maxY, 2,
        bb.minX, bb.minY, 2,
      ]);
      rectGeo.setAttribute("position", new THREE.BufferAttribute(verts, 3));
      group.add(new THREE.Line(rectGeo, new THREE.LineBasicMaterial({
        color, transparent: true, opacity: 0.7,
      })));

      // Semi-transparent fill
      const fillGeo = new THREE.PlaneGeometry(bb.maxX - bb.minX, bb.maxY - bb.minY);
      const fill = new THREE.Mesh(fillGeo, new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: 0.06, side: THREE.DoubleSide,
      }));
      fill.position.set((bb.minX + bb.maxX) / 2, (bb.minY + bb.maxY) / 2, 1.5);
      group.add(fill);

      // Text label sprite above the box
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (ctx) {
        const label = comp.label;
        ctx.font = "bold 28px sans-serif";
        const metrics = ctx.measureText(label);
        canvas.width = Math.ceil(metrics.width) + 12;
        canvas.height = 36;
        ctx.font = "bold 28px sans-serif";
        ctx.fillStyle = color;
        ctx.fillText(label, 6, 28);

        const texture = new THREE.CanvasTexture(canvas);
        texture.minFilter = THREE.LinearFilter;
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true }));
        const boxWidth = bb.maxX - bb.minX;
        const scale = Math.max(boxWidth * 0.25, 5);
        sprite.scale.set(scale * (canvas.width / canvas.height), scale, 1);
        sprite.position.set((bb.minX + bb.maxX) / 2, bb.maxY + scale * 0.6, 2);
        sprite.center.set(0.5, 0);
        group.add(sprite);
      }
    }

    this.componentOverlayGroup = group;
    this.scene.add(group);
    this.render();
  }

  clearComponentBoxes(): void {
    if (this.componentOverlayGroup) {
      this.scene.remove(this.componentOverlayGroup);
      this.componentOverlayGroup.traverse((child) => {
        if (child instanceof THREE.Line || child instanceof THREE.Mesh) {
          child.geometry?.dispose();
        }
      });
      this.componentOverlayGroup = null;
      this.render();
    }
  }

  // --- Visual Diff Overlay (Feature 3) ---

  showDiffOverlay(originalEntities: ParsedEntity[], currentEntities: ParsedEntity[]): void {
    this.clearDiffOverlay();

    const group = new THREE.Group();
    group.userData = { isDiffOverlay: true };

    // Index current entities by handle for comparison
    const currentMap = new Map(currentEntities.map(e => [e.handle, e]));

    for (const orig of originalEntities) {
      const current = currentMap.get(orig.handle);
      if (!current) continue;

      // Check if entity moved or changed
      const changed = this.entityDiffers(orig, current);
      if (!changed) continue;

      // Draw original position in red dashed
      const obj = this.createObject(orig, "#FF0000");
      if (obj) {
        obj.traverse((child) => {
          if (child instanceof THREE.Line || child instanceof THREE.LineSegments) {
            const mat = child.material as THREE.LineBasicMaterial;
            mat.transparent = true;
            mat.opacity = 0.4;
          }
        });
        obj.position.z = 1.5;
        group.add(obj);
      }
    }

    this.diffOverlayGroup = group;
    this.scene.add(group);
    this.render();
  }

  clearDiffOverlay(): void {
    if (this.diffOverlayGroup) {
      this.scene.remove(this.diffOverlayGroup);
      this.diffOverlayGroup.traverse((child) => {
        if (child instanceof THREE.Line || child instanceof THREE.Mesh) {
          child.geometry?.dispose();
        }
      });
      this.diffOverlayGroup = null;
      this.render();
    }
  }

  /** Check if two entities have different geometry */
  private entityDiffers(a: ParsedEntity, b: ParsedEntity): boolean {
    if (a.vertices && b.vertices) {
      if (a.vertices.length !== b.vertices.length) return true;
      for (let i = 0; i < a.vertices.length; i++) {
        if (Math.abs(a.vertices[i].x - b.vertices[i].x) > 0.01 ||
            Math.abs(a.vertices[i].y - b.vertices[i].y) > 0.01) return true;
      }
    }
    if (a.center && b.center) {
      if (Math.abs(a.center.x - b.center.x) > 0.01 ||
          Math.abs(a.center.y - b.center.y) > 0.01) return true;
    }
    if (a.insertionPoint && b.insertionPoint) {
      if (Math.abs(a.insertionPoint.x - b.insertionPoint.x) > 0.01 ||
          Math.abs(a.insertionPoint.y - b.insertionPoint.y) > 0.01) return true;
    }
    return false;
  }

  /** Convert minimap pixel coords to world coords for click-to-pan */
  minimapToWorld(canvasX: number, canvasY: number, canvas: HTMLCanvasElement): Point2D {
    if (!this.drawing) return { x: 0, y: 0 };
    const { bounds } = this.drawing;
    const dw = bounds.max.x - bounds.min.x;
    const dh = bounds.max.y - bounds.min.y;

    const cw = canvas.width;
    const ch = canvas.height;
    const padding = 0.05;

    const scaleX = cw / (dw * (1 + padding * 2));
    const scaleY = ch / (dh * (1 + padding * 2));
    const scale = Math.min(scaleX, scaleY);

    const offsetX = (cw - dw * scale) / 2 - bounds.min.x * scale;
    const offsetY = (ch - dh * scale) / 2 + bounds.max.y * scale;

    return {
      x: (canvasX - offsetX) / scale,
      y: -(canvasY - offsetY) / scale,
    };
  }
}
