import * as THREE from 'three'
import { MapControls } from 'three/examples/jsm/controls/MapControls'
import Stats from 'three/examples/jsm/libs/stats.module'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader'
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader'
import useTransformControls from './useTransformControls'
import GUI from 'three/examples/jsm/libs/lil-gui.module.min'
import { gsap } from 'gsap'
import { useComposerHook } from './useComposer'
const gsapTimeLine = gsap.timeline()

declare global {
    interface Window {
        showOpenFilePicker: (options?: { types?: { accept: string }[], multiple?: boolean }) => Promise<FileSystemFileHandle[]>;
        showDirectoryPicker: (options?: { startIn?: string }) => Promise<FileSystemDirectoryHandle[]>;
    }
}

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
stats.dom.style.top = '60px';
stats.dom.style.left = '0px';
stats.dom.style.visibility = 'hidden'
document.body.appendChild(stats.dom);

let envMapTexture: THREE.Texture | null = null
let envMapTexture2: THREE.Texture | null = null
let environmentIntensity = 1.0
async function initEnvMap() {
    return new Promise((resolve, _reject) => {
        // 创建一个PMREMGenerator以生成环境贴图
        var pmremGenerator = new THREE.PMREMGenerator(renderer!);
        pmremGenerator.compileEquirectangularShader();

        let loader = new RGBELoader()

        loader.load('hdr/studio_small_06_2k.hdr', function (texture0) {
            texture0.colorSpace = THREE.SRGBColorSpace;
            texture0.mapping = THREE.EquirectangularReflectionMapping;
            // 通过PMREMGenerator处理texture生成环境贴图
            envMapTexture2 = pmremGenerator.fromEquirectangular(texture0).texture;

            loader.load('hdr/rostock_laage_airport_2k.hdr', function (texture) {
                texture.colorSpace = THREE.SRGBColorSpace;
                texture.mapping = THREE.EquirectangularReflectionMapping;
                // 通过PMREMGenerator处理texture生成环境贴图
                envMapTexture = pmremGenerator.fromEquirectangular(texture).texture;
                // 设置场景的环境贴图
                scene.environment = envMapTexture;
                scene.environmentIntensity = environmentIntensity ?? 1.0;
                // 释放pmremGenerator的资源
                console.log('环境贴图解析配置完成');
                pmremGenerator.dispose();
                resolve('环境贴图解析配置完成')
            });
        })
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

let getCenterFromBounding = () => {
    const box = new THREE.Box3().setFromObject(modelGroup)
    if (box.isEmpty()) {
        console.warn('Bounding box is empty; skip centering')
        return
    }
    const center = new THREE.Vector3()
    box.getCenter(center)
    const sphere = new THREE.Sphere()
    box.getBoundingSphere(sphere)
    const radius = Math.max(sphere.radius, 0.001)

    const verticalFov = THREE.MathUtils.degToRad(camera.fov)
    const aspect = Math.max(0.0001, camera.aspect)
    const distanceV = radius / Math.tan(verticalFov / 2)
    const horizFov = 2 * Math.atan(Math.tan(verticalFov / 2) * aspect)
    const distanceH = radius / Math.tan(horizFov / 2)
    const distance = Math.max(distanceV, distanceH) * 1.2

    if (mapControls) {
        mapControls.target.copy(center)
        mapControls.update()
    }
    const viewDir = new THREE.Vector3(1, 1, 1).normalize()
    camera.position.copy(center.clone().add(viewDir.multiplyScalar(distance)))
    camera.near = Math.max(0.1, distance / 1000)
    camera.far = Math.max(camera.near + 10, distance * 1000)
    camera.lookAt(center)
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
    // 修改阴影计算函数，增强对比度
    // THREE.ShaderChunk.shadowmap_pars_fragment = THREE.ShaderChunk.shadowmap_pars_fragment.replace(
    //     'float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {',
    //     `float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
    //             shadowIntensity = shadowIntensity * (1.0 + ${0.2});`
    // )
    viewerContainer.appendChild(renderer.domElement)


    camera.aspect = containerWidth / containerHeight
    camera.position.set(0, 0, 10)
    camera.lookAt(0, 0, 0)
    camera.layers.enableAll();

    mapControls = new MapControls(camera, renderer.domElement)
    mapControls.enableDamping = false
    mapControls.screenSpacePanning = false

    // composerApi = useComposerHook({
    //     renderer,
    //     scene,
    //     camera,
    //     containerWidth,
    //     containerHeight,
    //     highlightColor:'#fff',
    //     useTAA:true,
    //     TAASampleLevel:2
    // })

    const ambientLight = new THREE.AmbientLight(0xffffff, 1) // 环境光
    scene.add(ambientLight)

    const directionalLight = new THREE.DirectionalLight(0xfffdf6, 3)
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
    scene.add(directionalLight)

    //初始化背景
    initEnvMap()
    addEventListener()
    removeEvent = showEditor(1)
    addMapControlsGui()
    stats.dom.style.visibility = 'visible'
    viewerContainer.addEventListener('dblclick', addRaycaster)


    try {
        if (loadingTextEl) loadingTextEl.textContent = `正在加载模型（0/${urls.length}）...`
        await loadModels(urls)
        if (loadingTextEl) loadingTextEl.textContent = '正在计算视角...'
        // getCenterFromBounding()
        getCenterFromBounding()
        let position = {
            "x": -38.1035078849931,
            "y": 2.6764456514848263,
            "z": -58.96259276014798
        }
        camera.position.set(position.x, position.y, position.z)
        position = {
            "x": -41.51088325890221,
            "y": 2.377209136262537,
            "z": -48.9939838587306
        }
        mapControls!.target.set(position.x, position.y, position.z)
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
    const mapControlsFolder = gui.addFolder('MapControls')
    mapControlsFolder.add(mapControls, 'enableDamping').name('开启阻尼')
    mapControlsFolder.add(mapControls, 'screenSpacePanning').name('左键屏幕空间移动')
    mapControlsFolder.add(mapControls, 'dampingFactor').name('dampingFactor').min(0).max(1).step(0.01)
    mapControlsFolder.add(mapControls, 'panSpeed').name('panSpeed').min(0).max(10).step(0.01)
    mapControlsFolder.add(mapControls, 'rotateSpeed').name('rotateSpeed').min(0).max(10).step(0.01)
    mapControlsFolder.add(mapControls, 'zoomSpeed').name('zoomSpeed').min(0).max(10).step(0.01)
    mapControlsFolder.close()
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
function addLight(group:THREE.Group) {
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
        const directionalLightFolder = gui.addFolder('平行光')
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
        directionalLightFolder.open()
        lightFolder = directionalLightFolder
    }

    return lightBox
}

let lightBox = null as THREE.Group | null
const options = {
    showLight:false
}
function doAfterLoad(group: THREE.Group, _url: string) {
    if (execCoutn > 0) return
    execCoutn++

    lightBox = addLight(group)
    if(gui){
        gui.add(options, 'showLight').name('showLight').name('展示污泥脱水间灯光').onChange(val => {
            if (val) {
                lightBox && group.add(lightBox)
                lightFolder?.show()
            } else {
                lightBox && group.remove(lightBox)
                lightFolder?.hide()
            }
        })
    }
    // addLight(group)

    group.traverse(child => {
        if (child instanceof THREE.Mesh) {
            child.receiveShadow = true
            child.castShadow = true

            if (!Array.isArray(child.material)) {
                const mat = child.material as THREE.MeshStandardMaterial
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