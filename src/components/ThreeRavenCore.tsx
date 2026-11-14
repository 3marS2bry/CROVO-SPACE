import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

interface ThreeRavenCoreProps {
  level?: number;
  xp?: number;
  className?: string;
  interactive?: boolean;
}

export const ThreeRavenCore: React.FC<ThreeRavenCoreProps> = ({
  level = 1,
  xp = 0,
  className = '',
  interactive = true,
}) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const coreMeshRef = useRef<THREE.Mesh | null>(null);
  const ring1Ref = useRef<THREE.Mesh | null>(null);
  const ring2Ref = useRef<THREE.Mesh | null>(null);
  const ravenGroupRef = useRef<THREE.Group | null>(null);
  const leftWingRef = useRef<THREE.Group | null>(null);
  const rightWingRef = useRef<THREE.Group | null>(null);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    // 1. Software-WebGL detection
    const isSoftwareGl = (() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      if (!gl) return true;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
      const gpu = String(gl.getParameter(param));
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    })();

    // 2. Renderer setup with color & tone pipeline
    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));

    const width = container.clientWidth || 400;
    const height = container.clientHeight || 400;
    renderer.setSize(width, height);
    container.appendChild(renderer.domElement);

    // 3. Scene & Camera
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    camera.position.set(0, 1.2, 5.2);

    // 4. Room Environment for PBR metallic reflections
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    pmremGenerator.dispose();

    // 5. Lighting Rig
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(0xa5b4fc, 2.5);
    keyLight.position.set(4, 6, 5);
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x38bdf8, 2.8);
    rimLight.position.set(-4, -2, -3);
    scene.add(rimLight);

    const hemiLight = new THREE.HemisphereLight(0xe0e7ff, 0x1e1b4b, 1.2);
    scene.add(hemiLight);

    // 6. Master Raven + Tech Core Group (3-12 Composite Parts)
    const masterGroup = new THREE.Group();
    scene.add(masterGroup);

    // Common PBR Materials
    const ravenMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x111625,
      emissive: 0x1e1b4b,
      emissiveIntensity: 0.25,
      metalness: 0.85,
      roughness: 0.2,
      clearcoat: 0.6,
      clearcoatRoughness: 0.1,
    });

    const holoAccentMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x818cf8,
      emissive: 0x6366f1,
      emissiveIntensity: 0.8,
      metalness: 0.9,
      roughness: 0.15,
      wireframe: false,
    });

    const energyCoreMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x38bdf8,
      emissive: 0x0284c7,
      emissiveIntensity: 1.4,
      metalness: 0.3,
      roughness: 0.1,
      transmission: isSoftwareGl ? 0 : 0.85,
      transparent: true,
      opacity: isSoftwareGl ? 0.6 : 0.95,
      ior: 1.7,
      thickness: 1.2,
    });

    const ringsMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xc7d2fe,
      emissive: 0x4f46e5,
      emissiveIntensity: 0.9,
      metalness: 0.95,
      roughness: 0.1,
      wireframe: true,
    });

    // Sub-group: Raven Body
    const ravenGroup = new THREE.Group();
    ravenGroup.position.set(0, 0.4, 0);
    masterGroup.add(ravenGroup);
    ravenGroupRef.current = ravenGroup;

    // Part 1: Raven Torso (Faceted Cone/Pyramid)
    const torsoGeo = new THREE.ConeGeometry(0.55, 1.4, 6);
    torsoGeo.rotateX(Math.PI * 0.1);
    const torsoMesh = new THREE.Mesh(torsoGeo, ravenMaterial);
    torsoMesh.position.set(0, 0.1, 0);
    ravenGroup.add(torsoMesh);

    // Part 2: Raven Head (Angled faceted shape)
    const headGeo = new THREE.DodecahedronGeometry(0.35, 0);
    const headMesh = new THREE.Mesh(headGeo, ravenMaterial);
    headMesh.position.set(0, 0.8, 0.3);
    ravenGroup.add(headMesh);

    // Part 3: Beak (Sharp forward cone)
    const beakGeo = new THREE.ConeGeometry(0.12, 0.55, 4);
    beakGeo.rotateX(Math.PI * 0.45);
    const beakMesh = new THREE.Mesh(beakGeo, holoAccentMaterial);
    beakMesh.position.set(0, 0.78, 0.65);
    ravenGroup.add(beakMesh);

    // Part 4 & 5: Glowing Eyes
    const eyeGeo = new THREE.SphereGeometry(0.045, 8, 8);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
    const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
    leftEye.position.set(0.16, 0.85, 0.48);
    const rightEye = new THREE.Mesh(eyeGeo, eyeMat);
    rightEye.position.set(-0.16, 0.85, 0.48);
    ravenGroup.add(leftEye, rightEye);

    // Part 6 & 7: Wings (Layered geometric panels)
    const leftWing = new THREE.Group();
    const rightWing = new THREE.Group();

    const wingPanelGeo1 = new THREE.BoxGeometry(0.85, 0.04, 0.35);
    const wingPanelGeo2 = new THREE.BoxGeometry(0.65, 0.03, 0.25);
    const wingPanelGeo3 = new THREE.BoxGeometry(0.45, 0.02, 0.18);

    const lp1 = new THREE.Mesh(wingPanelGeo1, ravenMaterial);
    lp1.position.set(0.45, 0, 0);
    lp1.rotation.y = -0.2;
    const lp2 = new THREE.Mesh(wingPanelGeo2, holoAccentMaterial);
    lp2.position.set(0.85, -0.05, 0.05);
    lp2.rotation.y = -0.35;
    const lp3 = new THREE.Mesh(wingPanelGeo3, holoAccentMaterial);
    lp3.position.set(1.15, -0.12, 0.08);
    leftWing.add(lp1, lp2, lp3);
    leftWing.position.set(0.3, 0.45, 0.05);
    ravenGroup.add(leftWing);
    leftWingRef.current = leftWing;

    const rp1 = new THREE.Mesh(wingPanelGeo1, ravenMaterial);
    rp1.position.set(-0.45, 0, 0);
    rp1.rotation.y = 0.2;
    const rp2 = new THREE.Mesh(wingPanelGeo2, holoAccentMaterial);
    rp2.position.set(-0.85, -0.05, 0.05);
    rp2.rotation.y = 0.35;
    const rp3 = new THREE.Mesh(wingPanelGeo3, holoAccentMaterial);
    rp3.position.set(-1.15, -0.12, 0.08);
    rightWing.add(rp1, rp2, rp3);
    rightWing.position.set(-0.3, 0.45, 0.05);
    ravenGroup.add(rightWing);
    rightWingRef.current = rightWing;

    // Part 8: Tail Feathers
    const tailGeo = new THREE.BoxGeometry(0.3, 0.03, 0.7);
    tailGeo.rotateX(-Math.PI * 0.15);
    const tailMesh = new THREE.Mesh(tailGeo, holoAccentMaterial);
    tailMesh.position.set(0, -0.6, -0.3);
    ravenGroup.add(tailMesh);

    // Part 9: Floating Energy Tech Core (Icosahedron)
    const coreGeo = new THREE.IcosahedronGeometry(0.42, 1);
    const coreMesh = new THREE.Mesh(coreGeo, energyCoreMaterial);
    coreMesh.position.set(0, -0.65, 0);
    masterGroup.add(coreMesh);
    coreMeshRef.current = coreMesh;

    // Part 10 & 11: Dual Rotating Orbital Tech Rings
    const ringGeo1 = new THREE.TorusGeometry(0.72, 0.02, 8, 36);
    const ring1 = new THREE.Mesh(ringGeo1, ringsMaterial);
    ring1.rotation.x = Math.PI * 0.35;
    masterGroup.add(ring1);
    ring1Ref.current = ring1;

    const ringGeo2 = new THREE.TorusGeometry(0.85, 0.015, 8, 36);
    const ring2 = new THREE.Mesh(ringGeo2, ringsMaterial);
    ring2.rotation.y = Math.PI * 0.4;
    ring2.rotation.z = Math.PI * 0.25;
    masterGroup.add(ring2);
    ring2Ref.current = ring2;

    // Part 12: Ambient Tech Particle Cloud
    const particleCount = isSoftwareGl ? 30 : 90;
    const particleGeo = new THREE.BufferGeometry();
    const particlePositions = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount; i++) {
      const theta = Math.random() * Math.PI * 2;
      const radius = 1.0 + Math.random() * 1.4;
      const y = (Math.random() - 0.5) * 2.2;
      particlePositions[i * 3] = Math.cos(theta) * radius;
      particlePositions[i * 3 + 1] = y;
      particlePositions[i * 3 + 2] = Math.sin(theta) * radius;
    }
    particleGeo.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
    const particleMat = new THREE.PointsMaterial({
      color: 0x818cf8,
      size: 0.04,
      transparent: true,
      opacity: 0.75,
    });
    const particlePoints = new THREE.Points(particleGeo, particleMat);
    masterGroup.add(particlePoints);

    // Soft Contact Shadow Plane underneath
    const shadowCanvas = document.createElement('canvas');
    shadowCanvas.width = 128;
    shadowCanvas.height = 128;
    const sCtx = shadowCanvas.getContext('2d')!;
    const gradient = sCtx.createRadialGradient(64, 64, 0, 64, 64, 60);
    gradient.addColorStop(0, 'rgba(30, 27, 75, 0.45)');
    gradient.addColorStop(0.5, 'rgba(79, 70, 229, 0.15)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    sCtx.fillStyle = gradient;
    sCtx.fillRect(0, 0, 128, 128);

    const shadowTex = new THREE.CanvasTexture(shadowCanvas);
    shadowTex.colorSpace = THREE.SRGBColorSpace;
    const shadowGeo = new THREE.PlaneGeometry(3.0, 3.0);
    const shadowMat = new THREE.MeshBasicMaterial({
      map: shadowTex,
      transparent: true,
      depthWrite: false,
      opacity: 0.7,
    });
    const shadowPlane = new THREE.Mesh(shadowGeo, shadowMat);
    shadowPlane.rotation.x = -Math.PI / 2;
    shadowPlane.position.y = -1.6;
    scene.add(shadowPlane);

    // Mouse / Touch kinematics tracking
    const mouse = { x: 0, y: 0, targetX: 0, targetY: 0 };

    const handlePointerMove = (e: MouseEvent) => {
      if (!interactive) return;
      const rect = container.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
      mouse.targetX = x * 0.7;
      mouse.targetY = y * 0.5;
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!interactive || e.touches.length === 0) return;
      const touch = e.touches[0];
      const rect = container.getBoundingClientRect();
      const x = ((touch.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -(((touch.clientY - rect.top) / rect.height) * 2 - 1);
      mouse.targetX = x * 0.7;
      mouse.targetY = y * 0.5;
    };

    window.addEventListener('mousemove', handlePointerMove);
    container.addEventListener('touchmove', handleTouchMove, { passive: true });

    // Handle Resize
    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth || 400;
      const h = container.clientHeight || 400;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    // 7. Animation Loop with Exponential Damping
    let frameId = 0;
    let clock = new THREE.Clock();

    const animate = () => {
      const dt = clock.getDelta();
      const time = clock.getElapsedTime();

      // Exponential damping for smooth mouse follow
      mouse.x += (mouse.targetX - mouse.x) * (1 - Math.exp(-6 * dt));
      mouse.y += (mouse.targetY - mouse.y) * (1 - Math.exp(-6 * dt));

      if (masterGroup) {
        masterGroup.rotation.y = time * 0.25 + mouse.x;
        masterGroup.rotation.x = mouse.y * 0.4;
        masterGroup.position.y = Math.sin(time * 1.5) * 0.12;
      }

      // Raven Wing Gentle Flap & Gliding
      if (leftWingRef.current && rightWingRef.current) {
        const wingFlap = Math.sin(time * 2.2) * 0.2;
        leftWingRef.current.rotation.z = 0.15 + wingFlap;
        rightWingRef.current.rotation.z = -0.15 - wingFlap;
      }

      // Orbital Rings Rotation
      if (ring1Ref.current) {
        ring1Ref.current.rotation.x += dt * 0.8;
        ring1Ref.current.rotation.z += dt * 0.6;
      }
      if (ring2Ref.current) {
        ring2Ref.current.rotation.y -= dt * 0.7;
        ring2Ref.current.rotation.x -= dt * 0.5;
      }

      // Tech Core Multi-faceted Rotation
      if (coreMeshRef.current) {
        coreMeshRef.current.rotation.y += dt * 0.9;
        coreMeshRef.current.rotation.x += dt * 0.4;
        const scale = 1.0 + Math.sin(time * 3.0) * 0.05;
        coreMeshRef.current.scale.set(scale, scale, scale);
      }

      // Particle Drift
      if (particlePoints) {
        particlePoints.rotation.y -= dt * 0.15;
      }

      renderer.render(scene, camera);
      frameId = requestAnimationFrame(animate);
    };

    frameId = requestAnimationFrame(animate);

    // Cleanup on unmount
    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener('mousemove', handlePointerMove);
      container.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('resize', handleResize);

      // Clean disposal
      torsoGeo.dispose();
      headGeo.dispose();
      beakGeo.dispose();
      eyeGeo.dispose();
      wingPanelGeo1.dispose();
      wingPanelGeo2.dispose();
      wingPanelGeo3.dispose();
      tailGeo.dispose();
      coreGeo.dispose();
      ringGeo1.dispose();
      ringGeo2.dispose();
      particleGeo.dispose();
      shadowGeo.dispose();
      shadowTex.dispose();

      ravenMaterial.dispose();
      holoAccentMaterial.dispose();
      energyCoreMaterial.dispose();
      ringsMaterial.dispose();
      particleMat.dispose();
      shadowMat.dispose();

      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [interactive]);

  return (
    <div className={`relative flex items-center justify-center overflow-hidden ${className}`}>
      {/* 3D WebGL Canvas Container */}
      <div ref={mountRef} className="w-full h-full min-h-[320px] max-h-[500px]" />

      {/* Floating Neumorphic Status Badge */}
      <div className="absolute bottom-3 right-3 px-3 py-1.5 rounded-xl bg-white/75 backdrop-blur-md shadow-sm border border-slate-200/60 text-xs font-semibold text-slate-700 flex items-center gap-2 pointer-events-none">
        <span className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
        <span>تميمة الغراب الذكية · طاقة المستوى {level}</span>
      </div>
    </div>
  );
};
