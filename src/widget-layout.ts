export interface WidgetViewport {width:number;height:number}
export interface WidgetPosition {x:number;y:number}
const PAD=12;

export function widgetDimensions(viewport:WidgetViewport,minimized:boolean,touch:boolean){
  const availableWidth=Math.max(1,viewport.width-PAD*2);
  const width=Math.min(minimized && !touch?240:320,availableWidth);
  const narrow=minimized && width<220;
  const height=Math.min(minimized?(narrow?112:touch?64:56):(width<280?240:touch?164:140),Math.max(1,viewport.height-PAD*2));
  return {width,height,narrow};
}

// Clamp a preferred position for this viewport without overwriting it. A
// temporary small window should not erase the user's position on a larger one.
export function widgetPosition(viewport:WidgetViewport,size:WidgetViewport,preferred?:WidgetPosition|null):WidgetPosition {
  const maxX=Math.max(0,viewport.width-size.width),maxY=Math.max(0,viewport.height-size.height);
  const padX=Math.min(PAD,maxX/2),padY=Math.min(PAD,maxY/2);
  return {x:Math.max(padX,Math.min(preferred?.x??viewport.width-size.width-24,maxX-padX)),y:Math.max(padY,Math.min(preferred?.y??viewport.height-size.height-36,maxY-padY))};
}
