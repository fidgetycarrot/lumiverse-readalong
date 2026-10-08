import {test,expect} from 'bun:test';
import {widgetDimensions,widgetPosition} from '../src/widget-layout';
import {normalizeSettings} from '../src/shared';

const screens=[{width:320,height:568},{width:360,height:800},{width:393,height:852},{width:412,height:915},{width:800,height:360},{width:768,height:1024},{width:640,height:480},{width:1366,height:768},{width:1920,height:1080}];
test('both widget modes stay on screen across phone, landscape, tablet and desktop viewports',()=>{
  for(const viewport of screens)for(const minimized of [false,true]){
    const size=widgetDimensions(viewport,minimized,viewport.width<=600),pos=widgetPosition(viewport,size,{x:1770,y:970});
    expect(pos.x).toBeGreaterThanOrEqual(12);expect(pos.y).toBeGreaterThanOrEqual(12);
    expect(pos.x+size.width).toBeLessThanOrEqual(viewport.width-12);expect(pos.y+size.height).toBeLessThanOrEqual(viewport.height-12);
  }
});
test('phone compact mode leaves room for four 44px buttons and a status label',()=>{
  const size=widgetDimensions({width:320,height:568},true,true);
  expect(size.width).toBe(296);expect(size.height).toBe(64);expect(size.narrow).toBe(false);
  expect(size.width-16-18-4*44).toBeGreaterThan(70);
});
test('desktop compact mode retains the small bar, including a touch tablet in landscape',()=>{
  expect(widgetDimensions({width:1366,height:768},true,false)).toMatchObject({width:240,height:56});
  expect(widgetDimensions({width:1024,height:768},true,true)).toMatchObject({width:320,height:64});
});
test('a large-screen preferred position returns after a temporary phone viewport',()=>{
  const preferred={x:1200,y:600},desktop={width:1920,height:1080},phone={width:360,height:800};
  expect(widgetPosition(phone,widgetDimensions(phone,true,true),preferred)).toEqual({x:28,y:600});
  expect(widgetPosition(desktop,widgetDimensions(desktop,true,false),preferred)).toEqual(preferred);
  expect(preferred).toEqual({x:1200,y:600});
});
test('expanding near an edge keeps controls visible; minimizing restores the preferred location',()=>{
  const viewport={width:360,height:800},preferred={x:28,y:724};
  expect(widgetPosition(viewport,widgetDimensions(viewport,false,true),preferred)).toEqual({x:28,y:624});
  expect(widgetPosition(viewport,widgetDimensions(viewport,true,true),preferred)).toEqual(preferred);
});
test('enlarged UI layouts use a compact button grid and allow expanded controls to wrap',()=>{
  const viewport={width:360/1.5,height:800/1.5};
  expect(widgetDimensions(viewport,true,true)).toMatchObject({width:216,height:112,narrow:true});
  expect(widgetDimensions(viewport,false,true)).toMatchObject({width:216,height:240});
});
test('very small temporary viewports cannot put the widget outside the viewport',()=>{
  for(const viewport of [{width:120,height:100},{width:20,height:20}]){
    const size=widgetDimensions(viewport,true,true),pos=widgetPosition(viewport,size,{x:500,y:500});
    expect(pos.x).toBeGreaterThanOrEqual(0);expect(pos.y).toBeGreaterThanOrEqual(0);
    expect(pos.x+size.width).toBeLessThanOrEqual(viewport.width);expect(pos.y+size.height).toBeLessThanOrEqual(viewport.height);
  }
});
test('saved mode and preferred position survive settings normalization; invalid positions do not',()=>{
  const settings=normalizeSettings({widgetMinimized:true,widgetPosition:{x:42,y:123}});
  expect(normalizeSettings(JSON.parse(JSON.stringify(settings)))).toMatchObject({widgetMinimized:true,widgetPosition:{x:42,y:123}});
  expect(normalizeSettings({widgetPosition:{x:Infinity,y:1}}).widgetPosition).toBeNull();
  expect(normalizeSettings({widgetPosition:{x:-1,y:1}}).widgetPosition).toBeNull();
});
