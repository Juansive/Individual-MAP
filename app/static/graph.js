// 星图：把素材库画成 3D 神经网络。
// 数据来自 /api/graph；ForceGraph3D、THREE、UnrealBloomPass、CSS2DRenderer/CSS2DObject 来自 vendor/graph-lib.js。

const el = document.getElementById("graph");
const panel = document.getElementById("panel");

const state = {
  hoverNode: null,
  selected: null,
  hiddenKinds: new Set(),
  lowFx: false,
  layered: false,
  minYear: 0,
  dragging: null,
  celebrating: false,  // 正在播放升级庆祝
  group: null,         // 点亮面板里点了某个等级后，一起高亮的那组节点
  achvCollapsed: false,
  linkMode: "simple",  // 连线开关，见 linkModeAllows()
  drawerCollapsed: false,  // 左栏抽屉收起
  immersive: false,        // 沉浸模式（不记住，每次打开都是正常模式）
  userMoved: false,  // 用户动过镜头或拖过小球后，就不再自动调整镜头
};
const highlightNodes = new Set();
const highlightLinks = new Set();

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
));

const BG_COLOR = 0x05060b;

// 深色背景上，把类型颜色的饱和度稍微降一点，看起来更协调
const tone = (hex) => new THREE.Color(hex).offsetHSL(0, -0.12, 0.02);

// ---------------------------------------------------------------- 小球外观

