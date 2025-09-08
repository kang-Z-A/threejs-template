import * as THREE from 'three'
import { MapControls } from 'three/examples/jsm/controls/MapControls'
import Stats from 'three/examples/jsm/libs/stats.module'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader'
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader'
import useTransformControls from './useTransformControls'
import GUI from 'three/examples/jsm/libs/lil-gui.module.min'
import { gsap } from 'gsap'
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
import { useComposerHook } from './useComposer'
import { EXRLoader } from 'three/examples/jsm/Addons'
const gsapTimeLine = gsap.timeline()

declare global {
    interface Window {
        showOpenFilePicker: (options?: {
            types?: {
                description?: string,
                accept: Record<string, string[]>
            }[],
            multiple?: boolean
        }) => Promise<FileSystemFileHandle[]>;
        showDirectoryPicker: (options?: { startIn?: string }) => Promise<FileSystemDirectoryHandle[]>;
    }
}

const header = document.querySelector('.header') as HTMLElement
const dropZone = document.getElementById('dropZone') as HTMLElement
const mainContent = document.querySelector('.main-content') as HTMLElement
const viewerContainer = document.getElementById('viewerContainer') as HTMLElement
const loadingOverlay = document.getElementById('loadingOverlay') as HTMLElement | null
const loadingTextEl = document.getElementById('loadingText') as HTMLElement | null

dropZone.addEventListener('dragover', (e) => {
    e.preventDefault()
})

dropZone.addEventListener('drop', async (event: DragEvent) => {
    event.preventDefault();
    const files = event.dataTransfer?.files;
    const items = event.dataTransfer?.items;
    if (files) {
        const promises = []
        if (items && items.length > 0) {
            for (const item of items) {
                const entry = item.webkitGetAsEntry() as FileSystemFileEntry | FileSystemDirectoryEntry | null;
                if (!entry) continue
                promises.push(readFiles(entry))
            }
        }
        const resultFiles = await Promise.all(promises)
        const allFiles = resultFiles.flat()

        console.log('[ All files ] >', allFiles);
        renderScene(allFiles)
    }
})

dropZone.addEventListener('click', async () => {
    try {
        if ('showOpenFilePicker' in window) {
            const fileHandles = await window.showOpenFilePicker({ multiple: true });
            const files = await Promise.all(fileHandles.map(handle => handle.getFile()));
            console.log('[ All files ] >', files);
            renderScene(files)
            // return files;
        } else {
            console.error('浏览器不支持 showOpenFilePicker');
        }
    } catch (err) {
        console.error('选择文件失败:', err);
    }
})

window.addEventListener('resize', () => {
    // camera.aspect = viewerContainer.clientWidth / viewerContainer.clientHeight
    const targetDom = document.getElementById('viewerContainer') as HTMLElement
    if (!targetDom) return
    const containerWidth = targetDom.clientWidth
    const containerHeight = targetDom.clientHeight
    renderer.setSize(containerWidth, containerHeight)
    camera.updateProjectionMatrix()
    renderer.setSize(containerWidth, containerHeight)
    if (composerApi) {
        composerApi.resize(containerWidth, containerHeight)
    }
})

let gui: GUI | null = null
function showEditor(length: number = 10) {
    if (!mapControls) return
    const { remove, getGui } = useTransformControls({
        renderer: renderer,
        camera: camera,
        scene: scene,
        controls: mapControls,
        length: length,
    })
    gui = getGui()

    return remove
}

async function readFiles(entry: FileSystemEntry | FileSystemFileEntry | FileSystemDirectoryEntry) {
    if (entry.isDirectory) {
        console.log('======文件夹==========');
        let directoryEntry = entry as FileSystemDirectoryEntry;
        let directoryReader = directoryEntry.createReader();
        const entries = await new Promise((resolve: (entries: FileSystemEntry[]) => void, reject: (error: Error) => void) => {
            directoryReader.readEntries((entries) => {
                resolve(entries)
            }, () => {
                reject(new Error('读取文件夹失败'))
            })
        })
        let files = [] as File[]
        for (const entry of entries) {
            const resultFiles = await readFiles(entry)
            files = files.concat(resultFiles)
        }
        return files
    } else {
        console.log('======文件==========');
        let fileEntry = entry as FileSystemFileEntry;
        const file = await new Promise((resolve: (file: File) => void, reject: (error: Error) => void) => {
            fileEntry.file((file) => {
                resolve(file)
            }, () => {
                reject(new Error('读取文件失败'))
            })
        })
        return [file]
    }
}

