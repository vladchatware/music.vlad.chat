import React, { useRef } from 'react'
import { Container, Root, Text, Content } from '@react-three/uikit'
import { Defaults, colors } from '@react-three/uikit-default'

export function CardPage() {
  const openRef = useRef(false)
  return (
    <Root flexDirection="column" pixelSize={0.01} sizeX={4.4}>
      <Defaults>
        <Container
          backgroundColor={0xffffff}
          dark={{ backgroundColor: 0x0 }}
          borderRadius={20}
          cursor="pointer"
          flexDirection="column"
          zIndex={10}
        >
          <Content transformTranslateZ={1} padding={14} keepAspectRatio={false} width="100%" height={400}>
            <Text>Test</Text>
          </Content>
          <Container
            backgroundColor={0xffffff}
            dark={{ backgroundColor: 0x0 }}
            flexDirection="row"
            padding={28}
            paddingTop={28 + 4}
            alignItems="center"
            justifyContent="space-between"
            borderBottomRadius={20}
            castShadow
          >
            <Container flexDirection="column" gap={8}>
              <Text fontWeight="normal" fontSize={24} lineHeight="100%">
                VanArsdel Marketing
              </Text>
              <Text fontSize={20} fontWeight="medium" letterSpacing={-0.4} color={colors.primary}>
                1 activities for you
              </Text>
            </Container>
          </Container>
        </Container>
      </Defaults>
    </Root >
  )
}
