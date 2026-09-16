import { describe, expect, it } from "vitest";
import * as THREE from "three";

import {
  deviceOrientationQuaternion,
  orbitPositionFromOrientation,
  relativeDeviceOrientation,
} from "./deviceOrientation";

const cameraNormal = (quaternion: THREE.Quaternion) =>
  new THREE.Vector3(0, 0, 1).applyQuaternion(quaternion);

describe("device orientation", () => {
  it("calibrates the initial pose to identity", () => {
    const initial = deviceOrientationQuaternion(31, 72, -8, 0);
    const relative = relativeDeviceOrientation(initial, initial);

    expect(relative.angleTo(new THREE.Quaternion())).toBeLessThan(1e-7);
  });

  it("maps portrait roll onto horizontal camera movement", () => {
    const initial = deviceOrientationQuaternion(0, 90, 0, 0);
    const current = deviceOrientationQuaternion(0, 90, 20, 0);
    const normal = cameraNormal(relativeDeviceOrientation(initial, current));

    expect(normal.x).toBeGreaterThan(0);
    expect(Math.abs(normal.y)).toBeLessThan(1e-7);
  });

  it("maps portrait pitch onto vertical camera movement", () => {
    const initial = deviceOrientationQuaternion(0, 90, 0, 0);
    const current = deviceOrientationQuaternion(0, 110, 0, 0);
    const normal = cameraNormal(relativeDeviceOrientation(initial, current));

    expect(normal.y).toBeLessThan(0);
    expect(Math.abs(normal.x)).toBeLessThan(1e-7);
  });

  it("compensates for screen rotation", () => {
    const portrait = deviceOrientationQuaternion(0, 90, 0, 0);
    const landscape = deviceOrientationQuaternion(0, 90, 0, 90);

    expect(THREE.MathUtils.radToDeg(portrait.angleTo(landscape))).toBeCloseTo(
      90,
      6,
    );
  });

  it("keeps camera on a fixed-radius orbit around scene center", () => {
    const focus = new THREE.Vector3(0, 0, -2);
    const orientation = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(0.15, -0.2, 0),
    );
    const position = orbitPositionFromOrientation(focus, 20, orientation);

    expect(position.distanceTo(focus)).toBeCloseTo(20, 7);
  });

  it("does not move orbit position when phone only rolls", () => {
    const focus = new THREE.Vector3(0, 0, -2);
    const roll = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 0, 1),
      Math.PI / 3,
    );
    const position = orbitPositionFromOrientation(focus, 20, roll);

    expect(position.x).toBeCloseTo(0, 7);
    expect(position.y).toBeCloseTo(0, 7);
    expect(position.z).toBeCloseTo(18, 7);
  });
});
