import * as THREE from 'three';

/* Distance haze. three's exponential fog is replaced by aerial perspective that starts a few
   hundred metres out (the district stays crisp), thins with altitude and takes its colour from
   the sky at the horizon in the direction the camera looks (set per frame by the atmosphere), so
   the far desert and towers dissolve into the sky instead of a flat grey. Uses only the built-in
   fog uniforms, so every material, instanced or not, gets it without patches. */

let installed = false;

export const HAZE_START = 420; // m

export function installHaze(): void {
  if (installed) return;
  installed = true;
  THREE.ShaderChunk.fog_pars_vertex = /* glsl */ `
#ifdef USE_FOG
  varying float vFogDepth;
  varying float vFogHeight;
#endif`;
  THREE.ShaderChunk.fog_vertex = /* glsl */ `
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  vFogHeight = (transpose(mat3(viewMatrix)) * mvPosition.xyz).y;
#endif`;
  THREE.ShaderChunk.fog_pars_fragment = /* glsl */ `
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying float vFogHeight;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
#endif`;
  THREE.ShaderChunk.fog_fragment = /* glsl */ `
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float dmFogD = max(vFogDepth - ${HAZE_START.toFixed(1)}, 0.0);
    float fogFactor = 1.0 - exp(- fogDensity * fogDensity * dmFogD * dmFogD);
  #else
    float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
  #endif
  float dmFogY = cameraPosition.y + vFogHeight;
  fogFactor *= mix(1.0, 0.6, smoothstep(30.0, 600.0, dmFogY));
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, clamp(fogFactor, 0.0, 1.0));
#endif`;
}
