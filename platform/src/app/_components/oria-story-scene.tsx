"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";

type SceneProps = {
  progress: number;
  motionEnabled: boolean;
  scenario: number;
  layerIndex: number;
  calendarEnabled: boolean;
  pixEnabled: boolean;
  onSelect: (module: "harness" | "whatsapp" | "calendar" | "team" | "pix") => void;
};

const background = "#eef1ef";

function roundedShape(width: number, height: number, radius: number) {
  const shape = new THREE.Shape();
  const left = -width / 2;
  const bottom = -height / 2;
  shape.moveTo(left + radius, bottom);
  shape.lineTo(left + width - radius, bottom);
  shape.quadraticCurveTo(left + width, bottom, left + width, bottom + radius);
  shape.lineTo(left + width, bottom + height - radius);
  shape.quadraticCurveTo(left + width, bottom + height, left + width - radius, bottom + height);
  shape.lineTo(left + radius, bottom + height);
  shape.quadraticCurveTo(left, bottom + height, left, bottom + height - radius);
  shape.lineTo(left, bottom + radius);
  shape.quadraticCurveTo(left, bottom, left + radius, bottom);
  return shape;
}

function panelTexture(title: string, subtitle: string, dark: boolean, accent: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 768;
  canvas.height = 448;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas indisponível");
  context.fillStyle = dark ? "#143b35" : "#fcfdfb";
  context.fillRect(0, 0, 768, 448);
  context.fillStyle = accent;
  context.fillRect(44, 44, 60, 8);
  context.fillStyle = dark ? "#f4f8ef" : "#183e35";
  context.font = "600 54px sans-serif";
  context.fillText(title, 44, 151);
  context.font = "26px sans-serif";
  context.fillStyle = dark ? "#c0d7cc" : "#586d64";
  context.fillText(subtitle, 44, 207);
  context.strokeStyle = dark ? "#466158" : "#d7e2d9";
  context.beginPath();
  context.moveTo(44, 254);
  context.lineTo(724, 254);
  context.stroke();
  for (let index = 0; index < 3; index++) {
    const position = 66 + index * 249;
    context.fillStyle = accent;
    context.beginPath();
    context.arc(position, 314, 12, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = dark ? "#acc3b7" : "#879a91";
    context.fillRect(position - 12, 354, 130, 5);
    context.fillRect(position - 12, 374, 90, 5);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export default function OriaStoryScene(props: SceneProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  const [unavailable, setUnavailable] = useState(false);
  const [hovered, setHovered] = useState("");

  useEffect(() => { latest.current = props; }, [props]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
    } catch {
      queueMicrotask(() => setUnavailable(true));
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.6));
    renderer.setClearColor(background, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.setAttribute("aria-hidden", "true");
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
    camera.position.set(0, 0, 16);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x7b9b89, 3));
    const keyLight = new THREE.DirectionalLight(0xffffff, 4);
    keyLight.position.set(-4, 6, 8);
    scene.add(keyLight);
    const rimLight = new THREE.DirectionalLight(0xb2d5f7, 2);
    rimLight.position.set(5, -2, 4);
    scene.add(rimLight);

    const assembly = new THREE.Group();
    scene.add(assembly);
    const textures: THREE.Texture[] = [];
    const createPanel = (title: string, subtitle: string, width: number, dark: boolean, accent: string) => {
      const height = width * 448 / 768;
      const group = new THREE.Group();
      const shape = roundedShape(width, height, 0.10);
      const solid = new THREE.Mesh(
        new THREE.ExtrudeGeometry(shape, { depth: 0.12, bevelEnabled: true, bevelSize: 0.035, bevelThickness: 0.035, bevelSegments: 3, steps: 1 }),
        new THREE.MeshStandardMaterial({ color: dark ? "#17483e" : "#d7e4db", metalness: 0.45, roughness: 0.26 }),
      );
      group.add(solid);
      const geometry = new THREE.ShapeGeometry(shape);
      const positions = geometry.attributes.position;
      const uv = geometry.attributes.uv;
      for (let index = 0; index < uv.count; index++) {
        uv.setXY(index, positions.getX(index) / width + 0.5, positions.getY(index) / height + 0.5);
      }
      const texture = panelTexture(title, subtitle, dark, accent);
      textures.push(texture);
      const face = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ map: texture }));
      face.position.z = 0.16;
      group.add(face);
      assembly.add(group);
      return { group, face };
    };

    const audit = createPanel("REGISTRO", "Ferramentas / resultados / limites", 3.5, false, "#b1c9ef");
    const rules = createPanel("VALIDAÇÃO", "Permissão / regras / disponibilidade", 3.5, false, "#ef957e");
    const core = createPanel("Oria AI Harness", "Contexto. Decisão. Ação.", 3.5, true, "#d4f18b");
    const whatsapp = createPanel("WhatsApp", "Uma nova conversa", 2.05, false, "#45ae80");
    const calendar = createPanel("Agenda", "Opções revalidadas", 2.05, false, "#8eaef1");
    const team = createPanel("Equipe", "A decisão continua sua", 2.05, false, "#ef957e");
    const pix = createPanel("Pix", "Pagamento vinculado", 2.05, false, "#45ae80");
    const nodes = [whatsapp, calendar, team, pix];
    const moduleNames = ["harness", "harness", "harness", "whatsapp", "calendar", "team", "pix"] as const;
    const selectablePanels = [core, rules, audit, ...nodes];
    selectablePanels.forEach((panel, index) => { panel.group.userData.module = moduleNames[index]; });
    const nodePositions = [new THREE.Vector3(-3.9, 1.65, -0.25), new THREE.Vector3(3.9, 1.65, -0.25), new THREE.Vector3(3.9, -1.65, -0.25), new THREE.Vector3(-3.9, -1.65, -0.25)];
    const links = nodes.map(() => {
      const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
      const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: "#789d8b", transparent: true, opacity: 0.6 }));
      assembly.add(line);
      const signal = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, 0.15), new THREE.MeshBasicMaterial({ color: "#087963" }));
      assembly.add(signal);
      return { line, signal };
    });
    let width = 1;
    let height = 1;
    let dirty = true;
    const resize = new ResizeObserver(([entry]) => {
      width = entry.contentRect.width;
      height = entry.contentRect.height;
      renderer.setSize(width, height);
      camera.aspect = width / Math.max(height, 1);
      camera.updateProjectionMatrix();
      dirty = true;
    });
    resize.observe(host);
    const pointer = new THREE.Vector2();
    const raycaster = new THREE.Raycaster();
    let hoveredModule = "";
    const moduleAt = (event: PointerEvent) => {
      if (latest.current.progress > 4.5 || (event.target instanceof Element && event.target.closest("button, a, label, input"))) return undefined;
      const bounds = renderer.domElement.getBoundingClientRect();
      raycaster.setFromCamera(new THREE.Vector2((event.clientX - bounds.left) / bounds.width * 2 - 1, -(event.clientY - bounds.top) / bounds.height * 2 + 1), camera);
      const hit = raycaster.intersectObjects(selectablePanels.map((panel) => panel.group), true)[0];
      return hit?.object.parent?.userData.module as SceneProps["onSelect"] extends (module: infer Module) => void ? Module | undefined : never;
    };
    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      pointer.set((event.clientX / window.innerWidth - 0.5) * 2, (event.clientY / window.innerHeight - 0.5) * 2);
      const selectedModule = moduleAt(event) ?? "";
      if (selectedModule !== hoveredModule) {
        hoveredModule = selectedModule;
        setHovered(selectedModule);
        if (host.parentElement) host.parentElement.style.cursor = selectedModule ? "pointer" : "";
      }
      dirty = true;
    };
    const resetPointer = () => { pointer.set(0, 0); hoveredModule = ""; setHovered(""); if (host.parentElement) host.parentElement.style.cursor = ""; dirty = true; };
    const pointerStart = new THREE.Vector2();
    const onPointerDown = (event: PointerEvent) => { pointerStart.set(event.clientX, event.clientY); };
    const onPointerUp = (event: PointerEvent) => {
      if (event.button !== 0 || pointerStart.distanceTo(new THREE.Vector2(event.clientX, event.clientY)) > 8) return;
      const selectedModule = moduleAt(event);
      if (selectedModule) { latest.current.onSelect(selectedModule); resetPointer(); }
    };
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerdown", onPointerDown, { passive: true });
    window.addEventListener("pointerup", onPointerUp, { passive: true });
    document.documentElement.addEventListener("pointerleave", resetPointer);
    const onContextLost = (event: Event) => { event.preventDefault(); setUnavailable(true); };
    const onContextRestored = () => { setUnavailable(false); dirty = true; };
    renderer.domElement.addEventListener("webglcontextlost", onContextLost);
    renderer.domElement.addEventListener("webglcontextrestored", onContextRestored);

    let frame = 0;
    let previousTime = 0;
    let elapsed = 0;
    let previousState = "";
    let renderedFrames = 0;
    const draw = (time: number) => {
      frame = requestAnimationFrame(draw);
      const state = latest.current;
      const stateKey = `${state.progress}:${state.motionEnabled}:${state.scenario}:${state.layerIndex}:${state.calendarEnabled}:${state.pixEnabled}`;
      const delta = Math.min((time - previousTime) / 1000, 0.05);
      previousTime = time;
      if (document.hidden || (!state.motionEnabled && stateKey === previousState && !dirty)) return;
      previousState = stateKey;
      dirty = false;
      if (state.motionEnabled) elapsed += delta;
      const progress = state.motionEnabled ? state.progress : Math.round(state.progress);
      const explode = Math.max(0, 1 - Math.abs(progress - 2));
      const network = Math.max(0, 1 - Math.abs(progress - 4));
      const narrow = window.innerWidth <= 760;
      const visibleHeight = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.position.z;
      const unitsPerPixel = visibleHeight / height;
      const hostBounds = host.getBoundingClientRect();
      const contentBounds = host.parentElement?.querySelector("#story-content")?.getBoundingClientRect();
      const captionBounds = host.parentElement?.querySelector("aside")?.getBoundingClientRect();
      const headerBounds = host.parentElement?.querySelector("header")?.getBoundingClientRect();
      const areaTop = (narrow ? contentBounds?.bottom : headerBounds?.bottom) ?? 90;
      const areaBottom = captionBounds?.top ?? height - 160;
      const areaHeight = Math.max(60, areaBottom - areaTop - 20);
      const centerY = (areaTop + areaBottom) / 2 - hostBounds.top;
      const centerX = narrow ? width * 0.5 : width * 0.735;
      assembly.position.x = (centerX - width / 2) * unitsPerPixel;
      assembly.position.y = (height / 2 - centerY) * unitsPerPixel;
      const scale = Math.min(width * (narrow ? 0.91 : 0.48) * unitsPerPixel / 10.8, areaHeight * unitsPerPixel / (6.2 + explode * 1.2), 1.3);
      assembly.scale.setScalar(scale);
      const pointerX = state.motionEnabled ? pointer.x * 0.23 : 0;
      const pointerY = state.motionEnabled ? pointer.y * 0.12 : 0;
      assembly.rotation.set(-0.28 + explode * 0.10 + pointerY, -0.26 + Math.sin(progress * 0.85) * 0.28 + pointerX, -0.07 + progress * 0.026);
      core.group.position.set(0, explode * 1.45, 0.55 + explode * 0.8);
      rules.group.position.set(0.12, -0.34 - explode * 0.3, 0.13);
      audit.group.position.set(0.24, -0.68 - explode * 1.75, -0.29 - explode * 0.6);
      [core, rules, audit].forEach((panel, index) => {
        const highlighted = state.layerIndex < 2 ? index === 0 : index === state.layerIndex - 1;
        panel.group.position.z += explode * (highlighted ? 0.5 : 0);
        (panel.face.material as THREE.MeshBasicMaterial).color.set(explode > 0.8 && !highlighted ? "#c3cdc3" : "#ffffff");
      });
      for (let index = 0; index < nodes.length; index++) {
        const node = nodes[index];
        node.group.position.copy(nodePositions[index]);
        node.group.position.multiplyScalar(1 + network * 0.06);
        node.group.position.z += Math.sin(elapsed * 0.65 + index * 1.3) * (state.motionEnabled ? 0.08 : 0);
        const disabled = (index === 1 && !state.calendarEnabled) || (index === 3 && !state.pixEnabled);
        const selected = index === (state.scenario === 2 || !state.calendarEnabled ? 2 : 1);
        node.group.scale.setScalar(selected && progress > 2.5 && progress < 3.5 ? 1.1 : 1);
        const faceMaterial = node.face.material as THREE.MeshBasicMaterial;
        faceMaterial.color.set(disabled ? "#9da6a0" : "#ffffff");
        const endpoint = node.group.position;
        const buffer = links[index].line.geometry.attributes.position;
        buffer.setXYZ(0, 0, 0, -0.7);
        buffer.setXYZ(1, endpoint.x, endpoint.y, endpoint.z);
        buffer.needsUpdate = true;
        links[index].line.geometry.computeBoundingSphere();
        links[index].signal.visible = !disabled && !explode;
        links[index].signal.position.lerpVectors(new THREE.Vector3(0, 0, -0.7), endpoint, (elapsed * 0.3 + index * 0.21) % 1);
      }
      renderer.render(scene, camera);
      renderer.domElement.dataset.frames = String(++renderedFrames);
      renderer.domElement.dataset.progress = progress.toFixed(3);
    };
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointerup", onPointerUp);
      document.documentElement.removeEventListener("pointerleave", resetPointer);
      renderer.domElement.removeEventListener("webglcontextlost", onContextLost);
      renderer.domElement.removeEventListener("webglcontextrestored", onContextRestored);
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((material) => material.dispose());
        }
      });
      textures.forEach((texture) => texture.dispose());
      renderer.dispose();
      renderer.domElement.remove();
      if (host.parentElement) host.parentElement.style.cursor = "";
    };
  }, []);

  const sceneOpacity = props.motionEnabled ? Math.max(0, Math.min(1, (4.5 - props.progress) / 0.45)) : props.progress < 4.5 ? 1 : 0;

  return <div ref={hostRef} style={{ position: "absolute", inset: 0, pointerEvents: "none", opacity: sceneOpacity, visibility: sceneOpacity === 0 ? "hidden" : "visible" }} data-scene="oria" role="img" aria-hidden={sceneOpacity === 0} aria-label="Modelo tridimensional do AI Harness Oria conectado ao WhatsApp, agenda, Pix e equipe">
    {hovered && <span role="tooltip" style={{ position: "absolute", top: 82, right: "7%", color: "#17654e", fontSize: 11 }}>Explorar {({ harness: "AI Harness", whatsapp: "WhatsApp", calendar: "Agenda", team: "Equipe", pix: "Pix" } as Record<string, string>)[hovered]}</span>}
    {unavailable && <div style={{ position: "absolute", top: "48%", right: "10%", color: "#1a5343", fontSize: 22, lineHeight: 2 }}>WhatsApp → Oria AI Harness<br />Contexto → Validação → Ação<br />Agenda · Pix · Equipe</div>}
  </div>;
}