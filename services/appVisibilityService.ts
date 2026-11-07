// Set by the existing root's platform listeners. Browser APIs are never accessed at module initialization.
let visible=true;
export function setAppVisible(value:boolean) { visible=value; }
export function isAppVisible():boolean { return visible; }
