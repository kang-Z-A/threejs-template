varying vec2 vUv;

#include <common>
#include <logdepthbuf_pars_vertex>
void main() {
    vUv = uv;

    gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
    #include <logdepthbuf_vertex>
}
