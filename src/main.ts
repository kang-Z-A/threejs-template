import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls'
import Stats from 'three/examples/jsm/libs/stats.module'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader'
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader'

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
let orbitControls: OrbitControls | null = null
const modelGroup = new THREE.Group()
scene.add(modelGroup)

const stats = new Stats()
stats.dom.style.position = 'absolute';
stats.dom.style.top = '0px';
stats.dom.style.left = (containerWidth - 100) + 'px';
document.body.appendChild(stats.dom);

let envMapTexture: THREE.Texture | null = null
let environmentIntensity = 1.0
async function initEnvMap() {
    return new Promise((resolve, _reject) => {
        // 创建一个PMREMGenerator以生成环境贴图
        var pmremGenerator = new THREE.PMREMGenerator(renderer!);
        pmremGenerator.compileEquirectangularShader();

        let loader = new RGBELoader()
        loader.load('hdr/Cloudy.hdr', function (texture) {
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
}

function animate() {
    camera.updateProjectionMatrix()
    orbitControls?.update()
    stats.update()
    renderer.render(scene, camera)
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

                const target = gltf.scene.getObjectByName("building19_L1002_4")
                if(target && target instanceof THREE.Mesh){
                    const material = target.material as THREE.MeshPhysicalMaterial
                    material.specularIntensity = 0
                    material.metalness = 0
                    material.roughness = 0.95
                }

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

    if (orbitControls) {
        orbitControls.target.copy(center)
        orbitControls.update()
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
            console.log('orbitControls.target', orbitControls?.target);
        }
    })
}

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
    viewerContainer.appendChild(renderer.domElement)


    camera.aspect = containerWidth / containerHeight
    camera.position.set(0, 0, 10)
    camera.lookAt(0, 0, 0)
    camera.layers.enableAll();

    orbitControls = new OrbitControls(camera, renderer.domElement)
    orbitControls.enableDamping = false

    const ambientLight = new THREE.AmbientLight(0xffffff, 1) // 环境光
    scene.add(ambientLight)

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1)
    directionalLight.position.set(1, 1, 1)
    scene.add(directionalLight)

    //初始化背景
    initEnvMap()
    addEventListener()

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