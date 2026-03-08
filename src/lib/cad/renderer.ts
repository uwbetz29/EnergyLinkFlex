// Three.js rendering engine for DXF drawings
// Converts parsed DXF entities into Three.js objects on a 2D orthographic scene

import * as THREE from "three";
import type {
  ParsedDrawing,
  ParsedEntity,
  CADComponent,
  Point2D,
} from "@/types/cad";

// DXF color index to hex (subset of the 256 ACI colors)
const DXF_COLORS: Record<number, string> = {
  0: "#000000", // BYBLOCK
  1: "#FF0000",
  2: "#FFFF00",
  3: "#00FF00",
  4: "#00FFFF",
  5: "#0000FF",
  6: "#FF00FF",
  7: "#FFFFFF",
  8: "#808080",
  9: "#C0C0C0",
};

function dxfColorToHex(colorIndex: number | undefined): string {
  if (colorIndex === undefined) return "#333333";
  // Color 7 is white in DXF, but on a light background we want it dark
  if (colorIndex === 7) return "#222222";
  return DXF_COLORS[colorIndex] || "#333333";
}

export interface RendererOptions {
  backgroundColor?: string;
  defaultColor?: string;
  highlightColor?: string;
  hoverColor?: string;
  lineWidth?: number;
}

const DEFAULT_OPTIONS: RendererOptions = {
  backgroundColor: "#FFFFFF",
  defaultColor: "#333333",
  highlightColor: "#93C90F",
  hoverColor: "#00BFDD",
  lineWidth: 1,
};

export class CADRenderer {
  private scene: THREE.Scene;
  private camera: THREE.OrthographicCamera;
  private renderer: THREE.WebGLRenderer;
  private raycaster: THREE.Raycaster;
  private mouse: THREE.Vector2;
  private entityMap: Map<string, THREE.Object3D> = new Map();
  private componentGroups: Map<string, THREE.Group> = new Map();
  private options: RendererOptions;
  private drawing: ParsedDrawing | null = null;
  private containerEl: HTMLElement | null = null;
  private isPanning = false;
  private panStart: Point2D = { x: 0, y: 0 };
  private cameraStart: Point2D = { x: 0, y: 0 };

  constructor(options: Partial<RendererOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(this.options.backgroundColor!);

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

    // Event listeners
    this.renderer.domElement.addEventListener("wheel", this.onWheel);
    this.renderer.domElement.addEventListener("mousedown", this.onMouseDown);
    this.renderer.domElement.addEventListener("mousemove", this.onMouseMove);
    this.renderer.domElement.addEventListener("mouseup", this.onMouseUp);

    window.addEventListener("resize", this.onResize);
    this.onResize();
  }

  unmount(): void {
    if (this.containerEl) {
      this.renderer.domElement.removeEventListener("wheel", this.onWheel);
      this.renderer.domElement.removeEventListener("mousedown", this.onMouseDown);
      this.renderer.domElement.removeEventListener("mousemove", this.onMouseMove);
      this.renderer.domElement.removeEventListener("mouseup", this.onMouseUp);
      window.removeEventListener("resize", this.onResize);
      this.containerEl.removeChild(this.renderer.domElement);
      this.containerEl = null;
    }
    this.renderer.dispose();
  }

  loadDrawing(drawing: ParsedDrawing): void {
    this.drawing = drawing;
    this.clearScene();

    // Render all entities
    for (const entity of drawing.entities) {
      const obj = this.createObject(entity);
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

      // Create a bounding box overlay for the component
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
        new THREE.LineBasicMaterial({
          color: component.color,
          transparent: true,
          opacity: 0,
        })
      );
      line.userData = { componentId: component.id, isOverlay: true };
      group.add(line);
      this.scene.add(group);
    }