function renderScene(files: File[]) {
    const fileUrls = getFileUrls(files)
    //展示三维场景
    viewerContainer.classList.add('active')
    mainContent.style.display = 'none'
    header.style.display = 'none'
    if (loadingOverlay) loadingOverlay.classList.add('active')
    if (loadingTextEl) loadingTextEl.textContent = '正在准备渲染...'
    setTimeout(() => {
        initThreeScene(fileUrls)
    }, 100)
}

function getFileUrls(files: File[]) {
    const FileMap = new Map()

    for (let i = 0; i < files.length; i++) {
        const file = files[i]
        const ext = file.name.split('.').pop() || ''

        if (!['glb', 'gltf'].includes(ext)) {
            continue
        }

        const Url = FileMap.get(file.name)
        if (!Url) {
            const fileUrl = URL.createObjectURL(file)
            FileMap.set(file.name, fileUrl)
        }
    }

    return Array.from(FileMap.values())
}

const containerWidth = viewerContainer.clientWidth
const containerHeight = viewerContainer.clientHeight

const scene = new THREE.Scene()
const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    logarithmicDepthBuffer: true,
    preserveDrawingBuffer: true
})
const camera = new THREE.PerspectiveCamera(60, containerWidth / containerHeight, 0.1, 10000)
let mapControls: MapControls | null = null
const modelGroup = new THREE.Group()
scene.add(modelGroup)
let composerApi: ReturnType<typeof useComposerHook> | null = null

const stats = new Stats()
stats.dom.style.position = 'absolute';
stats.dom.style.top = '0px';
stats.dom.style.left = '0px';
stats.dom.style.visibility = 'hidden'
document.body.appendChild(stats.dom);

let envMapTexture: THREE.Texture | null = null
let envMapTexture2: THREE.Texture | null = null
let environmentIntensity = 0.5

type initEnvMapOptions = {
    filePath?: string
    updateMaterials?: boolean,
    fileType?: 'exr' | 'hdr'
}
async function initEnvMap(options: initEnvMapOptions) {
    const { filePath = 'hdr/rostock_laage_airport_2k.hdr', updateMaterials = false, fileType = 'hdr' } = options
    return new Promise((resolve, _reject) => {
        // 创建一个PMREMGenerator以生成环境贴图
        var pmremGenerator = new THREE.PMREMGenerator(renderer!);
        pmremGenerator.compileEquirectangularShader();


        let loader;
        if (fileType === 'exr') {
            loader = new EXRLoader();
        } else {
            loader = new RGBELoader();
        }

        loader.load(filePath, function (texture) {
            texture.colorSpace = THREE.SRGBColorSpace;
            texture.mapping = THREE.EquirectangularReflectionMapping;
            // 通过PMREMGenerator处理texture生成环境贴图
            envMapTexture = pmremGenerator.fromEquirectangular(texture).texture;
            // 设置场景的环境贴图
            scene.environment = envMapTexture;
            scene.environmentIntensity = environmentIntensity ?? 1.0;
            // 释放pmremGenerator的资源
            console.log('环境贴图解析配置完成');

            if (updateMaterials) {
                scene.traverse(child => {
                    if (child instanceof THREE.Mesh) {
                        if (child.material instanceof THREE.MeshPhysicalMaterial || child.material instanceof THREE.MeshStandardMaterial) {
                            child.material.envMap = envMapTexture
                            child.material.envMapIntensity = environmentIntensity ?? 1.0
                            child.material.needsUpdate = true
                        }
                    }
                })
            }
            pmremGenerator.dispose();
            resolve('环境贴图解析配置完成')
        },
            undefined, // onProgress回调
            (error) => {
                console.error('环境贴图加载失败:', error);
                resolve('环境贴图加载失败');
            });
    })
}

