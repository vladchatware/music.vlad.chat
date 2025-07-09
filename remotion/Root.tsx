import React, { useState } from 'react';
import { Composition, staticFile } from 'remotion';
import { parseMedia } from '@remotion/media-parser';
import { MyComposition } from './Composition';
import { schema } from './types';

export const RemotionRoot: React.FC = () => {
  return (<Composition
    id="Main"
    component={MyComposition}
    durationInFrames={360}
    fps={30}
    width={720}
    height={1280}
    schema={schema}
    defaultProps={{
      image: 'path',
      username: 'vlad.chat',
      content: 'If hard work leads to success, the donkey would own the farm.',
      sound: 'speech-1.mp3'
    }}
    calculateMetadata={async ({ props }) => {
      const { slowDurationInSeconds } = await parseMedia({
        src: staticFile(props.sound),
        fields: { slowDurationInSeconds: true }
      })

      return {
        durationInFrames: Math.floor((slowDurationInSeconds + 10) * 30)
      }
    }}
  />);
};