    this.fitToView();
    this.render();
  }

  private createObject(entity: ParsedEntity): THREE.Object3D | null {
    const color = dxfColorToHex(entity.color);

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
      case "TEXT":
      case "MTEXT":
        return this.createText(entity, color);
      default:
        return null;
    }
  }

  private createLine(entity: ParsedEntity, color: string): THREE.Line | null {
    if (!entity.vertices || entity.vertices.length < 2) return null;
    const geometry = new THREE.BufferGeometry();
    const vertices = new Float32Array(
      entity.vertices.flatMap((v) => [v.x, v.y, 0])
    );
    geometry.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
    return new THREE.Line(
      geometry,
      new THREE.LineBasicMaterial({ color })
    );
  }

  private createPolyline(entity: ParsedEntity, color: string): THREE.Line | null {
    if (!entity.vertices || entity.vertices.length < 2) return null;
    const geometry = new THREE.BufferGeometry();
    const vertices = new Float32Array(
      entity.vertices.flatMap((v) => [v.x, v.y, 0])
    );
    geometry.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
    return new THREE.Line(
      geometry,
      new THREE.LineBasicMaterial({ color })
    );
  }

  private createCircle(entity: ParsedEntity, color: string): THREE.Line | null {
    if (!entity.center || !entity.radius) return null;
    const segments = 64;
    const geometry = new THREE.BufferGeometry();
    const vertices = new Float32Array((segments + 1) * 3);
    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      vertices[i * 3] = entity.center.x + Math.cos(angle) * entity.radius;
      vertices[i * 3 + 1] = entity.center.y + Math.sin(angle) * entity.radius;
      vertices[i * 3 + 2] = 0;
    }
    geometry.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
    return new THREE.Line(
      geometry,
      new THREE.LineBasicMaterial({ color })
    );
  }

  private createArc(entity: ParsedEntity, color: string): THREE.Line | null {
    if (!entity.center || !entity.radius) return null;
    const startAngle = ((entity.startAngle || 0) * Math.PI) / 180;
    const endAngle = ((entity.endAngle || 360) * Math.PI) / 180;
    let angleDiff = endAngle - startAngle;
    if (angleDiff < 0) angleDiff += Math.PI * 2;

    const segments = Math.max(16, Math.floor(angleDiff * 32));
    const geometry = new THREE.BufferGeometry();
    const vertices = new Float32Array((segments + 1) * 3);
    for (let i = 0; i <= segments; i++) {
      const angle = startAngle + (i / segments) * angleDiff;
      vertices[i * 3] = entity.center.x + Math.cos(angle) * entity.radius;
      vertices[i * 3 + 1] = entity.center.y + Math.sin(angle) * entity.radius;
      vertices[i * 3 + 2] = 0;
    }
    geometry.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
    return new THREE.Line(
      geometry,
      new THREE.LineBasicMaterial({ color })
    );
  }

  private createText(entity: ParsedEntity, _color: string): THREE.Sprite | null {
    if (!entity.text || !entity.insertionPoint) return null;

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    const fontSize = 14;
    canvas.width = Math.max(256, entity.text.length * fontSize);
    canvas.height = fontSize * 2;

    ctx.fillStyle = "#333333";
    ctx.font = `${fontSize}px monospace`;
    ctx.fillText(entity.text, 0, fontSize);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
    });
    const sprite = new THREE.Sprite(material);
    sprite.position.set(entity.insertionPoint.x, entity.insertionPoint.y, 1);

    // Scale sprite based on text length
    const aspect = canvas.width / canvas.height;
    const scale = 5; // Base scale factor
    sprite.scale.set(scale * aspect, scale, 1);

    return sprite;
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
    const padding = 1.1; // 10% padding

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
    // Reset all component overlays
    for (const [id, group] of this.componentGroups) {
      group.traverse((child) => {
        if (child instanceof THREE.Line && child.userData.isOverlay) {
          const mat = child.material as THREE.LineBasicMaterial;
          if (id === componentId) {
            mat.opacity = 0.8;
            mat.color.set(color || this.options.highlightColor!);
            mat.linewidth = 2;
          } else {
            mat.opacity = 0;
          }
        }
      });
    }

    // Highlight entities belonging to the selected component
    if (this.drawing) {
      const component = this.drawing.components.find(
        (c) => c.id === componentId
      );
      const handles = new Set(component?.entityHandles || []);

      for (const [handle, obj] of this.entityMap) {
        obj.traverse((child) => {
          if (child instanceof THREE.Line) {
            const mat = child.material as THREE.LineBasicMaterial;
            if (componentId && handles.has(handle)) {
              mat.color.set(color || this.options.highlightColor!);
            } else {
              // Reset to original color
              const entityColor = dxfColorToHex(
                this.drawing?.entities.find((e) => e.handle === handle)?.color
              );
              mat.color.set(entityColor);
            }
          }
        });
      }
    }
    this.render();
  }

  /**
   * Raycast to find which component was clicked
   */
  getComponentAtPoint(screenX: number, screenY: number): string | null {
    if (!this.containerEl || !this.drawing) return null;

    const rect = this.containerEl.getBoundingClientRect();
    this.mouse.x = ((screenX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((screenY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);
    const intersects = this.raycaster.intersectObjects(
      this.scene.children,
      true
    );

    for (const intersect of intersects) {
      const handle = intersect.object.userData?.handle;
      if (handle) {
        // Find which component this entity belongs to
        for (const component of this.drawing.components) {
          if (component.entityHandles.includes(handle)) {
            return component.id;
          }
        }
      }
    }

    return null;
  }

  /**
   * Get world coordinates from screen coordinates
   */
  screenToWorld(screenX: number, screenY: number): Point2D {
    if (!this.containerEl) return { x: 0, y: 0 };
    const rect = this.containerEl.getBoundingClientRect();
    const ndcX = ((screenX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((screenY - rect.top) / rect.height) * 2 + 1;

    const worldX =
      ((ndcX + 1) / 2) * (this.camera.right - this.camera.left) +
      this.camera.left;
    const worldY =
      ((ndcY + 1) / 2) * (this.camera.top - this.camera.bottom) +
      this.camera.bottom;

    return { x: worldX, y: worldY };
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
  }

  // --- Event handlers ---

  private onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const zoomFactor = event.deltaY > 0 ? 1.1 : 0.9;

    const centerX = (this.camera.left + this.camera.right) / 2;
    const centerY = (this.camera.top + this.camera.bottom) / 2;
    const halfWidth = (this.camera.right - this.camera.left) / 2;
    const halfHeight = (this.camera.top - this.camera.bottom) / 2;

    this.camera.left = centerX - halfWidth * zoomFactor;
    this.camera.right = centerX + halfWidth * zoomFactor;
    this.camera.top = centerY + halfHeight * zoomFactor;
    this.camera.bottom = centerY - halfHeight * zoomFactor;
    this.camera.updateProjectionMatrix();
    this.render();
  };

  private onMouseDown = (event: MouseEvent): void => {
    if (event.button === 1 || (event.button === 0 && event.shiftKey)) {
      // Middle click or Shift+Left = pan
      this.isPanning = true;
      this.panStart = { x: event.clientX, y: event.clientY };
      this.cameraStart = {
        x: (this.camera.left + this.camera.right) / 2,
        y: (this.camera.top + this.camera.bottom) / 2,
      };
      this.renderer.domElement.style.cursor = "grabbing";
    }
  };

  private onMouseMove = (event: MouseEvent): void => {
    if (this.isPanning && this.containerEl) {
      const rect = this.containerEl.getBoundingClientRect();
      const dx = event.clientX - this.panStart.x;
      const dy = event.clientY - this.panStart.y;

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
    }
  };

  private onMouseUp = (): void => {
    this.isPanning = false;
    this.renderer.domElement.style.cursor = "default";
  };

  private onResize = (): void => {
    if (!this.containerEl) return;
    const { width, height } = this.containerEl.getBoundingClientRect();
    this.renderer.setSize(width, height);
    if (this.drawing) {
      this.fitToView();
    }
    this.render();
  };
}