function animate() {
    camera.updateProjectionMatrix()
    mapControls?.update()
    stats.update()
    if (composerApi) {
        composerApi.composer.render()
    } else {
        renderer.render(scene, camera)
    }
}

const loader = new GLTFLoader()
const dracoLoader = new DRACOLoader()
dracoLoader.setDecoderPath('draco/gltf/')
loader.setDRACOLoader(dracoLoader)


async function loadModels(urls: string[]) {
    let count = urls.length, finished = 0
    return new Promise((resolve, reject) => {
        for (const url of urls) {
            loader.load(url, (gltf) => {
                console.log(`${url} scene`, gltf.scene);
                // gltf.scene.scale.set(0.01, 0.01, 0.01)

                doAfterLoad(gltf.scene, url)

                modelGroup.add(gltf.scene)
                finished++
                if (loadingTextEl) {
                    loadingTextEl.textContent = `正在加载模型（${finished}/${count}）...`
                }
                if (finished === count) {
                    resolve('模型加载完成')
                }
            }, (xhr) => {
                if (xhr && typeof xhr.loaded === 'number' && typeof xhr.total === 'number' && xhr.total > 0) {
                    const percent = Math.min(99, Math.floor((xhr.loaded / xhr.total) * 100))
                    if (loadingTextEl) {
                        loadingTextEl.textContent = `正在加载模型（${finished}/${count}）... ${percent}%`
                    }
                }
            }, (error) => {
                console.log(`[ ${url} ] > ${error}`)
                if (loadingTextEl) loadingTextEl.textContent = '模型加载失败，请重试'
                reject(error)
            })
        }
    })
}

// 计算模型包围盒中心并自动调整相机视角与远近裁剪面
let getCenterFromBounding = () => {
    // 计算模型组的包围盒
    const box = new THREE.Box3().setFromObject(modelGroup)
    if (box.isEmpty()) {
        // 如果包围盒为空，输出警告并跳过居中
        console.warn('Bounding box is empty; skip centering')
        return
    }
    // 获取包围盒中心点
    const center = new THREE.Vector3()
    box.getCenter(center)
    // 获取包围球及半径
    const sphere = new THREE.Sphere()
    box.getBoundingSphere(sphere)
    // 防止半径为0，最小值为0.001
    const radius = Math.max(sphere.radius, 0.001)

    // 计算相机垂直视场角（弧度制）
    const verticalFov = THREE.MathUtils.degToRad(camera.fov)
    // 获取相机宽高比，防止为0
    const aspect = Math.max(0.0001, camera.aspect)
    // 根据垂直视场角计算到模型的距离
    const distanceV = radius / Math.tan(verticalFov / 2)
    // 计算水平视场角
    const horizFov = 2 * Math.atan(Math.tan(verticalFov / 2) * aspect)
    // 根据水平视场角计算到模型的距离
    const distanceH = radius / Math.tan(horizFov / 2)
    // 取较大距离并适当放大，保证模型完整显示
    const distance = Math.max(distanceV, distanceH) * 1.1

    // 设置控制器的目标点为模型中心
    if (mapControls) {
        mapControls.target.copy(center)
        mapControls.update()
    }
    // 设定相机视角方向（可根据需求调整方向）
    const viewDir = new THREE.Vector3(1, 1, 1).normalize()
    // 设置相机位置为中心点加上视角方向乘以距离
    camera.position.copy(center.clone().add(viewDir.multiplyScalar(distance)))
    // 自动设置相机近裁剪面，防止过小
    camera.near = Math.max(0.1, distance / 1000)
    // 自动设置相机远裁剪面，保证场景完整
    camera.far = Math.max(camera.near + 10, distance * 1000)
    // 相机朝向模型中心
    camera.lookAt(center)
    // 更新相机投影矩阵
    camera.updateProjectionMatrix()
}

