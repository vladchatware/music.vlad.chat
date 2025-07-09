import React from 'react'
import { Audio, AbsoluteFill, Img, staticFile, Sequence } from "remotion";
import { loadFont } from '@remotion/google-fonts/Roboto';
const { fontFamily } = loadFont(); // "Titan One"
import { CameraMotionBlur } from '@remotion/motion-blur';

const styles = {
  container: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(241, 241, 241, 1)'
  },
  content: {
    width: 592,
    minHeight: 255,
    backgroundColor: 'rgba(255, 255, 255, 1)',
    paddingLeft: 16,
    paddingRight: 16,
    borderRadius: 21,
    boxShadow: '1px 1px 60px 5px rgba(0, 0, 0, 0.25)'
  },
  innerContaner: {
    paddingTop: 27,
    paddingBottom: 27
  },
  header: {
    display: 'flex',
    flexDirection: 'row',
    justifyContent: 'space-between',
    // backgroundColor: 'rgba(130, 0, 255, 0.4)',
    alignItems: 'center',
    paddingBottom: 6
  },
  p: {
    margin: 0,
    padding: 0,
    fontSize: 22,
    lineHeight: 1.1,
    fontFamily,
    letterSpacing: 0.3
  },
  mainP: {
    margin: 0,
    padding: 0,
    fontSize: 24,
    lineHeight: 1.2,
    fontFamily,
    letterSpacing: 0.5
  },
  trailing: {

  },
  main: {
    paddingTop: 14,
    paddingBottom: 5,
  },
  footer: {
  }
}


export const MyComposition = ({ image, username, content, sound }) => {
  return (<CameraMotionBlur shutterAngle={280} samples={1}>
    <AbsoluteFill style={styles.container}>
      <div style={styles.content}>
        <div style={styles.innerContaner}>
          <header style={styles.header}>
            <div style={{ ...styles.p, width: 50, height: 50, borderRadius: 100, marginTop: -12, marginLeft: 1, marginRight: 16 }}>
              <Img src={staticFile(image)} width={50} height={50} />
            </div>
            <div style={{ display: 'flex', flexGrow: 1, justifyContent: 'space-between' }}>
              <p style={styles.p}>{username}</p>
              <p></p>
            </div>
            <p style={{ ...styles.p, width: 40, height: 40, borderRadius: 100, marginTop: 0, marginRight: 0 }}></p>
          </header>
          <main style={styles.main}>
            <p style={styles.mainP}>{content}</p>
            {/* <p style={{...styles.mainP, paddingTop: 14}}>Work hard 🫏</p> */}
          </main>
        </div>
      </div>
    </AbsoluteFill>
    <Sequence from={10}>
      <Audio src={staticFile(sound)} />
    </Sequence>
  </CameraMotionBlur>
  );
};
