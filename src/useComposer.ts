import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutlinePass } from 'three/addons/postprocessing/OutlinePass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { GammaCorrectionShader } from 'three/addons/shaders/GammaCorrectionShader.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { TAARenderPass } from 'three/addons/postprocessing/TAARenderPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
import { BleachBypassShader } from 'three/addons/shaders/BleachBypassShader.js'; //降低饱和度，提高对比度，保留高光细节
import { ColorCorrectionShader } from 'three/addons/shaders/ColorCorrectionShader.js'; //调整色彩平衡，校正色偏

export type ComposerCustomOptions = {
  /** 是否使用描边，默认为true */
  useOutline?: boolean,
  /** 是否使用伽马校正，默认为false */
  useGammaCorrection?: boolean,
  /** 是否使用FXAA抗锯齿，默认为false */
  useFXAA?: boolean,
  /** 是否使用边缘检测，默认为false */
  useEdgeDetection?: boolean,
  /** 是否使用亮度检测，默认为false */
  useLuminance?: boolean,
  /** 是否使用下采样，默认为false */
  useDownSampling?: boolean,
  /** 是否使用上采样，默认为false */
  useUpSampling?: boolean,
  /** 是否使用TAA抗锯齿，默认为false */
  useTAA?:boolean,
  /** TAA抗锯齿采样等级，默认1 */
  TAASampleLevel?:number,
  /** 是否使用SMAA抗锯齿，默认为false */
  useSMAA?:boolean,
  /** 是否使用SSAO环境光遮蔽，默认为false */
  useSSAO?:boolean,
  /** 是否使用ColorCorrection，默认为false */
  useColorCorrection?:boolean
}

type ComposerOptions = {
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    containerWidth: number,
    containerHeight: number,
    highlightColor: string | number,
} & ComposerCustomOptions

export function useComposerHook(options: ComposerOptions) {
    const { renderer, scene, camera, containerWidth, containerHeight, highlightColor,
        useOutline, useGammaCorrection, useFXAA, useTAA, TAASampleLevel, useSMAA, useSSAO,
        useColorCorrection } = options

    let outlinePass: OutlinePass | undefined
    let composer: EffectComposer | undefined
    let renderPass: RenderPass | undefined
    let effectFXAA: ShaderPass | undefined
    let taaPass: TAARenderPass | undefined
    let smaaPass: SMAAPass | undefined
    let outputPass: OutputPass | undefined
    let ssaoPass: SSAOPass | undefined
    let effectColor: ShaderPass | undefined

    /**
    * 模型描线默认配置
    */
    let defaultOutlinePass = () => {
        outlinePass!.edgeStrength = 16       //描边强度
        outlinePass!.edgeGlow = 1        //描边光晕
        outlinePass!.edgeThickness = 3.0;    //描边厚度
        outlinePass!.pulsePeriod = 2.0;  //描边呼吸频率
        // outlinePass.visibleEdgeColor.set('rgb(255, 0, 0)')
        outlinePass!.visibleEdgeColor.set(highlightColor)    //描边视觉上可见部分颜色,开启碰撞检测后此配置无效，只有不可见颜色，因为有一层透明球包裹在摄像机外面
        outlinePass!.hiddenEdgeColor.set(highlightColor)       //描边视觉上不可见部分颜色
        // outlinePass.hiddenEdgeColor.set(0x493827)       //描边视觉上不可见部分颜色
    }
    composer = new EffectComposer(renderer!);

    renderPass = new RenderPass(scene, camera)
    composer.addPass(renderPass)

    renderer.setPixelRatio(window.devicePixelRatio);
    
    // 1. 首先添加SSAO（几何处理先做）
    if(useSSAO){
        ssaoPass = new SSAOPass(scene, camera, containerWidth, containerHeight);
        composer.addPass(ssaoPass);
    }
    
    // 2. 添加Outline（几何处理先做）
    if (useOutline) {
        const v2 = new THREE.Vector2(containerWidth, containerHeight)
        outlinePass = new OutlinePass(v2, scene, camera)
        defaultOutlinePass()
        composer.addPass(outlinePass)
    }
    
    // 3. 添加抗锯齿（三选一）
    if (useTAA) {
        taaPass = new TAARenderPass(scene, camera, 0x000, 1);
        taaPass.unbiased = false;
        taaPass.sampleLevel = TAASampleLevel ?? 1;
        taaPass.accumulate = false
        composer.addPass(taaPass);
        // renderPass.enabled = false
    } else if (useFXAA) {
        effectFXAA = new ShaderPass(FXAAShader);
        // `.getPixelRatio()`获取`renderer!.setPixelRatio()`设置的值
        const pixelRatio = renderer.getPixelRatio();//获取设备像素比 
        // width、height是canva画布的宽高度
        effectFXAA.material.uniforms['resolution'].value.x = 1 / (containerWidth * pixelRatio);
        effectFXAA.material.uniforms['resolution'].value.y = 1 / (containerHeight * pixelRatio);
        composer.addPass(effectFXAA);
    } else if (useSMAA) {
        smaaPass = new SMAAPass();
        composer.addPass(smaaPass);
    }

    if(useColorCorrection){
        effectColor = new ShaderPass(ColorCorrectionShader);
        effectColor.uniforms['powRGB'].value.set(1.0, 1.0, 1.0);
        effectColor.uniforms['mulRGB'].value.set(1.0, 1.0, 1.0);
        composer.addPass(effectColor);
    }

    // 5. 最后添加伽马校正
    if (useGammaCorrection) {
        const gammaPass = new ShaderPass(GammaCorrectionShader);
        composer.addPass(gammaPass);
    }
    
    // 6. 输出通道
    outputPass = new OutputPass()
    composer.addPass(outputPass)

    function dispose() {
        outlinePass?.dispose()
        outlinePass = undefined

        composer = undefined

        renderPass?.dispose()
        renderPass = undefined

        effectFXAA?.dispose()
        effectFXAA = undefined

        outputPass?.dispose()
        outputPass = undefined

        taaPass?.dispose()
        taaPass = undefined

        smaaPass?.dispose()
        smaaPass = undefined

        ssaoPass?.dispose()
        ssaoPass = undefined
    }

    function resize(width: number, height: number) {
        composer!.setSize(width, height);
        const pixelRatio = renderer.getPixelRatio();
        if (effectFXAA) {
            effectFXAA.material.uniforms['resolution'].value.x = 1 / (width * pixelRatio);
            effectFXAA.material.uniforms['resolution'].value.y = 1 / (height * pixelRatio);
        }
    }

    return {
        outlinePass,
        composer,
        effectFXAA,
        taaPass,
        smaaPass,
        ssaoPass,
        effectColor,
        dispose,
        resize
    }
}