function addEventListener() {
    document.addEventListener('keydown', (e) => {
        if (e.code === 'Space') {
            console.log('cameraPosition', camera.position);
            console.log('MapControls.target', mapControls?.target);
        }
    })
}

let axisHelper: THREE.AxesHelper | undefined
let removeEvent: Function | undefined
async function initThreeScene(urls: string[]) {
    const containerWidth = viewerContainer.clientWidth
    const containerHeight = viewerContainer.clientHeight

    renderer.localClippingEnabled = true
    if (loadingTextEl) loadingTextEl.textContent = '正在初始化渲染器...'
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(containerWidth, containerHeight)
    renderer.shadowMap.enabled = true // 渲染器阴影渲染
    renderer.shadowMap.type = THREE.PCFSoftShadowMap // 阴影类型
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 0.8
    // 修改阴影计算函数，增强对比度并进行标准化处理
    // THREE.ShaderChunk.shadowmap_pars_fragment = THREE.ShaderChunk.shadowmap_pars_fragment.replace(
    //     'float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {',
    //     `float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
    //             // 增强阴影强度但限制在合理范围内
    //             shadowIntensity = clamp(shadowIntensity * (1.0 + ${0.9}), 0.0, 1.0);`
    // )
    viewerContainer.appendChild(renderer.domElement)


    camera.aspect = containerWidth / containerHeight
    camera.position.set(0, 0, 10)
    camera.lookAt(0, 0, 0)
    camera.layers.enableAll();

    axisHelper = new THREE.AxesHelper(10)
    scene.add(axisHelper)

    mapControls = new MapControls(camera, renderer.domElement)
    mapControls.enableDamping = false
    mapControls.screenSpacePanning = false

    composerApi = useComposerHook({
        renderer,
        scene,
        camera,
        containerWidth,
        containerHeight,
        highlightColor: '#fff',
        useTAA: true,
        TAASampleLevel: 1,
        useColorCorrection:true,
        useSSAO: false
    })

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.35) // 环境光
    scene.add(ambientLight)

    const directionalLight = new THREE.DirectionalLight(0xfffdf6, 5)
    directionalLight.position.set(300, 150, 200)
    directionalLight.castShadow = true
    directionalLight.shadow.mapSize.width = Math.pow(2, 13); // 保持高分辨率阴影贴图
    directionalLight.shadow.mapSize.height = Math.pow(2, 13);
    directionalLight.shadow.blurSamples = 8; // 增加模糊采样数量以获得更柔和的阴影边缘
    const length = 200
    directionalLight.shadow.camera.left = -length
    directionalLight.shadow.camera.right = length
    directionalLight.shadow.camera.top = length
    directionalLight.shadow.camera.bottom = -length
    directionalLight.shadow.camera.far = 500
    directionalLight.shadow.camera.near = 300
    directionalLight.shadow.radius = 2
    directionalLight.shadow.bias = -0.0015
    // scene.add(directionalLight)

    //初始化背景
    initEnvMap({})
    addEventListener()
    removeEvent = showEditor(1)

    if (gui) {
        const outdoorLightFolder = gui.addFolder('室外平行光')
        outdoorLightFolder.add(directionalLight, 'intensity').name('灯光强度').min(0).max(15).step(0.1)
        outdoorLightFolder.add(directionalLight.shadow, 'bias').name('bias').min(-0.5).max(0.5).step(0.0000001)
        outdoorLightFolder.add(directionalLight.position, 'x').name('平行光位置x').min(-500).max(500).step(0.1)
        outdoorLightFolder.add(directionalLight.position, 'y').name('平行光位置Y').min(0).max(300).step(0.1)
        outdoorLightFolder.add(directionalLight.position, 'z').name('平行光位置Z').min(-500).max(500).step(0.1)
        outdoorLightFolder.add(directionalLight.shadow.camera, 'near').name('平行光阴影相机近截面距离').min(0.1).max(600).step(0.1).onChange(() => {
            directionalLight.shadow.camera.updateProjectionMatrix()
        })
        outdoorLightFolder.add(directionalLight.shadow.camera, 'far').name('平行光阴影相机远截面距离').min(0.1).max(1000).step(0.1).onChange(() => {
            directionalLight.shadow.camera.updateProjectionMatrix()
        })
        outdoorLightFolder.close()
    }

    addMapControlsGui()
    addHDRGui()
    addComposerGui()
    stats.dom.style.visibility = 'visible'
    viewerContainer.addEventListener('dblclick', addRaycaster)


    try {
        if (loadingTextEl) loadingTextEl.textContent = `正在加载模型（0/${urls.length}）...`
        await loadModels(urls)
        if (loadingTextEl) loadingTextEl.textContent = '正在计算视角...'
        getCenterFromBounding()
        if (loadingTextEl) loadingTextEl.textContent = '即将开始渲染...'
        renderer.setAnimationLoop(animate)
    } catch (e) {
        console.error('加载模型出错: ', e)
    } finally {
        if (loadingOverlay) loadingOverlay.classList.remove('active')
    }
}

