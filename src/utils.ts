import { Group, Mesh, MeshPhysicalMaterial, Object3D, MeshStandardMaterial, Texture } from 'three'
export type MergeRule = (group: Object3D) => MergeResult
export type MergeResult = {
    matched: true,
    groupName: string,
    meshName: string
} | {
    matched: false
}

function handleMaterial(material: MeshPhysicalMaterial | MeshStandardMaterial, envMapTexture: Texture | null, envMapIntensity: number) {
    material.envMap = envMapTexture
    material.envMapIntensity = envMapIntensity * 0.5; // 进一步降低环境贴图强度

    //通过关闭顶点颜色解决模型的黑块问题
    material.vertexColors = false

    // 根据材质名称或颜色智能设置材质属性
    const materialName = material.name?.toLowerCase() || '';
    const isWater = materialName.includes('water') || materialName.includes('水');
    const isMetal = materialName.includes('metal') || materialName.includes('steel') || materialName.includes('iron');
    const isConcrete = materialName.includes('concrete') || materialName.includes('混凝土');
    const isGlass = materialName.includes('glass') || materialName.includes('玻璃');

    if (isWater) {
        // 水面材质设置
        material.metalness = 0.0;
        material.roughness = 0.3; // 增加粗糙度减少反射
        material.transparent = true;
        material.opacity = 0.8;
        if (material instanceof MeshPhysicalMaterial) {
            material.transmission = 0.7; // 降低透射
            material.thickness = 0.3;
        }
    } else if (isMetal) {
        // 金属材质设置
        material.metalness = 0.6; // 降低金属度
        material.roughness = 0.4; // 增加粗糙度
    } else if (isConcrete) {
        // 混凝土材质设置
        material.metalness = 0.0;
        material.roughness = 0.9; // 增加粗糙度
    } else if (isGlass) {
        // 玻璃材质设置
        material.metalness = 0.0;
        material.roughness = 0.1; // 轻微粗糙度
        material.transparent = true;
        material.opacity = 0.5; // 增加不透明度
        if (material instanceof MeshPhysicalMaterial) {
            material.transmission = 0.8; // 降低透射
            material.thickness = 0.1;
        }
    } else {
        // 默认材质设置
        if (!material.metalness || material.metalness === 0 || material.metalness === 1) {
            material.metalness = 0.1; // 大幅降低金属度
        }
        if (!material.roughness || material.roughness === 0) {
            material.roughness = 0.8; // 增加粗糙度
        }
    }

    // 简化物理材质的额外特性
    if (material instanceof MeshPhysicalMaterial) {
        material.clearcoat = 0.0; // 移除清漆层
        material.clearcoatRoughness = 0.5;
        material.sheen = 0.0; // 移除光泽
        material.sheenRoughness = 1.0;
        material.iridescence = 0.0; // 移除彩虹色
    }

    // 确保材质需要更新
    material.needsUpdate = true;
}

export type SuffixTraverseOptions = {
    envMapTexture: Texture | null,
    envMapIntensity: number,
    receiveShadow: boolean,
    afterLoadTraverse: (obj: Object3D, gltfUrl: string) => void,
    gltfUrl: string
}

export function suffixTraverse(scene: Group, options: SuffixTraverseOptions) {
    const { envMapTexture, envMapIntensity, receiveShadow, afterLoadTraverse, gltfUrl } = options
    scene.traverse(obj => {
        if (obj instanceof Mesh) {
            const mesh = obj as Mesh
            mesh.castShadow = true
            mesh.receiveShadow = receiveShadow ?? true

            if (mesh.material instanceof MeshPhysicalMaterial || mesh.material instanceof MeshStandardMaterial) {
                handleMaterial(mesh.material, envMapTexture, envMapIntensity)
            } else if (mesh.material instanceof Array) {
                (mesh.material as MeshPhysicalMaterial[]).forEach(material => {
                    handleMaterial(material, envMapTexture, envMapIntensity)
                })
            }
        }
        afterLoadTraverse(obj, gltfUrl)
    })
}