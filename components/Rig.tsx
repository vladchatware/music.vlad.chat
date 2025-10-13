import { useFrame } from '@react-three/fiber'
import { easing } from 'maath'

export const Rig = () => {
  useFrame((state, delta) => {
    easing.damp3(state.camera.position, [state.pointer.x * 2, state.pointer.y * 2, 18], 0.35, delta)
    state.camera.lookAt(0, 0, -10)
  })

  return null
}
