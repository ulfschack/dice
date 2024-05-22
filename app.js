import * as THREE from 'https://esm.sh/three@0.128.0';
import { GLTFLoader } from 'https://esm.sh/three@0.128.0/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'https://esm.sh/three@0.128.0/examples/jsm/controls/OrbitControls.js';

let scene, camera, renderer, controls, directionalLight1, directionalLight2, ambientLight;
let diceModels = {};
let rolling = false;
const deceleration = 0.95;
const minVelocity = 0.01;

function init() {
    scene = new THREE.Scene();

    const aspect = window.innerWidth / window.innerHeight;
    const d = 20;
    camera = new THREE.OrthographicCamera(-d * aspect, d * aspect, d, -d, 1, 1000);
    camera.position.set(30, 20, 30); // Lowered camera position
    camera.lookAt(0, 0, 0);

    renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('scene'), antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enablePan = false;
    controls.minZoom = 0.5;
    controls.maxZoom = 2;

    // Add multiple light sources for better contrast
    directionalLight1 = new THREE.DirectionalLight(0xffffff, 0.4);
    directionalLight1.position.set(5, 10, 7.5);
    scene.add(directionalLight1);

    directionalLight2 = new THREE.DirectionalLight(0xffffff, 0.4);
    directionalLight2.position.set(-5, 10, -7.5);
    scene.add(directionalLight2);

    ambientLight = new THREE.AmbientLight(0x888888, 0.8); // Reduced intensity for better contrast
    scene.add(ambientLight);

    window.addEventListener('resize', onWindowResize, false);
}

function onWindowResize() {
    const aspect = window.innerWidth / window.innerHeight;
    const d = 20;
    camera.left = -d * aspect;
    camera.right = d * aspect;
    camera.top = d;
    camera.bottom = -d;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function loadDiceModels() {
    const loader = new GLTFLoader();
    const diceTypes = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20'];

    diceTypes.forEach(type => {
        loader.load(`models/${type}.glb`, (gltf) => {
            const model = gltf.scene;
            if (type === 'd4') {
                // Rotate the d4 model by 180 degrees around the X-axis
                model.rotation.x = Math.PI;
            }
            model.traverse((node) => {
                if (node.isMesh) {
                    node.material = new THREE.MeshStandardMaterial({ color: node.material.color });
                }
            });
            diceModels[type] = model;
        }, undefined, (error) => {
            console.error('An error happened loading the model', error);
        });
    });
}

function rollDice() {
    // Remove all previous dice from the scene
    const toRemove = [];
    scene.children.forEach(child => {
        if (child !== directionalLight1 && child !== directionalLight2 && child !== ambientLight) {
            toRemove.push(child);
        }
    });
    toRemove.forEach(child => scene.remove(child));

    const diceType = document.getElementById('dice-type').value;
    const diceCount = parseInt(document.getElementById('dice-count').value);

    if (!diceModels[diceType]) {
        console.error(`Model for ${diceType} not loaded yet.`);
        return;
    }

    rolling = true;

    const spacing = 15; // Increased spacing for better separation
    const positions = [];

    for (let i = 0; i < diceCount; i++) {
        let position;
        do {
            position = new THREE.Vector3(
                Math.random() * 40 - 20,
                Math.random() * 4 + 2 + 0.5, // Ensure the dice are above the floor plane
                Math.random() * 40 - 20
            );
        } while (positions.some(p => p.distanceTo(position) < spacing));

        positions.push(position);

        const dice = diceModels[diceType].clone();
        dice.position.copy(position);
        dice.rotation.set(
            Math.random() * Math.PI * 2,
            Math.random() * Math.PI * 2,
            Math.random() * Math.PI * 2
        );
        dice.scale.set(1.5, 1.5, 1.5);
        dice.userData.velocity = new THREE.Vector3(
            Math.random() * 0.5 - 0.25,
            Math.random() * 0.5 - 0.25,
            Math.random() * 0.5 - 0.25
        );
        dice.userData.type = diceType;
        scene.add(dice);
    }
}

function snapToNearestFace(dice) {
    const type = dice.userData.type;

    let orientations;
    if (type === 'd4') {
        orientations = [
            new THREE.Euler(Math.PI / 2, 0, Math.PI / 4),
            new THREE.Euler(-Math.PI / 2, 0, -Math.PI / 4),
            new THREE.Euler(0, Math.PI / 2, Math.PI / 4),
            new THREE.Euler(0, -Math.PI / 2, -Math.PI / 4)
        ];
    } else {
        orientations = [
            new THREE.Euler(0, 0, 0),
            new THREE.Euler(Math.PI / 2, 0, 0),
            new THREE.Euler(Math.PI, 0, 0),
            new THREE.Euler(-Math.PI / 2, 0, 0),
            new THREE.Euler(0, Math.PI / 2, 0),
            new THREE.Euler(0, -Math.PI / 2, 0),
            new THREE.Euler(0, 0, Math.PI / 2),
            new THREE.Euler(0, 0, -Math.PI / 2)
        ];
    }

    let closest = orientations[0];
    let minDist = Infinity;
    orientations.forEach(orientation => {
        const dist = new THREE.Quaternion().setFromEuler(dice.rotation).angleTo(new THREE.Quaternion().setFromEuler(orientation));
        if (dist < minDist) {
            minDist = dist;
            closest = orientation;
        }
    });

    dice.rotation.copy(closest);

    // Adjust for slight inaccuracies
    dice.rotation.x = Math.round(dice.rotation.x / (Math.PI / 2)) * (Math.PI / 2);
    dice.rotation.y = Math.round(dice.rotation.y / (Math.PI / 2)) * (Math.PI / 2);
    dice.rotation.z = Math.round(dice.rotation.z / (Math.PI / 2)) * (Math.PI / 2);
}

function animate() {
    requestAnimationFrame(animate);

    if (rolling) {
        let allStopped = true;

        scene.children.forEach(child => {
            if (child.userData.velocity) {
                child.rotation.x += child.userData.velocity.x;
                child.rotation.y += child.userData.velocity.y;
                child.rotation.z += child.userData.velocity.z;

                child.userData.velocity.multiplyScalar(deceleration);

                if (child.userData.velocity.length() > minVelocity) {
                    allStopped = false;
                } else {
                    child.userData.velocity.set(0, 0, 0);
                    snapToNearestFace(child);
                }
            }
        });

        if (allStopped) {
            rolling = false;
        }
    }

    controls.update();
    renderer.render(scene, camera);
}

export { init, loadDiceModels, animate, rollDice };
