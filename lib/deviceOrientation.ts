import * as THREE from "three";

const HALF_SQRT_TWO = Math.sqrt(0.5);
const DEVICE_TO_CAMERA = new THREE.Quaternion(
  -HALF_SQRT_TWO,
  0,
  0,
  HALF_SQRT_TWO,
);
const SCREEN_AXIS = new THREE.Vector3(0, 0, 1);

/**
 * Convert W3C DeviceOrientation angles to Three.js camera orientation.
 *
 * Device angles use intrinsic Z-X'-Y'' rotations. Three's camera looks down
 * local -Z, so the result also includes device-to-camera and screen rotation.
 */
export function deviceOrientationQuaternion(
  alpha: number,
  beta: number,
  gamma: number,
  screenOrientation: number,
  target = new THREE.Quaternion(),
) {
  const euler = new THREE.Euler(
    THREE.MathUtils.degToRad(beta),
    THREE.MathUtils.degToRad(alpha),
    -THREE.MathUtils.degToRad(gamma),
    "YXZ",
  );
  const screenRotation = new THREE.Quaternion().setFromAxisAngle(
    SCREEN_AXIS,
    -THREE.MathUtils.degToRad(screenOrientation),
  );

  return target
    .setFromEuler(euler)
    .multiply(DEVICE_TO_CAMERA)
    .multiply(screenRotation)
    .normalize();
}

/** Camera-space change since calibration. */
export function relativeDeviceOrientation(
  initial: THREE.Quaternion,
  current: THREE.Quaternion,
  target = new THREE.Quaternion(),
) {
  return target.copy(initial).invert().premultiply(current).normalize();
}