function addMapControlsGui() {
    if (!gui || !mapControls) return
    const mapControlsFolder = gui.addFolder('控制器')
    mapControlsFolder.add(mapControls, 'enableDamping').name('开启阻尼')
    mapControlsFolder.add(mapControls, 'screenSpacePanning').name('左键屏幕空间移动')
    mapControlsFolder.add(mapControls, 'dampingFactor').name('dampingFactor').min(0).max(1).step(0.01)
    mapControlsFolder.add(mapControls, 'panSpeed').name('panSpeed').min(0).max(10).step(0.01)
    mapControlsFolder.add(mapControls, 'rotateSpeed').name('rotateSpeed').min(0).max(10).step(0.01)
    mapControlsFolder.add(mapControls, 'zoomSpeed').name('zoomSpeed').min(0).max(10).step(0.01)
    mapControlsFolder.close()
}

function addHDRGui() {
    if (!gui) return
    const hdrFolder = gui.addFolder('环境贴图')
    hdrFolder.add(options, 'changeEnvMap').name('切换环境贴图')
    hdrFolder.add(options, 'envMapIntensity').name('环境贴图强度').min(0).max(3).step(0.01).onChange(() => {
        scene.traverse(child => {
            if (child instanceof THREE.Mesh) {
                if (child.material instanceof THREE.MeshPhysicalMaterial || child.material instanceof THREE.MeshStandardMaterial) {
                    child.material.envMapIntensity = options.envMapIntensity
                    child.material.needsUpdate = true
                }
            }
        })
    })
    hdrFolder.close()
}

function addComposerGui() {
    if (!gui || !composerApi) return

    const composerFolder = gui.addFolder('后处理')
    if (composerApi.ssaoPass) {
        const options = {
            showSSAO:false
        }
        composerFolder.add(composerApi.ssaoPass, 'kernelRadius').name('kernelRadius').min(0).max(64).step(0.1)
        composerFolder.add(composerApi.ssaoPass, 'minDistance').name('minDistance').min(0.001).max(1.0).step(0.001)
        composerFolder.add(composerApi.ssaoPass, 'maxDistance').name('maxDistance').min(0.01).max(10.0).step(0.0001)
        composerFolder.add(options, 'showSSAO').name('SSAO图像').onChange(val => {
            if(val){
                composerApi!.ssaoPass!.output = SSAOPass.OUTPUT.SSAO
            }else{
                composerApi!.ssaoPass!.output = SSAOPass.OUTPUT.Default
            }
        })
        composerFolder.add(composerApi.ssaoPass, 'enabled').name('SSAO启用')
    }

    if (composerApi.effectColor) {
        const options = {
            powRGB: 1.0,
            mulRGB: 1.0,
        }
        composerFolder.add(composerApi.effectColor, 'enabled').name('色彩校正')
        composerFolder.add(options, 'powRGB').min(0).max(5).step(0.01).name('effectColor_powRGB').onChange(val => {
            composerApi!.effectColor!.material.uniforms['powRGB'].value.set(val, val, val)
        })
        composerFolder.add(options, 'mulRGB').min(0).max(5).step(0.01).name('effectColor_mulRGB').onChange(val => {
            composerApi!.effectColor!.material.uniforms['mulRGB'].value.set(val, val, val)
        })
    }

    if(composerApi.taaPass){
        composerFolder.add(composerApi.taaPass, 'enabled').name('taa抗锯齿')
        composerFolder.add(composerApi.taaPass, 'sampleLevel').min(0).max(5).step(1).name('taa抗锯齿采样等级')
    }
    composerFolder.close()
}