function canvasTexture(size, draw) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  draw(c.getContext("2d"), size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// 柔和光晕：中心亮、向外透明
const GLOW_TEXTURE = canvasTexture(128, (ctx, s) => {
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, "rgba(255,255,255,.9)");
  g.addColorStop(0.3, "rgba(255,255,255,.18)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
});

// 待完善条目外面的橙色虚线光圈
const RING_TEXTURE = canvasTexture(128, (ctx, s) => {
  ctx.strokeStyle = "#ffa94d";
  ctx.lineWidth = 4;
  ctx.setLineDash([9, 8]);
  ctx.beginPath();
  ctx.arc(s / 2, s / 2, s / 2 - 6, 0, Math.PI * 2);
  ctx.stroke();
});

// 恒星日冕：一圈长短交错、向外渐隐的光芒
const CORONA_TEXTURE = canvasTexture(256, (ctx, s) => {
  ctx.translate(s / 2, s / 2);
  for (let i = 0; i < 16; i++) {
    ctx.rotate((Math.PI * 2) / 16);
    const len = (s / 2) * (i % 2 ? 0.55 : 0.95);
    const g = ctx.createLinearGradient(0, 0, len, 0);
    g.addColorStop(0, "rgba(255,255,255,.85)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, -3);
    ctx.lineTo(len, 0);
    ctx.lineTo(0, 3);
    ctx.fill();
  }
});

// 升级冲击波：一圈实心光环
const SHOCK_TEXTURE = canvasTexture(256, (ctx, s) => {
  ctx.strokeStyle = "rgba(255,255,255,.95)";
  ctx.shadowColor = "#fff";
  ctx.shadowBlur = 18;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(s / 2, s / 2, s / 2 - 24, 0, Math.PI * 2);
  ctx.stroke();
});

// 分支 Lv4 的柔光晕：中间空、贴着球边最亮、向外慢慢散开（不是一道清晰的环）
const SOFT_HALO_TEXTURE = canvasTexture(128, (ctx, s) => {
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, "rgba(255,255,255,0)");
  g.addColorStop(0.38, "rgba(255,255,255,0)");
  g.addColorStop(0.5, "rgba(255,255,255,.6)");
  g.addColorStop(0.62, "rgba(255,255,255,.2)");
  g.addColorStop(0.8, "rgba(255,255,255,.04)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
});

// 分支 Lv5 的十字星芒：上下左右四道细长光芒。中间留空，光芒从球的边缘外才亮起，闪的时候不会把球盖住
const SPARKLE_TEXTURE = canvasTexture(256, (ctx, s) => {
  ctx.translate(s / 2, s / 2);
  for (let i = 0; i < 4; i++) {
    ctx.rotate(Math.PI / 2);
    const g = ctx.createLinearGradient(0, 0, s / 2, 0);
    g.addColorStop(0, "rgba(255,255,255,0)");
    g.addColorStop(0.14, "rgba(255,255,255,0)");
    g.addColorStop(0.22, "rgba(255,255,255,1)");
    g.addColorStop(0.45, "rgba(255,255,255,.4)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, -6);
    ctx.lineTo(s / 2, 0);
    ctx.lineTo(0, 6);
    ctx.fill();
  }
});

// “玻璃珠”材质：中心暗而通透，边缘一圈亮的轮廓光（Fresnel 效果），像显微镜下的神经元胞体
function orbMaterial(color) {
  return new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      color: { value: color },
      opacity: { value: 1 },
      intensity: { value: 1 },
    }]),
    vertexShader: `
      #include <fog_pars_vertex>
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vNormal = normalize(normalMatrix * normal);
        vView = normalize(-mvPosition.xyz);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      uniform vec3 color;
      uniform float opacity;
      uniform float intensity;
      varying vec3 vNormal;
      varying vec3 vView;
      #include <fog_pars_fragment>
      void main() {
        float rim = pow(1.0 - abs(dot(normalize(vNormal), normalize(vView))), 2.2);
        vec3 c = mix(color * 0.22, color * 1.05 + vec3(0.08), rim) * intensity;
        gl_FragColor = vec4(c, mix(0.3, 1.0, rim) * opacity);
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    fog: true,
  });
}

function makeLabel(node) {
  const div = document.createElement("div");
  div.className = `node-label ${node.type}`;
  div.textContent = node.label.length > 14 ? node.label.slice(0, 13) + "…" : node.label;
  div.style.setProperty("--c", node.color);
  const label = new CSS2DObject(div);
  label.center.set(0.5, 1);  // 文字底边对准小球顶部
  return label;
}

const noRaycast = () => {};  // 光晕、光圈不参与鼠标拾取，只有球体本身能被悬停

// 星系盘：几条旋臂的星尘，倾斜着缓慢旋转。返回 { tilt: 外层（负责倾斜），disc: 内层（负责旋转） }
function galaxyDisc(r, color, arms) {
  const count = arms * 470;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const white = new THREE.Color(1, 1, 1);
  const c = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const t = Math.random() ** 1.6;               // 0 = 靠近中心，1 = 最外圈；平方让星尘往里聚
    const radius = r * (2.2 + t * 3.4);
    const spread = 0.25 + t * 0.35;               // 越往外旋臂越散
    const angle = (i % arms) * (Math.PI * 2 / arms) + t * 3.6 + (Math.random() - 0.5) * spread;
    positions.set([Math.cos(angle) * radius, (Math.random() - 0.5) * r * 0.18, Math.sin(angle) * radius], i * 3);
    c.copy(color).lerp(white, 0.6 * (1 - t)).multiplyScalar(1 - t * 0.55);  // 越往外越暗
    colors.set([c.r, c.g, c.b], i * 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const disc = new THREE.Points(geometry, new THREE.PointsMaterial({
    size: r * 0.22, map: GLOW_TEXTURE, vertexColors: true, transparent: true, opacity: 0.75,
    depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  disc.raycast = noRaycast;
  const tilt = new THREE.Object3D();
  tilt.rotation.set(0.5, 0, 0.25);
  tilt.add(disc);
  return { tilt, disc };
}

// ---------------------------------------------------------------- 大类的进化路线（Lv3 起）
// 每条路线一个函数，按等级往大类的小球上叠特效。fx 里是 makeNodeObject 提供的材料和工具：
//   group、r（半径）、color、white、level、shell、nucleus、
//   addAura / orbiter / addBelts / addProminence（见 makeNodeObject），sats（绕行小球），
//   updaters：逐帧动画 (dt, 秒, fade) => void，fade 是悬停时的明暗（0~1）
// 返回 { coronas, galaxy, dark }：日冕、星系盘交给 animate 里原有的代码处理；dark 表示内核变暗（黑洞）。

// 星云丝：几道弯曲的发光细丝，边缘渐隐
const WISP_TEXTURE = canvasTexture(256, (ctx, s) => {
  ctx.strokeStyle = "rgba(255,255,255,.55)";
  ctx.shadowColor = "#fff";
  ctx.shadowBlur = 16;
  ctx.lineCap = "round";
  for (let i = 0; i < 7; i++) {
    ctx.lineWidth = 3 + Math.random() * 6;
    ctx.beginPath();
    const a = Math.random() * Math.PI * 2;
    ctx.moveTo(s / 2 + Math.cos(a) * s * 0.08, s / 2 + Math.sin(a) * s * 0.08);
    ctx.bezierCurveTo(
      Math.random() * s, Math.random() * s, Math.random() * s, Math.random() * s,
      s / 2 + Math.cos(a + 2) * s * 0.42, s / 2 + Math.sin(a + 2) * s * 0.42,
    );
    ctx.stroke();
  }
  // 圆形渐隐蒙版：贴图边缘不留硬边
  const mask = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  mask.addColorStop(0, "rgba(0,0,0,1)");
  mask.addColorStop(0.6, "rgba(0,0,0,.7)");
  mask.addColorStop(1, "rgba(0,0,0,0)");
  ctx.globalCompositeOperation = "destination-in";
  ctx.fillStyle = mask;
  ctx.fillRect(0, 0, s, s);
});

// 光束：根部亮、末端透明（贴在开口圆柱上，用于脉冲星光束、黑洞喷流）
const BEAM_TEXTURE = canvasTexture(64, (ctx, s) => {
  const g = ctx.createLinearGradient(0, s, 0, 0);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.3, "rgba(255,255,255,.45)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
});

// 极光：横向绿 → 青 → 紫的色带，下沿最亮、往上渐隐，带一些竖向的光丝
const AURORA_TEXTURE = canvasTexture(256, (ctx, s) => {
  const h = ctx.createLinearGradient(0, 0, s, 0);
  ["#5cffb0", "#5ce1ff", "#b48cff", "#5cffb0"].forEach((c, i, arr) => h.addColorStop(i / (arr.length - 1), c));
  ctx.fillStyle = h;
  ctx.fillRect(0, 0, s, s);
  ctx.fillStyle = "rgba(255,255,255,.35)";
  for (let x = 0; x < s; x += 3 + Math.random() * 6) ctx.fillRect(x, 0, 1 + Math.random() * 2, s);
  const v = ctx.createLinearGradient(0, s, 0, 0);
  v.addColorStop(0, "rgba(0,0,0,0)");
  v.addColorStop(0.12, "rgba(0,0,0,.9)");
  v.addColorStop(0.45, "rgba(0,0,0,.35)");
  v.addColorStop(1, "rgba(0,0,0,0)");
  ctx.globalCompositeOperation = "destination-in";
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, s, s);
});

// 吸积盘：内圈白热、往外变橙变红，带一些旋转的条纹（贴在 RingGeometry 上，贴图的外圆就是盘的外沿）
const DISC_TEXTURE = canvasTexture(256, (ctx, s) => {
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, "rgba(255,255,255,0)");
  g.addColorStop(0.36, "rgba(255,255,255,0)");
  g.addColorStop(0.4, "rgba(255,246,225,1)");
  g.addColorStop(0.55, "rgba(255,170,70,.85)");
  g.addColorStop(0.8, "rgba(210,70,20,.35)");
  g.addColorStop(1, "rgba(120,30,10,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  ctx.strokeStyle = "rgba(255,230,190,.35)";
  for (let i = 0; i < 26; i++) {
    const radius = s * (0.21 + Math.random() * 0.26);
    const start = Math.random() * Math.PI * 2;
    ctx.lineWidth = 1 + Math.random() * 2;
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, radius, start, start + 0.6 + Math.random() * 1.4);
    ctx.stroke();
  }
});

const additive = (opts) => ({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, ...opts });

// 一道光束：从原点沿 +y 射出的开口圆锥
function makeBeam(length, width, tint) {
  const geometry = new THREE.CylinderGeometry(width, width * 0.15, length, 16, 1, true);
  geometry.translate(0, length / 2, 0);
  const beam = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial(additive({
    map: BEAM_TEXTURE, color: tint, side: THREE.DoubleSide,
  })));
  beam.raycast = noRaycast;
  return beam;
}

// 一对方向相反的光束，放在 parent 里（parent 决定朝向）
function beamPair(parent, length, width, tint) {
  const up = makeBeam(length, width, tint);
  const down = makeBeam(length, width, tint);
  down.rotation.x = Math.PI;
  parent.add(up, down);
  return [up, down];
}

// 一团星云：许多大而淡的光点，颜色在本色附近浮动。flat < 1 时压扁成盘状
function nebulaCloud(r, color, count, rMin, rMax, flat, size, opacity) {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const dir = new THREE.Vector3().randomDirection();
    const radius = r * (rMin + Math.random() ** 0.7 * (rMax - rMin));
    positions.set([dir.x * radius, dir.y * radius * flat, dir.z * radius], i * 3);
    c.copy(color).offsetHSL((Math.random() - 0.5) * 0.3, 0.1, (Math.random() - 0.3) * 0.2);
    colors.set([c.r, c.g, c.b], i * 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const cloud = new THREE.Points(geometry, new THREE.PointsMaterial(additive({
    size, map: GLOW_TEXTURE, vertexColors: true, opacity,
  })));
  cloud.raycast = noRaycast;
  cloud.userData.base = opacity;
  return cloud;
}

// 恒星日冕：两层长短交错的光芒，慢慢转
function makeCoronas(fx, strong) {
  return [[7, 0.45], [5, 0.3]].map(([scale, base]) => {
    const corona = new THREE.Sprite(new THREE.SpriteMaterial(additive({
      map: CORONA_TEXTURE, color: fx.color.clone().lerp(fx.white, 0.35),
    })));
    corona.scale.setScalar(fx.r * scale);
    corona.raycast = noRaycast;
    corona.userData = { base, strong };  // 满级时日冕脉动更明显
    fx.group.add(corona);
    return corona;
  });
}

// ☀️ 恒星之路：伴星群 → 光冕呼吸 → 日珥 → 日冕 → 双臂星系盘 → 三臂星系盘
function starPathFx(fx) {
  const { r, color, white, level } = fx;
  for (let i = 0; i < 4; i++) {                                                     // Lv3 伴星群
    fx.sats.push(fx.orbiter(color.clone().lerp(white, 0.7), r * 0.09, r * (1.3 + i * 0.12), 1.2 + i * 0.3));
  }
  if (level >= 4) {                                                                 // Lv4 光冕呼吸
    fx.addAura(SOFT_HALO_TEXTURE, color.clone().lerp(white, 0.25), 4.2, 0.28, { pulse: true, breathe: true });
  }
  if (level >= 5) {                                                                 // Lv5 日珥
    const tint = new THREE.Color("#ff8a3d").lerp(color, 0.1);  // 日珥是暖橙色的，只带一点本色
    for (let i = 0; i < 3; i++) fx.addProminence(tint);
  }
  return {
    coronas: level >= 6 ? makeCoronas(fx, level >= 8) : [],                        // Lv6 日冕
    galaxy: level >= 7 ? galaxyDisc(r, color, level >= 8 ? 3 : 2) : null,           // Lv7 双臂 / Lv8 三臂星系盘
  };
}

// 🪐 行星之路：卫星群 → 星环 → 双环 → 环 + 卫星带 → 环带星系 → 王冠环系
function planetPathFx(fx) {
  const { r, color, white, level, group, updaters } = fx;
  const grey = new THREE.Color("#8d94a8");
  for (let i = 0; i < 5; i++) {                                                     // Lv3 卫星群：比伴星大，颜色深浅不一
    const tint = color.clone().lerp(i % 2 ? white : grey, 0.45);
    fx.sats.push(fx.orbiter(tint, r * (0.11 + (i % 3) * 0.03), r * (1.7 + i * 0.28), 0.35 + Math.random() * 0.4));
  }
  if (level >= 4) fx.addBelts(fx.TILT_A, 1, [0.55, 0.25]);                         // Lv4 星环
  if (level >= 5) fx.addBelts(fx.TILT_B, 1.18, [0.4, 0.2]);                        // Lv5 第二道星环
  if (level >= 6) {                                                                 // Lv6 卫星带：主环外一圈碎石般的小卫星
    const count = 260;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const radius = r * (2.1 + Math.random() * 0.35);
      positions.set([Math.cos(a) * radius, Math.sin(a) * radius, (Math.random() - 0.5) * r * 0.08], i * 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const belt = new THREE.Points(geometry, new THREE.PointsMaterial(additive({
      size: r * 0.14, map: GLOW_TEXTURE, color: new THREE.Color("#ffe2a0").lerp(color, 0.3),
    })));
    belt.raycast = noRaycast;
    const tilt = new THREE.Object3D();
    tilt.rotation.set(...fx.TILT_A);  // 和主环在同一个平面上
    tilt.add(belt);
    group.add(tilt);
    updaters.push((dt, t, fade) => {
      belt.rotation.z += dt * 0.12;
      belt.material.opacity = 0.75 * fade;
    });
  }
  if (level >= 8) {                                                                 // Lv8 王冠环系：三道不同倾角的彩色细环，缓慢进动
    ["#7fe8ff", "#ff9ee0", "#ffe08a"].forEach((hex, i) => {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(r * (2.6 + i * 0.28), r * (2.66 + i * 0.28), 96),
        new THREE.MeshBasicMaterial(additive({ color: hex, side: THREE.DoubleSide })),
      );
      ring.raycast = noRaycast;
      ring.rotation.set(Math.PI / 2 + (i - 1) * 0.7, 0, i * 0.5);
      const pivot = new THREE.Object3D();
      pivot.add(ring);
      group.add(pivot);
      updaters.push((dt, t, fade) => {
        pivot.rotation.y += dt * (0.08 + i * 0.04);
        ring.material.opacity = 0.6 * fade;
      });
    });
  }
  return { galaxy: level >= 7 ? galaxyDisc(r, color, 2) : null };                  // Lv7 环带星系
}

// 🌌 星云之路：彩色星云丝 → 星云团 → 脉冲光束 → 极光带 → 星云海 → 超新星遗迹
function nebulaPathFx(fx) {
  const { r, color, white, level, group, updaters } = fx;
  for (let i = 0; i < 3; i++) {                                                     // Lv3 彩色星云丝，各自慢慢转
    fx.addAura(WISP_TEXTURE, color.clone().offsetHSL((i - 1) * 0.12, 0.1, 0.05), 5 + i, 0.4,
      { spin: (i % 2 ? -1 : 1) * (0.05 + i * 0.03), rotation: Math.random() * Math.PI * 2 });
  }
  const addCloud = (cloud, spin) => {
    group.add(cloud);
    updaters.push((dt, t, fade) => {
      cloud.rotation.y += dt * spin;
      cloud.material.opacity = cloud.userData.base * fade;
    });
  };
  if (level >= 4) addCloud(nebulaCloud(r, color, 110, 1.3, 3.2, 1, r * 1.1, 0.2), 0.05);  // Lv4 星云团
  if (level >= 5) {                                                                 // Lv5 脉冲光束：一对光束像灯塔一样扫过
    const spinner = new THREE.Object3D();
    const axis = new THREE.Object3D();
    axis.rotation.z = 0.6;  // 光束和自转轴有夹角，转起来才会“扫”
    spinner.add(axis);
    group.add(spinner);
    const beams = beamPair(axis, r * 5, r * 0.18, color.clone().lerp(white, 0.35));
    updaters.push((dt, t, fade) => {
      spinner.rotation.y += dt * 1.4;
      beams.forEach((b) => { b.material.opacity = (0.16 + 0.06 * Math.sin(t * 9)) * fade; });
    });
  }
  if (level >= 6) {                                                                 // Lv6 极光带：一圈上下起伏的光幕
    const geometry = new THREE.CylinderGeometry(r * 2, r * 2, r * 0.9, 96, 1, true);
    const rest = geometry.attributes.position.array.slice();
    const band = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial(additive({
      map: AURORA_TEXTURE, side: THREE.DoubleSide,
    })));
    band.raycast = noRaycast;
    const tilt = new THREE.Object3D();
    tilt.rotation.set(0.35, 0, 0.2);
    tilt.add(band);
    group.add(tilt);
    updaters.push((dt, t, fade) => {
      const pos = geometry.attributes.position.array;
      for (let i = 0; i < pos.length; i += 3) {
        const a = Math.atan2(rest[i + 2], rest[i]);
        pos[i + 1] = rest[i + 1] + Math.sin(a * 3 + t * 1.1) * r * 0.2;  // 绕一圈起伏三次，波浪慢慢往前走
      }
      geometry.attributes.position.needsUpdate = true;
      band.rotation.y += dt * 0.08;
      band.material.opacity = 0.3 * fade * (0.8 + 0.2 * Math.sin(t * 0.9));
    });
  }
  if (level >= 7) addCloud(nebulaCloud(r, color, 900, 2.4, 7, 0.22, r * 0.5, 0.28), 0.03);  // Lv7 星云海
  if (level >= 8) {                                                                 // Lv8 超新星遗迹：两层光壳轮流向外膨胀、淡出
    [0, 0.5].forEach((offset) => {
      const shellRing = new THREE.Sprite(new THREE.SpriteMaterial(additive({
        map: SHOCK_TEXTURE, color: color.clone().lerp(white, 0.4),
      })));
      shellRing.raycast = noRaycast;
      group.add(shellRing);
      updaters.push((dt, t, fade) => {
        const k = (t / 7 + offset) % 1;
        shellRing.scale.setScalar(r * (2.5 + k * 7));
        shellRing.material.opacity = 0.45 * (1 - k) ** 1.5 * fade;
      });
    });
  }
  return {};
}

// ⚫ 黑洞之路（稀有）：暗核 → 吸积盘 → 引力透镜光环 → 喷流 → 双喷流 + 炽热吸积盘 → 类星体
function blackholePathFx(fx) {
  const { r, white, level, group, updaters } = fx;
  // Lv3 暗核：内核换成一个大的黑球，外面一圈深紫色的视界光
  fx.nucleus.geometry.dispose();
  fx.nucleus.geometry = new THREE.SphereGeometry(r * 0.78, 24, 16);
  fx.nucleus.material.color.set(0x000000);
  fx.addAura(SOFT_HALO_TEXTURE, new THREE.Color("#7a5cff"), 3.6, 0.5, { pulse: true });

  // 吸积盘和喷流放在同一个倾斜的平面里：盘在 XY 平面，喷流沿盘的法线（Z 轴）
  const tilt = new THREE.Object3D();
  tilt.rotation.set(Math.PI / 2 - 0.3, 0, 0.25);
  group.add(tilt);
  const addDisc = (scale, tint, base, speed) => {
    const disc = new THREE.Mesh(
      new THREE.RingGeometry(r * 1.2 * scale, r * 3.3 * scale, 96),
      new THREE.MeshBasicMaterial(additive({ map: DISC_TEXTURE, color: tint, side: THREE.DoubleSide })),
    );
    disc.raycast = noRaycast;
    tilt.add(disc);
    updaters.push((dt, t, fade) => {
      disc.rotation.z += dt * speed;
      disc.material.opacity = base * fade;
    });
  };
  if (level >= 4) addDisc(1, new THREE.Color("#ffd9a8"), 0.85, 0.5);               // Lv4 吸积盘
  if (level >= 5) fx.addAura(SHOCK_TEXTURE, new THREE.Color("#ffcf8a"), 2.5, 0.6); // Lv5 引力透镜光环（永远正对镜头）
  if (level >= 6) {                                                                 // Lv6 喷流（Lv7 更长更亮）
    const jetAxis = new THREE.Object3D();
    jetAxis.rotation.x = Math.PI / 2;  // 光束默认沿 Y 轴，转到盘的法线方向
    tilt.add(jetAxis);
    const strong = level >= 7;
    const jets = beamPair(jetAxis, r * (strong ? 8 : 5.5), r * 0.22, new THREE.Color("#9fc4ff").lerp(white, 0.3));
    updaters.push((dt, t, fade) => {
      const flicker = 0.85 + 0.15 * Math.sin(t * 13) * Math.sin(t * 7.3);
      jets.forEach((j) => { j.material.opacity = (strong ? 0.7 : 0.4) * flicker * fade; });
    });
  }
  if (level >= 7) addDisc(1.12, white, 0.45, 0.9);                                 // Lv7 炽热吸积盘：再叠一层更白、转得更快的
  if (level >= 8) fx.addAura(GLOW_TEXTURE, new THREE.Color("#dfe8ff"), 13, 0.3, { pulse: true });  // Lv8 类星体强光
  return { dark: true };
}

const KIND_PATH_FX = { star: starPathFx, planet: planetPathFx, nebula: nebulaPathFx, blackhole: blackholePathFx };

function makeNodeObject(node) {
  const r = node.type === "me" ? 4.5 : node.size * 0.5;
  const color = node.type === "me" ? new THREE.Color("#e8ecff") : tone(node.color);
  const geometry = {
    skill: () => new THREE.OctahedronGeometry(r),
    org: () => new THREE.DodecahedronGeometry(r),
  }[node.type]?.() ?? new THREE.SphereGeometry(r, 32, 24);

  const dim = node.type === "entry" && node.issues.length > 0;
  const group = new THREE.Group();

  // 外壳：玻璃珠
  const shell = new THREE.Mesh(geometry, orbMaterial(color));
  group.add(shell);

  // 内核：一个小亮点，辉光主要从这里发出
  const nucleus = new THREE.Mesh(
    // 中心和 Lv2 以上的大类内核更大更亮
    new THREE.SphereGeometry(r * (node.type === "me" || (node.type === "kind" && node.growth >= 2) ? 0.45 : 0.36), 16, 12),
    new THREE.MeshBasicMaterial({ color: color.clone().lerp(new THREE.Color(1, 1, 1), 0.45), transparent: true }),
  );
  nucleus.raycast = noRaycast;
  group.add(nucleus);

  // 光晕：很淡，只是给小球一点“空气感”
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: GLOW_TEXTURE, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  halo.scale.setScalar(r * (node.type === "me" ? 6 : 3.4));
  halo.raycast = noRaycast;
  group.add(halo);

  let ring = null;
  if (dim) {
    ring = new THREE.Sprite(new THREE.SpriteMaterial({ map: RING_TEXTURE, transparent: true, depthWrite: false }));
    ring.scale.setScalar(r * 3.2);
    ring.raycast = noRaycast;
    group.add(ring);
  }

  // 中心、类型、技能、机构节点常驻文字标签；条目靠悬停信息卡
  let label = null;
  if (node.type !== "entry") {
    label = makeLabel(node);
    label.position.y = r + 1.5;
    group.add(label);
  }

  // ---- 成长特效（等级规则见 app/levels.py）
  // 按层级分配，保证大类始终比它的分支更耀眼：
  //   分支：卫星（Lv3+）、柔光晕（Lv4+）、十字星芒（Lv5，偶尔一闪）
  //   核心技能（被 4 条以上经历用到）：缓慢旋转的晶体外壳
  //   星环只留给大类，分支和技能都不用环，免得看起来都一样
  //   大类 8 级，每升一级多一样。Lv1 星雾、Lv2 变大变亮所有大类一样；Lv3 起按进化路线（node.path）各走各的，
  //   见上面的 starPathFx / planetPathFx / nebulaPathFx / blackholePathFx；满级都有金色光晕
  const white = new THREE.Color(1, 1, 1);
  const kindLv = node.type === "kind" ? node.growth : 0;

  // 叠加发光贴图（星雾、光晕……），base 是基础亮度。选项：pulse 缓慢明暗脉动，breathe 大小也一胀一缩，
  // spin 每秒转多少弧度，rotation 初始角度
  const auras = [];
  const addAura = (map, tint, scale, base, { pulse = false, breathe = false, spin = 0, rotation = 0 } = {}) => {
    const aura = new THREE.Sprite(new THREE.SpriteMaterial({
      map, color: tint, rotation, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    aura.scale.setScalar(r * scale);
    aura.raycast = noRaycast;
    aura.userData = { base, pulse, breathe, spin, size: r * scale };
    group.add(aura);
    auras.push(aura);
  };

  // 日珥：从球面跃出的拱形光弧，此起彼伏地伸缩（恒星之路 Lv5）
  const prominences = [];
  const addProminence = (tint) => {
    const pivot = new THREE.Object3D();  // 负责朝向：光弧从球面上随机一点跃出
    pivot.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3().randomDirection());
    const arc = new THREE.Mesh(
      new THREE.TorusGeometry(r * 0.45, r * 0.07, 8, 32, Math.PI),  // 半个圆环 = 一道拱
      new THREE.MeshBasicMaterial({ color: tint, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    arc.position.y = r * 0.85;  // 两脚扎在球面附近
    arc.rotation.y = Math.random() * Math.PI;
    arc.raycast = noRaycast;
    pivot.add(arc);
    group.add(pivot);
    prominences.push({ arc, phase: Math.random() * Math.PI * 2 });
  };

  // 绕行的小球：分支的卫星、大类的伴星。各自在随机倾斜的轨道上转
  const orbiter = (tint, size, radius, speed) => {
    const pivot = new THREE.Object3D();
    pivot.rotation.set((Math.random() - 0.5) * 1.6, Math.random() * Math.PI * 2, (Math.random() - 0.5) * 1.6);
    const moon = new THREE.Mesh(new THREE.SphereGeometry(size, 12, 8), new THREE.MeshBasicMaterial({ color: tint, transparent: true }));
    moon.position.x = radius;
    moon.raycast = noRaycast;
    pivot.add(moon);
    group.add(pivot);
    return { pivot, moon, speed };  // speed：角速度，弧度/秒
  };

  // 金色星环：一宽一窄两道，像土星环；tilt 决定倾斜方向
  const belts = [];
  const addBelts = (tilt, scale, bases) => {
    [[1.5, 1.72], [1.8, 1.88]].forEach(([inner, outer], i) => {
      const belt = new THREE.Mesh(
        new THREE.RingGeometry(r * inner * scale, r * outer * scale, 72),
        new THREE.MeshBasicMaterial({
          color: 0xffd27a, side: THREE.DoubleSide, transparent: true, depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      belt.rotation.set(...tilt);
      belt.raycast = noRaycast;
      belt.userData.base = bases[i];
      group.add(belt);
      belts.push(belt);
    });
  };
  const TILT_A = [Math.PI / 2 - 0.45, 0, 0.35];
  const TILT_B = [Math.PI / 2 + 0.55, 0, -0.6];

  // 分支 Lv3 起：卫星。每颗代表一个证明文件（暖白）或一条成果要点（本色）
  const sats = (node.satellites ?? []).map((s, i) => orbiter(
    s.type === "file" ? new THREE.Color("#ffe2a0") : color.clone().lerp(white, 0.5),
    Math.max(0.45, r * 0.16), r * (2.1 + i * 0.35), 0.5 + Math.random() * 0.6,
  ));
  const gold = new THREE.Color("#ffd27a");
  const entryLv = node.type === "entry" ? node.growth : 0;
  if (entryLv >= 4) addAura(SOFT_HALO_TEXTURE, gold.clone().lerp(white, 0.25), 4.4, entryLv >= 5 ? 0.7 : 0.55, { pulse: true });  // Lv4 柔光晕

  // Lv5 十字星芒：平时淡淡的，每隔几秒“叮”地亮一下（相位随机，免得所有星芒一起闪）
  let sparkle = null;
  if (entryLv >= 5) {
    sparkle = new THREE.Sprite(new THREE.SpriteMaterial({
      map: SPARKLE_TEXTURE, color: gold.clone().lerp(white, 0.5), transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending,
    }));
    sparkle.scale.setScalar(r * 7);
    sparkle.raycast = noRaycast;
    sparkle.userData = { phase: Math.random() * Math.PI * 2, size: r * 7 };
    group.add(sparkle);
  }

  // 核心技能：外面套一层缓慢旋转的线框二十面体，像晶体
  let crystal = null;
  if (node.star) {
    crystal = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(r * 1.75)),
      new THREE.LineBasicMaterial({
        color: color.clone().lerp(white, 0.4), transparent: true, depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    crystal.raycast = noRaycast;
    group.add(crystal);
  }

  // 大类逐级叠加：Lv1 星雾、Lv2 变大变亮（内核，见上）所有大类一样；Lv3 起交给进化路线
  if (kindLv >= 1) addAura(GLOW_TEXTURE, color, 7, 0.12);                          // Lv1 星雾
  const updaters = [];  // 各路线特效的逐帧动画
  let coronas = [];
  let galaxy = null;
  let dark = false;
  if (kindLv >= 3) {
    const fx = {
      group, r, color, white, level: kindLv, shell, nucleus, sats, updaters, TILT_A, TILT_B,
      addAura, orbiter, addBelts, addProminence,
    };
    ({ coronas = [], galaxy = null, dark = false } = (KIND_PATH_FX[node.path] ?? starPathFx)(fx));
  }
  if (galaxy) group.add(galaxy.tilt);
  if (kindLv >= 8) addAura(GLOW_TEXTURE, new THREE.Color("#ffcf6b"), 11, 0.22, { pulse: true });  // Lv8 金色光晕

  // 动画状态：fade 明暗（1 = 正常，接近 0 = 被淡化），boost 悬停加亮，pulse 放电闪光
  node.__parts = {
    group, shell, nucleus, halo, ring, label, sats, belts, coronas, galaxy, auras, sparkle, crystal, prominences,
    updaters,
    baseOpacity: dim ? 0.55 : 1,
    // 光晕亮度：大类越高越亮；黑洞的光晕压暗，衬出黑色的核
    baseHalo: (node.type === "me" ? 0.35 : dim ? 0.12 : 0.22)
      * (dark ? 0.35 : coronas.length ? 1.6 : kindLv >= 2 ? 1.3 : 1),
    fade: 1, targetFade: 1, boost: 0, targetBoost: 0, pulse: 0, labelOpacity: 1,
  };
  return group;
}

// ---------------------------------------------------------------- 悬停信息卡

// 条目的关联经历，按“从这个条目看”的说法：[{ label: "产出", node }]
function relationsOf(node) {
  return node.links.filter((l) => l.type === "relation").map((l) =>
    l.source === node ? { label: l.outLabel, node: l.target } : { label: l.inLabel, node: l.source });
}

// 成长等级 + 进度条 + 升到下一级还差什么
function growthBlock(node) {
  const next = node.nextSteps.length
    ? `<div class="tip-next">升级：${node.nextSteps.map(esc).join("；")}</div>`
    : `<div class="tip-next max">已达最高等级 ✦</div>`;
  const path = node.pathName ? `<div class="tip-path">${node.pathIcon} ${esc(node.pathName)}</div>` : "";
  return `<div class="tip-growth">
      <span class="lv">Lv.${node.growth}</span><span class="lv-name">${esc(node.growthName)}</span>
      <span class="lv-bar"><i style="width:${Math.round(node.progress * 100)}%"></i></span>
    </div>${path}${next}`;
}

function tooltip(node) {
  if (node.type === "entry") {
    const meta = [node.org, node.role, node.level].filter(Boolean).join(" · ");
    const rels = relationsOf(node);
    return `<div class="tip" style="--c:${node.color}">
      <div class="tip-head"><span class="tip-kind">${esc(node.kindLabel)}</span><span class="tip-period">${esc(node.period)}</span></div>
      <div class="tip-title">${esc(node.label)}</div>
      ${meta ? `<div class="tip-meta">${esc(meta)}</div>` : ""}
      ${node.skills.length ? `<div class="tip-chips">${node.skills.map((s) => `<span class="tip-chip">${esc(s)}</span>`).join("")}</div>` : ""}
      ${rels.length ? `<div class="tip-rels">${rels.map((r) => `<div><b>${esc(r.label)}</b> ${esc(r.node.label)}</div>`).join("")}</div>` : ""}
      ${growthBlock(node)}
      ${node.highlights.length
        ? `<ul class="tip-hl">${node.highlights.map((h) => `<li>${esc(h)}</li>`).join("")}</ul>`
        : node.description ? `<div class="tip-desc">${esc(node.description)}</div>` : ""}
      <div class="tip-foot">${node.files ? `<span>📎 ${node.files} 个文件</span>` : ""}${node.issues.map((i) => `<span class="tip-issue">${esc(i)}</span>`).join("")}</div>
    </div>`;
  }
  if (node.type === "me") {
    const skills = graphData.nodes.filter((n) => n.type === "skill").length;
    return `<div class="tip" style="--c:#fff"><div class="tip-title">我</div>
      <div class="tip-meta">${node.count} 条经历 · ${skills} 项技能</div></div>`;
  }
  const entries = node.neighbors.filter((n) => n.type === "entry");
  return `<div class="tip" style="--c:${node.color}">
    <div class="tip-title">${esc(node.label)}</div>
    <div class="tip-meta">${node.type === "kind" ? `${node.count} 条经历` : `${node.categoryLabel ? `${esc(node.categoryLabel)} · ` : ""}关联 ${node.count} 个条目`}</div>
    ${node.star ? `<div class="tip-next max">✦ 核心技能</div>` : ""}
    ${node.type === "kind" ? growthBlock(node) : ""}
    <ul class="tip-list">${entries.slice(0, 5).map((e) => `<li>${esc(e.label)}</li>`).join("")}${entries.length > 5 ? "<li>…</li>" : ""}</ul>
  </div>`;
}

// ---------------------------------------------------------------- 高亮

function setHighlight(node) {
  highlightNodes.clear();
  highlightLinks.clear();
  if (node) {
    highlightNodes.add(node);
    node.neighbors.forEach((n) => highlightNodes.add(n));
    node.links.forEach((l) => highlightLinks.add(l));
  }
  state.hoverNode = node;
  // 只设定目标值，真正的明暗变化在 animate() 里逐帧渐变
  for (const n of graphData.nodes) {
    if (!n.__parts) continue;
    n.__parts.targetFade = !node || highlightNodes.has(n) ? 1 : 0.07;
    n.__parts.targetBoost = n === node ? 0.5 : 0;
  }
  refreshLinks();
}

function refreshLinks() {
  // “简洁”档下悬停会改变哪些连线可见，所以显隐也要一起刷新
  Graph.linkVisibility(Graph.linkVisibility())
    .linkColor(Graph.linkColor())
    .linkWidth(Graph.linkWidth())
    .linkDirectionalParticles(Graph.linkDirectionalParticles());
}

// 连线颜色：类型分支和技能连线用终点节点的颜色，机构和条目关联用固定颜色
const LINK_RGB = { org: "154,167,199", relation: "255,207,122" };
const linkRgb = (l) => LINK_RGB[l.type] ?? hexToRgb(l.target.color);

function hexToRgb(hex) {
  const v = parseInt(hex.slice(1), 16);
  return `${(v >> 16) & 255},${(v >> 8) & 255},${v & 255}`;
}

function linkColor(link) {
  const rgb = linkRgb(link);
  if (highlightLinks.has(link)) return `rgba(${rgb},0.85)`;
  return `rgba(${rgb},${highlightNodes.size ? 0.03 : link.type === "relation" ? 0.45 : 0.3})`;
}

// ---------------------------------------------------------------- 神经放电
// 每隔几秒随机挑一条经历，让一个光点从“我”出发，经过类型分支传到它，再传向它的某个技能或机构。

const HOP_MS = 650;

function linkBetween(a, b) {
  return a.links.find((l) => l.source === a && l.target === b);
}

function fire() {
  const entries = graphData.nodes.filter((n) => n.type === "entry" && n.__revealed && isVisible(n));
  if (state.lowFx || !entries.length || document.hidden) return;
  const entry = entries[Math.floor(Math.random() * entries.length)];
  const kindNode = nodeById.get(`kind:${entry.kind}`);
  const path = [linkBetween(nodeById.get("me"), kindNode), linkBetween(kindNode, entry)];
  const outward = entry.links.filter((l) => l.source === entry && linkShown(l));  // 只沿看得见的连线走
  if (outward.length) path.push(outward[Math.floor(Math.random() * outward.length)]);

  path.forEach((link, i) => {
    if (!link) return;
    setTimeout(() => Graph.emitParticle(link), i * HOP_MS);
    setTimeout(() => { if (link.target.__parts) link.target.__parts.pulse = 1; }, (i + 1) * HOP_MS);
  });
}

(function scheduleFire() {
  setTimeout(() => { fire(); scheduleFire(); }, 2200 + Math.random() * 2000);
})();

// ---------------------------------------------------------------- 时间分层（星盘年轮）
// 开启后整张网压成一个水平的星盘，每条经历被吸到自己年份的轨道上（越早越靠里）。
// 轨道代表年份，固定不动；拖走小球时轨道亮起、拉出牵引线，松手后小球像被橡皮筋拉回轨道。

const ringRadius = (year) => 45 + (year - state.minYear) * 32;

function orbitForce() {
  let nodes = [];
  function force(alpha) {
    for (const n of nodes) {
      if (n.type === "me") continue;
      // 压扁成星盘：经历几乎贴平，类型/技能/机构保留一点厚度，旋转时仍有立体感
      n.vy -= n.y * alpha * (n.type === "entry" ? 0.9 : 0.35);
      if (n.type !== "entry" || n.year == null) continue;
      const r = Math.hypot(n.x, n.z) || 1;
      const k = ((ringRadius(n.year) - r) / r) * Math.min(1, alpha * 3);
      n.vx += n.x * k;
      n.vz += n.z * k;
    }
  }
  force.initialize = (ns) => { nodes = ns; };
  return force;
}

const yearRings = new Map();  // 年份 → { ring, label }

function showYearRings(years) {
  yearRings.forEach(({ ring, label }) => Graph.scene().remove(ring, label));
  yearRings.clear();
  for (const y of years) {
    const radius = ringRadius(y);
    const points = Array.from({ length: 161 }, (_, i) => {
      const a = (i / 160) * Math.PI * 2;
      return new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius);
    });
    const ring = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({ color: 0x7b8fff, transparent: true, opacity: 0.14 }),
    );
    const div = document.createElement("div");
    div.className = "year-label";
    div.textContent = y;
    const label = new CSS2DObject(div);
    label.position.set(radius + 4, 0, 0);
    Graph.scene().add(ring, label);
    yearRings.set(y, { ring, label });
  }
}

function highlightRing(year, on) {
  const r = yearRings.get(year);
  if (!r) return;
  r.ring.material.opacity = on ? 0.7 : 0.14;
  r.ring.material.color.set(on ? 0xc4ceff : 0x7b8fff);
  r.label.element.classList.toggle("active", on);
}

// 牵引线：从被拖走的小球连到它在轨道上的“家”，家的位置用一个小光点标出
const tether = { node: null, line: null, dot: null };

function orbitAnchor(n) {
  const r = Math.hypot(n.x, n.z) || 1;
  const R = ringRadius(n.year);
  return new THREE.Vector3((n.x / r) * R, 0, (n.z / r) * R);
}

function startTether(node) {
  if (!state.layered || node.type !== "entry" || node.year == null) return;
  if (!tether.line) {
    tether.line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineBasicMaterial({ transparent: true }),
    );
    tether.dot = new THREE.Sprite(new THREE.SpriteMaterial({
      map: GLOW_TEXTURE, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    tether.dot.scale.setScalar(7);
    Graph.scene().add(tether.line, tether.dot);
  }
  if (tether.node && tether.node !== node) highlightRing(tether.node.year, false);
  tether.node = node;
  tether.line.material.color.copy(tone(node.color));
  tether.dot.material.color.copy(tone(node.color));
  tether.line.visible = tether.dot.visible = true;
  highlightRing(node.year, true);
}

function updateTether(home) {
  const n = tether.node;
  if (!n) return;
  const a = home ?? orbitAnchor(n);
  const pos = tether.line.geometry.attributes.position;
  pos.setXYZ(0, n.x, n.y, n.z);
  pos.setXYZ(1, a.x, a.y, a.z);
  pos.needsUpdate = true;
  tether.line.geometry.computeBoundingSphere();
  tether.dot.position.copy(a);
  // 像橡皮筋：拉得越长越淡（越“细”）
  const len = a.distanceTo(new THREE.Vector3(n.x, n.y, n.z));
  tether.line.material.opacity = Math.max(0.15, Math.min(0.85, 18 / (len + 1)));
}

function endTether() {
  if (!tether.node) return;
  highlightRing(tether.node.year, false);
  tether.node = null;
  tether.line.visible = tether.dot.visible = false;
}

// 弹簧回弹：松手后小球被“橡皮筋”拉回轨道，会稍微冲过头再晃一下停住
const spring = { node: null, pos: new THREE.Vector3(), vel: new THREE.Vector3(), home: new THREE.Vector3() };
const SPRING_K = 95;                                // 刚度：越大回得越快
const SPRING_C = 2 * 0.55 * Math.sqrt(SPRING_K);    // 阻尼：0.55 倍临界阻尼，冲过头约 10% 再轻轻回来

function startSpring(node) {
  spring.node = node;
  spring.pos.set(node.x, node.y, node.z);
  spring.vel.set(0, 0, 0);
  spring.home.copy(orbitAnchor(node));
  node.fx = node.x;
  node.fy = node.y;
  node.fz = node.z;
}

function stepSpring(dt) {
  const n = spring.node;
  if (!n) return;
  const offset = spring.pos.clone().sub(spring.home);
  const acc = offset.multiplyScalar(-SPRING_K).sub(spring.vel.clone().multiplyScalar(SPRING_C));
  spring.vel.addScaledVector(acc, dt);
  spring.pos.addScaledVector(spring.vel, dt);
  n.fx = spring.pos.x;
  n.fy = spring.pos.y;
  n.fz = spring.pos.z;
  forceGraph()?.resetCountdown();  // 让引擎继续跑，连线才会跟着小球动
  updateTether(spring.home);
  if (spring.pos.distanceTo(spring.home) < 0.5 && spring.vel.length() < 1.5) {
    delete n.fx;
    delete n.fy;
    delete n.fz;
    spring.node = null;
    endTether();
  }
}

function setLayered(on, { moveCamera = true } = {}) {
  state.layered = on;
  const years = [...new Set(graphData.nodes.filter((n) => n.year != null).map((n) => n.year))].sort();
  state.minYear = years[0];
  endTether();
  if (on && years.length) {
    Graph.d3Force("year", orbitForce());
    showYearRings(years);
    // 镜头抬高成俯视角度，方便看清一圈圈年轮
    if (moveCamera) {
      const d = Graph.camera().position.length();
      stopRotate();
      Graph.cameraPosition({ x: 0, y: d * 0.6, z: d * 0.8 }, { x: 0, y: 0, z: 0 }, 1200);
      scheduleRotate();
    }
  } else {
    Graph.d3Force("year", null);
    showYearRings([]);
  }
  Graph.d3ReheatSimulation();
}

// ---------------------------------------------------------------- 镜头、面板、筛选

// "我"固定在原点，所以只要算出最远节点的距离，就能让镜头正好装下整张网
function fitView(ms = 1000) {
  stopRotate();
  const radius = Math.max(40, ...graphData.nodes.map((n) => Math.hypot(n.x || 0, n.y || 0, n.z || 0) + n.size));
  const halfFov = (Graph.camera().fov * Math.PI) / 360;
  const dist = (radius / Math.sin(halfFov)) * 1.05;
  const cam = Graph.camera().position;
  const len = cam.length() || 1;  // 保持当前观察方向，只调整远近
  Graph.cameraPosition({ x: (cam.x / len) * dist, y: (cam.y / len) * dist, z: (cam.z / len) * dist }, { x: 0, y: 0, z: 0 }, ms);
  scheduleRotate();
}

// 镜头飞行动画和自动旋转会互相干扰，飞之前先停下旋转
function focusNode(node) {
  stopRotate();
  const dist = 110 + node.size * 4;
  const len = Math.hypot(node.x, node.y, node.z);
  const pos = len < 1
    ? { x: 0, y: 0, z: dist }
    : { x: node.x * (1 + dist / len), y: node.y * (1 + dist / len), z: node.z * (1 + dist / len) };
  Graph.cameraPosition(pos, { x: node.x, y: node.y, z: node.z }, 1200);
}

function selectNode(node) {
  state.selected = node;
  state.group = null;
  state.userMoved = true;
  setHighlight(node);
  focusNode(node);
  openPanel(node);
}

function clearSelection() {
  state.selected = null;
  state.group = null;
  levelCycle = { key: null, index: -1 };
  markCurrentRow(null);
  panel.hidden = true;
  setHighlight(null);
  scheduleRotate();
}

// labels：每一项前面的小标签（比如“产出”），可省略
function relatedList(nodes, labels = []) {
  if (!nodes.length) return "<p>暂无</p>";
  return `<ul class="related">${nodes.map((n, i) => `
    <li><button type="button" data-id="${esc(n.id)}" style="--c:${n.color}">${labels[i] ? `<em>${esc(labels[i])}</em>` : ""}${esc(n.label)}<small>${esc(n.period ?? "")}</small></button></li>`).join("")}</ul>`;
}

function openPanel(node) {
  let html = `<button type="button" class="panel-close" title="关闭">✕</button>`;
  if (node.type === "entry") {
    const meta = [node.org, node.role, node.level].filter(Boolean).join(" · ");
    const rels = relationsOf(node);
    html += `
      <div class="tip-head"><span class="tip-kind" style="--c:${node.color}">${esc(node.kindLabel)}</span><span class="tip-period">${esc(node.period)}</span></div>
      <h2>${esc(node.label)}</h2>
      ${meta ? `<p class="tip-meta">${esc(meta)}</p>` : ""}
      ${growthBlock(node)}
      ${node.description ? `<h3>描述</h3><p>${esc(node.description)}</p>` : ""}
      ${node.highlights.length ? `<h3>成果要点</h3><ul>${node.highlights.map((h) => `<li>${esc(h)}</li>`).join("")}</ul>` : ""}
      ${node.skills.length ? `<h3>技能</h3><div class="tip-chips">${node.skills.map((s) => `<span class="tip-chip">${esc(s)}</span>`).join("")}</div>` : ""}
      ${rels.length ? `<h3>关联经历</h3>${relatedList(rels.map((r) => r.node), rels.map((r) => r.label))}` : ""}
      <h3>证明文件</h3><p>${node.files ? `${node.files} 个` : "暂无"}</p>
      ${node.issues.length ? `<h3>待完善</h3><div class="tip-foot">${node.issues.map((i) => `<span class="tip-issue">${esc(i)}</span>`).join("")}</div>` : ""}
      <div class="panel-actions"><a class="primary" href="${node.url}">打开详情</a><a href="${node.url}/edit">编辑</a></div>`;
  } else {
    const entries = node.neighbors.filter((n) => n.type === "entry");
    const sub = node.type === "me" || node.type === "kind" ? `${node.count} 条经历`
      : `${node.categoryLabel ? `${node.categoryLabel} · ` : ""}关联 ${node.count} 个条目`;
    html += `<h2>${esc(node.label)}</h2><p class="tip-meta">${sub}</p>`;
    if (node.type === "kind") html += growthBlock(node);
    html += node.type === "me"
      ? `<h3>经历类型</h3>${relatedList(node.neighbors)}`
      : `<h3>相关条目</h3>${relatedList(entries)}`;
    if (node.url) html += `<div class="panel-actions"><a href="${node.url}">在素材库中筛选</a></div>`;
  }
  panel.innerHTML = html;
  panel.style.setProperty("--c", node.color);
  panel.hidden = false;
  panel.querySelector(".panel-close").addEventListener("click", clearSelection);
  panel.querySelectorAll("[data-id]").forEach((btn) =>
    btn.addEventListener("click", () => selectNode(nodeById.get(btn.dataset.id)))
  );
}

function isVisible(node) {
  if (node.type === "entry" || node.type === "kind") return !state.hiddenKinds.has(node.kind);
  if (node.type === "me") return true;
  return node.neighbors.some((n) => n.type === "entry" && !state.hiddenKinds.has(n.kind));
}

// 连线开关三档（技能、机构、关联的线叠在一起像蜘蛛网，所以默认收起来）：
//   simple     简洁：只常驻主干（我 → 类型 → 经历），其余连线在悬停或选中某个球时才出现
//   all        全部
//   noRelation 全部（不含关联）：条目之间的关联线平时不显示
// 任何一档下，悬停或选中的球自己的连线都会显示。
const LINK_MODES = ["simple", "all", "noRelation"];

function linkModeAllows(l) {
  if (l.type === "tree" || highlightLinks.has(l) || state.linkMode === "all") return true;
  return state.linkMode === "noRelation" && l.type !== "relation";
}

function linkShown(l) {
  // 入场动画期间，两端都“长出来”之后连线才接通
  return isVisible(l.source) && isVisible(l.target) && l.source.__revealed && l.target.__revealed
    && linkModeAllows(l);
}

function applyVisibility() {
  Graph.nodeVisibility(isVisible).linkVisibility(linkShown);
  renderAchievements();  // 图例隐藏了某个类型，点亮进度也跟着变
}

// ---------------------------------------------------------------- 自动旋转

let rotateTimer = null;
function stopRotate() {
  clearTimeout(rotateTimer);
  Graph.controls().autoRotate = false;
}
function scheduleRotate() {
  clearTimeout(rotateTimer);
  rotateTimer = setTimeout(() => {
    if (!state.selected && !state.hoverNode && !state.dragging) Graph.controls().autoRotate = true;
  }, 6000);
}

// ---------------------------------------------------------------- 背景星尘
// 远景星空：两层星星交替微微闪烁，跟着镜头走（像天空盒，永远在最远处）。
// 近景浮尘：散落在网络周围、缓慢漂移，转动视角时有前后错落的空间感。

function starLayer(count, rMin, rMax, size, opacity) {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const u = Math.random() * 2 - 1;
    const theta = Math.random() * Math.PI * 2;
    const r = rMin + Math.random() * (rMax - rMin);
    const s = Math.sqrt(1 - u * u);
    positions.set([r * s * Math.cos(theta), r * u, r * s * Math.sin(theta)], i * 3);
    c.setHSL(0.58 + Math.random() * 0.1, 0.45, 0.6 + Math.random() * 0.3);
    colors.set([c.r, c.g, c.b], i * 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const points = new THREE.Points(geometry, new THREE.PointsMaterial({
    size, map: GLOW_TEXTURE, vertexColors: true, transparent: true, opacity,
    depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  }));
  points.raycast = noRaycast;
  return points;
}

const stars = {
  sky: new THREE.Group(),
  twinkleA: starLayer(1300, 1000, 1700, 7, 0.5),
  twinkleB: starLayer(800, 1000, 1700, 10, 0.35),
  dust: starLayer(450, 90, 520, 2.4, 0.3),
};
stars.sky.add(stars.twinkleA, stars.twinkleB);

function updateStars(dt, t) {
  stars.sky.position.copy(Graph.camera().position);
  stars.sky.rotation.y += dt * 0.004;
  stars.twinkleA.material.opacity = 0.55 + 0.15 * Math.sin(t * 0.8);
  stars.twinkleB.material.opacity = 0.4 + 0.15 * Math.sin(t * 0.8 + Math.PI);
  stars.dust.visible = !state.lowFx;
  stars.dust.rotation.y -= dt * 0.012;
  stars.dust.rotation.x += dt * 0.003;
}

// ---------------------------------------------------------------- 入场动画
// 打开页面时网络从中心逐层长出来：我 → 类型分支 → 经历 → 技能/机构。
// 每层小球弹出放大，连线随之接通，同时一道信号从上一层传过来。

const INTRO_STEP = 420;  // 每一层间隔的毫秒数
const depthOf = (n) => ({ me: 0, kind: 1, entry: 2 }[n.type] ?? 3);
const easeOutBack = (x) => 1 + 2.70158 * (x - 1) ** 3 + 1.70158 * (x - 1) ** 2;

function playIntro(nodes) {
  const start = performance.now();
  const levels = [[], [], [], []];
  nodes.forEach((n) => levels[depthOf(n)].push(n));
  levels.forEach((level, d) => {
    level.forEach((n, i) => { n.__appearAt = start + d * INTRO_STEP + Math.min(i * 45, 400); });
    setTimeout(() => {
      level.forEach((n) => { n.__revealed = true; });
      applyVisibility();
      if (d > 0 && !state.lowFx) {
        level.forEach((n) => n.links
          .filter((l) => l.target === n && linkShown(l))
          .forEach((l) => Graph.emitParticle(l)));
      }
    }, d * INTRO_STEP);
  });
}

// ---------------------------------------------------------------- 升级庆祝
// 浏览器里记着每个节点上次看到时的等级，以及每套等级“点亮”到了第几级。
// 这次打开发现升级了，就飞过去放庆祝动画；某一级第一次被点亮，额外提示“首次点亮”。
// 第一次打开星图只记录、不庆祝；新加的经历如果一上来就到了 Lv3 以上，也算升级。
// 键名带版本号：等级规则改过（大类从 5 级改成 8 级），旧记录不能拿来比较。

const LEVELS_KEY = "imap.graph.levels.v2";
const LIT_KEY = "imap.graph.lit.v2";
const effects = [];  // 正在播放的一次性特效，每个是 (dt) => 是否还要继续

function readAndSave(key, value) {
  try {
    const saved = JSON.parse(localStorage.getItem(key));
    localStorage.setItem(key, JSON.stringify(value));
    return saved;
  } catch {
    return null;
  }
}

// 已经有大类走上的进化路线
const FORK_LEVEL = 3;
const foundPaths = () => [...new Set(graphData.nodes.filter((n) => n.type === "kind" && n.path).map((n) => n.path))];
const pathInfo = (key) => (levelTables.paths ?? []).find((p) => p.key === key);

function findCelebrations(nodes) {
  const tracked = nodes.filter((n) => n.type === "entry" || n.type === "kind");
  const savedLevels = readAndSave(LEVELS_KEY, Object.fromEntries(tracked.map((n) => [n.id, n.growth])));
  const lit = { kind: maxLevel("kind"), entry: maxLevel("entry"), paths: foundPaths() };
  const savedLit = readAndSave(LIT_KEY, lit);
  if (!savedLevels || !savedLit) return { ups: [], newlyLit: [], newPaths: [] };

  tracked.forEach((n) => { n.__from = savedLevels[n.id] ?? Math.min(n.growth, 2); });  // 上次看到时的等级
  const ups = tracked
    .filter((n) => n.growth > n.__from)
    .sort((a, b) => (b.type === "kind") - (a.type === "kind") || b.growth - a.growth)  // 大类优先
    .slice(0, 3);  // 一次最多庆祝 3 个，免得太长
  const newlyLit = ["kind", "entry"]
    .filter((type) => lit[type] > (savedLit[type] ?? 0))
    .map((type) => ({ type, level: lit[type], name: levelTables[type][lit[type] - 1].name }));
  // 新发现的路线（旧记录里没有 paths，说明是刚加进化分支后第一次打开，现有的路线都算新发现）
  const newPaths = lit.paths.filter((p) => !(savedLit.paths ?? []).includes(p));
  return { ups, newlyLit, newPaths };
}

// 大类刚升过 Lv3、走上了进化路线
const isFork = (node) => node.type === "kind" && node.path && node.__from < FORK_LEVEL;

function forkToast(node) {
  const p = pathInfo(node.path);
  return node.path === "blackhole"
    ? `<b>✦ 稀有进化！</b>「${esc(node.label)}」坠入了 <b>${p.icon} ${esc(p.name)}</b>`
    : `<b>✦ 进化分支</b>「${esc(node.label)}」踏上了 <b>${p.icon} ${esc(p.name)}</b>`;
}

function burst(node) {
  const scene = Graph.scene();
  const center = new THREE.Vector3(node.x, node.y, node.z);
  const color = tone(node.color);

  // 冲击波：一圈光环迅速扩散并淡出
  const wave = new THREE.Sprite(new THREE.SpriteMaterial({
    map: SHOCK_TEXTURE, color: 0xffe2a0, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  wave.position.copy(center);

  // 粒子迸发：向四面八方飞散，逐渐减速、淡出
  const count = 70;
  const positions = new Float32Array(count * 3);
  const velocities = Array.from({ length: count }, () =>
    new THREE.Vector3().randomDirection().multiplyScalar(18 + Math.random() * 30));
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const sparks = new THREE.Points(geometry, new THREE.PointsMaterial({
    size: 2.4, map: GLOW_TEXTURE, color: color.clone().lerp(new THREE.Color(1, 0.9, 0.6), 0.5),
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  sparks.position.copy(center);

  scene.add(wave, sparks);
  if (node.__parts) node.__parts.pulse = 1.8;

  let t = 0;
  effects.push((dt) => {
    t += dt;
    const k = Math.min(1, t / 1.5);
    wave.scale.setScalar(4 + (1 - (1 - k) ** 3) * node.size * 10);
    wave.material.opacity = 1 - k;
    velocities.forEach((v, i) => {
      positions[i * 3] += v.x * dt;
      positions[i * 3 + 1] += v.y * dt;
      positions[i * 3 + 2] += v.z * dt;
      v.multiplyScalar(1 - dt * 1.8);
    });
    geometry.attributes.position.needsUpdate = true;
    sparks.material.opacity = 1 - k * k;
    if (k < 1) return true;
    scene.remove(wave, sparks);
    geometry.dispose();
    return false;
  });
}

let toastTimer = null;
function showToast(html) {
  const toast = document.getElementById("toast");
  toast.innerHTML = html;
  toast.hidden = false;
  toast.classList.remove("show");
  void toast.offsetWidth;  // 重新触发 CSS 动画
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 3400);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function celebrate({ ups, newlyLit, newPaths }) {
  state.celebrating = true;
  stopRotate();
  for (const node of ups) {
    setHighlight(node);
    focusNode(node);
    await sleep(1300);
    burst(node);
    if (isFork(node)) {
      showToast(forkToast(node));
      if (node.path === "blackhole") {  // 稀有路线：多炸一次，多停一会儿
        await sleep(700);
        burst(node);
      }
    } else {
      const who = node.type === "kind" ? `「${esc(node.label)}」大类` : `「${esc(node.label)}」`;
      showToast(`<b>✦ 升级</b>${who}升到 <b>Lv.${node.growth} · ${esc(node.growthName)}</b>`);
    }
    await sleep(2800);
  }
  // 新发现的路线：图鉴里对应的图标闪几下；上面已经播过分叉庆祝的，就不再弹提示
  const announced = new Set(ups.filter(isFork).map((n) => n.path));
  for (const key of newPaths) {
    document.getElementById("achv").classList.remove("collapsed");
    document.querySelector(`.path-chip[data-path="${key}"]`)?.classList.add("flash");
    if (announced.has(key)) continue;
    const p = pathInfo(key);
    const kinds = graphData.nodes.filter((n) => n.type === "kind" && n.path === key).map((n) => `「${esc(n.label)}」`);
    showToast(`<b>✦ 发现新路线</b>${p.icon} <b>${esc(p.name)}</b>：${kinds.join("")}`);
    await sleep(2800);
  }
  // 首次点亮：点亮面板里对应的那一行闪几下
  for (const { type, level, name } of newlyLit) {
    document.getElementById("achv").classList.remove("collapsed");
    document.querySelector(`.achv-row[data-type="${type}"][data-level="${level}"]`)?.classList.add("flash");
    showToast(`<b>✦ 首次点亮</b>${type === "kind" ? "大类" : "经历"}等级 <b>Lv.${level} · ${esc(name)}</b>`);
    await sleep(2800);
  }
  state.celebrating = false;
  restoreHighlight();
  if (!state.selected) fitView();
}

// ---------------------------------------------------------------- 点亮进度
// 某个等级只要有节点达到过（当前等级 ≥ 它）就算“点亮”，像收集图鉴。点击已点亮的等级：
// 只有一个节点就直接飞过去；多个就一起点亮、镜头框住它们，再点一次就在它们之间依次切换。

let levelTables = { entry: [], kind: [], paths: [] };
const ACHV_GROUPS = [
  { type: "kind", title: "大类", badge: "◆" },
  { type: "entry", title: "经历", badge: "●" },
];
let levelCycle = { key: null, index: -1 };

function nodesAtLeast(type, level) {
  return graphData.nodes
    .filter((n) => n.type === type && isVisible(n) && n.growth >= level)
    .sort((a, b) => b.growth - a.growth);
}

function maxLevel(type) {
  return Math.max(0, ...graphData.nodes.filter((n) => n.type === type && isVisible(n)).map((n) => n.growth));
}

// 离升级最近：大类看还差几点成长值；经历看等级最高、还缺的东西最少
function closestToUpgrade() {
  const kind = graphData.nodes
    .filter((n) => n.type === "kind" && isVisible(n) && n.need > 0)
    .sort((a, b) => a.need - b.need)[0];
  const entry = graphData.nodes
    .filter((n) => n.type === "entry" && isVisible(n) && n.nextSteps.length)
    .sort((a, b) => b.growth - a.growth || a.nextSteps.length - b.nextSteps.length)[0];
  return [kind, entry].filter(Boolean);
}

function renderAchievements() {
  const body = document.getElementById("achv-body");
  let lit = 0;
  let total = 0;
  let html = "";
  for (const g of ACHV_GROUPS) {
    const table = levelTables[g.type];
    const top = maxLevel(g.type);
    lit += top;
    total += table.length;
    html += `<div class="achv-group"><div class="achv-title"><b>${g.title}</b>
      <span class="badges">${table.map((l) => `<span class="${l.level <= top ? "on" : "off"}">${g.badge}</span>`).join("")}</span>
      <span class="achv-count">已点亮 ${top} / ${table.length}</span></div>`;
    for (const l of [...table].reverse()) {
      const nodes = nodesAtLeast(g.type, l.level);
      const on = nodes.length > 0;
      const who = nodes.length === 1 ? esc(nodes[0].label) : on ? `×${nodes.length}` : "未点亮";
      html += `<button type="button" class="achv-row ${on ? "lit" : "unlit"}" data-type="${g.type}" data-level="${l.level}" ${on ? "" : "disabled"}>
        <span class="lvn">Lv.${l.level}</span><span>${esc(l.name)}</span><span class="who">${who}</span>${on ? '<span class="go">›</span>' : ""}</button>`;
    }
    html += "</div>";
  }
  // 进化路线图鉴：发现了的显示图标和名字，点击飞到走这条路的大类；没发现的是问号
  const paths = levelTables.paths ?? [];
  if (paths.length) {
    const found = new Set(foundPaths());
    html += `<div class="achv-group"><div class="achv-title"><b>进化路线</b>
      <span class="achv-count">已发现 ${found.size} / ${paths.length}</span></div><div class="path-chips">`;
    html += paths.map((p) => (found.has(p.key)
      ? `<button type="button" class="path-chip" data-path="${p.key}" title="${esc(p.name)}：点击飞过去">${p.icon}<span>${esc(p.name)}</span></button>`
      : `<span class="path-chip unknown" title="还没有大类走上这条路">？</span>`)).join("");
    html += "</div></div>";
  }
  for (const n of closestToUpgrade()) {
    html += `<button type="button" class="achv-next" data-id="${esc(n.id)}">🎯 离升级最近：${esc(n.label)}（Lv.${n.growth} → ${n.growth + 1}）
      <small>${esc(n.nextSteps[0].split("（")[0])}</small></button>`;
  }
  body.innerHTML = html;
  document.getElementById("achv-sum").textContent = `已点亮 ${lit} / ${total}`;
  body.querySelectorAll(".achv-row.lit").forEach((row) =>
    row.addEventListener("click", () => jumpToLevel(row.dataset.type, Number(row.dataset.level))));
  body.querySelectorAll(".path-chip[data-path]").forEach((chip) =>
    chip.addEventListener("click", () => jumpToGroup(`path:${chip.dataset.path}`,
      graphData.nodes.filter((n) => n.type === "kind" && isVisible(n) && n.path === chip.dataset.path))));
  body.querySelectorAll(".achv-next").forEach((btn) =>
    btn.addEventListener("click", () => selectNode(nodeById.get(btn.dataset.id))));
  markCurrentRow(levelCycle.key);
}

function markCurrentRow(key) {
  document.querySelectorAll(".achv-row").forEach((row) =>
    row.classList.toggle("current", `${row.dataset.type}:${row.dataset.level}` === key));
}

function jumpToLevel(type, level) {
  jumpToGroup(`${type}:${level}`, nodesAtLeast(type, level));
}

// 一组节点：只有一个就直接飞过去；多个先一起框住，再点就在它们之间依次切换。key 用来认出“同一组”
function jumpToGroup(key, nodes) {
  if (!nodes.length) return;
  if (nodes.length === 1 || levelCycle.key === key) {
    // 只有一个，或者已经框住过这一组：逐个飞过去
    levelCycle.index = levelCycle.key === key ? (levelCycle.index + 1) % nodes.length : 0;
    levelCycle.key = key;
    selectNode(nodes[levelCycle.index]);
  } else {
    levelCycle = { key, index: -1 };
    showGroup(nodes);
  }
  markCurrentRow(key);
}

// 一组节点一起点亮（其余淡出），镜头框住它们
function showGroup(nodes) {
  state.selected = null;
  state.group = nodes;
  state.userMoved = true;
  panel.hidden = true;
  applyGroupHighlight(nodes);
  fitNodes(nodes);
}

function applyGroupHighlight(nodes) {
  highlightNodes.clear();
  highlightLinks.clear();
  nodes.forEach((n) => highlightNodes.add(n));
  state.hoverNode = null;
  for (const n of graphData.nodes) {
    if (!n.__parts) continue;
    n.__parts.targetFade = highlightNodes.has(n) ? 1 : 0.07;
    n.__parts.targetBoost = highlightNodes.has(n) ? 0.3 : 0;
  }
  refreshLinks();
}

// 鼠标移开、庆祝结束后，回到当前的高亮状态（一组节点 / 选中的节点 / 无）
function restoreHighlight() {
  if (state.group) applyGroupHighlight(state.group);
  else setHighlight(state.selected);
}

function fitNodes(nodes) {
  stopRotate();
  const points = nodes.map((n) => new THREE.Vector3(n.x, n.y, n.z));
  const center = points.reduce((sum, p) => sum.add(p), new THREE.Vector3()).divideScalar(points.length);
  const radius = Math.max(30, ...points.map((p, i) => center.distanceTo(p) + nodes[i].size * 3));
  const dist = (radius / Math.sin((Graph.camera().fov * Math.PI) / 360)) * 1.1;
  const dir = Graph.camera().position.clone().sub(Graph.controls().target).normalize();
  const pos = center.clone().addScaledVector(dir, dist);
  Graph.cameraPosition({ x: pos.x, y: pos.y, z: pos.z }, { x: center.x, y: center.y, z: center.z }, 1100);
}

// ---------------------------------------------------------------- 记住开关
// “连线”“时间分层”“低特效”存在浏览器里，下次打开星图自动恢复。读写失败（比如隐私模式）就当没存过。

const PREFS_KEY = "imap.graph.prefs";

function loadPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY)) || {};
  } catch {
    return {};
  }
}

function savePrefs() {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({
      layered: state.layered, lowFx: state.lowFx, achvCollapsed: state.achvCollapsed,
      linkMode: state.linkMode, drawerCollapsed: state.drawerCollapsed,
    }));
  } catch {
    // 存不了就算了，不影响使用
  }
}

// ---------------------------------------------------------------- 逐帧动画
// 明暗渐变、悬停加亮、放电闪光、中心呼吸、弹簧回弹、景深雾都在这里更新。

let lastFrame = performance.now();

function animate(now) {
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;
  const ease = 1 - Math.exp(-dt * 10);  // 大约 0.2 秒完成一次渐变
  const breath = Math.sin(now / 1000 * 1.3);

  for (const n of graphData.nodes) {
    const p = n.__parts;
    if (!p) continue;
    p.fade += (p.targetFade - p.fade) * ease;
    p.boost += (p.targetBoost - p.boost) * ease;
    p.pulse *= Math.exp(-dt * 2.5);
    const b = n.type === "me" ? 0.12 * breath : 0;
    // 入场：从无到有弹出放大，同时淡入
    const appear = n.__appearAt == null ? 1 : Math.min(1, Math.max(0, (now - n.__appearAt) / 650));
    p.group.scale.setScalar(Math.max(0.001, easeOutBack(appear)));
    const fade = p.fade * appear;

    p.shell.material.uniforms.opacity.value = p.baseOpacity * fade;
    p.shell.material.uniforms.intensity.value = 1 + p.boost + p.pulse * 0.8 + b;
    p.nucleus.material.opacity = 0.9 * fade;
    p.nucleus.scale.setScalar(1 + p.pulse * 0.5 + b);
    p.halo.visible = !state.lowFx;
    p.halo.material.opacity = p.baseHalo * fade * (1 + p.boost * 1.5 + p.pulse * 2.5 + b * 2);
    if (p.ring) p.ring.material.opacity = 0.55 * fade;
    for (const s of p.sats) {
      s.pivot.rotateY(dt * s.speed);
      s.moon.material.opacity = 0.95 * fade;
    }
    for (const belt of p.belts) belt.material.opacity = belt.userData.base * fade;
    p.coronas.forEach((c, i) => {
      c.material.rotation += dt * (i ? -0.1 : 0.06);
      const amp = c.userData.strong ? 0.45 : 0.2;
      c.material.opacity = c.userData.base * fade * (1 + amp * Math.sin(now / 1000 * 1.6 + i * 2));
    });
    for (const a of p.auras) {
      a.material.opacity = a.userData.base * fade * (a.userData.pulse ? 1 + 0.4 * Math.sin(now / 1000 * 1.1) : 1);
      if (a.userData.breathe) a.scale.setScalar(a.userData.size * (1 + 0.09 * Math.sin(now / 1000 * 1.1)));
      if (a.userData.spin) a.material.rotation += dt * a.userData.spin;
    }
    for (const update of p.updaters) update(dt, now / 1000, fade);
    for (const pr of p.prominences) {
      const w = 0.5 + 0.5 * Math.sin(now / 1000 * 0.7 + pr.phase);
      pr.arc.scale.set(1, 0.55 + 0.75 * w, 1);  // 光弧一会儿高高跃起，一会儿落回球面
      pr.arc.material.opacity = (0.3 + 0.45 * w) * fade;
    }
    if (p.galaxy) {
      p.galaxy.disc.rotation.y += dt * 0.12;
      p.galaxy.disc.material.opacity = 0.75 * fade;
    }
    if (p.sparkle) {
      // 尖峰函数：大部分时间接近 0，大约每 7 秒冒一次尖，像星星“叮”地闪一下
      const flash = Math.max(0, Math.sin(now / 1000 * 0.9 + p.sparkle.userData.phase)) ** 12;
      p.sparkle.material.opacity = (0.22 + 0.78 * flash) * fade;
      p.sparkle.material.rotation = flash * 0.4;  // 闪的时候顺手转一点点
      p.sparkle.scale.setScalar(p.sparkle.userData.size * (0.85 + 0.45 * flash));
    }
    if (p.crystal) {
      p.crystal.rotation.y += dt * 0.25;
      p.crystal.rotation.x += dt * 0.09;
      p.crystal.material.opacity = 0.42 * fade;
    }
    if (p.label) {
      const o = fade < 0.5 ? fade * 0.6 : fade;
      if (Math.abs(o - p.labelOpacity) > 0.01) {
        p.label.element.style.opacity = o;
        p.labelOpacity = o;
      }
      p.label.visible = isVisible(n);
    }
  }

  stepSpring(dt);
  updateStars(dt, now / 1000);
  for (let i = effects.length - 1; i >= 0; i--) {
    if (!effects[i](dt)) effects.splice(i, 1);
  }

  // 景深雾：随镜头远近调整，远处的节点自然变淡
  const fog = Graph.scene().fog;
  const d = Graph.camera().position.distanceTo(Graph.controls().target);
  fog.near = d * 0.75;
  fog.far = d * 2.3;

  requestAnimationFrame(animate);
}

// ---------------------------------------------------------------- 初始化

const Graph = ForceGraph3D({ controlType: "orbit", extraRenderers: [new CSS2DRenderer()] })(el)
  .backgroundColor("rgba(0,0,0,0)")
  .showNavInfo(false)
  .warmupTicks(120)  // 先在后台把网络大致展开，再开始绘制
  .cooldownTime(6000)
  .nodeThreeObject(makeNodeObject)
  .nodeLabel(tooltip)
  .linkColor(linkColor)
  .linkWidth((l) => (highlightLinks.has(l) ? 0.5 : 0))
  // 连线带一点弧度、朝向随机，更像神经纤维
  .linkCurvature((l) => ({ tree: 0.12, relation: 0.45 }[l.type] ?? 0.28))
  .linkCurveRotation((l) => l.rotation)
  // 平时没有流动光点（由“放电”偶尔点亮），悬停时相关连线上才有持续的信号
  .linkDirectionalParticles((l) => (!state.lowFx && highlightLinks.has(l) ? 3 : 0))
  .linkDirectionalParticleSpeed(0.022)
  .linkDirectionalParticleWidth(1.4)
  .linkDirectionalParticleColor((l) => `rgb(${linkRgb(l)})`)
  .onNodeHover((node) => {
    el.style.cursor = node ? "pointer" : "";
    if (node === state.hoverNode) return;
    if (node) {
      stopRotate();
      setHighlight(node);
    } else {
      restoreHighlight();  // 鼠标移开后，回到之前的高亮状态
      scheduleRotate();
    }
  })
  .onNodeDrag((node) => {
    state.dragging = node;
    state.userMoved = true;
    spring.node = spring.node === node ? null : spring.node;  // 回弹途中又被抓住，就停止回弹
    if (tether.node !== node) startTether(node);
    updateTether();
  })
  .onNodeDragEnd((node) => {
    state.dragging = null;
    if (tether.node === node) startSpring(node);
  })
  .onNodeClick(selectNode)
  .onBackgroundClick(clearSelection);

// 底层的力导向引擎对象：弹簧回弹时要用它保持引擎运转
const forceGraph = () => Graph.scene().children.find((c) => typeof c.resetCountdown === "function");

// 辉光：阈值调高，只让小球的内核发光，连线和文字不会糊
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.85, 0.45, 0.2);
Graph.postProcessingComposer().addPass(bloom);

Graph.scene().fog = new THREE.Fog(BG_COLOR, 300, 900);
Graph.scene().add(stars.sky, stars.dust);

// 力学参数：我固定在中心，类型分支离得远一些
Graph.d3Force("charge").strength(-50);
Graph.d3Force("link").distance((l) => (l.source.type === "me" ? 38 : l.type === "tree" ? 24 : 20));

const controls = Graph.controls();
controls.autoRotate = true;
controls.autoRotateSpeed = 0.4;
controls.enableDamping = true;  // 松开鼠标后旋转有惯性，更顺滑
controls.addEventListener("start", () => { state.userMoved = true; stopRotate(); });
controls.addEventListener("end", scheduleRotate);

let graphData = { nodes: [], links: [] };
const nodeById = new Map();

fetch("/api/graph").then((r) => r.json()).then((data) => {
  data.nodes.forEach((n) => {
    n.neighbors = [];
    n.links = [];
    nodeById.set(n.id, n);
  });
  // 把连线两端从 id 换成节点对象，并记录邻居，悬停时用来点亮
  data.links.forEach((l) => {
    l.source = nodeById.get(l.source);
    l.target = nodeById.get(l.target);
    l.rotation = Math.random() * Math.PI * 2;
    l.source.neighbors.push(l.target);
    l.target.neighbors.push(l.source);
    l.source.links.push(l);
    l.target.links.push(l);
  });
  const me = nodeById.get("me");
  me.fx = me.fy = me.fz = 0;

  graphData = data;
  levelTables = data.levels;
  playIntro(data.nodes);
  Graph.graphData(data);
  applyVisibility();
  if (prefs.layered) {
    document.getElementById("layered").checked = true;
    setLayered(true, { moveCamera: false });  // 镜头角度在下面第一帧时一起处理
  }
  requestAnimationFrame(animate);

  // 图例只显示实际存在的类型、技能类别和关联
  const kindsPresent = new Set(data.nodes.filter((n) => n.type === "kind").map((n) => n.kind));
  document.querySelectorAll(".legend-item[data-kind]").forEach((btn) => {
    btn.hidden = !kindsPresent.has(btn.dataset.kind);
  });
  const catsPresent = new Set(data.nodes.filter((n) => n.type === "skill").map((n) => n.category));
  document.querySelectorAll(".legend-item[data-skillcat]").forEach((item) => {
    item.hidden = !catsPresent.has(item.dataset.skillcat);
  });
  document.getElementById("legend-relation").hidden = !data.links.some((l) => l.type === "relation");
  document.getElementById("empty").hidden = data.nodes.some((n) => n.type === "entry");

  // 第一帧：先从稍远处看，再配合入场动画缓缓推近；网络稳定后再平滑微调一次
  let firstTick = true;
  Graph.onEngineTick(() => {
    if (firstTick) {
      firstTick = false;
      if (state.layered) {
        // 星盘用俯视角度（fitView 只调远近）；位置和朝向要一起改，否则镜头会看偏
        Graph.camera().position.set(0, 0.6, 0.8);
        Graph.camera().lookAt(0, 0, 0);
        Graph.controls().target.set(0, 0, 0);
      }
      fitView(0);
      Graph.camera().position.multiplyScalar(1.6);
      fitView(2600);
    }
    if (state.dragging) updateTether();
  });
  Graph.onEngineStop(() => {
    if (!state.userMoved && !state.selected && !state.celebrating) fitView();
  });

  // 入场动画结束后，播放升级庆祝
  const celebrations = findCelebrations(data.nodes);
  if (celebrations.ups.length || celebrations.newlyLit.length || celebrations.newPaths.length) {
    setTimeout(() => celebrate(celebrations), INTRO_STEP * 4 + 900);
  }
});

// 图例：显示/隐藏某个类型
document.querySelectorAll(".legend-item[data-kind]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const kind = btn.dataset.kind;
    state.hiddenKinds.has(kind) ? state.hiddenKinds.delete(kind) : state.hiddenKinds.add(kind);
    btn.classList.toggle("off", state.hiddenKinds.has(kind));
    applyVisibility();
  });
});

// 搜索：回车飞到第一个匹配的节点
document.getElementById("search").addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  const q = e.target.value.trim().toLowerCase();
  if (!q) return;
  const hit = graphData.nodes.find((n) => isVisible(n) && n.label.toLowerCase().includes(q))
    ?? graphData.nodes.find((n) => isVisible(n) && (n.skills ?? []).some((s) => s.toLowerCase().includes(q)));
  if (hit) selectNode(hit);
  else e.target.animate([{ borderColor: "#ff6b6f" }, { borderColor: "" }], 600);
});

document.getElementById("layered").addEventListener("change", (e) => {
  setLayered(e.target.checked);
  savePrefs();
});

function setLowFx(on) {
  state.lowFx = on;
  bloom.enabled = !on;
  refreshLinks();
}

document.getElementById("lowfx").addEventListener("change", (e) => {
  setLowFx(e.target.checked);
  savePrefs();
});

const prefs = loadPrefs();

// 点亮进度面板的折叠：记住上次的状态；没记过时，小屏幕默认收起
const achvPanel = document.getElementById("achv");
state.achvCollapsed = prefs.achvCollapsed ?? innerWidth < 720;
achvPanel.classList.toggle("collapsed", state.achvCollapsed);
document.getElementById("achv-toggle").addEventListener("click", () => {
  state.achvCollapsed = achvPanel.classList.toggle("collapsed");
  document.getElementById("achv-toggle").setAttribute("aria-expanded", String(!state.achvCollapsed));
  savePrefs();
});

if (prefs.lowFx) {
  document.getElementById("lowfx").checked = true;
  setLowFx(true);
}

const linkModeSelect = document.getElementById("linkmode");
if (LINK_MODES.includes(prefs.linkMode)) state.linkMode = prefs.linkMode;
linkModeSelect.value = state.linkMode;
linkModeSelect.addEventListener("change", (e) => {
  state.linkMode = e.target.value;
  refreshLinks();
  savePrefs();
});

// 左栏抽屉：右边缘的把手点一下收起/展开；按住左右拖，松手时拖过一半就收起，否则弹回
const leftCol = document.querySelector(".left-col");
const grip = document.getElementById("drawer-grip");
let gripDrag = null;

function setDrawer(collapsed) {
  state.drawerCollapsed = collapsed;
  leftCol.classList.toggle("collapsed", collapsed);
  grip.setAttribute("aria-expanded", String(!collapsed));
  grip.title = collapsed ? "展开左栏（可拖动）" : "收起左栏（可拖动）";
}

grip.addEventListener("pointerdown", (e) => {
  grip.setPointerCapture(e.pointerId);
  const width = leftCol.offsetWidth + 16;  // 收起时整列要移出屏幕的距离（含左边距）
  gripDrag = { x: e.clientX, width, from: state.drawerCollapsed ? -width : 0, offset: 0, moved: false };
  leftCol.style.transition = "none";  // 拖动时跟手，不要过渡
});
grip.addEventListener("pointermove", (e) => {
  if (!gripDrag) return;
  const dx = e.clientX - gripDrag.x;
  if (Math.abs(dx) > 4) gripDrag.moved = true;  // 动了几个像素以内算点击
  if (!gripDrag.moved) return;
  gripDrag.offset = Math.min(0, Math.max(-gripDrag.width, gripDrag.from + dx));
  leftCol.style.transform = `translateX(${gripDrag.offset}px)`;
});
function endGripDrag(cancelled) {
  if (!gripDrag) return;
  const { moved, offset, width } = gripDrag;
  gripDrag = null;
  // 去掉拖动时的内联样式，交给 .collapsed 类，过渡动画会从松手的位置滑到终点
  leftCol.style.transition = leftCol.style.transform = "";
  if (moved) setDrawer(offset < -width / 2);
  else if (!cancelled) setDrawer(!state.drawerCollapsed);
  savePrefs();
}
grip.addEventListener("pointerup", () => endGripDrag(false));
grip.addEventListener("pointercancel", () => endGripDrag(true));
grip.addEventListener("click", (e) => {
  if (e.detail === 0) {  // 键盘（回车、空格）触发的点击；鼠标点击已经在 pointerup 里处理了
    setDrawer(!state.drawerCollapsed);
    savePrefs();
  }
});
// 恢复上次的状态：打开页面时直接就位，不播滑动动画
leftCol.style.transition = "none";
setDrawer(prefs.drawerCollapsed ?? false);
leftCol.offsetWidth;  // 强制浏览器先应用上面的位置，再恢复过渡
leftCol.style.transition = "";

// 沉浸模式：只想欣赏星图时，隐藏所有面板，只留星图慢慢自转。H 切换，Esc 退出，角落的小眼睛也能退出
function setImmersive(on) {
  state.immersive = on;
  document.body.classList.toggle("immersive", on);
  if (on) {
    clearSelection();
    Graph.controls().autoRotate = true;  // 直接开始自转，不用等 6 秒
  }
}

document.getElementById("immersive").addEventListener("click", () => setImmersive(true));
document.getElementById("immersive-exit").addEventListener("click", () => setImmersive(false));
addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
  // 在搜索框里打字时不响应
  if (e.target instanceof Element && e.target.closest("input, select, textarea, [contenteditable]")) return;
  if (e.key === "h" || e.key === "H") setImmersive(!state.immersive);
  else if (e.key === "Escape" && state.immersive) setImmersive(false);
});

document.getElementById("reset").addEventListener("click", () => {
  clearSelection();
  fitView();
});

addEventListener("resize", () => {
  Graph.width(innerWidth).height(innerHeight);
  bloom.setSize(innerWidth, innerHeight);
});
