// 引入TransformControls，辅助定位
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import * as THREE from 'three';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { MapControls } from 'three/examples/jsm/controls/MapControls.js';

type MyCatmullRomCurve3 = THREE.CatmullRomCurve3 & { mesh?: THREE.Line }

type SplineObject = {
    uniform?: MyCatmullRomCurve3
    centripetal?: MyCatmullRomCurve3
    chordal?: MyCatmullRomCurve3
} & {
    [key: string]: MyCatmullRomCurve3
}

type Options = {
    renderer: THREE.WebGLRenderer
    camera: THREE.Camera
    scene: THREE.Scene,
    controls: OrbitControls | MapControls,
    length?: number,
}

interface TransformControlsRoot extends THREE.Object3D {
    readonly isTransformControlsRoot: true;
    controls: TransformControls;
    dispose(): void;
}

const GroupName = 'transformGroup'

function useTransformControls(options: Options) {
    const { renderer, camera, scene, controls } = options;
    const splineHelperObjects = [] as THREE.Mesh[];
    let splinePointsLength = 1;
    const positions = [] as THREE.Vector3[];
    const point = new THREE.Vector3();
    let transformHelper: TransformControlsRoot;

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const onUpPosition = new THREE.Vector2();
    const onDownPosition = new THREE.Vector2();

    const length = options.length || 10;
    const geometry = new THREE.BoxGeometry(length, length, length);
    let transformControl: TransformControls;

    const ARC_SEGMENTS = 200;

    const splines = {} as SplineObject;
    let destroying = false

    let gui: GUI;

    const params = {
        uniform: true,
        tension: 0,
        centripetal: true,
        chordal: true,
        scale: 1,
        addPoint: addPoint,
        removePoint: removePoint,
        exportSpline: exportSpline
    };

    init();

    function init() {
        gui = new GUI();

        const transformControlsFolder = gui.addFolder('TransformControls')
        transformControlsFolder.add(params, 'uniform').onChange(render);
        transformControlsFolder.add(params, 'tension', 0, 1).step(0.01).onChange(function (value) {
            if (splines.uniform) {
                splines.uniform.tension = value;
                updateSplineOutline();
            }

        });
        transformControlsFolder.add(params, 'scale', 0, 10).step(0.1).onChange(function (value) {
            params.scale = value;
            updateMeshScale()
        });
        // gui.add(params, 'centripetal').onChange(render);
        // gui.add(params, 'chordal').onChange(render);
        transformControlsFolder.add(params, 'addPoint');
        transformControlsFolder.add(params, 'removePoint');
        transformControlsFolder.add(params, 'exportSpline');
        gui.open();


        transformControl = new TransformControls(camera, renderer.domElement);
        transformHelper = transformControl.getHelper();
        transformControl.addEventListener('dragging-changed', function (event) {
            controls.enabled = !event.value;
        });

        let transformGroup = scene.getObjectByName(GroupName);
        if (!transformGroup) {
            transformGroup = new THREE.Group();
            transformGroup.name = GroupName
            scene.add(transformGroup);
        }
        setIngore(transformHelper)
        transformGroup.add(transformHelper);

        transformControl.addEventListener('objectChange', function () {
            updateSplineOutline();
        });

        document.addEventListener('pointerdown', onPointerDown);
        document.addEventListener('pointerup', onPointerUp);
        document.addEventListener('pointermove', onPointerMove);

        /*******
         * Curves
         *********/

        for (let i = 0; i < splinePointsLength; i++) {

            addSplineObject(positions[i]);

        }

        positions.length = 0;

        for (let i = 0; i < splinePointsLength; i++) {

            positions.push(splineHelperObjects[i].position);

        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(ARC_SEGMENTS * 3), 3));

        let curve: MyCatmullRomCurve3 = new THREE.CatmullRomCurve3(positions);
        curve.curveType = 'catmullrom';
        curve.tension = params.tension;
        curve.mesh = new THREE.Line(geometry.clone(), new THREE.LineBasicMaterial({
            color: 0xff0000,
            opacity: 0.35
        }));
        curve.mesh.scale.set(params.scale, params.scale, params.scale);
        curve.mesh.castShadow = true;
        splines.uniform = curve;

        for (const k in splines) {
            const spline = splines[k];
            setIngore(spline.mesh!)
            transformGroup.add(spline.mesh!);
        }

        load([new THREE.Vector3(289.76843686945404, 452.51481137238443, 56.10018915737797),
        new THREE.Vector3(- 53.56300074753207, 171.49711742836848, - 14.495472686253045),
        new THREE.Vector3(- 91.40118730204415, 176.4306956436485, - 6.958271935582161),
        new THREE.Vector3(- 383.785318791128, 491.1365363371675, 47.869296953772746)]);

        render();

    }

    function updateMeshScale() {
        for (const object of splineHelperObjects) {
            object.scale.set(params.scale, params.scale, params.scale);
        }
    }

    function setIngore(object: THREE.Object3D) {
        object.userData.__needIgnore = true
        if (object.children.length > 0) {
            object.children.forEach(child => {
                setIngore(child)
            })
        }
    }

    function addSplineObject(position?: THREE.Vector3) {
        const material = new THREE.MeshLambertMaterial({ color: Math.random() * 0xffffff });
        const object = new THREE.Mesh(geometry, material);

        if (position) {

            object.position.copy(position);

        } else {

            object.position.x = Math.random() * 100 - 50;
            object.position.y = Math.random() * 60;
            object.position.z = Math.random() * 80 - 40;

        }

        object.castShadow = true;
        object.receiveShadow = true;
        object.scale.set(params.scale, params.scale, params.scale);
        setIngore(object)
        const transformGroup = scene.getObjectByName(GroupName);
        transformGroup?.add(object);
        splineHelperObjects.push(object);
        return object;

    }

    function addPoint() {

        splinePointsLength++;

        positions.push(addSplineObject(controls.target).position);

        updateSplineOutline();

        render();

    }

    function removePoint(clearAll: boolean = false) {

        if (splinePointsLength <= 4 && !clearAll) {

            return;

        }

        const point = splineHelperObjects.pop();
        splinePointsLength--;
        positions.pop();

        if (transformControl.object === point) transformControl.detach();
        point!.removeFromParent();
        point!.geometry.dispose();
        if (point!.material instanceof THREE.Material) {
            point!.material.dispose();
        }

        updateSplineOutline();
        render();

    }

    function updateSplineOutline() {
        if (destroying) return

        for (const k in splines) {

            const spline = splines[k];

            const splineMesh = spline.mesh;
            const position = splineMesh!.geometry.attributes.position;

            for (let i = 0; i < ARC_SEGMENTS; i++) {

                const t = i / (ARC_SEGMENTS - 1);
                spline.getPoint(t, point);
                position.setXYZ(i, point.x, point.y, point.z);

            }

            position.needsUpdate = true;

        }

    }

    function exportSpline() {

        const strplace = [];

        for (let i = 4; i < splinePointsLength; i++) {

            const p = splineHelperObjects[i].position;
            // strplace.push(`new THREE.Vector3(${p.x}, ${p.y}, ${p.z})`);
            strplace.push(`{ x:${p.x}, y:${p.y}, z:${p.z} }`);

        }


        console.log(strplace.join(',\n'));
        const code = '[' + (strplace.join(',\n\t')) + ']';
        // prompt('添加的虚拟节点坐标依次为：', code);
        // eventBus.publish('exportVirtualNode', code);
    }

    function load(new_positions: THREE.Vector3[]) {

        while (new_positions.length > positions.length) {

            addPoint();

        }

        while (new_positions.length < positions.length) {

            removePoint();

        }

        for (let i = 0; i < positions.length; i++) {

            positions[i].copy(new_positions[i]);

        }

        updateSplineOutline();

    }

    function render() {
        // if (!splines.uniform || !splines.centripetal || !splines.chordal) return;
        if (!splines.uniform) return;

        splines.uniform.mesh!.visible = params.uniform;
        // splines.centripetal.mesh!.visible = params.centripetal;
        // splines.chordal.mesh!.visible = params.chordal;
    }

    function onPointerDown(event: MouseEvent) {

        onDownPosition.x = event.clientX;
        onDownPosition.y = event.clientY;

    }

    function onPointerUp(event: MouseEvent) {

        onUpPosition.x = event.clientX;
        onUpPosition.y = event.clientY;

        if (onDownPosition.distanceTo(onUpPosition) === 0) {

            transformControl.detach();
            render();

        }

    }

    function onPointerMove(event: MouseEvent) {

        pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
        pointer.y = - (event.clientY / window.innerHeight) * 2 + 1;

        raycaster.setFromCamera(pointer, camera);

        const intersects = raycaster.intersectObjects(splineHelperObjects, false);

        if (intersects.length > 0) {

            const object = intersects[0].object;

            if (object !== transformControl.object) {

                transformControl.attach(object);

            }

        }

    }

    function remove() {
        destroying = true
        document.removeEventListener('pointerdown', onPointerDown);
        document.removeEventListener('pointerup', onPointerUp);
        document.removeEventListener('pointermove', onPointerMove);

        while (splineHelperObjects.length > 0) {
            removePoint(true);
        }

        for (const k in splines) {
            const spline = splines[k];
            spline.mesh!.removeFromParent();
            spline.mesh!.geometry.dispose();
            if (spline.mesh!.material instanceof THREE.Material) {
                spline.mesh!.material.dispose();
            }
        }
        transformHelper.removeFromParent();
        //销毁gui
        gui.destroy();

        transformHelper.dispose();
    }

    function getGui(){
        return gui
    }

    return {
        remove,
        getGui
    }
}

export default useTransformControls;