const pos = new THREE.Vector3()
function addRaycaster(event: MouseEvent) {
    event.preventDefault()

    const mouse = new THREE.Vector2()
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1
    mouse.y = - (event.clientY / window.innerHeight) * 2 + 1
    const raycaster = new THREE.Raycaster()
    raycaster.setFromCamera(mouse, camera)
    const intersects = raycaster.intersectObjects(scene.children)
    // console.log(intersects)
    if (intersects.length > 0) {
        const object = intersects[0].object
        console.log('射线拾取到物体：', object)

        object.getWorldPosition(pos)
        const unitVector = new THREE.Vector3().subVectors(pos, camera.position).normalize()
        const pos2 = pos.clone().add(unitVector.multiplyScalar(-3))

        if (!mapControls) return
        gsapTimeLine.kill()
        gsapTimeLine.to(camera.position, {
            x: pos2.x,
            y: pos2.y,
            z: pos2.z,
            duration: 0.5,
            ease: 'power2.inOut'
        })
        gsapTimeLine.to(mapControls!.target, {
            x: pos.x,
            y: pos.y,
            z: pos.z,
            duration: 0.5,
            ease: 'power2.inOut'
        })
        gsapTimeLine.play()
    }
}

let execCoutn = 0, center = { x: -39.89443344077032, y: 0.10530759300673465, z: -53.995329363649034 }
let lightFolder = null as GUI | null
function addLight(group: THREE.Group) {
    const lightBox = new THREE.Group()
    lightBox.name = 'lightBox'
    let position = { x: -35.04560543736986, y: 1.125605617251738, z: -54.4983522125491 }

    const directionalLight = new THREE.DirectionalLight(0xfffdf6, 3)
    directionalLight.position.set(position.x, position.y, position.z)
    directionalLight.target.position.set(center.x, center.y, center.z)
    lightBox.add(directionalLight.target)
    lightBox.add(directionalLight)

    const directionalLight2 = new THREE.DirectionalLight(0xfffdf6, 1.2)
    position = { x: -39.75941112689964, y: 0.937708701278898, z: -56.669197007802374 }
    directionalLight2.position.set(position.x, position.y, position.z)
    // directionalLight2.target.position.set(center.x, center.y, center.z)
    directionalLight2.target.position.set(position.x, position.y - 10, position.z)
    lightBox.add(directionalLight2)
    lightBox.add(directionalLight2.target)
    addLightShadow(directionalLight2)

    position = { x: -45.83234042693757, y: 1.065550923889952, z: -55.56383205194379 }
    const directionalLight3 = new THREE.DirectionalLight(0xfffdf6, 0.3)
    directionalLight3.position.set(position.x, position.y, position.z)
    directionalLight3.target.position.set(center.x, center.y, center.z)
    // directionalLight3.target.position.set(position.x, position.y - 10, position.z)
    lightBox.add(directionalLight3)
    lightBox.add(directionalLight3.target)

    position = { x: -41.284753900624075, y: 4.7770173140838175, z: -56.821598332646516 }
    const directionalLight4 = new THREE.DirectionalLight(0xfffdf6, 0.4)
    directionalLight4.position.set(position.x, position.y, position.z)
    directionalLight4.target.position.set(center.x, center.y, center.z)
    lightBox.add(directionalLight4)
    lightBox.add(directionalLight4.target)

    if (gui) {
        const directionalLightFolder = gui.addFolder('室内平行光')
        directionalLightFolder.add(directionalLight2.target.position, 'x').name('阴影目标X').min(-100).max(100).step(0.1)
        directionalLightFolder.add(directionalLight2.target.position, 'y').name('阴影目标Y').min(-100).max(100).step(0.1)
        directionalLightFolder.add(directionalLight2.target.position, 'z').name('阴影目标Z').min(-100).max(100).step(0.1)
        directionalLightFolder.add(directionalLight, 'castShadow').name('light1_castShadow').name('灯光1投射阴影').onChange(function (val: boolean) {
            if (val) {
                addLightShadow(directionalLight)
            } else {
                directionalLight.shadow.dispose()
                directionalLight.castShadow = false
            }
        })
        directionalLightFolder.add(directionalLight2, 'castShadow').name('light2_castShadow').name('灯光2投射阴影').onChange(function (val: boolean) {
            if (val) {
                addLightShadow(directionalLight2)
            } else {
                directionalLight2.shadow.dispose()
                directionalLight2.castShadow = false
            }
        })
        directionalLightFolder.add(directionalLight3, 'castShadow').name('light3_castShadow').name('灯光3投射阴影').onChange(function (val: boolean) {
            if (val) {
                addLightShadow(directionalLight3)
            } else {
                directionalLight3.shadow.dispose()
                directionalLight3.castShadow = false
            }
        })
        directionalLightFolder.add(directionalLight4, 'castShadow').name('light4_castShadow').name('灯光4投射阴影').onChange(function (val: boolean) {
            if (val) {
                addLightShadow(directionalLight4)
            } else {
                directionalLight4.shadow.dispose()
                directionalLight4.castShadow = false
            }
        })
        // directionalLightFolder.add(directionalLight.shadow, 'blurSamples').min(0).max(10).step(1).onChange(val => {
        //     directionalLight2.shadow.blurSamples = val
        // })
        // directionalLightFolder.add(directionalLight.shadow, 'bias').min(0).max(1).step(0.00001).onChange(val => {
        //     directionalLight2.shadow.bias = val
        // })
        // directionalLightFolder.add(directionalLight.shadow, 'radius').min(0).max(10).step(0.01).onChange(val => {
        //     directionalLight2.shadow.radius = val
        // })
        directionalLightFolder.add(directionalLight, 'intensity').name('灯光1强度').min(0).max(3).step(0.1)
        directionalLightFolder.add(directionalLight2, 'intensity').name('灯光2强度').min(0).max(3).step(0.1)
        directionalLightFolder.add(directionalLight3, 'intensity').name('灯光3强度').min(0).max(3).step(0.1)
        directionalLightFolder.add(directionalLight4, 'intensity').name('灯光4强度').min(0).max(3).step(0.1)
        directionalLightFolder.close()
        lightFolder = directionalLightFolder
    }

    return lightBox
}

