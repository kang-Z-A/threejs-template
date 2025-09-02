#include <common>
#include <logdepthbuf_pars_fragment>
varying vec2 vUv;
uniform float iTime;
uniform vec2 iResolution;

void main() {
    #include <logdepthbuf_fragment>

    gl_FragColor = vec4(vUv, 0.0, 1.0);

    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}
