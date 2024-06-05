import * as THREE from 'https://esm.sh/three@0.128.0';
import { GLTFLoader } from 'https://esm.sh/three@0.128.0/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'https://esm.sh/three@0.128.0/examples/jsm/controls/OrbitControls.js';

let scene, camera, renderer, controls, world;
let diceModels = {};
let rolling = false;
const minVelocity = 0.01;

function init() {
    // Three.js setup
    scene = new THREE.Scene();
    const aspect = window.innerWidth / window.innerHeight;
    const d = 20;
    camera = new THREE.OrthographicCamera(-d * aspect, d * aspect, d, -d, 1, 1000);
    camera.position.set(30, 20, 30);
    camera.lookAt(0, 0, 0);

    renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('scene'), antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enablePan = false;
    controls.minZoom = 0.5;
    controls.maxZoom = 2;

    const directionalLight1 = new THREE.DirectionalLight(0xffffff, 5.0); // Increased intensity
    directionalLight1.position.set(5, 10, 7.5);
    scene.add(directionalLight1);

    const directionalLight2 = new THREE.DirectionalLight(0xffffff, 5.0); // Increased intensity
    directionalLight2.position.set(-5, 10, 7.5);
    scene.add(directionalLight2);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6); // Increased intensity and color to white
    scene.add(ambientLight);

    const groundGeometry = new THREE.PlaneGeometry(100, 100);
    const groundMaterial = new THREE.MeshStandardMaterial({ color: 0x808080, side: THREE.DoubleSide, transparent: true, opacity: 0 });
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);

    // Cannon.js setup
    world = new CANNON.World();
    world.gravity.set(0, -9.82, 0); // m/s²

    const groundBody = new CANNON.Body({
        mass: 0, // mass == 0 makes the body static
        shape: new CANNON.Plane()
    });
    groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    world.addBody(groundBody);

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
            console.log(`Loaded model for ${type}`);
            model.traverse((node) => {
                if (node.isMesh) {
                    // Ensure the existing material with textures is used
                    node.material = node.material.clone();
                }
            });
            diceModels[type] = model;
        }, undefined, (error) => {
            console.error('An error happened loading the model', error);
        });
    });
}


function createDiceBody(dice, type) {
    const vertices = [];
    const faces = [];

    dice.traverse((node) => {
        if (node.isMesh) {
            const geometry = node.geometry;
            const position = geometry.attributes.position.array;
            const index = geometry.index.array;

            for (let i = 0; i < position.length; i += 3) {
                vertices.push(new CANNON.Vec3(position[i], position[i + 1], position[i + 2]));
            }
            for (let i = 0; i < index.length; i += 3) {
                faces.push([index[i], index[i + 1], index[i + 2]]);
            }
        }
    });

    // Create unique vertices
    const uniqueVertices = Array.from(new Set(vertices.map(v => `${v.x},${v.y},${v.z}`)))
                                .map(str => {
                                    const [x, y, z] = str.split(',').map(Number);
                                    return new CANNON.Vec3(x, y, z);
                                });

    // Create a map from old vertex indices to new vertex indices
    const vertexMap = {};
    vertices.forEach((v, i) => {
        const key = `${v.x},${v.y},${v.z}`;
        if (!vertexMap[key]) {
            vertexMap[key] = uniqueVertices.findIndex(uv => uv.x === v.x && uv.y === v.y && uv.z === v.z);
        }
    });

    // Map faces to unique vertices
    const uniqueFaces = faces.map(face => face.map(index => vertexMap[`${vertices[index].x},${vertices[index].y},${vertices[index].z}`]));

    const shape = new CANNON.ConvexPolyhedron(uniqueVertices, uniqueFaces);
    const body = new CANNON.Body({ mass: 5 });
    body.addShape(shape);
    body.position.set(dice.position.x, dice.position.y, dice.position.z);
    body.quaternion.set(dice.quaternion.x, dice.quaternion.y, dice.quaternion.z, dice.quaternion.w);

    return body;
}

function rollDice() {
    // Remove all previous dice from the scene and world
    const toRemove = [];
    scene.children.forEach(child => {
        if (child.type === 'Group' || (child.type === 'Mesh' && child.material.transparent)) {
            toRemove.push(child);
        }
    });
    toRemove.forEach(child => scene.remove(child));

    world.bodies = world.bodies.filter(body => body.mass === 0);

    const diceType = document.getElementById('dice-type').value;
    const diceCount = parseInt(document.getElementById('dice-count').value);

    if (!diceModels[diceType]) {
        console.error(`Model for ${diceType} not loaded yet.`);
        return;
    }

    rolling = true;

    const spacing = 10; // Increase spacing to reduce the chance of initial overlaps
    const positions = [];

    // Function to check if a position is valid
    function isPositionValid(newPosition) {
        for (const position of positions) {
            if (position.distanceTo(newPosition) < spacing) {
                return false;
            }
        }
        return true;
    }

    // Function to create bounding boxes for initial position validation
    function createBoundingBox(dice) {
        const box = new THREE.Box3().setFromObject(dice);
        return box;
    }

    for (let i = 0; i < diceCount; i++) {
        let position;
        let attempts = 0;
        do {
            position = new THREE.Vector3(
                Math.random() * 40 - 20,
                Math.random() * 4 + 2 + 0.5,
                Math.random() * 40 - 20
            );
            attempts++;
            if (attempts > 1000) {
                console.error('Unable to find a valid position for the dice');
                return;
            }
        } while (!isPositionValid(position));

        positions.push(position);

        const dice = diceModels[diceType].clone();
        dice.position.copy(position);
        dice.rotation.set(
            Math.random() * Math.PI * 2,
            Math.random() * Math.PI * 2,
            Math.random() * Math.PI * 2
        );
        dice.scale.set(1.0, 1.0, 1.0);

        const body = createDiceBody(dice, diceType);
        
        // Apply initial random angular velocity for spin
        body.angularVelocity.set(
            (Math.random() - 0.5) * 30,
            (Math.random() - 0.5) * 30,
            (Math.random() - 0.5) * 30
        );
        
        // Apply initial random linear velocity
        body.velocity.set(
            (Math.random() - 0.5) * 20,
            (Math.random() - 0.5) * 20,
            (Math.random() - 0.5) * 20
        );
        
        // Apply linear damping and angular damping
        body.linearDamping = 0.2;
        body.angularDamping = 0.2;

        world.addBody(body);

        dice.userData.physicsBody = body;
        scene.add(dice);
    }
}

function animate() {
    requestAnimationFrame(animate);

    if (rolling) {
        world.step(1 / 60);

        let allStopped = true;
        scene.children.forEach(child => {
            if (child.userData.physicsBody) {
                const body = child.userData.physicsBody;
                child.position.copy(body.position);
                child.quaternion.copy(body.quaternion);

                if (body.velocity.length() > minVelocity || body.angularVelocity.length() > minVelocity) {
                    allStopped = false;
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

document.addEventListener('DOMContentLoaded', () => {
    init();
    loadDiceModels();
    animate();

    document.getElementById('roll-button').addEventListener('click', rollDice);
});