const views = [
    //污泥脱水间视角
    {
        cameraPosition: {
            "x": -38.1035078849931,
            "y": 2.6764456514848263,
            "z": -58.96259276014798
        },
        target: {
            "x": -41.51088325890221,
            "y": 2.377209136262537,
            "z": -48.9939838587306
        }
    },
    //全厂视角
    {
        cameraPosition: {
            "x": -117.39883179817937,
            "y": 76.09916388265496,
            "z": -5.785914196212406
        },
        target: {
            "x": -18.261177319630175,
            "y": 2.377209136262534,
            "z": -1.6077837065429958
        }
    }
]
let lightBox = null as THREE.Group | null
const options = {
    showLight: false,
    showStats: true,
    showAxis: true,
    envMapIntensity: 1.0,
    useView1: () => changeView(0),
    useView2: () => changeView(1),
    changeEnvMap: () => changeEnvMap()
}

function changeView(index: number) {
    gsapTimeLine.kill()
    gsapTimeLine.to(camera.position, {
        x: views[index].cameraPosition.x,
        y: views[index].cameraPosition.y,
        z: views[index].cameraPosition.z,
        duration: 0.5,
        ease: 'power2.inOut'
    })
    gsapTimeLine.to(mapControls!.target, {
        x: views[index].target.x,
        y: views[index].target.y,
        z: views[index].target.z,
        duration: 0.5,
        ease: 'power2.inOut'
    }, '<')
}

