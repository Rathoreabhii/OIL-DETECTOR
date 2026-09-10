import GUI from 'lil-gui';

export function createGui(env, { onWindChange, onResetCamera }) {
  const gui = new GUI({ title: 'Environment' });

  const current = gui.addFolder('Current (water transport)');
  current.add(env.current, 'speed', 0, 2.5, 0.01).name('speed m/s');
  current.add(env.current, 'direction', 0, 360, 1).name('toward °');
  current.add(env.current, 'influence', 0, 1, 0.01).name('influence');
  current.add(env.current, 'visible').name('show drift');
  current.open();

  const wind = gui.addFolder('Wind (atmospheric forcing)');
  wind.add(env.wind, 'speed', 0.5, 22, 0.1).name('speed m/s').onFinishChange(onWindChange);
  wind.add(env.wind, 'direction', 0, 360, 1).name('toward °').onFinishChange(onWindChange);
  wind.add(env.wind, 'influence', 0, 1, 0.01).onFinishChange(onWindChange);
  wind.add(env.wind, 'fetch', 5000, 200000, 1000).onFinishChange(onWindChange);

  const ocean = gui.addFolder('Ocean');
  ocean.add(env.ocean, 'waveAmplitude', 0.15, 1.8, 0.01).onFinishChange(onWindChange);
  ocean.add(env.ocean, 'choppiness', 0, 2.2, 0.01);
  ocean.add(env.ocean, 'waveSpeed', 0.2, 2, 0.01);
  ocean.add(env.ocean, 'swell', 0, 1.5, 0.01);
  ocean.add(env.ocean, 'microDetail', 0, 1.5, 0.01);
  ocean.add(env.ocean, 'foamAmount', 0, 1.5, 0.01);

  const sun = gui.addFolder('Sun / sky');
  sun.add(env.sun, 'elevation', 2, 80, 0.1);
  sun.add(env.sun, 'azimuth', 0, 360, 1);
  sun.add(env.sun, 'intensity', 0.2, 8, 0.05);
  sun.addColor(env.sun, 'color');
  sun.add(env.atmosphere, 'exposure', 0.1, 1.2, 0.01);

  const water = gui.addFolder('Water color');
  water.addColor(env.water, 'deepColor');
  water.addColor(env.water, 'shallowColor');
  water.add(env.water, 'roughness', 0.01, 0.3, 0.001);
  water.add(env.water, 'specular', 0.2, 3, 0.01);
  water.add(env.water, 'reflectionIntensity', 0.2, 1.6, 0.01);

  gui.add({ reset: onResetCamera }, 'reset').name('Reset camera');
  return gui;
}
