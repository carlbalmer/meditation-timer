// Draws the scene through a depth map so near things shift a few pixels with
// device tilt. Only used on the setup screen; the plain video shows otherwise.

const VERTEX = `
attribute vec2 p;
varying vec2 uv;
void main() { uv = p * 0.5 + 0.5; uv.y = 1.0 - uv.y; gl_Position = vec4(p, 0.0, 1.0); }`;

const FRAGMENT = `
precision mediump float;
uniform sampler2D image;
uniform sampler2D depth;
uniform vec2 scale;
uniform vec2 shift;
varying vec2 uv;
void main() {
  vec2 st = (uv - 0.5) * scale + 0.5;
  float near = texture2D(depth, st).r - 0.5;
  gl_FragColor = texture2D(image, clamp(st - shift * near, 0.0, 1.0));
}`;

type Source = HTMLVideoElement | HTMLImageElement;
type Resources = { image: WebGLTexture; depth: WebGLTexture; scale: WebGLUniformLocation; shift: WebGLUniformLocation };

export const MAX_SHIFT_PX = 7;

const size = (source: Source) =>
  source instanceof HTMLVideoElement ? [source.videoWidth, source.videoHeight] : [source.naturalWidth, source.naturalHeight];

// A source is usable once it has a decoded frame with real dimensions.
const usable = (source: Source) => size(source).every(n => n > 0) && (source instanceof HTMLVideoElement ? source.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA : source.complete);

export class Parallax {
  private gl: WebGLRenderingContext;
  private gpu: Resources | null = null;
  private source: Source | null = null;
  private depthImage: HTMLImageElement | null = null;
  private fresh = false;

  static create(canvas: HTMLCanvasElement, onChange: () => void) {
    const gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, powerPreference: 'low-power' });
    return gl ? new Parallax(canvas, gl, onChange) : null;
  }

  private constructor(private canvas: HTMLCanvasElement, gl: WebGLRenderingContext, onChange: () => void) {
    this.gl = gl;
    this.gpu = this.build();
    canvas.addEventListener('webglcontextlost', event => {
      event.preventDefault();
      this.gpu = null;
      onChange();
    });
    canvas.addEventListener('webglcontextrestored', () => {
      this.gpu = this.build();
      this.upload();
      onChange();
    });
  }

  // Usability is checked once in setScene: a looping video briefly has no
  // current frame while it seeks back to the start.
  get ready() {
    return !!this.gpu && !!this.source && !!this.depthImage;
  }

  get lost() {
    return !this.gpu;
  }

  get animated() {
    return this.source instanceof HTMLVideoElement && !this.source.paused;
  }

  clear() {
    this.source = null;
  }

  setScene(source: Source, depth: HTMLImageElement) {
    this.source = usable(source) ? source : null;
    this.depthImage = depth;
    if (!this.source) return;
    this.upload();
    if (source instanceof HTMLVideoElement) {
      const onFrame = () => {
        if (this.source !== source) return;
        this.fresh = true;
        source.requestVideoFrameCallback(onFrame);
      };
      source.requestVideoFrameCallback(onFrame);
    }
  }

  // tilt is -1..1 per axis; skips work when neither the frame nor the tilt changed.
  draw(tiltX: number, tiltY: number, tiltChanged: boolean) {
    const { gl, canvas, source, gpu } = this;
    if (!gpu || !source || !this.ready || (!this.fresh && !tiltChanged)) return;
    const [width, height] = size(source);
    if (this.fresh && usable(source)) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, source);
      this.fresh = false;
    }
    const cover = Math.max(canvas.width / width, canvas.height / height);
    const scaleX = canvas.width / (width * cover);
    const scaleY = canvas.height / (height * cover);
    const px = (2 * MAX_SHIFT_PX * canvas.width) / canvas.clientWidth;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(gpu.scale, scaleX, scaleY);
    gl.uniform2f(gpu.shift, (tiltX * px * scaleX) / canvas.width, (tiltY * px * scaleY) / canvas.height);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  private upload() {
    const { gl, gpu } = this;
    if (!gpu || !this.depthImage) return;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, gpu.depth);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, gl.LUMINANCE, gl.UNSIGNED_BYTE, this.depthImage);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, gpu.image);
    this.fresh = true;
  }

  private build(): Resources | null {
    const gl = this.gl;
    if (gl.isContextLost()) return null;
    const program = gl.createProgram()!;
    for (const [type, code] of [[gl.VERTEX_SHADER, VERTEX], [gl.FRAGMENT_SHADER, FRAGMENT]] as const) {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, code);
      gl.compileShader(shader);
      gl.attachShader(program, shader);
    }
    gl.linkProgram(program);
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.uniform1i(gl.getUniformLocation(program, 'image'), 0);
    gl.uniform1i(gl.getUniformLocation(program, 'depth'), 1);
    const depth = texture(gl);
    const image = texture(gl);
    return { image, depth, scale: gl.getUniformLocation(program, 'scale')!, shift: gl.getUniformLocation(program, 'shift')! };
  }
}

function texture(gl: WebGLRenderingContext) {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}
