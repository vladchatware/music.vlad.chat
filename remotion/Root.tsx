import React from 'react';
import {Composition} from 'remotion';
import {MyComposition} from './Composition';
import { schema } from './types';
 
export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="Main"
        component={MyComposition}
        durationInFrames={120}
        fps={30}
        width={720}
        height={1280}
        schema={schema}
        defaultProps={{
          image: 'path',
          username: 'vlad.chat',
          content: 'If hard work leads to success, the donkey would own the farm.'
        }}
      />
    </>
  );
};