async function changeEnvMap() {
    const fileHandles = await window.showOpenFilePicker(
        {
            multiple: false,
            types: [
                {
                    description: '环境贴图文件',
                    accept: {
                        'application/octet-stream': ['.exr', '.hdr']
                    }
                }
            ]
        }
    );
    const files = await Promise.all(fileHandles.map(handle => handle.getFile()));
    console.log('[ All files ] >', files);

    if (files.length > 0) {
        const file = files[0]
        const ext = file.name.split('.').pop()?.toLowerCase() || ''
        if (ext === 'exr' || ext === 'hdr') {
            const filePath = URL.createObjectURL(file)
            initEnvMap({
                filePath,
                fileType: ext,
                updateMaterials: true
            })
        }
    }
}

function doAfterLoad(group: THREE.Group, _url: string) {
    if (execCoutn > 0) return
    execCoutn++

    lightBox = addLight(group)
    if (gui) {
        gui.add(options, 'showLight').name('展示污泥脱水间灯光').onChange(val => {
            if (val) {
                lightBox && group.add(lightBox)
                lightFolder?.show()
            } else {
                lightBox && group.remove(lightBox)
                lightFolder?.hide()
            }
        })
        gui.add(options, 'showStats').name('性能监视器').onChange(val => {
            if (val) {
                stats.dom.style.visibility = 'visible'
            } else {
                stats.dom.style.visibility = 'hidden'
            }
        })
        gui.add(options, 'showAxis').name('坐标轴').onChange(val => {
            if (!axisHelper) return
            if (val) {
                scene.add(axisHelper)
            } else {
                scene.remove(axisHelper)
            }
        })
        gui.add(options, 'useView1').name('污泥脱水间视角')
        gui.add(options, 'useView2').name('全厂视角')
    }

    group.traverse(child => {
        if (child instanceof THREE.Mesh) {
            child.receiveShadow = true
            child.castShadow = true

            if (!Array.isArray(child.material)) {
                const mat = child.material as THREE.MeshStandardMaterial
                mat.vertexColors = false
                const materialNames = ['equ_1_metal_white.002', '新新冷灰']
                if (materialNames.includes(mat.name)) {
                    mat.envMap = envMapTexture
                    mat.envMapIntensity = 0.25
                } else {
                    mat.envMap = envMapTexture
                    mat.envMapIntensity = 0.75
                }
            }

            // if (child.name === 'equ_1_2002_2') {
            //     const mat = child.material as THREE.MeshStandardMaterial
            //     const newMat = new THREE.MeshPhysicalMaterial(mat)
            //     newMat.metalness = 0.9
            //     newMat.roughness = 0.1
            //     newMat.reflectivity = 2.0
            //     child.material = newMat
            //     mat.dispose()
            // }
        }
    })
}

function addLightShadow(light: THREE.DirectionalLight) {
    light.castShadow = true
    light.shadow.mapSize.width = Math.pow(2, 13); // 保持高分辨率阴影贴图
    light.shadow.mapSize.height = Math.pow(2, 13);
    light.shadow.blurSamples = 4; // 增加模糊采样数量以获得更柔和的阴影边缘

    const d = 10
    light.shadow.camera.left = -d
    light.shadow.camera.right = d
    light.shadow.camera.top = d
    light.shadow.camera.bottom = -d
    light.shadow.bias = -0.0005

    light.shadow.camera.far = 10
    light.shadow.camera.near = 0.01
    light.shadow.radius = 2
    // const lightHelper = new THREE.CameraHelper(light.shadow.camera)
    // scene.add(lightHelper)
}