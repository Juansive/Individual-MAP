// 打包入口：把星图需要的库挂到 window 上，供 app/static/graph.js 使用。
// 必须打包在一起，保证 3d-force-graph 和泛光效果用的是同一份 three.js。
import ForceGraph3D from "3d-force-graph";
import * as THREE from "three";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { CSS2DObject, CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";

window.ForceGraph3D = ForceGraph3D;
window.THREE = THREE;
window.UnrealBloomPass = UnrealBloomPass;
window.CSS2DRenderer = CSS2DRenderer;  // 用网页文字渲染标签：清晰、不被辉光糊掉
window.CSS2DObject = CSS2DObject;
