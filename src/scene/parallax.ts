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

export const MAX_SHIFT_PX = 7;

export class Parallax {
  private gl: WebGLRenderingContext;
  private image: WebGLTexture;
  private depth: WebGLTexture;
  private scale: WebGLUniformLocation;
  private shift: WebGLUniformLocation;
  private source: Source | null = null;
  private fresh = false;

  static create(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, powerPreference: 'low-power' });
    return gl ? new Parallax(canvas, gl) : null;
  }

  private constructor(private canvas: HTMLCanvasElement, gl: WebGLRenderingContext) {
    this.gl = gl;
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
    this.image = texture(gl);
    this.depth = texture(gl);
    gl.uniform1i(gl.getUniformLocation(program, 'image'), 0);
    gl.uniform1i(gl.getUniformLocation(program, 'depth'), 1);
    this.scale = gl.getUniformLocation(program, 'scale')!;
    this.shift = gl.getUniformLocation(program, 'shift')!;
  }

  setScene(source: Source, depth: HTMLImageElement) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.depth);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, gl.LUMINANCE, gl.UNSIGNED_BYTE, depth);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.image);
    this.setSource(source);
  }

  setSource(source: Source) {
    this.source = source;
    this.fresh = true;
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
    const { gl, canvas, source } = this;
    if (!source || (!this.fresh && !tiltChanged)) return;
    const width = source instanceof HTMLVideoElement ? source.videoWidth : source.naturalWidth;
    const height = source instanceof HTMLVideoElement ? source.videoHeight : source.naturalHeight;
    if (!width || !height) return;
    if (this.fresh) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, source);
      this.fresh = false;
    }
    const cover = Math.max(canvas.width / width, canvas.height / height);
    const scaleX = canvas.width / (width * cover);
    const scaleY = canvas.height / (height * cover);
    const px = (2 * MAX_SHIFT_PX * canvas.width) / canvas.clientWidth;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(this.scale, scaleX, scaleY);
    gl.uniform2f(this.shift, (tiltX * px * scaleX) / canvas.width, (tiltY * px * scaleY) / canvas.height);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
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
